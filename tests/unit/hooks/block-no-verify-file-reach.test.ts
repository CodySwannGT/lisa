/**
 * Reach coverage for `block-no-verify.sh` — WHICH TEXT the guard classifies.
 *
 * The guard inspects argv and nothing else, so a bypass one file away is
 * invisible: `bash nv.sh` shows it two tokens, `bash` and a path, while the
 * script it is about to run carries `git commit --no-verify` and skips
 * pre-commit exactly as completely as the inline spelling. Measured against the
 * shipped guard: inline BLOCK, `bash <same line in a file>` ALLOW.
 *
 * Reach alone is not the fix, and shipping it alone would break the repository
 * on the first command. This guard's positive signal is a BARE TOKEN — measured,
 * `echo --no-verify` and `grep -rl -- --no-verify scripts/` are both refused
 * today — so a guard that reads files and keeps that matcher refuses `bash` on
 * its own source, on every husky hook, and on much of this repository, all of
 * which contain the literal token in prose and in refusal messages. So the token
 * match is NARROWED to a `git` invocation's argv first, and only then given
 * reach. Scoped to any subcommand rather than to `commit`, because
 * `git push --no-verify` skips pre-push and `git am` / `git merge` skip their
 * own hooks — narrowing to `commit` would trade an over-block for a fail-open.
 * Only the short `-n` keeps the commit scope, since `-n` is --dry-run to push
 * and --no-stat to merge. The narrowing is a deliberate WEAKENING, which is why
 * the cases it gives up are asserted here by name rather than left implicit.
 *
 * The third group is the one that keeps this fix from becoming the previous
 * one. A sibling guard was taught to read any file any token names, and that
 * produced refusals of `git diff`, `grep -n`, `wc -l`, a `git grep` pathspec and
 * a test run — commands where the path is DATA and is never executed. Those
 * cases pass against the guard as it stands today and must still pass after the
 * fix; they are here to fail loudly if reach is implemented the known-wrong way.
 * @module tests/unit/hooks/block-no-verify-file-reach
 */
import { describe, expect, it } from "vitest";

import {
  bash,
  EXIT_ALLOWED,
  EXIT_BLOCKED,
  runGuard,
  scratchDir,
  script,
  sourceGuard,
} from "./support/executed-script-reach.js";

const GUARD = sourceGuard("block-no-verify.sh");

/**
 * Drive the guard with one shell command.
 * @param command - The command an agent is attempting.
 * @returns The exit status; 2 means refused.
 */
const run = (command: string): number | null =>
  runGuard(GUARD, bash(command)).status;

const dir = scratchDir("no-verify-reach");

/** `it.each` titles, named because the same table shape recurs below. */
const REFUSES = "refuses %s";
const ALLOWS = "allows %s";

/** The long-flag bypass, as a line inside a script. */
const LONG_BYPASS = 'git commit --no-verify -m "wip"';
/** The short cluster, which skips pre-commit identically. */
const SHORT_BYPASS = 'git commit -nm "wip"';

/** A script that runs the bypass. Its contents are the whole point. */
const BYPASS_SCRIPT = script(dir, "nv.sh", ["set -euo pipefail", LONG_BYPASS]);
/** The same, spelled with the short cluster. */
const SHORT_SCRIPT = script(dir, "nv-short.sh", [SHORT_BYPASS]);
/** A script that only MENTIONS the flag, the way this repository's guards do. */
const PROSE_SCRIPT = script(dir, "prose.sh", [
  "# never pass --no-verify to git; fix the underlying failure instead",
  'echo "the --no-verify flag is refused here"',
]);
/** Executes the bypass script: two hops, both of them real execution. */
const EXEC_CHAIN = script(dir, "outer-exec.sh", [`bash ${BYPASS_SCRIPT}`]);
/** NAMES the bypass script as a search target: two hops, the second is data. */
const DATA_CHAIN = script(dir, "outer-data.sh", [
  `grep -n commit ${BYPASS_SCRIPT}`,
]);
/** A home-relative execution target, for the shell's ordinary `~/...` form. */
const homeFixtureDir = scratchDir("no-verify-home");
const HOME_BYPASS_SCRIPT = script(homeFixtureDir, "nv-home.sh", [LONG_BYPASS]);

