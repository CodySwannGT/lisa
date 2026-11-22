/**
 * Ways of writing a shell hook that leave nothing open, and that the reader
 * of `lisa controls install-carriers` once took for an open quote or an
 * open here-document (CodySwannGT/lisa#4989).
 *
 * A hook refused that way gets nothing added, so every form the reader can
 * follow for certain is followed. Where it cannot be certain it says that it
 * could not read the hook, and from which line. Each accepted form is also
 * run under every shell on this machine, to hold "nothing is left open" to
 * what a shell does.
 */
import { afterEach, describe, expect, it } from "vitest";

import { earlyLeave } from "../../../src/controls/carrier-hook-reach.js";
import {
  EVERY_SHELL,
  hook,
  ranToTheEnd,
} from "../../support/carrier-hook-run.js";

const SHEBANG = "#!/bin/sh";

/** A no-break space, named so that it can be seen. */
const NBSP = String.fromCodePoint(0xa0);

const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

describe("a hook written in a form that leaves nothing open", () => {
  const READ: ReadonlyArray<readonly [string, readonly string[]]> = [
    ["a shift inside arithmetic", ["x=$((1<<2))", "y=$(( (x << 1) + 1 ))"]],
    [
      "a double quote inside single quotes inside a quoted substitution",
      [`v="$(printf '%s' 'a"b')"`, `w="$(printf '%s' "$(printf '%s' 'c"d')")"`],
    ],
    [
      "a program started with quoted code inside a quoted substitution",
      [`v="$(printf '%s' 'require("./package.json").version')"`],
    ],
    [
      "a substitution in a substitution, each with quotes of its own",
      ['here="$(cd "$(dirname -- "$0")" && pwd)"', 'test -n "$here"'],
    ],
    [
      "two less-than signs in a comment line",
      ["# shift left: x << 2", "  # usage: tool <<EOF", "true"],
    ],
    [
      "a parenthesis in single quotes inside a quoted substitution",
      [`v="$(printf '%s' ')')"`, 'test "$v" = ")"'],
    ],
  ];

  it.each(READ)("is accepted: %s", (_name, lines) => {
    const text = hook(SHEBANG, ...lines);

    expect(earlyLeave(text)).toBeNull();
    for (const shell of EVERY_SHELL) {
      expect(ranToTheEnd(text, { shell }, cleanups)).toEqual({
        reached: true,
        status: 0,
      });
    }
  });

  it("still sees an exit that follows such a form", () => {
    expect(
      earlyLeave(hook(SHEBANG, `v="$(printf '%s' 'a"b')"; exit 0`))
    ).toEqual({ line: 2, word: "exit" });
    expect(earlyLeave(hook(SHEBANG, "x=$((1<<2))", "exit 0"))).toEqual({
      line: 3,
      word: "exit",
    });
    expect(earlyLeave(hook(SHEBANG, "# x << EOF", "exit 0", "EOF"))).toEqual({
      line: 3,
      word: "exit",
    });
  });

  it("does not take a command inside a quoted substitution for one of the hook's", () => {
    // What runs there runs in a shell of its own and cannot end the hook.
    const text = hook(
      SHEBANG,
      'v="$(exit 0)"',
      'w="$(printf \'%s\' "x"; exit 0)"'
    );

    expect(earlyLeave(text)).toBeNull();
    expect(ranToTheEnd(text, {}, cleanups)).toEqual({
      reached: true,
      status: 0,
    });
  });
});

