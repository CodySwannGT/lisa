/**
 * Physical comment boundaries and admitted aggregate source transport. Proposed
 * commands and followed bodies are DATA only, never executed by this harness.
 * @module tests/unit/hooks/parity-safety-net-agent-store-comment-transport
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

import profile from "./support/agent-store-comment-transport.json" with { type: "json" };

const HOOKS = [
  "plugins/src/base/hooks/parity-safety-net.sh",
  "plugins/lisa/hooks/parity-safety-net.sh",
].map(file => path.resolve(file));
let root: string;
const bodies: Record<string, string> = {};

/**
 * Identify exact input/source bytes.
 * @param value Bytes to identify.
 * @returns SHA256 digest.
 */
const sha256 = (value: string | Buffer): string =>
  createHash("sha256").update(value).digest("hex");

/**
 * Build a bounded body of small ordinary statements plus literal read data.
 * @param tail Literal synthetic read statements, never executed here.
 * @returns Exactly the frozen admitted body byte count.
 */
function body(tail: string): string {
  let padding = "";
  while (
    Buffer.byteLength(padding + profile.paddingStatement + tail) <=
    profile.bodyBytes - 3
  )
    padding += profile.paddingStatement;
  const remainder = profile.bodyBytes - Buffer.byteLength(padding + tail);
  return `${padding}: ${"p".repeat(remainder - 3)}\n${tail}`;
}

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), "lisa-agent-comment-transport-"));
  const research = path.join(root, ".codex/artifacts/research");
  mkdirSync(research, { recursive: true });
  for (const name of ["auth-design.md", "auth#design.md"])
    writeFileSync(path.join(research, name), "Harmless synthetic notes.\n");
  for (const kind of ["benign", "protected", "mixed"]) {
    bodies[`${kind}-a.sh`] = body(profile.benignRead);
    bodies[`${kind}-b.sh`] = body(
      kind === "benign"
        ? profile.benignRead
        : kind === "protected"
          ? profile.protectedRead
          : profile.benignRead + profile.protectedRead
    );
  }
  for (const [name, content] of Object.entries(bodies)) {
    expect(Buffer.byteLength(content)).toBe(profile.bodyBytes);
    writeFileSync(path.join(root, name), content);
  }
});
afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

describe("parity-safety-net: agent store comment and transport", () => {
  it.each(profile.cases)("$id", row => {
    const command = row.command.replaceAll("{root}", root);
    const input = JSON.stringify({
      tool_name: "Bash",
      tool_input: { command },
      cwd: root,
    });
    const selectedBodies =
      "bodies" in row
        ? Object.entries(bodies)
            .filter(([name]) => name.startsWith(`${row.bodies}-`))
            .map(([name, content]) => ({
              name,
              bytes: Buffer.byteLength(content),
              sha256: sha256(content),
              content,
            }))
        : [];
    const receipts = HOOKS.map(hook => {
      const result = boundedSpawnSync({
        label: `agent-comment-transport: ${row.id}`,
        command: "/bin/bash",
        args: [hook],
        input,
        cwd: root,
        env: { ...process.env, HOME: root },
      });
      const receipt = {
        id: row.id,
        expected: row.expected,
        command,
        input,
        input_sha256: sha256(input),
        cwd: root,
        home: root,
        hook,
        hook_sha256: sha256(readFileSync(hook)),
        invocation: ["/bin/bash", hook],
        bodies: selectedBodies,
        observed_at: new Date().toISOString(),
        status: result.status,
        signal: result.signal,
        stdout: result.stdout,
        stderr: result.stderr,
      };
      console.info(`[agent-comment-transport] ${JSON.stringify(receipt)}`);
      return receipt;
    });
    for (const receipt of receipts) {
      expect(
        receipt.status,
        JSON.stringify({
          ...receipt,
          bodies: receipt.bodies.map(
            ({ content: _content, ...metadata }) => metadata
          ),
        })
      ).toBe(row.expected);
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
