/**
 * Cross-agent nested-shell parity for the block-no-verify guard.
 *
 * `block-no-verify` ships as nine shell copies across three stdin/stdout
 * protocols — Claude/cursor/copilot/host-fallback (exit 2 = refuse), agy
 * (`{"decision":"deny"}` on stdout), and Codex (a `permissionDecision` object,
 * or silence for allow). Five of the nine parsed nested shells. Four did not:
 * the three `.agy.sh` copies and the Codex script carried a FORK of the policy
 * payload that had never gained the nested-shell scanner, so
 * `bash -c 'git commit --no-verify'` — the first form anyone would try — was
 * permitted while the same guard refused the direct spelling.
 *
 * That is the failure mode this file exists for. A guard that is absent is
 * obvious; a guard that enforces on four of its ten forms is not, because every
 * spelling anyone thinks to test by hand is one of the four. So the evidence
 * here is EXECUTION against each shipped copy individually. Asserting the
 * canonical source and assuming the projections follow is precisely the
 * inference that let the fork sit undetected.
 *
 * Both halves of the table are load-bearing:
 *
 *   1. Refusals — every one verified to FAIL against the pre-fix agy and Codex
 *      copies (36 misses across the four broken copies), so a passing run
 *      proves the guard bites rather than proving the test ran.
 *   2. Permissions — `grep -n`, a `-mn` message, `git push -n` and a commit
 *      message that quotes `--no-verify` in prose. They are what justifies a
 *      tokenizing scanner over a broader match: a guard that refuses
 *      `bash -c 'echo ok'` is a guard somebody turns off.
 *
 * The final describe asserts the three policy payloads are byte-identical.
 * Parity by intention is what failed here; parity by equality cannot fail
 * quietly, and any future hardening of the canonical payload now has to fan out
 * to every agent in the same commit.
 * @module tests/unit/hooks/block-no-verify-nested-shell-parity
 */
import { readFileSync } from "node:fs";
import * as path from "node:path";

import { describe, expect, it } from "vitest";

import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";

const BASH_PATH = "/bin/bash";
const EXIT_BLOCKED = 2;

/** Shipped copies answering on the exit-code protocol (Claude and its clones). */
const EXIT_CODE_COPIES = [
  "plugins/src/base/hooks/block-no-verify.sh",
  "plugins/lisa/hooks/block-no-verify.sh",
  "plugins/lisa-cursor/hooks/block-no-verify.sh",
  "plugins/lisa-copilot/hooks/block-no-verify.sh",
  "all/copy-overwrite/scripts/lisa-hooks/block-no-verify.sh",
] as const;

/** Shipped copies answering on the agy JSON-decision protocol. */
const AGY_COPIES = [
  "plugins/src/base/hooks/block-no-verify.agy.sh",
  "plugins/lisa/hooks/block-no-verify.agy.sh",
  "plugins/lisa-agy/hooks/block-no-verify.agy.sh",
] as const;

/** Shipped copies answering on the Codex permissionDecision protocol. */
const CODEX_COPIES = ["src/codex/scripts/block-no-verify.sh"] as const;

/**
 * Nested-shell spellings that reach `git commit` with verification disabled.
 *
 * Measured against real git in a scratch repo with a failing pre-commit hook:
 * each of these commits with the hook never running, exactly as a direct
 * `--no-verify` does. The outer command is what the guard sees, so the bypass
 * is only visible to a scanner that reparses the `-c` payload.
 */
const REFUSED = [
  "bash -c 'git commit --no-verify -m x'",
  `sh -c "git commit -n -m x"`,
  "zsh -c 'git commit --no-veri -m x'",
  "/bin/bash -c 'git commit -nm x'",
  `bash -c "bash -c 'git commit --no-verify'"`,
  "env FOO=1 bash -c 'git commit --no-verify'",
] as const;

/** Benign nested shells that must keep running. */
const ALLOWED = [
  "bash -c 'echo ok'",
  `bash -c "grep -n foo file.txt"`,
  "sh -c 'git status'",
  `bash -c 'git commit -m "mention --no-verify in prose"'`,
  "bash -c 'git push -n'",
] as const;

/**
 * Run one shipped copy against one command and report its decision.
 * @param script - Repository-relative path to the shipped guard copy.
 * @param stdin - The agent-shaped JSON envelope to feed it.
 * @returns The raw spawn result, for the protocol adapter to read.
 */
const runGuard = (
  script: string,
  stdin: string
): { status: number | null; stdout: string } => {
  const result = boundedSpawnSync({
    label: `block-no-verify (${script})`,
    command: BASH_PATH,
    args: [path.join(process.cwd(), script)],
    input: stdin,
  });
  return { status: result.status, stdout: result.stdout };
};

