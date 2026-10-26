/**
 * Closer-shaped text must never close a compound the shell keeps open.
 *
 * The followed-file walker restores the enclosing flow when a compound closes
 * (CodySwannGT/lisa#4470). Each probe here puts text that LOOKS like a closer —
 * or an opener the walker does not model, whose own closer would pop the
 * enclosing frame — inside a body the shell never runs, between a destructive
 * definition and a benign redefinition. Bash keeps the destructive one, so the
 * walker must keep refusing the call rather than follow the benign body.
 */
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";

const HOOK = path.resolve("plugins/src/base/hooks/parity-safety-net.sh");
const DANGEROUS = `${"r"}${"m"} -${"r"}${"f"} /Users/probe/outside-project`;
const UNCLASSIFIABLE = "cannot classify the file this command executes";
const DIE = 'die () { echo "$*"; }';

/**
 * The first bash 4+ at a fixed absolute path (CI's /bin/bash; Homebrew's on a
 * macOS host, whose /bin/bash is 3.2), or undefined when none is installed.
 */
const MODERN_BASH = [
  "/bin/bash",
  "/usr/bin/bash",
  "/opt/homebrew/bin/bash",
  "/usr/local/bin/bash",
].find(candidate => {
  if (!existsSync(candidate)) return false;
  const probe = boundedSpawnSync({
    command: candidate,
    args: ["-c", "echo ${BASH_VERSINFO[0]}"],
    env: process.env,
    input: "",
    label: `probe ${candidate} version`,
    childMayExitBeforeReading: true,
  });
  return probe.status === 0 && Number(probe.stdout.trim()) >= 4;
});

