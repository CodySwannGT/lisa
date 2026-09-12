/**
 * `eval` must not restore every blocked bypass spelling (#3531).
 *
 * The guard enumerates eleven spellings of the hook bypass and blocks them all.
 * `eval` restored every one, because the payload is constructed at runtime and
 * the guard only ever saw the `eval`: the argv scan sees one opaque quoted
 * token, and the git scan sees no `git` token at all.
 *
 * `eval` was absent from BOTH recursion sets, and the reason is worth keeping:
 * it is not a `SHELL_PROGRAM` (it has no `-c` payload to reparse) and, unlike
 * `builtin`, it is not a prefix wrapper whose argv carries through. It is the
 * one builtin that takes a command STRING, and it was in neither set.
 *
 * MEASURED against `origin/main`, 13 of these fixtures passed the guard —
 * including four the report did not name: `git push --no-verify`,
 * `core.hooksPath`, `HUSKY=0`, and one behind a `command` wrapper.
 *
 * ## Why this is recursion and not spelling twelve
 *
 * This repository has twice declined an arms race of this shape: #3606 found
 * inverting a fallback to an allowlist unreachable, and #3481 declined to
 * emulate shell quoting after a bash-lexer-emulating control lost five
 * adversarial rounds. Enumerating `eval` as a pattern would be the same bet.
 *
 * Recursing is different in kind: the payload gets the IDENTICAL analysis, so
 * every vector already covered — and every vector added later — is covered
 * inside `eval` too, with nothing to keep in step. The guard already recurses
 * for `bash -c` and for executed scripts; `eval` was a missing recursion SITE,
 * not a missing pattern.
 *
 * It recurses through `verdict` rather than through the git half, which matters:
 * `HUSKY=0` and `core.hooksPath` live in `token_bypass`, so the report's own
 * suggested patch — which recursed into the git check only — would have left
 * `eval "HUSKY=0 git commit -m x"` open.
 *
 * ## Round two found a gap round one left
 *
 * `bash -c 'eval "git commit --no-verify -m x"'` survived the first fix.
 * `git_skips_verification` recurses into a nested shell payload but only into
 * ITSELF, so it carries the git half down and leaves `eval` behind. That was
 * found by RUNNING the adversarial round rather than reasoning about it, and
 * the nested payload now recurses through `verdict` as well.
 *
 * ## Safety
 *
 * Every string below is inert data. The guard classifies text and never
 * executes it: no git command runs, nothing is committed or pushed, and no hook
 * is bypassed anywhere in this suite.
 * @module tests/unit/hooks/block-no-verify-eval-payload
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";

const BASH_PATH = "/bin/bash";
const EXIT_BLOCKED = 2;

/** Shipped copies answering on the exit-code protocol. */
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

/** Bypasses reachable only by constructing the command inside `eval`. */
const REFUSED = [
  'eval "git commit --no-verify -m x"',
  'eval "git commit -nm x"',
  "eval 'git commit --no-verify -m x'",
  'eval "git push --no-verify"',
  'eval "git commit --no-ver -m x"',
  'eval "git -c core.hooksPath=/dev/null commit -m x"',
  'eval "HUSKY=0 git commit -m x"',
  'eval "HUSKY_SKIP_HOOKS=1 git commit -m x"',
  'eval "/usr/bin/git commit --no-verify -m x"',
  'echo hi && eval "git commit --no-verify -m x"',
  'command eval "git commit --no-verify -m x"',
  'eval "eval \\"git commit --no-verify -m x\\""',
  "bash -c 'eval \"git commit --no-verify -m x\"'",
] as const;

/**
 * Commands that must keep running.
 *
 * A guard that refused `eval` outright would pass every assertion above and
 * make a common builtin unusable — the shape that gets a guard switched off
 * rather than satisfied. `eval "$CMD"` is deliberately here: the payload is not
 * knowable statically, and inventing a refusal for it would refuse a construct
 * the guard cannot actually judge.
 */
const ALLOWED = [
  'eval "echo hello"',
  'eval "cd /tmp"',
  'eval "npm test --no-verify-ssl"',
  'eval "echo git commit --no-verify -m x"',
  'bash -c "echo HUSKY=0"',
  'eval "$(some-tool hook bash)"',
  'eval "$CMD"',
  "npm run eval:suite",
  'git commit -m "refactor eval usage"',
  'echo "we should eval git commit --no-verify"',
  "git log -n 5",
] as const;

