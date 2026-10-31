/**
 * Eighteen frozen carrier-value controls. Proposed programs are JSON DATA only,
 * never executed. Only fixed actual Bash hook argv reads the synthetic input.
 * @module tests/unit/hooks/parity-safety-net-agent-store-carrier-values-v4
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

import profile from "./support/agent-store-carrier-values-v4.json" with { type: "json" };

/** Exact source-pinned full-hook fixture for the explicit historical replay. */
interface HookFixture {
  label: string;
  hook: string;
  sha256: string;
}
const fixturePath = process.env["LISA_AGENT_STORE_CARRIER_V4_BASELINES"];
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

/**
 * Identify complete source/input bytes.
 * @param value Bytes to identify.
 * @returns SHA256 digest.
 */
const sha256 = (value: string | Buffer): string =>
  createHash("sha256").update(value).digest("hex");

beforeAll(() => {
  expect(fixtures).toHaveLength(fixturePath ? 6 : 2);
  if (fixturePath) {
    expect(fixtures.map(fixture => fixture.label)).toEqual([
      "main73a-canonical",
      "main73a-emitted",
      "d57-canonical",
      "d57-emitted",
      "current1d1-canonical",
      "current1d1-emitted",
    ]);
    for (const fixture of fixtures)
      expect(fixture.sha256).toMatch(/^[a-f0-9]{64}$/u);
  }
  root = mkdtempSync(path.join(tmpdir(), "lisa-agent-option-controls-"));
  const notes = path.join(root, ".codex/artifacts/research/notes.md");
  mkdirSync(path.dirname(notes), { recursive: true });
  writeFileSync(notes, "Harmless neutral synthetic notes.\n");
  writeFileSync(
    path.join(root, "note=cat .npmrc; notes.md"),
    "Harmless literal filename.\n"
  );
  writeFileSync(path.join(root, "README.md"), "Harmless README.\n");
  for (const fixture of fixtures)
    if (fixture.sha256)
      expect(sha256(readFileSync(fixture.hook))).toBe(fixture.sha256);
});
afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

describe("parity-safety-net: agent store option ownership", () => {
  it.each(profile.cases)("$id", row => {
    const command = row.command.replaceAll("{root}", root);
    const input = JSON.stringify({
      tool_name: "Bash",
      tool_input: { command },
      cwd: root,
    });
    const receipts = fixtures.map(fixture => {
      const result = boundedSpawnSync({
        label: `agent-store-carrier-values-v4: ${row.id}`,
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
        observed_at: new Date().toISOString(),
        status: result.status,
        signal: result.signal,
        stdout: result.stdout,
        stderr: result.stderr,
      };
      console.info(
        `[agent-store-carrier-values-v4] ${JSON.stringify(receipt)}`
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
