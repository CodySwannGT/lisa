/**
 * Ten frozen SSH configuration/phase controls. Proposed programs are JSON DATA only,
 * never executed. Only fixed actual Bash hook argv reads the synthetic input.
 * @module tests/unit/hooks/parity-safety-net-agent-store-ssh-configuration
 */
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";

import profile from "./support/agent-store-ssh-configuration-v6.json" with { type: "json" };

/** Exact source-pinned full-hook fixture for the explicit historical replay. */
interface HookFixture {
  label: string;
  hook: string;
  sha256: string;
}
const fixturePath = process.env["LISA_AGENT_STORE_SSH_V6_BASELINES"];
const fixtures: HookFixture[] = fixturePath
  ? (JSON.parse(readFileSync(fixturePath, "utf8")) as HookFixture[])
  : [
      "plugins/src/base/hooks/parity-safety-net.sh",
      "plugins/lisa/hooks/parity-safety-net.sh",
    ].map((hook, index) => ({
      label: index === 0 ? "current-canonical" : "current-emitted",
      hook: path.resolve(hook),
      sha256: "",
    }));
let root: string;
const protectedStorePath = ".codex/auth.json";

/**
 * Identify complete source/input bytes.
 * @param value Bytes to identify.
 * @returns SHA256 digest.
 */
const sha256 = (value: string | Buffer): string =>
  createHash("sha256").update(value).digest("hex");

beforeAll(() => {
  expect(fixtures).toHaveLength(2);
  if (fixturePath) {
    expect(fixtures.map(fixture => fixture.label)).toEqual([
      "f5-canonical",
      "f5-emitted",
    ]);
    for (const fixture of fixtures)
      expect(fixture.sha256).toMatch(/^[a-f0-9]{64}$/u);
  }
  root = mkdtempSync(path.join(tmpdir(), "lisa-agent-option-controls-"));
  const notes = path.join(root, ".codex/artifacts/research/notes.md");
  mkdirSync(path.dirname(notes), { recursive: true });
  writeFileSync(notes, "Harmless neutral synthetic notes.\n");
  writeFileSync(path.join(root, "README.md"), "Harmless README.\n");
  for (const [name, body] of Object.entries(profile.fixture_files))
    writeFileSync(path.join(root, name), body);
  expect(existsSync(path.join(root, protectedStorePath))).toBe(false);
  for (const fixture of fixtures)
    if (fixture.sha256)
      expect(sha256(readFileSync(fixture.hook))).toBe(fixture.sha256);
});
afterAll(() => {
  if (root) {
    expect(existsSync(path.join(root, protectedStorePath))).toBe(false);
    for (const [name, body] of Object.entries(profile.fixture_files))
      expect(readFileSync(path.join(root, name), "utf8")).toBe(body);
    rmSync(root, { recursive: true, force: true });
  }
});

describe("parity-safety-net: SSH configuration and expansion phases", () => {
  it.each(profile.cases)("$id", row => {
    const command = row.command.replaceAll("{root}", root);
    const input = JSON.stringify({
      tool_name: "Bash",
      tool_input: { command },
      cwd: root,
    });
    const receipts = fixtures.map(fixture => {
      const result = boundedSpawnSync({
        label: `agent-store-ssh-configuration-v6: ${row.id}`,
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
        fixture_files: Object.entries(profile.fixture_files).map(
          ([name, body]) => ({
            name,
            expected_sha256: sha256(body),
            actual_sha256: sha256(readFileSync(path.join(root, name))),
          })
        ),
        protected_store_exists: existsSync(path.join(root, protectedStorePath)),
        observed_at: new Date().toISOString(),
        status: result.status,
        signal: result.signal,
        stdout: result.stdout,
        stderr: result.stderr,
      };
      console.info(
        `[agent-store-ssh-configuration-v6] ${JSON.stringify(receipt)}`
      );
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
