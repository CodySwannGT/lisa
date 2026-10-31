/**
 * S1/S2: store terminators and conservative brace uncertainty. Proposed shell
 * strings are JSON stdin DATA to fixed Bash hook argv, never shell commands.
 * HOME and every path point only at an owned harmless synthetic fixture root.
 * @module tests/unit/hooks/parity-safety-net-agent-store-shell-boundaries
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

import profile from "./support/agent-store-shell-boundaries.json" with { type: "json" };

const HOOKS = [
  "plugins/src/base/hooks/parity-safety-net.sh",
  "plugins/lisa/hooks/parity-safety-net.sh",
].map(file => path.resolve(file));
const NAMES = [
  "auth-design.md",
  "authorization-notes.md",
  "token-budget-notes.md",
  "credentials-policy.md",
  "operator-resume-authority-v1.md",
  "lint-final-authored.stdout",
  "authorization-notes;v1.md",
];
let root: string;

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), "lisa-agent-store-shell-boundaries-"));
  for (const directory of [".codex", ".claude"]) {
    const research = path.join(root, directory, "artifacts", "research");
    mkdirSync(research, { recursive: true });
    for (const name of NAMES)
      writeFileSync(path.join(research, name), "Harmless synthetic notes.\n");
  }
});
afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

/**
 * Identify actual source and input bytes in the classifier journal.
 * @param value Bytes to identify.
 * @returns SHA256 of the supplied bytes.
 */
const sha256 = (value: string | Buffer): string =>
  createHash("sha256").update(value).digest("hex");

describe("parity-safety-net: agent store shell boundaries", () => {
  it.each(profile.cases)("$id", row => {
    const command = row.command.replaceAll("{root}", root);
    const input = JSON.stringify({
      tool_name: "Bash",
      tool_input: { command },
      cwd: root,
    });
    const receipts = HOOKS.map(hook => {
      const result = boundedSpawnSync({
        label: `agent-store-shell-boundary: ${row.id}`,
        command: "/bin/bash",
        args: [hook],
        input,
        cwd: root,
        env: { ...process.env, HOME: root },
      });
      const receipt = {
        id: row.id,
        family: row.family,
        expected: row.expected,
        command,
        input,
        input_sha256: sha256(input),
        cwd: root,
        home: root,
        hook,
        hook_sha256: sha256(readFileSync(hook)),
        invocation: ["/bin/bash", hook],
        observed_at: new Date().toISOString(),
        status: result.status,
        signal: result.signal,
        stdout: result.stdout,
        stderr: result.stderr,
      };
      console.info(`[agent-store-shell-boundary] ${JSON.stringify(receipt)}`);
      return receipt;
    });
    for (const receipt of receipts) {
      expect(receipt.status, JSON.stringify(receipt)).toBe(row.expected);
      if (row.expected === 2)
        expect(receipt.stderr).toContain("Blocked by safety-net");
      else expect(receipt.stderr).not.toContain("Blocked by safety-net");
    }
    expect(receipts.map(receipt => receipt.status)).toEqual([
      row.expected,
      row.expected,
    ]);
  });
});