describe("safety-net closer shadowing", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "lisa-closer-shadow-"));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  /**
   * Write an inspected fixture; nothing here is ever executed.
   * @param name - File name inside the temporary root.
   * @param content - Synthetic shell source.
   * @returns Absolute path of the written fixture.
   */
  function emit(name: string, content: string): string {
    const file = path.join(root, name);
    writeFileSync(file, `#!/bin/sh\n${content}\n`);
    return file;
  }

  /**
   * Run the real guard against the proposed shell text.
   * @param command - Proposed text; only the guard executes.
   * @returns Native guard process result.
   */
  function inspect(command: string) {
    return boundedSpawnSync({
      command: "/bin/bash",
      args: [HOOK],
      cwd: root,
      env: { ...process.env, CLAUDE_PROJECT_DIR: root },
      input: JSON.stringify({ tool_name: "Bash", tool_input: { command } }),
      label: "inspect closer shadowing",
    });
  }

  /**
   * A shadowing probe proves something only if the shell would run it: a
   * script with a syntax error never reaches `die hi`, so its refusal says
   * nothing about shadowing. Every probe here must parse under each shell
   * that may run it. There are no exempt rows: a shape that only some shell
   * accepts is run under, and parsed by, that shell alone.
   * @param file - Generated probe script; parsed with -n, never executed.
   * @param shells - Absolute interpreters that must accept the script.
   */
  function expectValidShell(file: string, shells: readonly string[]): void {
    for (const shell of shells) {
      const parsed = boundedSpawnSync({
        command: shell,
        args: ["-n", file],
        cwd: root,
        env: process.env,
        input: "",
        label: `parse shadowing probe with ${shell}`,
        childMayExitBeforeReading: true,
      });
      expect(parsed.status, `${shell} -n ${file}: ${parsed.stderr}`).toBe(0);
    }
  }

  describe("closer-shaped text the shell does not read as a closer", () => {
    /**
     * Place one line in a body that never runs, before a benign redefinition.
     * Each probe defines a destructive `die` first; the shell keeps it, so a
     * walker that reads the line as a closer would follow the benign body and
     * pass the call. The destructive body sits behind a second file so the
     * whole-file text scan cannot be what refuses it.
     * @param opener - The skipped compound's opening line.
     * @param line - Closer-shaped text inside the skipped body.
     * @param closer - The compound's real closer.
     * @returns The script lines between the two definitions' call sites.
     */
    function skipped(opener: string, line: string, closer: string): string[] {
      return [opener, line, `  ${DIE}`, closer];
    }
    /**
     * Skip the line in a loop that never iterates.
     * @param line - Closer-shaped text inside the loop body.
     * @returns The skipped loop's lines.
     */
    const LOOP = (line: string): string[] =>
      skipped("while false; do", line, "done");
    /**
     * Skip the line in a branch that is never taken.
     * @param line - Closer-shaped text inside the branch.
     * @returns The skipped branch's lines.
     */
    const BRANCH = (line: string): string[] =>
      skipped("if false; then", line, "fi");
    const FAKE_CLOSERS: ReadonlyArray<readonly [string, readonly string[]]> = [
      ["a closer after a comment's `;`", LOOP("  : # x; done")],
      ["a double-quoted closer", LOOP('  "done"')],
      ["a backslash-escaped closer", LOOP("  \\done")],
      ["a single-quoted closer", BRANCH("  'fi'")],
      ["an eval'd closer", LOOP("  eval done")],
      ["a closer after `command`", LOOP("  command done")],
      ["a closer inside backticks", LOOP("  x=`true; done`")],
      ["a closer after a line continuation", LOOP("  echo a \\\ndone")],
      ["an escaped closer after an assignment", LOOP("  x=1 \\done")],
      ["a quoted closer after `!`", LOOP('  ! "done"')],
      ["a closer inside a single-quoted span", BRANCH("  x='a; fi'")],
      ["a closer after a bare comment `;`", BRANCH("  : # ; fi")],
      ["a closer after `builtin`", LOOP("  builtin done")],
      ["a closer inside a double-quoted span", LOOP('  x="a; done"')],
      ["a closer mid single-quoted span", LOOP("  x='a; done b'")],
      ["a closer on its own line of a quoted span", LOOP('  x="a\ndone\n"')],
      // Bash parses `$( )` with the script, so a bare `done` there is a syntax
      // error; an escaped one is a valid command name the split still reads.
      ["a closer inside a command substitution", LOOP("  x=$(: ; \\done)")],
      // Bash splits words on space and tab only; these bytes are word bytes.
      ["a form-feed-prefixed closer", LOOP("\fdone")],
      ["a vertical-tab-prefixed closer", LOOP("\vdone")],
      ["a carriage-return-prefixed closer", LOOP("\rdone")],
      ["a form-feed-prefixed fi", BRANCH("\ffi")],
      ["a tab then form-feed closer", LOOP("\t\fdone")],
      [
        "a form-feed-prefixed esac",
        ["case x in", "  y)", "\fesac", `  ${DIE}`, "  ;;", "esac"],
      ],
      ["a carriage-return-prefixed fi", BRANCH("\rfi")],
      ["a form-feed-prefixed closer after a `;`", LOOP("  :;\fdone")],
      // An opener the walk does not open lets its own closer pop the
      // enclosing frame.
      [
        "an if nested in an elif condition",
        ["if true; then :; elif if x; then :; fi", `  ${DIE}`, "then :; fi"],
      ],
      ["a function whose body is a bare if", BRANCH("  f () if x; then :; fi")],
      [
        "a function whose body is a bare loop",
        LOOP("  f() while x; do :; done"),
      ],
      [
        "a closer in a do line's comment",
        ["while false; do # note; done", `  ${DIE}`, "done"],
      ],
      [
        "a closer in a then line's comment",
        ["if false; then # note; fi", `  ${DIE}`, "fi"],
      ],
      ["a quoted closer after then", ["if false", `then "fi"; ${DIE}; fi`]],
    ];

    /**
     * Shadow a destructive `die` with the probe, prove the shells accept it,
     * and expect the guard to keep refusing the call.
     * @param lines - Probe lines between the two definitions and the call.
     * @param runner - Interpreter named in the proposed command.
     * @param shells - Absolute interpreters that must parse the probe.
     */
    function expectShadowRefused(
      lines: readonly string[],
      runner: string,
      shells: readonly string[]
    ): void {
      const evil = emit("evil.sh", DANGEROUS);
      const script = emit(
        "shadow.sh",
        [`die () { sh ${evil}; }`, ...lines, "die hi"].join("\n")
      );
      const result = inspect(`${runner} ${script}`);

      expectValidShell(script, shells);
      expect(result.status, result.stderr).toBe(2);
      expect(result.stderr).toContain(UNCLASSIFIABLE);
    }

    it.each(FAKE_CLOSERS)(
      "keeps an earlier destructive definition after %s",
      (_shape, lines) =>
        expectShadowRefused(lines, "sh", ["/bin/bash", "/bin/sh"])
    );

    // coproc and `function NAME <compound>` are bash 4+ syntax, so these run
    // as `bash <file>` and parse only under a bash 4+ found at a fixed path.
    const BASH4_ONLY: ReadonlyArray<readonly [string, readonly string[]]> = [
      ["a loop run as a coprocess", LOOP("  coproc while x; do :; done")],
      [
        "a loop run as a named coprocess",
        LOOP("  coproc worker while x; do :; done"),
      ],
      [
        "a function-keyword body that is a bare loop",
        LOOP("  function f while x; do :; done"),
      ],
    ];

    it.skipIf(MODERN_BASH === undefined).each(BASH4_ONLY)(
      "keeps an earlier destructive definition after %s (bash 4+)",
      (_shape, lines) =>
        expectShadowRefused(lines, "bash", [MODERN_BASH ?? "/bin/bash"])
    );

    it("refuses a definition in a body after a do line's comment closer", () => {
      const script = emit(
        "body.sh",
        `for x in a; do # note; done\n  ${DIE}\ndone\ndie hi`
      );
      const result = inspect(`sh ${script}`);

      expect(result.status, result.stderr).toBe(2);
      expect(result.stderr).toContain(UNCLASSIFIABLE);
    });
  });
});