describe("a hook the reader cannot follow", () => {
  const UNREAD: ReadonlyArray<readonly [string, readonly string[], number]> = [
    [
      // Dash reads this as a quote that is never closed; bash does not.
      "a quote written with a dollar sign and an escaped quote in it",
      ["true", "x=$'it\\'s'"],
      3,
    ],
    [
      "a shift inside arithmetic that runs over two lines",
      ["x=$((1 << y", "))"],
      2,
    ],
    [
      // Read as a here-document, the two lines under it would be blanked
      // out and the hook accepted; it exits with success on its third line.
      "two less-than signs inside a quoted message, above an exit",
      ['echo "see <<EOF"', "exit 0", "EOF"],
      2,
    ],
    [
      "two less-than signs after a # further along a line",
      ["true # see <<EOF", "exit 0", "EOF"],
      2,
    ],
    ["a quote that really is left open", ["true", "true", 'echo "open'], 4],
    [
      "a here-document that really is left open",
      ["cat <<'EOF'", "text", "more text"],
      2,
    ],
    [
      // The first empty line closes it, wherever that is.
      "a here-document whose closing word is nothing",
      ["true", "cat >/dev/null <<''", "exit 0"],
      3,
    ],
    [
      "a here-document whose closing word runs on to the next line",
      ["cat >/dev/null <<'one", "two'", "exit 0"],
      2,
    ],
    [
      // A shell takes these for part of a word; no rule here takes them in.
      "a no-break space outside quotes and comments",
      ["true", `true${NBSP}exit 0`],
      3,
    ],
    ["a form feed outside quotes and comments", ["true", "\f", "true"], 3],
    [
      // `exit 0` to bash, ksh and zsh; a program called `$exit` to dash.
      "a command named by a dollar sign in front of a quote",
      ["true", "$'exit' 0"],
      3,
    ],
    [
      "a command with a dollar sign and an empty quote in front of its name",
      ["$''exit 0"],
      2,
    ],
    ["a parenthesis that is left open", ["true", "( true", "true"], 3],
    [
      "a command substitution that is left open",
      ["true", "true", "x=$(true"],
      4,
    ],
  ];

  it.each(UNREAD)(
    "is refused as not read, from the line it lost track on: %s",
    (_name, lines, line) => {
      expect(earlyLeave(hook(SHEBANG, ...lines))).toEqual({
        line,
        word: "unread",
      });
    }
  );

  it("really does leave with success where a shell takes the dollar sign and the quote for nothing", () => {
    const text = hook("#!/bin/bash", "$'exit' 0", "true");

    expect(earlyLeave(text)).toEqual({ line: 2, word: "unread" });
    expect(ranToTheEnd(text, { shell: "/bin/bash" }, cleanups)).toEqual({
      reached: false,
      status: 0,
    });
  });

  it("accepts a dollar sign in front of a quote as a value, and as what another command is given", () => {
    const text = hook(
      SHEBANG,
      "IFS=$'\\n'",
      "tab=$'\\t' true",
      "printf '%s' $'one\\n' >/dev/null",
      "( true ) && case x in x) true ;; esac"
    );

    expect(earlyLeave(text)).toBeNull();
    for (const shell of EVERY_SHELL) {
      expect(ranToTheEnd(text, { shell }, cleanups)).toEqual({
        reached: true,
        status: 0,
      });
    }
  });

  it("really does leave with success in the case it will not guess at", () => {
    const text = hook(SHEBANG, 'echo "see <<EOF" >/dev/null', "exit 0", "EOF");

    expect(earlyLeave(text)?.word).toBe("unread");
    expect(ranToTheEnd(text, {}, cleanups)).toEqual({
      reached: false,
      status: 0,
    });
  });

  it("reads a no-break space inside a quote or a comment like any other character", () => {
    const text = hook(
      SHEBANG,
      `echo "one${NBSP}two" >/dev/null # three${NBSP}four`,
      `printf '%s' 'five${NBSP}six' >/dev/null`
    );

    expect(earlyLeave(text)).toBeNull();
    expect(ranToTheEnd(text, {}, cleanups)).toEqual({
      reached: true,
      status: 0,
    });
  });

  it("still reads a here-document whose closing word is quoted", () => {
    expect(
      earlyLeave(
        hook(SHEBANG, "cat >/dev/null <<'EOF'", "exit 0", "EOF", "true")
      )
    ).toBeNull();
    expect(
      earlyLeave(hook(SHEBANG, 'cat "a" <<"EOF" >/dev/null', "it's", "EOF"))
    ).toBeNull();
  });
});
