/**
 * Finite review-boundary baseline. Proposed commands are inert PreToolUse JSON
 * for fixed Bash guard argv. Only the owned helper-fault shim executes; its
 * other Python calls delegate unchanged to the previously resolved interpreter.
 * @module tests/unit/hooks/parity-safety-net-review-boundaries-v9
 */
import { createHash } from "node:crypto";
import {
  accessSync,
  appendFileSync,
  chmodSync,
  constants,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";

import profile from "./support/review-boundaries-v9.json" with { type: "json" };

const journal = process.env["LISA_REVIEW_BOUNDARY_V9_JOURNAL"];
const freezePath = process.env["LISA_REVIEW_BOUNDARY_V9_FREEZE"];
const fixtures = [
  {
    label: "current-canonical",
    hook: path.resolve("plugins/src/base/hooks/parity-safety-net.sh"),
  },
  {
    label: "current-generated",
    hook: path.resolve("plugins/lisa/hooks/parity-safety-net.sh"),
  },
];
let root: string;
let home: string;
let toolDirectory: string;
let captureDirectory: string;
let python: string;
let shimSource: string;
let wirePaths: Record<string, string>;

/**
 * Identify exact source, input, tool and wire bytes.
 * @param value Bytes to identify.
 * @returns SHA256 digest.
 */
const sha256 = (value: string | Buffer): string =>
  createHash("sha256").update(value).digest("hex");

/**
 * Resolve the actual executable before any child-only PATH injection.
 * @returns Absolute real Python executable.
 */
function resolvedPython() {
  for (const directory of (process.env["PATH"] ?? "").split(path.delimiter)) {
    const candidate = path.join(directory, "python3");
    try {
      accessSync(candidate, constants.X_OK);
      return realpathSync(candidate);
    } catch {
      // Normal executable lookup; no service/authentication substitute.
    }
  }
  throw new Error("Required actual python3 executable is unavailable");
}

/**
 * Snapshot the complete owned fixture/tool namespace; journals live outside it.
 * @returns Recursive inventory, file contents, digests and modes.
 */
function snapshot() {
  return {
    root_mode: lstatSync(root).mode,
    entries: readdirSync(root, { recursive: true })
      .map(String)
      .sort((left, right) => left.localeCompare(right))
      .map(relative => {
        const file = path.join(root, relative);
        const info = lstatSync(file);
        const contents = info.isFile() ? readFileSync(file, "utf8") : null;
        return {
          path: relative,
          kind: info.isFile()
            ? "file"
            : info.isDirectory()
              ? "directory"
              : "other",
          mode: info.mode,
          contents,
          bytes: contents === null ? null : Buffer.byteLength(contents),
          sha256: contents === null ? null : sha256(contents),
        };
      }),
  };
}

/** Validate optional private evidence bindings without making CI depend on them. */
function validateOptionalFreeze() {
  if (freezePath) {
    const freeze = JSON.parse(readFileSync(freezePath, "utf8"));
    expect(python).toBe(freeze.tools.python.executable);
    expect(sha256(readFileSync(python))).toBe(
      freeze.tools.python.identity.sha256
    );
    expect(sha256(shimSource)).toBe(freeze.shim.sha256);
    expect(
      sha256(
        readFileSync(
          path.resolve("tests/unit/hooks/support/review-boundaries-v9.json")
        )
      )
    ).toBe(freeze.profile.sha256);
    for (const fixture of freeze.tools.hooks)
      for (const file of fixture.closure)
        expect(sha256(readFileSync(file.path))).toBe(file.identity.sha256);
  }
}

beforeAll(() => {
  expect(profile.cases).toHaveLength(9);
  python = resolvedPython();
  const helpers = fixtures.map(f =>
    path.join(path.dirname(f.hook), "parity-safety-net-heredoc.py")
  );
  shimSource = profile.helper_shim_template
    .replaceAll("__REAL_PYTHON__", python)
    .replaceAll("__REAL_PYTHON_JSON__", JSON.stringify(python))
    .replaceAll("__HELPERS_JSON__", JSON.stringify(helpers));
  validateOptionalFreeze();
  root = mkdtempSync(path.join(tmpdir(), "lisa-review-boundary-v9-"));
  chmodSync(root, 0o700);
  home = path.join(root, "home");
  toolDirectory = path.join(root, "tools");
  mkdirSync(home, { mode: 0o700 });
  mkdirSync(toolDirectory, { mode: 0o700 });
  captureDirectory = journal
    ? `${journal}.helper-calls`
    : mkdtempSync(path.join(tmpdir(), "lisa-review-boundary-capture-v9-"));
  if (journal) mkdirSync(captureDirectory, { mode: 0o700 });
  else chmodSync(captureDirectory, 0o700);
  for (const [relative, contents] of Object.entries(profile.fixture_files)) {
    const file = path.join(home, relative);
    mkdirSync(path.dirname(file), { mode: 0o700, recursive: true });
    writeFileSync(file, contents, { mode: 0o600, flag: "wx" });
  }
  writeFileSync(path.join(toolDirectory, "python3"), shimSource, {
    mode: 0o700,
    flag: "wx",
  });
  wirePaths = {};
  const wires = {
    "missing-body": profile.wire_templates["missing-body"],
    "known-body": `${JSON.stringify({
      body: profile.wire_templates["known-body"].body.replaceAll(
        "{root}",
        home
      ),
    })}\n`,
    "explicit-null": profile.wire_templates["explicit-null"],
  };
  for (const [mode, wire] of Object.entries(wires)) {
    wirePaths[mode] = path.join(toolDirectory, `${mode}.json`);
    writeFileSync(wirePaths[mode], wire, { mode: 0o600, flag: "wx" });
  }
  const setup = {
    at: new Date().toISOString(),
    root,
    home,
    python,
    python_sha256: sha256(readFileSync(python)),
    shim_source: shimSource,
    shim_sha256: sha256(shimSource),
    shim_mode: lstatSync(path.join(toolDirectory, "python3")).mode,
    wire_bytes: wires,
    wire_hashes: Object.fromEntries(
      Object.entries(wires).map(([key, wire]) => [key, sha256(wire)])
    ),
    full_initial_inventory: snapshot(),
  };
  if (journal)
    writeFileSync(`${journal}.setup.json`, `${JSON.stringify(setup)}\n`, {
      mode: 0o600,
      flag: "wx",
    });
});

afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
  if (captureDirectory && !journal)
    rmSync(captureDirectory, { recursive: true, force: true });
});

