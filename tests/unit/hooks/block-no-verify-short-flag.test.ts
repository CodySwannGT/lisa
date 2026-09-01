/**
 * Tests for the short `-n` arm of the block-no-verify.sh hook.
 *
 * `git commit -n` is the short spelling of `--no-verify` and skips pre-commit
 * and commit-msg identically — as does a bundled cluster such as `-nm "msg"`,
 * which is the likelier spelling in practice because it reads as an ordinary
 * message flag. The guard excluded the short form for years on the recorded
 * grounds that "grep cannot distinguish a real -n option from -n in
 * commit-message prose or an unrelated piped command". That described a
 * grep-based matcher; the hook tokenizes, so the distinction the comment called
 * impossible is exactly what the tokenizer makes routine.
 *
 * Split from block-no-verify.test.ts, which is already at the file-length
 * ceiling. The two halves cover the same hook.
 *
 * Two kinds of assertion live here and both are load-bearing:
 *
 *   1. Refusals — each verified to FAIL against the pre-fix hook, because a
 *      guard test that passes either way proves the test ran, not that the
 *      guard bites.
 *   2. Permissions — the false positives the stale rationale named. They are
 *      what justifies scoping the match to a `git commit` argv instead of
 *      widening it to a substring: a guard that refuses `grep -n` is a guard
 *      somebody turns off.
 * @module tests/unit/hooks/block-no-verify-short-flag
 */
import path from "path";

import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";

const HOOK_PATH = path.resolve("plugins/lisa/hooks/block-no-verify.sh");
const BASH_PATH = "/bin/bash";

const EXIT_BLOCKED = 2;
const EXIT_ALLOWED = 0;

const runHook = (command: string): number | null => {
  const input = JSON.stringify({
    tool_name: "Bash",
    tool_input: { command },
  });

  return boundedSpawnSync({
    label: "block-no-verify.sh",
    command: BASH_PATH,
    args: [HOOK_PATH],
    input,
  }).status;
};

