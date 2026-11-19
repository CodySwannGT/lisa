/**
 * The two ways a shell hook ends with success that are not an `exit`: a
 * `return` outside every function, and a `trap` that takes over when the
 * hook ends (CodySwannGT/lisa#4989).
 *
 * Both made `lisa controls install-carriers` report a hook as wired whose
 * added lines could not stop a commit. Each case is judged by its text and
 * then run for real, under every shell on this machine the case is about,
 * so the judgement is held to what a shell does.
 */
import { afterEach, describe, expect, it } from "vitest";

import { earlyLeave } from "../../../src/controls/carrier-hook-reach.js";
import {
  EVERY_SHELL,
  hook,
  RETURN_LEAVES,
  ranToTheEnd,
} from "../../support/carrier-hook-run.js";

const SHEBANG = "#!/bin/sh";

const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

/**
 * How a hook ends in each of a set of shells when the lines added at its end
 * fail, as the call to a carrier does when a declared check fails.
 * @param text - The hook
 * @param shells - The shells to run it in
 * @returns One line per shell: whether the lines were reached, and whether
 *   the hook still ended with success
 */
function outcomes(text: string, shells: readonly string[]): readonly string[] {
  return shells.map(shell => {
    const run = ranToTheEnd(text, { failing: true, shell }, cleanups);
    const reached = run.reached ? "reached" : "skipped";
    return `${shell}: ${reached}, ${run.status === 0 ? "passes" : "fails"}`;
  });
}

describe("a hook with a return outside every function", () => {
  it("has a shell here in which such a return ends the script", () => {
    // Dash is `sh` on most Linux systems. Without one of these shells the
    // cases below would prove nothing.
    expect(RETURN_LEAVES.length).toBeGreaterThan(0);
  });

  const LEAVES: ReadonlyArray<readonly [string, string, number]> = [
    [
      "after a test that failed",
      hook(SHEBANG, '[ -n "${RUN_ALL:-}" ] || return 0', "true"),
      2,
    ],
    ["with no status", hook(SHEBANG, "true", "return", "true"), 3],
    ["with the last status", hook(SHEBANG, "true; return $?"), 2],
    [
      "with a status that is a variable",
      hook(SHEBANG, "code=0", 'return "$code"'),
      3,
    ],
    [
      "inside an if",
      hook(SHEBANG, "if true; then", "  return 0", "fi", "true"),
      3,
    ],
  ];

  it.each(LEAVES)("is refused: a return %s", (_name, text, line) => {
    expect(earlyLeave(text)).toEqual({ line, word: "return" });
    // In each of these shells the added lines never run and the hook passes.
    expect(outcomes(text, RETURN_LEAVES)).toEqual(
      RETURN_LEAVES.map(shell => `${shell}: skipped, passes`)
    );
  });

  it("is refused behind the word command, which dash and ksh let it stand behind", () => {
    const text = hook(SHEBANG, "command return 0");
    // Zsh reports this one and carries on, so it is not run there.
    const shells = RETURN_LEAVES.filter(shell => shell !== "/bin/zsh");

    expect(earlyLeave(text)).toEqual({ line: 2, word: "return" });
    expect(outcomes(text, shells)).toEqual(
      shells.map(shell => `${shell}: skipped, passes`)
    );
  });

  const FAILS: ReadonlyArray<readonly [string, string]> = [
    ["a written failure", hook(SHEBANG, "if false; then", "  return 1", "fi")],
    [
      "the status of the command that failed",
      hook(SHEBANG, "true || return", "true || return $?"),
    ],
  ];

  it.each(FAILS)("is accepted when it returns %s", (_name, text) => {
    expect(earlyLeave(text)).toBeNull();
    expect(outcomes(text, EVERY_SHELL)).toEqual(
      EVERY_SHELL.map(shell => `${shell}: reached, fails`)
    );
  });

  it("leaves with a failure where a written failure is returned", () => {
    const text = hook(SHEBANG, "return 3", "true");

    expect(earlyLeave(text)).toBeNull();
    // The added lines are skipped, and git stops the commit all the same.
    expect(outcomes(text, RETURN_LEAVES)).toEqual(
      RETURN_LEAVES.map(shell => `${shell}: skipped, fails`)
    );
  });

  it("is refused inside a function too, as an exit there is", () => {
    // A return there ends the function and not the hook. Telling the two
    // apart means following where a function starts and ends, and a wrong
    // answer is a commit that passes unchecked, so it is not attempted.
    expect(
      earlyLeave(hook(SHEBANG, "check() {", "  return 0", "}", "check"))
    ).toEqual({ line: 3, word: "return" });
  });
});