/**
 * Inputs that must not crash the parser.
 *
 * An outer shell crash must not count as an allow. An inner Python crash can
 * instead become a normal denial because the wrappers use `if ! python3`.
 * Check both the wrapper status and Python diagnostics: either failure must
 * fail this table rather than masquerade as a valid guard decision.
 */
const PATHOLOGICAL = [
  "eval",
  "eval ;",
  'eval "git commit',
  'eval "eval \\"git',
] as const;

/**
 * Run one shipped copy against one command and report its raw result.
 *
 * The envelope carries BOTH input shapes on purpose: Claude and Codex read
 * `tool_input.command` while agy reads `toolCall.args.CommandLine`. A payload
 * carrying only the first makes agy see an empty command and allow everything,
 * which is exactly how this suite first measured agy as half-inert.
 * @param script - Repository-relative path to the shipped guard copy
 * @param command - The Bash command line the guard is asked to vet
 * @returns The spawn status and output, for a protocol adapter to read
 */
const runGuard = (
  script: string,
  command: string
): { status: number | null; stdout: string; stderr: string } => {
  const result = boundedSpawnSync({
    label: `block-no-verify eval (${script})`,
    command: BASH_PATH,
    // Absolute paths pass through, so the rejection controls below can point a
    // decider at a deliberately broken script outside the repository. Joining
    // unconditionally would turn "/tmp/x" into "<cwd>/tmp/x" and the control
    // would measure a missing file instead of a crashing one.
    args: [path.isAbsolute(script) ? script : path.join(process.cwd(), script)],
    input: JSON.stringify({
      tool_name: "Bash",
      tool_input: { command },
      toolCall: { name: "run_command", args: { CommandLine: command } },
    }),
  });
  // A child exception can be wrapped into a valid denial on every protocol.
  // The status alone cannot distinguish that crash from a deliberate refusal.
  expect(result.stderr).not.toMatch(
    /Traceback \(most recent call last\):|(?:Syntax|Indentation|Tab)Error:/
  );
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
};

/**
 * Decide via the exit-code protocol: status 2 refuses, status 0 allows.
 *
 * Any OTHER status is a crash, not a verdict, and is failed here rather than
 * folded into "allow". These copies contain exactly two exits, 0 and 2, so a 1
 * or a 127 means the guard died before deciding — and reading that as an allow
 * would let a parser crash satisfy every ALLOWED and PATHOLOGICAL case in the
 * table while the guard refused nothing at all.
 * @param script - Repository-relative path to the shipped guard copy
 * @param command - The Bash command line the guard is asked to vet
 * @returns "deny" when the guard refuses, "allow" otherwise
 */
const decideByExitCode = (script: string, command: string): string => {
  const { status } = runGuard(script, command);
  if (status === EXIT_BLOCKED) {
    return "deny";
  }
  expect(status).toBe(0);
  return "allow";
};

/**
 * Decide via the agy protocol: a JSON `decision` field on stdout.
 * @param script - Repository-relative path to the shipped guard copy
 * @param command - The Bash command line the guard is asked to vet
 * @returns "deny" when the guard refuses, "allow" otherwise
 */
const decideByAgyJson = (script: string, command: string): string => {
  const { status, stdout } = runGuard(script, command);
  // These copies exit 0 on both verdicts and carry the decision on stdout, so
  // any non-zero status is a crash. `JSON.parse("")` would throw here anyway,
  // but it throws about syntax; asserting the status first makes the failure
  // say which of the two things went wrong.
  expect(status).toBe(0);
  return (JSON.parse(stdout) as { decision: string }).decision;
};

/**
 * Decide via the Codex protocol: a permissionDecision object, or silence.
 * @param script - Repository-relative path to the shipped guard copy
 * @param command - The Bash command line the guard is asked to vet
 * @returns "deny" when the guard refuses, "allow" otherwise
 */