describe("block-no-verify.sh short -n form", () => {
  describe("refuses -n as an argv token of a git commit", () => {
    // Measured against real git in a scratch repo with a failing pre-commit
    // hook: `git commit -n -m msg`, `-nm msg`, and `-anm msg` each committed
    // with the hook never running, exactly as `--no-verify` does.
    it("refuses a bare git commit -n", () => {
      expect(runHook("git commit -n")).toBe(EXIT_BLOCKED);
    });

    it("refuses git commit -n with a separate message flag", () => {
      expect(runHook('git commit -n -m "wip"')).toBe(EXIT_BLOCKED);
    });

    it("refuses the bundled cluster -nm", () => {
      expect(runHook('git commit -nm "msg"')).toBe(EXIT_BLOCKED);
    });

    // Longer clusters, with `n` first, middle, and last. Matching only a bare
    // `-n` token would miss every one of them.
    it.each(["-nam", "-anm", "-an", "-na"])(
      "refuses the longer cluster %s, where n is one flag among several",
      cluster => {
        expect(runHook(`git commit ${cluster} "msg"`)).toBe(EXIT_BLOCKED);
      }
    );

    it("refuses -n arriving after other flags on the invocation", () => {
      expect(runHook('git commit -am "wip" -n')).toBe(EXIT_BLOCKED);
    });

    it("refuses -n alongside --amend", () => {
      expect(runHook("git commit --amend -n")).toBe(EXIT_BLOCKED);
    });

    it("refuses -n when git carries global options before the subcommand", () => {
      // `-c` and `-C` take a separate value token; a scan that did not skip
      // them would never reach `commit` and would call the line clean.
      expect(runHook("git -c core.hooksPath=.husky commit -nm wip")).toBe(
        EXIT_BLOCKED
      );
    });

    it("refuses -n when git is invoked by absolute path", () => {
      expect(runHook("/usr/bin/git commit -n")).toBe(EXIT_BLOCKED);
    });

    it("refuses -n inside a subshell", () => {
      expect(runHook("(git commit -n)")).toBe(EXIT_BLOCKED);
    });

    it("refuses -n on the second command of a chain", () => {
      // The bypass need not be the first thing on the line.
      expect(runHook("echo hi && git commit -nm x")).toBe(EXIT_BLOCKED);
    });

    it("refuses a second git commit -n after a clean first one", () => {
      expect(runHook("git commit -m x; git commit -n")).toBe(EXIT_BLOCKED);
    });

    it("refuses -nm reached across a backslash-newline continuation", () => {
      // The one newline that is NOT a command boundary. Joining it first is
      // what keeps normalizing the others from hiding a real bypass.
      expect(runHook("git commit \\\n  -nm x")).toBe(EXIT_BLOCKED);
    });

    it("refuses a git commit -n on a later line", () => {
      expect(runHook("echo hi\ngit commit -nm x")).toBe(EXIT_BLOCKED);
    });

    it("still refuses the long --no-verify", () => {
      // The short-form arm is additive; the vector it was built alongside must
      // not have moved.
      expect(runHook('git commit --no-verify -m "wip"')).toBe(EXIT_BLOCKED);
    });

    it.each([
      `bash -c 'git commit -n'`,
      `sh -lc 'git commit --no-verify'`,
      `env TESTING=1 /bin/bash -c 'git commit -nm nested'`,
      `env -i /bin/bash -c 'git commit -n'`,
      `env -u HOME /bin/bash -c 'git commit -n'`,
      `bash -o errexit -c 'git commit -n'`,
      `bash --rcfile /dev/null -c 'git commit -n'`,
    ])("refuses a bypass nested in %s", command => {
      expect(runHook(command)).toBe(EXIT_BLOCKED);
    });

    // A LONG shell option is never the command-string flag, but the scanner
    // tested every option for a bare `c` — so `--norc` and `--restricted`,
    // which merely CONTAIN one, were read as the carrier and swallowed the
    // real `-c` that followed as their payload. The nested `git commit
    // --no-verify` was then never classified at all. Every form below runs the
    // bypass for real; each was ALLOWED before this was fixed.
    it.each([
      `bash --norc -c 'git commit --no-verify -m x'`,
      `bash --restricted -c 'git commit -n'`,
      `bash --noprofile --norc -c 'git commit --no-verify -m x'`,
      `bash --posix --norc -c 'git commit -nm x'`,
      `/bin/bash --norc -c 'git commit --no-verify -m x'`,
      `zsh --no-rcs -c 'git commit --no-verify -m x'`,
      // zsh's --emulate takes a SEPARATE value, so the `-c` sits two tokens
      // further along than a boolean long option would leave it.
      `zsh --emulate ksh -c 'git commit --no-verify -m x'`,
    ])("refuses a bypass behind the long shell option in %s", command => {
      expect(runHook(command)).toBe(EXIT_BLOCKED);
    });

    // Wrappers that run whatever follows them without changing what it is.
    // Reading the wrapper as the command is what hid the payload.
    it.each([
      `command bash --norc -c 'git commit --no-verify -m x'`,
      `exec bash -c 'git commit -n -m x'`,
      `nohup bash --norc -c 'git commit --no-verify -m x'`,
      `builtin command env -S 'git commit --no-verify -m x'`,
    ])("refuses a bypass behind the wrapper in %s", command => {
      expect(runHook(command)).toBe(EXIT_BLOCKED);
    });

    it.each([
      `bash --norc -c 'echo ok'`,
      `bash --noprofile --norc -c 'npm test'`,
      `zsh --emulate ksh -c 'echo hi'`,
      `command ls -la`,
      `nohup npm test`,
      `exec ls`,
    ])("still permits the benign long option or wrapper in %s", command => {
      expect(runHook(command)).toBe(EXIT_ALLOWED);
    });

    it("fails closed when shell nesting exceeds the inspection limit", () => {
      const quote = (value: string): string =>
        `'${value.replaceAll("'", `'"'"'`)}'`;
      let command = "git commit -n";
      for (let depth = 0; depth < 9; depth += 1) {
        command = `bash -c ${quote(command)}`;
      }
      expect(runHook(command)).toBe(EXIT_BLOCKED);
    });
  });

  describe("permits the -n false positives the old rationale named", () => {
    it("permits -n appearing in a commit message", () => {
      expect(runHook('git commit -m "fix the -n flag handling"')).toBe(
        EXIT_ALLOWED
      );
    });

    it("permits a commit message that is exactly -n", () => {
      // The token really is `-n`, but it is the VALUE of -m, not an option.
      expect(runHook('git commit -m "-n"')).toBe(EXIT_ALLOWED);
    });

    it("permits -mn, which git reads as the message n", () => {
      // Verified against real git: `git commit -mn` records the subject "n".
      expect(runHook("git commit -mn")).toBe(EXIT_ALLOWED);
    });

    it("permits -n inside a heredoc payload", () => {
      expect(
        runHook(
          "gh issue create --body-file - <<'EOF'\nUse git commit -n to reproduce.\nEOF"
        )
      ).toBe(EXIT_ALLOWED);
    });

    it.each([
      "grep -n pattern file",
      "sort -n numbers.txt",
      "tail -n 5 log.txt",
      "head -n 20 file",
      "echo -n hello",
    ])("permits the unrelated command %s", command => {
      expect(runHook(command)).toBe(EXIT_ALLOWED);
    });

    it.each([
      "git commit -m x && grep -n foo file",
      "git commit -m x | tail -n 5",
      "git status -s; sort -n f",
    ])("permits %s, where -n belongs to a different command", command => {
      // Why the scan uses an operator-aware tokenizer: without one the pipeline
      // reads as a single git invocation and the guard refuses the grep.
      expect(runHook(command)).toBe(EXIT_ALLOWED);
    });

    it.each(["git push -n", "git merge -n topic", "git log -n 5"])(
      "permits %s, where -n is not a hook bypass",
      command => {
        // -n is --dry-run for push, --no-stat for merge, a count for log.
        expect(runHook(command)).toBe(EXIT_ALLOWED);
      }
    );

    it("permits a pathspec named -n after the -- separator", () => {
      expect(runHook("git commit -m x -- -n")).toBe(EXIT_ALLOWED);
    });

    it("permits -uno, where the n belongs to an untracked-files mode", () => {
      // Verified against real git: `git commit -uno -m plain` commits normally.
      expect(runHook("git commit -uno -m plain")).toBe(EXIT_ALLOWED);
    });

    it("permits a long option whose value contains -n", () => {
      expect(runHook('git commit --author "A -n B" -m normal')).toBe(
        EXIT_ALLOWED
      );
    });

    it.each([
      "git commit -m x\ngrep -n foo file",
      "git commit -m x\ngit push -n",
      "git commit -m x\ntail -n 5 log.txt",
    ])(
      "permits a following LINE whose -n belongs to another command",
      command => {
        // A newline ends a command exactly as `;` does, but shlex reads it as
        // plain whitespace — so without normalizing it the two lines merge into
        // one invocation and the second line's -n is charged to the commit.
        // Raised by CodeRabbit on #3025, reproduced before it was fixed.
        expect(runHook(command)).toBe(EXIT_ALLOWED);
      }
    );

    it("permits a -n inside a multi-line quoted commit message", () => {
      expect(runHook('git commit -m "line one\nline two -n"')).toBe(
        EXIT_ALLOWED
      );
    });

    it("permits shell-shaped text that is only an echo argument", () => {
      expect(runHook(`echo "bash -c 'git commit -n'"`)).toBe(EXIT_ALLOWED);
    });
  });
});
