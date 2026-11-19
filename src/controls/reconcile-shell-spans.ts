/**
 * Finding the commands a line of shell runs inside another command.
 *
 * Shell runs a command of its own wherever a line holds a command
 * substitution, in either spelling, or a process substitution:
 *
 * | Written | What runs |
 * | --- | --- |
 * | `OUT=$(npx eslint .)`, `echo "$(npx eslint .)"` | `npx eslint .` |
 * | `` OUT=`npx eslint .` `` | `npx eslint .` |
 * | `diff <(npx eslint .) expected` | `npx eslint .`, and `diff` |
 *
 * The reader behind `lisa controls reconcile` splits a line into words, and
 * such a span is part of one word, so the command in it was never reported:
 * a hook could capture a check's output and act on it, and the comparison
 * still said nothing runs that the register does not declare.
 *
 * So each span is found here first. What is inside it is handed back to be
 * read as a line of its own, and in the line it stands in it is replaced by
 * filler of the same length ({@link maskSpans}), so that nothing written
 * inside it is taken for a word, a pipe or a bracket of the line around it.
 *
 * ## What is, and is not, a span
 *
 * - Inside single quotes nothing is: `'$(date)'` is those characters.
 * - Inside double quotes `$(…)` and backticks are. `<(…)` is not.
 * - A character after a backslash starts nothing.
 * - After a `#` that starts a word the rest of the line is a comment.
 * - `$((…))` is arithmetic. It is replaced like any span. What is inside it
 *   is a sum and not a command, but a sum can hold a `$(…)` of its own, so
 *   the span says that it is arithmetic and its inside is searched for
 *   those.
 * - Only a span that is closed on the same line is one. One left open is
 *   left as it is written.
 *
 * Only the outermost spans of a line are returned. A span inside one of them
 * is found when that one's inside is read as a line.
 *
 * ## What it gets wrong
 *
 * It follows quotes and brackets, not the shell grammar. The `)` of a `case`
 * label written inside a `$(…)` is taken for the end of the substitution.
 * @module controls/reconcile-shell-spans
 */

/** One command substitution or process substitution of a line. */
export interface ShellSpan {
  /** Where it starts in the line. */
  readonly start: number;
  /** Where the line goes on after it. */
  readonly end: number;
  /** What is written inside it. */
  readonly inner: string;
  /**
   * Whether it is arithmetic: its inside is a sum, which runs nothing itself
   * and may hold spans that do.
   */
  readonly arithmetic: boolean;
}

/** What a place in a line is inside of. */
type FrameKind = "substitution" | "bracket" | "double" | "single" | "tick";

/** One thing that is open at a place in a line, and where it opened. */
interface Frame {
  readonly kind: FrameKind;
  readonly start: number;
}

/** A line read up to one character. */
interface Scan {
  /** Everything that is open, the innermost last. */
  readonly frames: readonly Frame[];
  readonly spans: readonly ShellSpan[];
  /** How many of the next characters are already accounted for. */
  readonly skip: number;
  /** Whether a comment was reached, so the rest of the line is ignored. */
  readonly ended: boolean;
}

/** The older spelling of a command substitution's delimiter. */
const TICK = "`";

/** What a span is replaced with in the line around it. */
const FILLER = "_";

/** The two characters that open a command substitution. */
const SUBSTITUTION = "$(";

/** How arithmetic starts. */
const ARITHMETIC = "$((";

/** The two characters that open a process substitution. */
const PROCESS = new Set(["<(", ">("]);

