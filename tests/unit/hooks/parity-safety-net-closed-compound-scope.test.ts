/**
 * A closed compound command restores the flow state that encloses it.
 *
 * The followed-file walker records a function as CONDITIONAL when reaching its
 * definition depends on runtime flow, and refuses a later call to it. A
 * `while`/`until`/`for`/`case`/`if` that has fully closed no longer decides
 * whether a following top-level definition runs, so it must not leave that
 * verdict behind — the defect that blocked every Gradle-generated start script
 * (CodySwannGT/lisa#4470). Definitions INSIDE a compound, and definitions a
 * conditional `return` can skip, stay conditional.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";

const HOOK = path.resolve("plugins/src/base/hooks/parity-safety-net.sh");
const GRADLE_START_SCRIPT = path.resolve(
  "tests/fixtures/parity-safety-net/gradle-start-script.sh"
);
const DANGEROUS = `${"r"}${"m"} -${"r"}${"f"} /Users/probe/outside-project`;
const UNCLASSIFIABLE = "cannot classify the file this command executes";
const DIE = 'die () { echo "$*"; }';

/** Closed compound commands that precede a top-level definition. */
const CLOSED_COMPOUNDS: ReadonlyArray<readonly [string, string]> = [
  ["a while loop", 'while [ "$x" = a ]; do x=b; done'],
  ["an until loop", 'until [ "$x" = b ]; do x=b; done'],
  ["a for loop", "for x in a; do :; done"],
  ["a case", "case a in a) x=b ;; esac"],
  ["an if", 'if [ -n "$x" ]; then x=b; else x=c; fi'],
  ["a multi-line while", 'while\n  [ "$x" = a ]\ndo\n  x=b\ndone'],
  ["a redirected loop", "while read -r x; do :; done < /dev/null"],
  ["a piped loop", "for x in a; do echo x; done | cat"],
  ["a piped if condition", "if echo a | grep -q a; then :; fi"],
  [
    "a nested loop, if and case",
    'while [ "$x" = a ]; do\n  if [ -n "$x" ]; then\n    case $x in a) x=b ;; esac\n  fi\ndone',
  ],
  [
    "a case inside an if condition",
    "if\n  case a in a) true ;; esac\nthen\n  :\nfi",
  ],
];

/** Compound bodies and lists whose definition may never run. */
const ENCLOSING_SHAPES: ReadonlyArray<readonly [string, string]> = [
  ["a while body", `while [ "$x" = a ]; do\n  ${DIE}\n  x=b\ndone`],
  ["an until body", `until [ "$x" = b ]; do\n  ${DIE}\n  x=b\ndone`],
  ["a for body", `for x in a; do\n  ${DIE}\ndone`],
  ["a case arm", `case $x in\n  a)\n    ${DIE}\n    ;;\nesac`],
  ["an if branch", `if [ -n "$x" ]; then\n  ${DIE}\nfi`],
  ["an else branch", `if [ -n "$x" ]; then\n  :\nelse\n  ${DIE}\nfi`],
  ["an && list", `[ -n "$x" ] && ${DIE}`],
  ["an || list", `[ -n "$x" ] || ${DIE}`],
  [
    "a loop after a nested if closes",
    `while [ "$x" = a ]; do\n  if [ -n "$x" ]; then :; fi\n  ${DIE}\n  x=b\ndone`,
  ],
  [
    "a loop after a nested case closes",
    `for x in a; do\n  case $x in a) : ;; esac\n  ${DIE}\ndone`,
  ],
];