const decideByCodexDecision = (script: string, command: string): string => {
  const { status, stdout } = runGuard(script, command);
  // Silence means allow ONLY from a guard that ran to completion. This copy
  // contains a single exit, 0, and signals deny by printing JSON — so a crashed
  // script produces empty stdout too, and is indistinguishable from an allow
  // until the status is checked. Checking it first is what keeps the quietest
  // possible failure from reading as the most permissive possible verdict.
  expect(status).toBe(0);
  if (stdout.trim() === "") {
    return "allow";
  }
  return (
    JSON.parse(stdout) as {
      hookSpecificOutput: { permissionDecision: string };
    }
  ).hookSpecificOutput.permissionDecision;
};

/**
 * The full payload table, run against one shipped copy on its own protocol.
 * @param script - Repository-relative path to the shipped guard copy
 * @param decide - The protocol adapter that reads that copy's answer
 */
const assertEvalParity = (
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

    it.each(PATHOLOGICAL)("does not crash on %s", command => {
      // Not asserting a verdict — asserting the parser answered at all.
      //
      // Outer crashes fail the protocol status assertions. Inner Python
      // crashes fail runGuard's diagnostic check even when the wrapper turns
      // the exception into a normal denial.
      expect(["deny", "allow"]).toContain(decide(script, command));
    });
  });
};

describe("a crashed guard is not read as an allow", () => {
  /**
   * Write a guard that dies without deciding, and return its absolute path.
   *
   * It exits 1 with empty stdout, which is what a syntax error or an unbound
   * variable under `set -u` actually produces — the shape the deciders used to
   * fold into "allow".
   * @returns Absolute path to the crashing script
   */
  const crashRoots: string[] = [];

  const crashingGuard = (): string => {
    const dir = mkdtempSync(path.join(tmpdir(), "block-no-verify-crash-"));
    const file = path.join(dir, "crash.sh");
    crashRoots.push(dir);
    writeFileSync(file, "#!/usr/bin/env bash\nexit 1\n");
    return file;
  };

  afterAll(() => {
    for (const dir of crashRoots) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // One innocent command is enough: the crash is in the guard, not the input.
  const INNOCENT = "git status";

  // These are the controls for the three assertions added above. Without them
  // the assertions are untested code that would pass whether or not they were
  // there — the exact shape this suite exists to refuse, since a guard is only
  // as good as the proof it refuses something.
  it("fails the exit-code protocol instead of allowing", () => {
    expect(() => decideByExitCode(crashingGuard(), INNOCENT)).toThrow();
  });

  it("fails the Codex protocol instead of allowing on silence", () => {
    expect(() => decideByCodexDecision(crashingGuard(), INNOCENT)).toThrow();
  });

  it("fails the agy protocol instead of parsing empty stdout", () => {
    expect(() => decideByAgyJson(crashingGuard(), INNOCENT)).toThrow();
  });

  it("fails an inner Python crash even when the wrapper reports a denial", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "block-no-verify-crash-"));
    const file = path.join(dir, "child-crash.sh");
    crashRoots.push(dir);
    writeFileSync(
      file,
      "#!/usr/bin/env bash\n" +
        "if ! python3 -c 'raise RuntimeError(\"inert child crash control\")'; then\n" +
        "  exit 2\nfi\nexit 0\n"
    );

    expect(() => decideByExitCode(file, INNOCENT)).toThrow();
  });
});

describe("block-no-verify eval-payload coverage across shipped copies", () => {
  for (const script of EXIT_CODE_COPIES) {
    assertEvalParity(script, decideByExitCode);
  }
  for (const script of AGY_COPIES) {
    assertEvalParity(script, decideByAgyJson);
  }
  for (const script of CODEX_COPIES) {
    assertEvalParity(script, decideByCodexDecision);
  }
});

describe("the capability marker names what the guard now covers", () => {
  it.each([...EXIT_CODE_COPIES, ...AGY_COPIES, ...CODEX_COPIES])(
    "%s declares eval-payload",
    script => {
      // `lisa apply` compares declared capability sets to tell a copy that is
      // BEHIND from one that is AHEAD. A hardening that forgets the marker is
      // invisible to refresh and can be silently replaced by a weaker upstream.
      const source = readFileSync(path.join(process.cwd(), script), "utf8");

      expect(source).toContain("eval-payload");
    }
  );
});
