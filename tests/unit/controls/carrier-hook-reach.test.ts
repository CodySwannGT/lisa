/**
 * Whether lines added at the end of a shell hook are sure to be reached
 * (CodySwannGT/lisa#4989).
 *
 * The call to a carrier is added after a hook's own content. Each case here
 * is a hook someone could really have, and says whether added lines would
 * run after it. The first group is the wrong outcome this reader exists to
 * prevent: a hook that leaves with success before its last line.
 */
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { earlyLeave } from "../../../src/controls/carrier-hook-reach.js";
import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";

const SH = "/bin/sh";

const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

/**
 * Join the lines of a hook.
 * @param lines - The lines
 * @returns The hook's text
 */
function hook(...lines: readonly string[]): string {
  return `${lines.join("\n")}\n`;
}

/**
 * Run a hook with one line added at its end, and say whether that line ran.
 * @param text - The hook
 * @returns Whether the added line was reached, and how the hook ended
 */
function ranToTheEnd(text: string): {
  readonly reached: boolean;
  readonly status: number | null;
} {
  const folder = mkdtempSync(path.join(tmpdir(), "lisa-carrier-reach-"));
  const file = path.join(folder, "hook");
  const mark = path.join(folder, "reached");
  cleanups.push(() => rmSync(folder, { force: true, recursive: true }));
  writeFileSync(file, `${text}echo reached > "${mark}"\n`);
  chmodSync(file, 0o755);
  // Worked out in the order written: the hook runs, then the mark is looked
  // for.
  return {
    status: boundedSpawnSync({
      args: [file],
      command: SH,
      cwd: folder,
      env: { PATH: "/usr/bin:/bin" },
      input: "",
      label: "a hook with a line added at its end",
    }).status,
    reached: existsSync(mark),
  };
}

describe("a hook that can leave with success before its end", () => {
  const LEAVES: ReadonlyArray<
    readonly [string, string, { line: number; word: string }]
  > = [
    [
      "an if whose branches both exit, closed by fi",
      hook(
        "#!/bin/sh",
        "if true; then",
        "  true",
        "  exit $?",
        "else",
        "  exit 0",
        "fi"
      ),
      { line: 4, word: "exit" },
    ],
    [
      "a last line that exits after another command",
      hook("#!/bin/sh", "true; exit $?"),
      { line: 2, word: "exit" },
    ],
    [
      "a plain exit 0 in the middle",
      hook("#!/bin/sh", "true", "exit 0", "true"),
      { line: 3, word: "exit" },
    ],
    [
      "a hand-over to another program that is not the last line",
      hook("#!/bin/sh", "exec true", "true"),
      { line: 2, word: "exec" },
    ],
    [
      "an exit 0 after a failure",
      hook("#!/bin/sh", "false || exit 0"),
      { line: 2, word: "exit" },
    ],
    [
      "an exit in a case branch",
      hook("#!/bin/sh", "case x in", "  x) exit 0 ;;", "esac"),
      { line: 3, word: "exit" },
    ],
    [
      "an exit after a line continued with a backslash",
      hook("#!/bin/sh", "true \\", "  && exit 0"),
      { line: 3, word: "exit" },
    ],
    [
      "an exit after a quoted text that runs over two lines",
      hook("#!/bin/sh", 'echo "one', 'two"; exit 0'),
      { line: 3, word: "exit" },
    ],
    [
      "an exit after the end of a here-document",
      hook("#!/bin/sh", "cat <<EOF", "it's text", "EOF", "exit 0"),
      { line: 5, word: "exit" },
    ],
    [
      "an exec behind a setting and the word command",
      hook("#!/bin/sh", "CI=1 command exec true"),
      { line: 2, word: "exec" },
    ],
  ];

  it.each(LEAVES)("is refused: %s", (_name, text, leave) => {
    expect(earlyLeave(text)).toEqual(leave);
    // The hook really does skip a line added at its end, and reports success.
    expect(ranToTheEnd(text)).toEqual({ reached: false, status: 0 });
  });
});

describe("a hook the reader cannot prove safe", () => {
  it("is refused for an exit with a failure inside an if", () => {
    expect(
      earlyLeave(hook("#!/bin/sh", "if ! true; then", "  exit 1", "fi"))
    ).toEqual({ line: 3, word: "exit" });
  });

  it("is refused for an exit whose status is a variable", () => {
    expect(earlyLeave(hook("#!/bin/sh", 'false || exit "$code"'))).toEqual({
      line: 2,
      word: "exit",
    });
  });

  it("is refused where a quote is still open at the place lines would go", () => {
    expect(earlyLeave(hook("#!/bin/sh", "echo 'never closed"))).toEqual({
      line: 2,
      word: "open",
    });
  });

  it("is refused where a here-document is still open there", () => {
    expect(earlyLeave(hook("#!/bin/sh", "cat <<EOF", "text"))?.word).toBe(
      "open"
    );
  });
});

describe("a hook whose end is reached whenever what is above it passed", () => {
  const REACHED: ReadonlyArray<readonly [string, string]> = [
    ["a plain command", hook("#!/bin/sh", "true")],
    [
      "a failure that exits with a failure",
      hook("#!/bin/sh", "true || exit 1"),
    ],
    [
      "a failure that exits with its own status",
      hook("#!/bin/sh", "true || exit $?", 'true || exit "$?"', "true || exit"),
    ],
    [
      "a program called exec by its package manager",
      hook(
        "#!/bin/sh",
        "true npm exec lint-staged",
        "true bundle exec rubocop"
      ),
    ],
    [
      "an exec that only redirects",
      hook(
        "#!/bin/sh",
        "exec 3>&1",
        "exec < /dev/null",
        "exec >/dev/null 2>&1"
      ),
    ],
    [
      "the word exit inside a message, a comment and a here-document",
      hook(
        "#!/bin/sh",
        "# exit 0 would be wrong here",
        'echo "do not exit; exec nothing" >/dev/null',
        "echo 'exit 0' >/dev/null",
        "cat >/dev/null <<'EOF'",
        "exit 0",
        "exec true",
        "EOF",
        "true # exit 0"
      ),
    ],
    ["a trap that exits on a signal", hook("#!/bin/sh", "trap 'exit 1' INT")],
    [
      "a function named like the word",
      hook("#!/bin/sh", "exit_code=0", "true"),
    ],
  ];

  it.each(REACHED)("is accepted: %s", (_name, text) => {
    expect(earlyLeave(text)).toBeNull();
    expect(ranToTheEnd(text)).toEqual({ reached: true, status: 0 });
  });

  it("is accepted for the line Husky's older versions start a hook with", () => {
    expect(
      earlyLeave(hook("#!/bin/sh", '. "$(dirname -- "$0")/_/husky.sh"', "true"))
    ).toBeNull();
  });
});
