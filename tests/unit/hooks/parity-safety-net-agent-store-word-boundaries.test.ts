/**
 * Agent-store word boundaries. Proposed commands are JSON stdin DATA to fixed
 * hook argv only. HOME/cwd are owned harmless roots; store paths never exist.
 * @module tests/unit/hooks/parity-safety-net-agent-store-word-boundaries
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

import profile from "./support/agent-store-word-boundaries.json" with { type: "json" };

const HOOKS = [
  "plugins/src/base/hooks/parity-safety-net.sh",
  "plugins/lisa/hooks/parity-safety-net.sh",
].map(file => path.resolve(file));
const NOTES = [
  ".codex/artifacts/research/auth;design.md",
  ".codex/artifacts/research/auth-design.md",
  ".codex/auth-design.md",
  ".codex/{auth,x}.json",
  ".npmrc;notes.md",
];
let root: string;

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), "lisa-agent-store-word-boundaries-"));
  for (const name of NOTES) {
    const file = path.join(root, name);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, "Harmless synthetic notes.\n");
  }
});
afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

/**
 * Bind observations to actual source and input bytes.
 * @param value Bytes to identify.
 * @returns SHA256 digest.
 */
const sha256 = (value: string | Buffer): string =>
  createHash("sha256").update(value).digest("hex");

describe("parity-safety-net: agent store word boundaries", () => {
  it.each(profile.cases)("$id", row => {
    const command = row.command.replaceAll("{root}", root);
    const input = JSON.stringify({
      tool_name: "Bash",
      tool_input: { command },
      cwd: root,
    });
    const receipts = HOOKS.map(hook => {
      const result = boundedSpawnSync({
        label: `agent-store-word-boundary: ${row.id}`,
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
      console.info(`[agent-store-word-boundary] ${JSON.stringify(receipt)}`);
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
