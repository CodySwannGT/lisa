/**
 * Report-name regression: every proposed cat is inert JSON input to fixed Bash
 * hook argv. All files contain only the declared nonsecret synthetic sentinel;
 * no operator report/store or proposed shell command is read or executed.
 * @module tests/unit/hooks/parity-safety-net-agent-store-report-filenames
 */
import { createHash } from "node:crypto";
import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";

import profile from "./support/agent-store-report-filenames-v7.json" with { type: "json" };

/** Source-pinned complete hooks and faithful same-revision companions. */
interface HookFixture {
  label: string;
  hook: string;
  sha256: string;
  origin_revision?: string;
  closure?: { private_copy: string; identity: { sha256: string } }[];
}
const fixturePath = process.env["LISA_REPORT_FILENAME_V7_BASELINES"];
const journalPath = process.env["LISA_REPORT_FILENAME_V7_JOURNAL"];
const fixtures: HookFixture[] = fixturePath
  ? (JSON.parse(readFileSync(fixturePath, "utf8")) as HookFixture[])
  : [
      "plugins/src/base/hooks/parity-safety-net.sh",
      "plugins/lisa/hooks/parity-safety-net.sh",
    ].map((hook, index) => ({
      label: index === 0 ? "current-canonical" : "current-generated",
      hook: path.resolve(hook),
      sha256: "",
    }));
const STORE_DIAGNOSTIC = "coding-agent or package-registry credential store";
let root: string;

/**
 * Identify actual source, input or controlled fixture bytes.
 * @param value Bytes to identify.
 * @returns SHA256 digest.
 */
const sha256 = (value: string | Buffer): string =>
  createHash("sha256").update(value).digest("hex");

/**
 * Snapshot only the new owned synthetic namespace, including its file modes.
 * @returns Declared file identities and directory inventory.
 */
function snapshot() {
  return {
    inventory: readdirSync(root, { recursive: true })
      .map(String)
      .sort((left, right) => left.localeCompare(right)),
    files: profile.cases.map(row => {
      const file = path.join(root, row.file);
      const contents = readFileSync(file, "utf8");
      expect(contents).toBe(profile.sentinel);
      return {
        file: row.file,
        sha256: sha256(contents),
        mode: statSync(file).mode,
      };
    }),
  };
}

beforeAll(() => {
  expect(fixtures).toHaveLength(fixturePath ? 4 : 2);
  if (fixturePath)
    expect(fixtures.map(fixture => fixture.label)).toEqual([
      "main73a-canonical",
      "main73a-generated",
      "candidate0656-canonical",
      "candidate0656-generated",
    ]);
  root = mkdtempSync(path.join(tmpdir(), "lisa-report-filename-v7-"));
  for (const row of profile.cases) {
    const file = path.join(root, row.file);
    mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    writeFileSync(file, profile.sentinel, { mode: 0o600, flag: "wx" });
  }
  for (const fixture of fixtures) {
    if (fixture.sha256)
      expect(sha256(readFileSync(fixture.hook))).toBe(fixture.sha256);
    for (const companion of fixture.closure ?? [])
      expect(sha256(readFileSync(companion.private_copy))).toBe(
        companion.identity.sha256
      );
  }
});
afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

describe("parity-safety-net: synthetic report filenames", () => {
  it.each(profile.cases)("$id", row => {
    const command = row.command.replaceAll("{root}", root);
    const input = JSON.stringify({
      tool_name: "Bash",
      tool_input: { command },
      cwd: root,
    });
    const receipts = fixtures.map(fixture => {
      const before = snapshot();
      const startedAt = new Date().toISOString();
      const result = boundedSpawnSync({
        label: `report-filename-v7: ${row.id}`,
        command: "/bin/bash",
        args: [fixture.hook],
        input,
        cwd: root,
        env: { ...process.env, HOME: root },
      });
      const after = snapshot();
      const receipt = {
        id: row.id,
        expected: row.expected,
        fixture: fixture.label,
        origin: fixture.origin_revision ?? "current",
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
        stdout: result.stdout,
        stderr: result.stderr,
        before,
        after,
      };
      if (journalPath)
        appendFileSync(journalPath, `${JSON.stringify(receipt)}\n`, {
          mode: 0o600,
        });
      console.info(`[agent-report-filename-v7] ${JSON.stringify(receipt)}`);
      return receipt;
    });
    for (const receipt of receipts) {
      expect(receipt.after, JSON.stringify(receipt)).toEqual(receipt.before);
      expect(receipt.signal, JSON.stringify(receipt)).toBeNull();
      expect(receipt.status, JSON.stringify(receipt)).toBe(row.expected);
      if (row.expected === 2)
        expect(receipt.stderr).toContain(STORE_DIAGNOSTIC);
      else expect(receipt.stderr).not.toContain("Blocked by safety-net");
    }
  });
});