describe("block-no-verify.sh reach", () => {
  describe("refuses a bypass inside a file the command executes", () => {
    // Every spelling here puts the script at a COMMAND POSITION, which is the
    // only position that runs it. The wrapper rows matter because a wrapper's
    // own operand is what walked past the invocation in a sibling guard.
    it.each([
      ["bash", `bash ${BYPASS_SCRIPT}`],
      ["sh", `sh ${BYPASS_SCRIPT}`],
      ["zsh", `zsh ${BYPASS_SCRIPT}`],
      ["an absolute interpreter path", `/bin/bash ${BYPASS_SCRIPT}`],
      ["source", `source ${BYPASS_SCRIPT}`],
      ["the dot builtin", `. ${BYPASS_SCRIPT}`],
      ["an env prefix", `env bash ${BYPASS_SCRIPT}`],
      ["the command builtin", `command bash ${BYPASS_SCRIPT}`],
      ["a wrapper with its own operand", `nice -n 5 bash ${BYPASS_SCRIPT}`],
      ["a timeout wrapper", `timeout 5 bash ${BYPASS_SCRIPT}`],
      ["stdin redirection", `bash < ${BYPASS_SCRIPT}`],
      ["stdin redirection after -x", `bash -x < ${BYPASS_SCRIPT}`],
      ["stdin redirection after -e", `bash -e < ${BYPASS_SCRIPT}`],
      ["stdin redirection after --", `bash -- < ${BYPASS_SCRIPT}`],
    ])(REFUSES, (_label, command) => {
      expect(run(command)).toBe(EXIT_BLOCKED);
    });

    it("expands a leading tilde before resolving the executed script", () => {
      const { status } = runGuard(GUARD, bash("bash ~/nv-home.sh"), {
        env: { HOME: homeFixtureDir },
      });

      expect(status).toBe(EXIT_BLOCKED);
      expect(HOME_BYPASS_SCRIPT).toContain(homeFixtureDir);
    });

    it("refuses the short cluster inside an executed script", () => {
      expect(run(`bash ${SHORT_SCRIPT}`)).toBe(EXIT_BLOCKED);
    });

    it("names the script in the refusal", () => {
      const { stderr } = runGuard(GUARD, bash(`bash ${BYPASS_SCRIPT}`));
      expect(stderr).toContain(BYPASS_SCRIPT);
    });

    it("follows execution across two hops", () => {
      expect(run(`bash ${EXEC_CHAIN}`)).toBe(EXIT_BLOCKED);
    });
  });

  describe("does not refuse a file that merely mentions the flag", () => {
    // The acceptance case that makes reach usable at all. This repository's own
    // guards, husky hooks and refusal messages contain the literal token; a
    // guard that reads a file and keeps the bare-token matcher refuses them all.
    it("allows executing a script that only names the flag in prose", () => {
      expect(run(`bash ${PROSE_SCRIPT}`)).toBe(EXIT_ALLOWED);
    });

    it("allows executing this guard's own source", () => {
      expect(run(`bash ${GUARD}`)).toBe(EXIT_ALLOWED);
    });

    it("does not treat stdin as a script when -c already supplied the command", () => {
      expect(run(`bash -c 'cat >/dev/null' < ${BYPASS_SCRIPT}`)).toBe(
        EXIT_ALLOWED
      );
    });
  });

  describe("narrows the bare-token match to a git commit argv", () => {
    // Measured as refused against the guard before this change, and correct to
    // allow: none of them runs a commit. This is the weakening the reach above
    // depends on, listed explicitly rather than discovered later.
    it.each([
      ["echo of the flag", "echo --no-verify"],
      ["a grep for the flag", 'grep -rl -- "--no-verify" scripts/'],
      ["a printf of the flag", "printf '%s' --no-verify"],
      ["a ripgrep for the flag", "rg --fixed-strings -- --no-verify"],
      ["the flag in a commit message", 'git commit -m "ban --no-verify"'],
      ["a push, where -n is --dry-run", "git push -n origin main"],
      ["a merge, where -n is --no-stat", "git merge -n topic"],
    ])(ALLOWS, (_label, command) => {
      expect(run(command)).toBe(EXIT_ALLOWED);
    });
  });

  describe("does not follow a path named as data", () => {
    // The over-blocking half of this classify step, asserted from the other
    // side. Each command NAMES a script that really does carry a bypass, and
    // each one only reads it. A sibling guard refuses every one of these today.
    it.each([
      ["grep -n", `grep -n commit ${BYPASS_SCRIPT}`],
      ["wc -l", `wc -l ${BYPASS_SCRIPT}`],
      ["cat", `cat ${BYPASS_SCRIPT}`],
      ["git diff", `git diff ${BYPASS_SCRIPT}`],
      ["a git grep pathspec", `git grep -n commit -- ${BYPASS_SCRIPT}`],
      ["a test run", `vitest ${BYPASS_SCRIPT}`],
      ["a commit message file", `git commit -F ${BYPASS_SCRIPT}`],
      ["a body-file", `gh pr create --body-file ${BYPASS_SCRIPT}`],
      ["a shellcheck run", `shellcheck ${BYPASS_SCRIPT}`],
      ["an editor", `code ${BYPASS_SCRIPT}`],
    ])("allows %s naming a script that does bypass", (_label, command) => {
      expect(run(command)).toBe(EXIT_ALLOWED);
    });

    it("does not propagate taint through a reference inside a followed file", () => {
      // The transitive case, decided deliberately: following an executed script
      // is following what RUNS; following a path that script merely names is
      // following data, one file further away. The outer script is executed and
      // is read; the inner one is only grepped, so it is not.
      expect(run(`bash ${DATA_CHAIN}`)).toBe(EXIT_ALLOWED);
    });
  });

  describe("still refuses everything it refused before", () => {
    // The rejection controls. Without these the suite is satisfied by a guard
    // that returns 0 unconditionally, which is how a fail-open survives its own
    // tests.
    it.each([
      ["the inline long flag", LONG_BYPASS],
      ["an accepted abbreviation", 'git commit --no-veri -m "wip"'],
      ["the inline short cluster", SHORT_BYPASS],
      ["a nested shell payload", `bash -c '${LONG_BYPASS}'`],
      ["the husky escape", 'HUSKY=0 git commit -m "wip"'],
      ["a hooksPath disable", 'git -c core.hooksPath=/dev/null commit -m "x"'],
    ])(REFUSES, (_label, command) => {
      expect(run(command)).toBe(EXIT_BLOCKED);
    });
  });

  describe("allows a syntax check, which executes nothing", () => {
    // `-n` is noexec: the shell reads and parses the operand, then exits
    // without running a line. It is the one shape that puts a path at a
    // command position while provably executing nothing, and reach adjudicated
    // it anyway — so a syntax check of any file merely DISCUSSING the bypass
    // was refused, which is most of this repository's guards and every husky
    // hook. Paired with the executing control below: noexec is the
    // distinction, not the program.
    it.each([
      ["bash -n", `bash -n ${BYPASS_SCRIPT}`],
      ["sh -n", `sh -n ${BYPASS_SCRIPT}`],
      ["-n in a cluster", `bash -en ${BYPASS_SCRIPT}`],
      ["the long spelling", `bash --noexec ${BYPASS_SCRIPT}`],
      ["a syntax check of this guard's own source", `bash -n ${GUARD}`],
    ])(ALLOWS, (_label, command) => {
      expect(run(command)).toBe(EXIT_ALLOWED);
    });

    it("still refuses the same script when it actually runs", () => {
      expect(run(`bash ${BYPASS_SCRIPT}`)).toBe(EXIT_BLOCKED);
    });
  });

  describe("fails closed on an execution it cannot follow", () => {
    // Silence on an unclassifiable EXECUTION is the bug being fixed, and a
    // truncated scan would report a confident ALLOW about text it never read.
    // Scoped to command position on purpose: `grep -n x "$FILE"` executes
    // nothing and stays allowed, so this costs a refusal only where the agent
    // is genuinely about to run something the guard cannot see.
    it.each([
      ["a computed target", 'bash "$SCRIPT"'],
      ["a target that does not exist", "bash /nonexistent/smguards-absent.sh"],
      ["a dispatched interpreter", "find . -name '*.sh' -exec bash {} ;"],
    ])(REFUSES, (_label, command) => {
      expect(run(command)).toBe(EXIT_BLOCKED);
    });

    it("allows a computed path that is only read", () => {
      expect(run('grep -n commit "$FILE"')).toBe(EXIT_ALLOWED);
    });
  });
});