/** What stands in front of a word. */
const BEFORE_WORD = /^[\s;|&(]?$/u;

/** The kinds of frame whose inside shell runs as a command. */
const RUNS: readonly FrameKind[] = ["substitution", "tick"];

/**
 * Open something at a place in a line.
 * @param scan - The line read so far
 * @param kind - What opens
 * @param start - Where
 * @param skip - How many characters after this one belong to the opener
 * @returns The line read one character further
 */
function push(scan: Scan, kind: FrameKind, start: number, skip = 0): Scan {
  return { ...scan, frames: [...scan.frames, { kind, start }], skip };
}

/**
 * Say what is written inside a span.
 * @param text - The line
 * @param opened - The frame the span opened with
 * @param index - Where its closing character is
 * @returns Its inside, as shell reads it
 */
function insideOf(text: string, opened: Frame, index: number): string {
  return opened.kind === "tick"
    ? // Inside backticks a backtick is written with a backslash.
      text.slice(opened.start + 1, index).replaceAll(`\\${TICK}`, TICK)
    : text.slice(opened.start + SUBSTITUTION.length, index);
}

/**
 * Close the innermost thing that is open.
 * @param text - The line
 * @param scan - The line read so far
 * @param index - Where the closing character is
 * @returns The line read one character further, with the span that closed
 *   when it is an outermost one
 */
function pop(text: string, scan: Scan, index: number): Scan {
  const frames = scan.frames.slice(0, -1);
  const closing = scan.frames.at(-1);
  if (
    closing === undefined ||
    !RUNS.includes(closing.kind) ||
    frames.some(frame => RUNS.includes(frame.kind))
  ) {
    return { ...scan, frames };
  }
  return {
    ...scan,
    frames,
    spans: [
      ...scan.spans,
      {
        arithmetic: text.startsWith(ARITHMETIC, closing.start),
        end: index + 1,
        inner: insideOf(text, closing, index),
        start: closing.start,
      },
    ],
  };
}

/**
 * Read one character that stands between double quotes.
 * @param text - The line
 * @param scan - The line read so far
 * @param index - Where the character is
 * @returns The line read one character further
 */
function inDouble(text: string, scan: Scan, index: number): Scan {
  const char = text.charAt(index);
  if (char === '"') return pop(text, scan, index);
  if (char === TICK) return push(scan, "tick", index);
  return text.startsWith(SUBSTITUTION, index)
    ? push(scan, "substitution", index, 1)
    : scan;
}

/**
 * Read one character that opens or closes a quote or a bracket, outside
 * quotes.
 * @param text - The line
 * @param scan - The line read so far
 * @param index - Where the character is
 * @returns The line read one character further
 */
function delimiter(text: string, scan: Scan, index: number): Scan {
  const char = text.charAt(index);
  const top = scan.frames.at(-1)?.kind;
  if (char === "'") return push(scan, "single", index);
  if (char === '"') return push(scan, "double", index);
  if (char === TICK) return push(scan, "tick", index);
  if (char === "(") return push(scan, "bracket", index);
  // A closing bracket nothing opened is a `case` label's.
  return char === ")" && top !== undefined ? pop(text, scan, index) : scan;
}

/**
 * Read one character that stands outside quotes.
 * @param text - The line
 * @param scan - The line read so far
 * @param index - Where the character is
 * @returns The line read one character further
 */
function inCode(text: string, scan: Scan, index: number): Scan {
  const pair = text.slice(index, index + 2);
  if (pair === SUBSTITUTION || PROCESS.has(pair)) {
    return push(scan, "substitution", index, 1);
  }
  return text.charAt(index) === "#" && BEFORE_WORD.test(text.charAt(index - 1))
    ? { ...scan, ended: true }
    : delimiter(text, scan, index);
}

/**
 * Read one character of a line.
 * @param text - The line
 * @param scan - The line read so far
 * @param index - Where the character is
 * @returns The line read one character further
 */
function step(text: string, scan: Scan, index: number): Scan {
  if (scan.ended) return scan;
  if (scan.skip > 0) return { ...scan, skip: scan.skip - 1 };
  const char = text.charAt(index);
  const top = scan.frames.at(-1)?.kind;
  if (top === "single") return char === "'" ? pop(text, scan, index) : scan;
  if (char === "\\") return { ...scan, skip: 1 };
  if (top === "tick") return char === TICK ? pop(text, scan, index) : scan;
  return top === "double"
    ? inDouble(text, scan, index)
    : inCode(text, scan, index);
}

/**
 * Find the outermost command and process substitutions of a line.
 * @param text - The line
 * @returns Each one that is closed on the line, in order
 */
export function shellSpans(text: string): readonly ShellSpan[] {
  return Array.from({ length: text.length }, (_, index) => index).reduce<Scan>(
    (scan, index) => step(text, scan, index),
    { ended: false, frames: [], skip: 0, spans: [] }
  ).spans;
}

/**
 * Replace each span of a line with filler of the same length, so that every
 * other character keeps its place.
 * @param text - The line
 * @param spans - Its spans, from {@link shellSpans}
 * @returns The line with nothing left in it that a span held
 */
export function maskSpans(text: string, spans: readonly ShellSpan[]): string {
  return spans.reduce(
    (masked, span) =>
      `${masked.slice(0, span.start)}${FILLER.repeat(span.end - span.start)}${masked.slice(span.end)}`,
    text
  );
}