describe("parity-safety-net: review source boundaries v9", () => {
  it.each(profile.cases)("$id", row => {
    const command = row.command.replaceAll("{root}", home);
    const input = JSON.stringify({
      tool_name: "Bash",
      tool_input: { command },
      cwd: home,
    });
    const receipts = fixtures.map(fixture => {
      const helperLog = path.join(
        captureDirectory,
        `${row.id}-${fixture.label}.helper-calls.jsonl`
      );
      const env: NodeJS.ProcessEnv = { ...process.env, HOME: home };
      const wirePath = wirePaths[row.fault];
      const wire = wirePath ? readFileSync(wirePath, "utf8") : null;
      if (row.fault !== "none") {
        env["PATH"] =
          `${toolDirectory}${path.delimiter}${process.env["PATH"] ?? ""}`;
        env["LISA_REVIEW_BOUNDARY_V9_WIRE"] = wirePath;
        env["LISA_REVIEW_BOUNDARY_V9_HELPER_LOG"] = helperLog;
        writeFileSync(helperLog, "", { mode: 0o600, flag: "wx" });
      }
      const before = snapshot();
      const sourceIdentities = [
        "parity-safety-net.sh",
        "parity-safety-net-heredoc.py",
        "guard-dedupe.bash",
      ].map(leaf => {
        const file = path.join(path.dirname(fixture.hook), leaf);
        return {
          path: file,
          sha256: sha256(readFileSync(file)),
          mode: lstatSync(file).mode,
        };
      });
      const started = new Date().toISOString();
      const result = boundedSpawnSync({
        label: `review-boundary-v9: ${row.id}`,
        command: "/bin/bash",
        args: [fixture.hook],
        input,
        cwd: home,
        env,
      });
      const after = snapshot();
      const calls =
        row.fault === "none"
          ? []
          : readFileSync(helperLog, "utf8")
              .trim()
              .split("\n")
              .filter(Boolean)
              .map(line => JSON.parse(line));
      const receipt = {
        id: row.id,
        finding: row.finding,
        expected: row.expected,
        expected_category: row.expected_category,
        fixture: fixture.label,
        hook: fixture.hook,
        hook_sha256: sha256(readFileSync(fixture.hook)),
        source_identities_before_invocation: sourceIdentities,
        invocation: ["/bin/bash", fixture.hook],
        command,
        input,
        input_sha256: sha256(input),
        cwd: home,
        home,
        started_at: started,
        finished_at: new Date().toISOString(),
        runtime: process.version,
        platform: process.platform,
        status: result.status,
        signal: result.signal,
        error: result.error?.message ?? null,
        stdout: result.stdout,
        stderr: result.stderr,
        fault: row.fault,
        wire_path: wirePath ?? null,
        wire,
        wire_sha256: wire === null ? null : sha256(wire),
        resolved_python: python,
        python_sha256: sha256(readFileSync(python)),
        shim_sha256: sha256(shimSource),
        child_PATH_prefix: row.fault === "none" ? null : toolDirectory,
        helper_calls: calls,
        before,
        after,
      };
      if (journal)
        appendFileSync(journal, `${JSON.stringify(receipt)}\n`, {
          mode: 0o600,
        });
      console.info(`[review-boundary-v9] ${JSON.stringify(receipt)}`);
      return receipt;
    });
    // Both complete owner receipts are durable before the first assertion.
    for (const receipt of receipts) {
      expect(receipt.after, JSON.stringify(receipt)).toEqual(receipt.before);
      expect(receipt.error, JSON.stringify(receipt)).toBeNull();
      expect(receipt.signal, JSON.stringify(receipt)).toBeNull();
      expect(receipt.status, JSON.stringify(receipt)).toBe(row.expected);
      if (row.expected_category === "credential-store")
        expect(receipt.stderr).toContain(
          "Blocked by safety-net: reading, copying or transmitting a coding-agent or package-registry credential store"
        );
      else if (row.expected_category === "invalid-source-projection")
        expect(receipt.stderr).toContain(
          "Blocked by safety-net: cannot classify the file this command executes (literal stdin program): its source projection is invalid"
        );
      else expect(receipt.stderr).not.toContain("Blocked by safety-net");
      if (row.fault !== "none") {
        const interceptions = receipt.helper_calls.filter(
          call => call.action === "intercept"
        );
        expect(interceptions).toHaveLength(1);
        expect(interceptions[0].wire).toBe(receipt.wire);
        expect(interceptions[0].wire_sha256).toBe(receipt.wire_sha256);
      }
    }
  });
});
