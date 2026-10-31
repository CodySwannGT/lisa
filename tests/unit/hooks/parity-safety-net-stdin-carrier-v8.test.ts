/**
 * Literal stdin-program regression. Proposed commands and the ordinary script
 * are inert DATA: only fixed Bash hook argv executes, receiving PreToolUse JSON.
 * All controlled files contain declared nonsecret bytes in a fresh owned root.
 * @module tests/unit/hooks/parity-safety-net-stdin-carrier-v8
 */
import { createHash } from "node:crypto";
import {
  appendFileSync,
  chmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";

import profile from "./support/stdin-carrier-v8.json" with { type: "json" };

const journalPath = process.env["LISA_STDIN_CARRIER_V8_JOURNAL"];
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

/**
 * Identify source, input and synthetic file bytes.
 * @param value Bytes to identify.
 * @returns SHA256 digest.
 */
const sha256 = (value: string | Buffer): string =>
  createHash("sha256").update(value).digest("hex");

/**
 * Snapshot only the newly owned synthetic namespace, never operator files.
 * @returns Complete controlled inventory, contents, digests and modes.
 */
function snapshot() {
  const inventory = readdirSync(root, { recursive: true })
    .map(String)
    .sort((left, right) => left.localeCompare(right));
  return {
    root_mode: lstatSync(root).mode,
    inventory,
    entries: inventory.map(relative => {
      const file = path.join(root, relative);
      const stat = lstatSync(file);
      const contents = stat.isFile() ? readFileSync(file, "utf8") : null;
      return {
        path: relative,
        kind: stat.isFile()
          ? "file"
          : stat.isDirectory()
            ? "directory"
            : "other",
        mode: stat.mode,
        bytes: contents === null ? null : Buffer.byteLength(contents),
        contents,
        sha256: contents === null ? null : sha256(contents),
      };
    }),
  };
}

beforeAll(() => {
  expect(profile.cases).toHaveLength(12);
  root = mkdtempSync(path.join(tmpdir(), "lisa-stdin-carrier-v8-"));
  chmodSync(root, 0o700);
  for (const [relative, contents] of Object.entries(profile.fixture_files)) {
    const file = path.join(root, relative);
    mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    writeFileSync(file, contents, { mode: 0o600, flag: "wx" });
  }
});

afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

describe("parity-safety-net: literal stdin program ownership", () => {
  it.each(profile.cases)("$id", row => {
    const command = row.command.replaceAll("{root}", root);
    const input = JSON.stringify({
      tool_name: "Bash",
      tool_input: { command },
      cwd: root,
    });
    // Collect BOTH actual hook observations durably before any case assertion.
    const receipts = fixtures.map(fixture => {
      const before = snapshot();
      const startedAt = new Date().toISOString();
      const result = boundedSpawnSync({
        label: `stdin-carrier-v8: ${row.id}`,
        command: "/bin/bash",
        args: [fixture.hook],
        input,
        cwd: root,
        env: { ...process.env, HOME: root },
      });
      const after = snapshot();
      const receipt = {
        id: row.id,
        role: row.role,
        expected: row.expected,
        fixture: fixture.label,
        hook: fixture.hook,
        hook_sha256: sha256(readFileSync(fixture.hook)),
        invocation: ["/bin/bash", fixture.hook],
        command,
        input,
        input_sha256: sha256(input),
        cwd: root,
        home: root,
        started_at: startedAt,
        finished_at: new Date().toISOString(),
        runtime: process.version,
        platform: process.platform,
        status: result.status,
        signal: result.signal,
        error: result.error?.message ?? null,
        stdout: result.stdout,
        stderr: result.stderr,
        before,
        after,
      };
      if (journalPath)
        appendFileSync(journalPath, `${JSON.stringify(receipt)}\n`, {
          mode: 0o600,
        });
      console.info(`[stdin-carrier-v8] ${JSON.stringify(receipt)}`);
      return receipt;
    });
    for (const receipt of receipts) {
      expect(receipt.after, JSON.stringify(receipt)).toEqual(receipt.before);
      expect(receipt.error, JSON.stringify(receipt)).toBeNull();
      expect(receipt.signal, JSON.stringify(receipt)).toBeNull();
      expect(receipt.status, JSON.stringify(receipt)).toBe(row.expected);
      if (row.expected === 2)
        expect(receipt.stderr).toContain(
          "coding-agent or package-registry credential store"
        );
      else expect(receipt.stderr).not.toContain("Blocked by safety-net");
    }
  });
});
