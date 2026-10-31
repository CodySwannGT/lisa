/**
 * Quoted remote programs versus literal operands. Proposed SSH/eval commands
 * remain JSON stdin DATA to fixed Bash hook argv; they are never executed.
 * @module tests/unit/hooks/parity-safety-net-agent-store-quoted-programs
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

import boundaries from "./support/agent-store-program-carrier-boundaries.json" with { type: "json" };
import profile from "./support/agent-store-quoted-programs.json" with { type: "json" };

const HOOKS = [
  "plugins/src/base/hooks/parity-safety-net.sh",
  "plugins/lisa/hooks/parity-safety-net.sh",
].map(file => path.resolve(file));
let root: string;

/**
 * Identify the complete input/source bytes.
 * @param value Bytes to identify.
 * @returns SHA256 digest.
 */
const sha256 = (value: string | Buffer): string =>
  createHash("sha256").update(value).digest("hex");

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), "lisa-agent-quoted-programs-"));
  for (const name of [
    ".codex/artifacts/research/auth-design.md",
    ".npmrc; notes.md",
    "research/cat .npmrc; notes.md",
  ]) {
    const file = path.join(root, name);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, "Harmless synthetic notes.\n");
  }
});
afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

describe("parity-safety-net: agent store quoted programs", () => {
  it.each([...profile.cases, ...boundaries.cases])("$id", row => {
    const command = row.command.replaceAll("{root}", root);
    const input = JSON.stringify({
      tool_name: "Bash",
      tool_input: { command },
      cwd: root,
    });
    const receipts = HOOKS.map(hook => {
      const result = boundedSpawnSync({
        label: `agent-store-quoted-program: ${row.id}`,
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
      console.info(`[agent-store-quoted-program] ${JSON.stringify(receipt)}`);
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
