/**
 * SSH option programs and execution prefixes. Proposed programs are JSON DATA
 * only; fixed Bash hook argv reads synthetic inputs and never runs SSH/sudo.
 * @module tests/unit/hooks/parity-safety-net-agent-store-program-options
 */
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";

import profile from "./support/agent-store-program-options.json" with { type: "json" };

/** Source-pinned hook fixture used only for the explicit historical replay. */
interface HookFixture {
  label: string;
  hook: string;
  sha256: string;
}
const fixturePath = process.env["LISA_AGENT_STORE_PROGRAM_BASELINES"];
const fixtures: HookFixture[] = fixturePath
  ? (JSON.parse(readFileSync(fixturePath, "utf8")) as HookFixture[])
  : [
      "plugins/src/base/hooks/parity-safety-net.sh",
      "plugins/lisa/hooks/parity-safety-net.sh",
    ].map(hook => ({ label: "current", hook: path.resolve(hook), sha256: "" }));
let root: string;
let bodies: Record<string, string>;

/**
 * Identify the complete source/input bytes.
 * @param value Bytes to identify.
 * @returns SHA256 digest.
 */
const sha256 = (value: string | Buffer): string =>
  createHash("sha256").update(value).digest("hex");

beforeAll(() => {
  expect(fixtures).toHaveLength(fixturePath ? 4 : 2);
  if (fixturePath) {
    expect(fixtures.map(fixture => fixture.label)).toEqual([
      "d57-canonical",
      "d57-emitted",
      "intermediate622f-canonical",
      "intermediate622f-emitted",
    ]);
    for (const fixture of fixtures)
      expect(fixture.sha256).toMatch(/^[a-f0-9]{64}$/u);
  }
  root = mkdtempSync(path.join(tmpdir(), "lisa-agent-program-options-"));
  for (const name of [
    ".codex/artifacts/research/auth-design.md",
    ".npmrc; notes.md",
  ]) {
    const file = path.join(root, name);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, "Harmless synthetic notes.\n");
  }
  bodies = {
    "protected-body.sh": `cat '${root}/.codex/auth.json'\n`,
    "benign-body.sh": `cat '${root}/.codex/artifacts/research/auth-design.md'\n`,
  };
  for (const [name, body] of Object.entries(bodies))
    writeFileSync(path.join(root, name), body, { mode: 0o600 });
  for (const fixture of fixtures)
    if (fixture.sha256)
      expect(sha256(readFileSync(fixture.hook))).toBe(fixture.sha256);
});
afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

describe("parity-safety-net: agent store program options", () => {
  it.each(profile.cases)("$id", row => {
    const command = row.command.replaceAll("{root}", root);
    const input = JSON.stringify({
      tool_name: "Bash",
      tool_input: { command },
      cwd: root,
    });
    const receipts = fixtures.map(fixture => {
      const result = boundedSpawnSync({
        label: `agent-store-program-option: ${row.id}`,
        command: "/bin/bash",
        args: [fixture.hook],
        input,
        cwd: root,
        env: { ...process.env, HOME: root },
      });
      const receipt = {
        id: row.id,
        expected: row.expected,
        fixture: fixture.label,
        command,
        input,
        input_sha256: sha256(input),
        cwd: root,
        home: root,
        hook: fixture.hook,
        hook_sha256: sha256(readFileSync(fixture.hook)),
        invocation: ["/bin/bash", fixture.hook],
        bodies,
        observed_at: new Date().toISOString(),
        status: result.status,
        signal: result.signal,
        stdout: result.stdout,
        stderr: result.stderr,
      };
      console.info(`[agent-store-program-option] ${JSON.stringify(receipt)}`);
      return receipt;
    });
    for (const receipt of receipts) {
      expect(receipt.status, JSON.stringify(receipt)).toBe(row.expected);
      if (row.expected === 2)
        expect(receipt.stderr).toContain("Blocked by safety-net");
      else expect(receipt.stderr).not.toContain("Blocked by safety-net");
    }
  });
});