describe("safety-net closed compound scope", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "lisa-closed-compound-"));
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
      label: "inspect closed compound scope",
    });
  }

  describe("a definition after a closed compound is unconditional", () => {
    it("allows a definition with nothing before it (probe c)", () => {
      const script = emit("c.sh", `${DIE}\ndie hi`);
      const result = inspect(`sh ${script}`);

      expect(result.status, result.stderr).toBe(0);
    });

    it("allows a definition whose body closes with a redirect (probe a)", () => {
      const script = emit("a.sh", 'die () {\n  echo "$*"\n} >&2\ndie hi');
      const result = inspect(`sh ${script}`);

      expect(result.status, result.stderr).toBe(0);
    });

    it.each(CLOSED_COMPOUNDS)("allows a call after %s", (_shape, compound) => {
      const script = emit("probe.sh", `${compound}\n${DIE}\ndie hi`);
      const result = inspect(`sh ${script}`);

      expect(result.stderr).not.toContain(UNCLASSIFIABLE);
      expect(result.status, result.stderr).toBe(0);
    });

    it.each(CLOSED_COMPOUNDS)(
      "still follows the body called after %s",
      (_shape, compound) => {
        const inner = emit("inner.sh", DANGEROUS);
        const script = emit(
          "probe.sh",
          `${compound}\ndie () { sh ${inner}; }\ndie hi`
        );
        const result = inspect(`sh ${script}`);

        expect(result.status, result.stderr).toBe(2);
        expect(result.stderr).not.toContain(UNCLASSIFIABLE);
        expect(result.stderr).toContain(inner);
      }
    );

    it("allows a definition after the whole nest closes", () => {
      const script = emit(
        "nest.sh",
        `while [ "$x" = a ]; do if [ -n "$x" ]; then :; fi; x=b; done\n${DIE}\ndie hi`
      );
      const result = inspect(`sh ${script}`);

      expect(result.status, result.stderr).toBe(0);
    });
  });

  describe("a definition the flow may skip stays conditional", () => {
    it.each(ENCLOSING_SHAPES)(
      "refuses a function defined in %s",
      (_shape, definition) => {
        const script = emit("inside.sh", `${definition}\ndie hi`);
        const result = inspect(`sh ${script}`);

        expect(result.status, result.stderr).toBe(2);
        expect(result.stderr).toContain(UNCLASSIFIABLE);
      }
    );

    it("refuses a definition after a loop's conditional return in a sourced file", () => {
      writeFileSync(
        path.join(root, "defs.sh"),
        `for x in a; do [ -n "$x" ] && return; done\n${DIE}\n`
      );
      const result = inspect("source defs.sh; die hi");

      expect(result.status, result.stderr).toBe(2);
      expect(result.stderr).toContain(UNCLASSIFIABLE);
    });

    it("refuses a definition after a loop's return in a sourced file", () => {
      writeFileSync(
        path.join(root, "defs.sh"),
        `while [ -n "$x" ]; do return; done\n${DIE}\n`
      );
      const result = inspect(". defs.sh; die hi");

      expect(result.status, result.stderr).toBe(2);
      expect(result.stderr).toContain(UNCLASSIFIABLE);
    });

    it("refuses a definition after an if's conditional return in a function body", () => {
      const result = inspect(
        `setup () { if [ -n "$x" ]; then return; fi; ${DIE}; }; setup; die hi`
      );

      expect(result.status, result.stderr).toBe(2);
      expect(result.stderr).toContain(UNCLASSIFIABLE);
    });

    it("refuses a definition after a loop's conditional return in a function body", () => {
      const result = inspect(
        `setup () { for x in a; do [ -n "$x" ] && return; done; ${DIE}; }; setup; die hi`
      );

      expect(result.status, result.stderr).toBe(2);
      expect(result.stderr).toContain(UNCLASSIFIABLE);
    });
  });

  describe("loop exits that cannot skip a later definition", () => {
    // break and continue resume AT or INSIDE the loop, so a definition after
    // `done` is reached on every path that reaches its call; exit ends the
    // shell, so no call after the definition runs without it.
    it.each([
      ["break", 'for x in a b; do [ "$x" = a ] && break; done'],
      ["continue", 'for x in a b; do [ "$x" = a ] && continue; done'],
      ["exit", 'if [ -z "$x" ]; then exit 1; fi'],
    ])("allows a definition after a compound's %s", (_exit, compound) => {
      const script = emit("exits.sh", `${compound}\n${DIE}\ndie hi`);
      const result = inspect(`sh ${script}`);

      expect(result.status, result.stderr).toBe(0);
    });

    it("allows a definition after a loop's break in a sourced file", () => {
      writeFileSync(
        path.join(root, "defs.sh"),
        `for x in a b; do [ "$x" = a ] && break; done\n${DIE}\n`
      );
      const result = inspect("source defs.sh; die hi");

      expect(result.status, result.stderr).toBe(0);
    });
  });

  describe("text the walker cannot trust keeps the old verdict", () => {
    it("refuses a definition after a heredoc whose body spells a closer", () => {
      const script = emit(
        "heredoc.sh",
        `for x in a; do\n  cat <<EOF\ndone\nEOF\n  ${DIE}\ndone\ndie hi`
      );
      const result = inspect(`sh ${script}`);

      expect(result.status, result.stderr).toBe(2);
      expect(result.stderr).toContain(UNCLASSIFIABLE);
    });

    it("refuses a definition after a closer that matches no open compound", () => {
      // The comment's `;` reaches the walker as a statement boundary, so the
      // walker reads a `done` inside an `if`. It must not close the `if`.
      const script = emit(
        "mismatch.sh",
        `if [ -n "$x" ]; then\n  : # skip; done\n  ${DIE}\nfi\ndie hi`
      );
      const result = inspect(`sh ${script}`);

      expect(result.status, result.stderr).toBe(2);
      expect(result.stderr).toContain(UNCLASSIFIABLE);
    });
  });

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
      ["a closer inside a command substitution", LOOP("  x=$(true; done b)")],
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
      ["a form feed ending the line before a closer", LOOP(":;\f\ndone")],
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

    it.each(FAKE_CLOSERS)(
      "keeps an earlier destructive definition after %s",
      (_shape, lines) => {
        const evil = emit("evil.sh", DANGEROUS);
        const script = emit(
          "shadow.sh",
          [`die () { sh ${evil}; }`, ...lines, "die hi"].join("\n")
        );
        const result = inspect(`sh ${script}`);

        expect(result.status, result.stderr).toBe(2);
        expect(result.stderr).toContain(UNCLASSIFIABLE);
      }
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

  describe("directory resolution across a closed loop", () => {
    beforeEach(() => {
      mkdirSync(path.join(root, "safe"));
      writeFileSync(path.join(root, "x.sh"), `#!/bin/sh\n${DANGEROUS}\n`);
      writeFileSync(path.join(root, "safe", "x.sh"), "#!/bin/sh\necho safe\n");
    });

    it("resolves a cd after a closed loop", () => {
      const result = inspect("for x in a; do :; done; cd safe && sh ./x.sh");

      expect(result.status, result.stderr).toBe(0);
    });

    it("refuses a relative script after a cd inside a loop", () => {
      const result = inspect("for x in $EMPTY; do cd safe; done; sh ./x.sh");

      expect(result.status, result.stderr).toBe(2);
      expect(result.stderr).toContain("the execution directory is unknown");
    });

    it("refuses a relative script after a cd behind a comment closer", () => {
      const result = inspect(
        "for x in $EMPTY; do # note; done\n  cd safe\ndone\nsh ./x.sh"
      );

      expect(result.status, result.stderr).toBe(2);
      expect(result.stderr).toContain("the execution directory is unknown");
    });
  });

  it("allows a Gradle start script unmodified apart from the application name", () => {
    const result = inspect(`sh ${GRADLE_START_SCRIPT} --version`);

    expect(result.stderr).not.toContain(UNCLASSIFIABLE);
    expect(result.status, result.stderr).toBe(0);
  });
});
