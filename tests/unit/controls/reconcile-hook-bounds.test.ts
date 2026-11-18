/**
 * What the hook reader does with a hook that is more than it takes on
 * (CodySwannGT/lisa#4994, on the reader of CodySwannGT/lisa#5000).
 *
 * A hook is somebody else's text. Reading it must never throw and never run
 * on without end, and a hook the reader gives up on must be reported as not
 * read: passed over in silence, its commands would be missing from a run
 * that says nothing differs.
 */
import { describe, expect, it } from "vitest";

import {
  MAX_HOOK_CHARACTERS,
  MAX_HOOK_LINES,
  readShellHook,
  type ShellHookRead,
} from "../../../src/controls/reconcile-hook-lines.js";
import {
  MAX_SHELL_LINE_LENGTH,
  MAX_SUBSTITUTION_DEPTH,
} from "../../../src/controls/reconcile-shell-line.js";

const SHEBANG = "#!/bin/sh";
const LINT = "npm run lint";

/**
 * The commands of a hook that is expected to be readable, as text.
 * @param lines - The hook, one item per line
 * @returns Each command as it is reported
 */
function texts(lines: readonly string[]): readonly string[] {
  const read = readShellHook(lines.join("\n"));
  if (read.problem !== null) throw new Error(read.problem);
  return read.commands.map(command => command.command);
}

describe("a hook that is more than the reader takes on", () => {
  const HALF = MAX_SHELL_LINE_LENGTH / 2;

  /**
   * Read a hook, failing the case if the reader throws or takes too long.
   * @param text - The hook's content
   * @returns What the reader returned
   */
  function readInTime(text: string): ShellHookRead {
    const started = performance.now();
    const read = readShellHook(text);

    expect(performance.now() - started).toBeLessThan(5000);
    return read;
  }

  it("says the hook was not read, and does not throw, for a word that ends in 100,000 closing brackets", () => {
    const read = readInTime([SHEBANG, `x${")".repeat(100_000)}`].join("\n"));

    expect(read.problem).toContain("line 2 is 100001 characters long");
    expect(read.problem).toContain(String(MAX_SHELL_LINE_LENGTH));
  });

  it.each([
    ["closing brackets", ")".repeat(MAX_SHELL_LINE_LENGTH)],
    ["opening brackets", "(".repeat(MAX_SHELL_LINE_LENGTH)],
    ["a word ending in closing brackets", `x${")".repeat(HALF)}`],
    ["piped one-letter words", "a|".repeat(HALF)],
    ["one-letter words", "a ".repeat(HALF)],
    ["chained one-letter commands", "a;".repeat(HALF)],
    ["case labels", "a) ".repeat(HALF / 2)],
    ["quotes that never close", '"'.repeat(MAX_SHELL_LINE_LENGTH - 1)],
    ["substitutions that never close", "$(".repeat(HALF)],
    ["backticks", "`".repeat(MAX_SHELL_LINE_LENGTH - 1)],
    ["escapes", "\\".repeat(MAX_SHELL_LINE_LENGTH)],
    ["redirects", "> ".repeat(HALF)],
    ["double brackets", "[[ ".repeat(HALF / 2)],
  ])(
    "reads the longest line it takes on when it is all %s, without throwing",
    (_shape, line) => {
      expect(line.length).toBeLessThanOrEqual(MAX_SHELL_LINE_LENGTH);
      expect(readInTime([SHEBANG, line, LINT].join("\n"))).toMatchObject({
        problem: null,
      });
    }
  );

  it("follows substitutions as deep as it says it does, and no deeper", () => {
    const nested = (depth: number): string =>
      `X=${"$(echo ".repeat(depth)}$(${LINT})${")".repeat(depth)}`;

    expect(texts([nested(MAX_SUBSTITUTION_DEPTH - 1)])).toEqual([LINT]);
    expect(readInTime(nested(MAX_SUBSTITUTION_DEPTH)).problem).toContain(
      `line 1 nests commands inside commands more than ${MAX_SUBSTITUTION_DEPTH} deep`
    );
    expect(readInTime(nested(2000)).problem).toContain("line 1");
  });

  it("says a hook with more lines than it reads was not read", () => {
    const full = `${LINT}\n`.repeat(MAX_HOOK_LINES);

    const read = readInTime(`${full}${LINT}`);

    expect(read.problem).toContain(`${MAX_HOOK_LINES + 1} lines`);
  });

  it("says a hook with more characters than it reads was not read", () => {
    const read = readInTime(`${LINT}\n`.repeat(MAX_HOOK_CHARACTERS / 8));

    expect(read.problem).toContain("characters, and this command reads hooks");
  });

  it("reads the largest hook it takes on in bounded time when every line is the longest it reads and the slowest kind", () => {
    const line = "a;".repeat(HALF);
    const lines = Math.floor(MAX_HOOK_CHARACTERS / (line.length + 1));
    const started = performance.now();

    const read = readShellHook(
      Array.from({ length: lines }, () => line).join("\n")
    );

    expect(performance.now() - started).toBeLessThan(30_000);
    expect(read).toMatchObject({ problem: null });
  });

  it("measures a line with the lines it continues onto", () => {
    const line = `echo ${"a ".repeat(HALF / 2)}\\`;

    expect(readInTime([line, line, line].join("\n")).problem).toContain(
      "line 1 is"
    );
  });

  it("never throws, whatever a line holds", () => {
    const shapes = ["(", ")", "$(", "`", '"', "'", "\\", "|", ";", "{", "}"];
    const lines = shapes.flatMap(left =>
      shapes.map(right => `${left}${right}`.repeat(HALF / 2).slice(0, 2000))
    );

    expect(() => readInTime(lines.join("\n"))).not.toThrow();
  });
});
