/**
 * Contract tests for the agy protocol adapter around parity-safety-net.sh.
 * The policy itself is covered by the canonical hook suite; these assertions
 * prove envelope translation, deny propagation, and heredoc-parser delegation.
 */
import { spawnSync } from "node:child_process";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

const SCRIPT = path.join(
  process.cwd(),
  "plugins",
  "src",
  "base",
  "hooks",
  "parity-safety-net.agy.sh"
);

const payload = (commandLine: string): string =>
  JSON.stringify({
    toolCall: { name: "run_command", args: { CommandLine: commandLine } },
  });

const invoke = (stdin: string): { decision: string; reason?: string } => {
  const result = spawnSync("/bin/bash", [SCRIPT], {
    input: stdin,
    encoding: "utf8",
  });
  if (result.error) throw result.error;
  expect(result.status).toBe(0);
  return JSON.parse(result.stdout) as { decision: string; reason?: string };
};

describe("parity-safety-net.agy.sh", () => {
  it("denies a destructive command with the canonical reason", () => {
    const result = invoke(payload("rm -rf /"));
    expect(result.decision).toBe("deny");
    expect(result.reason).toContain("recursive forced delete");
  });

  it("allows an ordinary shell command", () => {
    expect(invoke(payload("git status --short")).decision).toBe("allow");
  });

  it("delegates safe GitHub body heredocs to the canonical parser", () => {
    const command =
      "gh issue comment 1594 --body-file - <<'EOF'\nrm -rf / is prose\nEOF";
    expect(invoke(payload(command)).decision).toBe("allow");
  });

  it("fails closed for malformed supported GitHub heredocs", () => {
    const command = "gh issue comment 1594 --body-file - <<'EOF'\nrm -rf /";
    const result = invoke(payload(command));
    expect(result.decision).toBe("deny");
    expect(result.reason).toContain("malformed or ambiguous heredoc");
  });

  it("allows malformed envelopes without crashing agy", () => {
    expect(invoke("not-json").decision).toBe("allow");
    expect(
      invoke(JSON.stringify({ toolCall: { name: "read_file" } })).decision
    ).toBe("allow");
  });
});