/**
 * Decide via the exit-code protocol: status 2 refuses, 0 permits.
 * @param script - Repository-relative path to the shipped guard copy.
 * @param command - The Bash command line the guard is asked to vet.
 * @returns "deny" when the guard refuses the command, "allow" otherwise.
 */
const decideByExitCode = (script: string, command: string): string => {
  const stdin = JSON.stringify({ tool_name: "Bash", tool_input: { command } });
  return runGuard(script, stdin).status === EXIT_BLOCKED ? "deny" : "allow";
};

/**
 * Decide via the agy protocol: a JSON `decision` field on stdout.
 * @param script - Repository-relative path to the shipped guard copy.
 * @param command - The Bash command line the guard is asked to vet.
 * @returns "deny" when the guard refuses the command, "allow" otherwise.
 */
const decideByAgyJson = (script: string, command: string): string => {
  const stdin = JSON.stringify({
    toolCall: { name: "run_command", args: { CommandLine: command } },
  });
  const { stdout } = runGuard(script, stdin);
  return (JSON.parse(stdout) as { decision: string }).decision;
};

/**
 * Decide via the Codex protocol: a permissionDecision object, or silence.
 * @param script - Repository-relative path to the shipped guard copy.
 * @param command - The Bash command line the guard is asked to vet.
 * @returns "deny" when the guard refuses the command; silence on stdout is how
 *   the Codex protocol spells "allow".
 */
const decideByCodexDecision = (script: string, command: string): string => {
  const stdin = JSON.stringify({ tool_name: "Bash", tool_input: { command } });
  const { stdout } = runGuard(script, stdin);
  if (stdout.trim() === "") {
    return "allow";
  }
  const parsed = JSON.parse(stdout) as {
    hookSpecificOutput: { permissionDecision: string };
  };
  return parsed.hookSpecificOutput.permissionDecision;
};

/**
 * The full payload table, run against one shipped copy on its own protocol.
 * @param script - Repository-relative path to the shipped guard copy.
 * @param decide - The protocol adapter that reads that copy's answer.
 */
const assertParity = (
  script: string,
  decide: (script: string, command: string) => string
): void => {
  describe(script, () => {
    it.each(REFUSED)("refuses %s", command => {
      expect(decide(script, command)).toBe("deny");
    });

    it.each(ALLOWED)("allows %s", command => {
      expect(decide(script, command)).toBe("allow");
    });
  });
};

describe("block-no-verify nested-shell parity across shipped copies", () => {
  for (const script of EXIT_CODE_COPIES) {
    assertParity(script, decideByExitCode);
  }
  for (const script of AGY_COPIES) {
    assertParity(script, decideByAgyJson);
  }
  for (const script of CODEX_COPIES) {
    assertParity(script, decideByCodexDecision);
  }
});

/** The three authored guards; every other shipped copy is generated from one. */
const CANONICAL_GUARDS = [
  "plugins/src/base/hooks/block-no-verify.sh",
  "plugins/src/base/hooks/block-no-verify.agy.sh",
  "src/codex/scripts/block-no-verify.sh",
] as const;

/**
 * Extract the embedded python policy payload from a guard script.
 *
 * The payload is the `python3 - <<'PY' ... PY` heredoc. Everything outside it
 * is the per-agent envelope, which is legitimately different in all three.
 * @param script - Repository-relative path to an authored guard.
 * @returns The heredoc body, exactly as the interpreter receives it.
 */
const policyPayload = (script: string): string => {
  const lines = readFileSync(path.join(process.cwd(), script), "utf8").split(
    "\n"
  );
  const start = lines.findIndex(line => line.trimEnd().endsWith("<<'PY'"));
  const end = lines.findIndex(
    (line, index) => index > start && line.trim() === "PY"
  );
  expect(start, `${script}: no python heredoc found`).toBeGreaterThan(-1);
  expect(end, `${script}: unterminated python heredoc`).toBeGreaterThan(start);
  return lines.slice(start + 1, end).join("\n");
};

describe("block-no-verify policy payload is single-sourced", () => {
  const canonical = policyPayload(CANONICAL_GUARDS[0]);

  it.each(CANONICAL_GUARDS.slice(1))(
    "%s carries the canonical policy verbatim",
    script => {
      expect(policyPayload(script)).toBe(canonical);
    }
  );

  it("declares the same guard capabilities on every agent", () => {
    const declared = CANONICAL_GUARDS.map(script => {
      const source = readFileSync(path.join(process.cwd(), script), "utf8");
      const marker = /^# lisa-guard-capabilities: (?<names>.+)$/m.exec(source);
      return marker?.groups?.names ?? "";
    });
    expect(declared[1]).toBe(declared[0]);
    expect(declared[2]).toBe(declared[0]);
    expect(declared[0]).toContain("nested-shell-no-verify");
  });
});