describe("a hook with something the shell works out written into the word exit", () => {
  const WRITTEN_IN = [
    "exit$1",
    "$1exit",
    "ex${nothing}it",
    "ex$1it",
    "exit$()",
  ];

  it.each(WRITTEN_IN)(
    "is refused: %s is exit whenever what is worked out holds nothing",
    line => {
      const text = hook(SHEBANG, line, "true");

      expect(earlyLeave(text)).toEqual({ line: 2, word: "exit" });
      // A hook is started with no first argument at commit, and nothing sets
      // the variable: each of these is `exit`.
      expect(outcomes(text, EVERY_SHELL)).toEqual(
        EVERY_SHELL.map(shell => `${shell}: skipped, passes`)
      );
    }
  );

  it("is refused for the other words that leave, written the same way", () => {
    expect(earlyLeave(hook(SHEBANG, "$1trap 'exit 0' EXIT"))).toEqual({
      line: 2,
      word: "trap",
    });
    expect(earlyLeave(hook(SHEBANG, 'exec"$program" --check'))).toEqual({
      line: 2,
      word: "exec",
    });
    expect(earlyLeave(hook(SHEBANG, "true", "return`true`"))).toEqual({
      line: 3,
      word: "return",
    });
  });

  it("is refused when what an exit or a trap is given has a dollar sign in front of a quote", () => {
    // `$'1'` is 1 to bash and the text `$1` to dash, which is nothing there.
    expect(earlyLeave(hook(SHEBANG, "false || exit $'1'"))).toEqual({
      line: 2,
      word: "exit",
    });
    expect(earlyLeave(hook(SHEBANG, "trap $'exit 0' EXIT"))).toEqual({
      line: 2,
      word: "trap",
    });
    expect(earlyLeave(hook(SHEBANG, "trap 'exit 0' $'EXIT'"))).toEqual({
      line: 2,
      word: "trap",
    });
  });

  it("does not take a program whose name only starts that way for one", () => {
    expect(earlyLeave(hook(SHEBANG, "exit-code-check --all"))).toBeNull();
    expect(earlyLeave(hook(SHEBANG, 'executable="$1"', "exits=0"))).toBeNull();
  });
});

describe("a hook with a trap that takes over when it ends", () => {
  const MASKS: ReadonlyArray<readonly [string, string, readonly string[]]> = [
    ["an exit with success", 'trap "exit 0" EXIT', EVERY_SHELL],
    ["an exit with success, on 0", "trap 'exit 0' 0", EVERY_SHELL],
    ["an exit with success, after --", "trap -- 'exit 0' EXIT", EVERY_SHELL],
    [
      "an exit with success, with a signal",
      "trap 'exit 0' INT EXIT",
      EVERY_SHELL,
    ],
    [
      "an exit with the status of what it ran",
      "trap 'true; exit $?' EXIT",
      EVERY_SHELL,
    ],
    ["a hand-over to another program", "trap 'exec true' EXIT", ["/bin/sh"]],
  ];

  it.each(MASKS)("is refused: %s", (_name, line, shells) => {
    const text = hook(SHEBANG, line, "true");

    expect(earlyLeave(text)).toEqual({ line: 2, word: "trap" });
    // The added lines run and fail, and the hook still ends with success.
    expect(outcomes(text, shells)).toEqual(
      shells.map(shell => `${shell}: reached, passes`)
    );
  });

  const SPELLINGS = [
    "trap 'exit 0' exit",
    "trap 'exit 0' SIGEXIT",
    "trap 'exit 0' 00",
    "trap 'return 0' EXIT",
    "trap 'exit' EXIT",
    "trap exit EXIT",
    "trap 'exit \"$status\"' EXIT",
    // Not known to be a signal, so taken for the end of the hook.
    'trap "exit 0" "$when"',
  ];

  it.each(SPELLINGS)("is refused however it is spelled: %s", line => {
    expect(earlyLeave(hook(SHEBANG, line))).toEqual({ line: 2, word: "trap" });
  });

  it("is refused when it takes over after a command fails, or before each one", () => {
    // Bash, ksh and zsh run these when a command fails (ERR, ZERR), before
    // every command (DEBUG) and when a function ends (RETURN).
    for (const when of ["ERR", "ZERR", "DEBUG", "RETURN", "err"]) {
      expect(earlyLeave(hook(SHEBANG, `trap 'exit 0' ${when}`))).toEqual({
        line: 2,
        word: "trap",
      });
    }
    expect(
      ranToTheEnd(
        hook("#!/bin/bash", "trap 'exit 0' ERR", "false"),
        { shell: "/bin/bash" },
        cleanups
      )
    ).toEqual({ reached: false, status: 0 });
  });

  it("is refused when the text of what it runs cannot be read", () => {
    expect(earlyLeave(hook(SHEBANG, `trap "echo 'open" EXIT`))).toEqual({
      line: 2,
      word: "trap",
    });
  });

  const KEEPS: ReadonlyArray<readonly [string, string]> = [
    ["cleans up and leaves the status alone", "trap 'rm -f \"$tmp\"' EXIT"],
    ["exits with a written failure", "trap 'exit 1' EXIT"],
    ["exits with success on a signal only", "trap 'exit 0' INT TERM"],
    ["exits with success on a signal given by number", "trap 'exit 0' 2 15"],
    ["is switched off", "trap - EXIT"],
    ["is set to do nothing", "trap '' EXIT"],
  ];

  it.each(KEEPS)("is accepted when it %s", (_name, line) => {
    const text = hook(SHEBANG, "tmp=/dev/null/none", line, "true");

    expect(earlyLeave(text)).toBeNull();
    // The added lines run, fail, and the failure reaches git.
    expect(outcomes(text, EVERY_SHELL)).toEqual(
      EVERY_SHELL.map(shell => `${shell}: reached, fails`)
    );
  });

  it("is accepted when it only lists what is set", () => {
    // Dash has no `-p` and stops with an error there, so this one is run
    // under bash alone.
    const text = hook("#!/bin/bash", "trap -p EXIT", "true");

    expect(earlyLeave(text)).toBeNull();
    expect(outcomes(text, ["/bin/bash"])).toEqual([
      "/bin/bash: reached, fails",
    ]);
  });
});
