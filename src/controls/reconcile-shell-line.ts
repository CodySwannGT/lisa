/**
 * Reading the commands one line of shell runs.
 *
 * `lisa controls reconcile` reports every command a commit or push hook runs
 * that no register entry declares. This is the reader behind it, for one
 * line. It is given text and returns text: nothing it finds is ever run.
 *
 * ## What counts as a command
 *
 * 1. The command and process substitutions of the line are found first
 *    (`./reconcile-shell-spans.ts`). What is inside each is read as a line
 *    of its own, as deep as {@link MAX_SUBSTITUTION_DEPTH}, and in the line
 *    it stands in it is replaced by filler.
 * 2. The line is split where shell starts another command (`&&`, `||`, `;`,
 *    a pipe), outside quotes (`./reconcile-shell-words.ts`).
 * 3. From each piece the redirects are left out, and so is what shell puts
 *    around a command: the words in front of it (`if`, `!`, `then`, `exec`,
 *    `command`, a `NAME=value` setting, a `case` head or label, the name a
 *    function is defined under), the bracket that opens a group and the one
 *    that closes it (`./reconcile-shell-command.ts`).
 * 4. What is left is a command unless its first word only steers the shell
 *    (`set`, `cd`, `exit`, `[`, `echo` and the like), only tests whether a
 *    program is there (`command -v`, `type`, `which`), or is the call to
 *    Lisa's own carrier.
 *
 * So `OUT=$(npx eslint . 2>&1) || { echo "$OUT"; exit 1; }` runs
 * `npx eslint .`, and `( cd api && npm test ) 2>&1 | tee log` runs
 * `npm test` and `tee log`.
 *
 * Two lines are read beyond that. What a `trap` is set to run is read as a
 * line of its own. The line that starts Husky, which reads `husky.sh` from
 * a folder it works out with `$(dirname -- "$0")`, is Husky's: neither it
 * nor what it finds its own folder with is reported.
 *
 * ## What it gives up on
 *
 * A line longer than {@link MAX_SHELL_LINE_LENGTH} characters, or one that
 * nests commands inside commands deeper than {@link MAX_SUBSTITUTION_DEPTH},
 * is not read at all, and the caller is told so. The reader never throws,
 * whatever a line holds: the time it takes is bounded by those two limits.
 *
 * ## What it does not follow
 *
 * It is not a shell, and a run that says nothing differs is only as good as
 * this list is short:
 *
 * - A script, a function or an alias the line calls. It is reported as that
 *   call, and what it does is not opened.
 * - Code handed to a program as text: `eval "…"`, `sh -c "…"`, `xargs …`,
 *   `find … -exec …`, `git … --exec …`. The call is reported and the text
 *   is not read.
 * - Conditions. Every branch is read, whether or not it would run.
 * - A here-document. Each of its lines is read as a line of shell.
 * - A `case` written inside a `$(…)`: the `)` of its first label is taken
 *   for the end of the substitution.
 * - A `case` arm whose label opens with a bracket, as in `(*.py) ruff`: it
 *   is reported with the label in it.
 * - Brackets across lines. They are matched within one line: the last line
 *   of a group that spans several is read right when its closing bracket
 *   stands on its own or after a command of more than one word.
 * @module controls/reconcile-shell-line
 */
import path from "node:path";

import { carrierScriptPath } from "./carrier-script.js";
import { CARRIER_MOMENTS, CARRIER_RUNNER_FILE } from "./carrier-types.js";
import {
  casePatterns,
  commandOfPiece,
  withoutCaseHead,
} from "./reconcile-shell-command.js";
import { maskSpans, shellSpans } from "./reconcile-shell-spans.js";
import { pieces, wordAt, type Word } from "./reconcile-shell-words.js";

/** The longest line that is read, in characters. */
export const MAX_SHELL_LINE_LENGTH = 8192;

/** How deep commands inside commands are followed. */
export const MAX_SUBSTITUTION_DEPTH = 8;

/** One command a hook runs. */
export interface ShellCommand {
  /** The line it starts on, counted from 1. */
  readonly line: number;
  /** The command as it is written, without the shell words in front of it. */
  readonly command: string;
  /** Its words, with the quotes around them taken off. */
  readonly words: readonly string[];
}

/** The commands of a line, or why the line was not read. */
export type ShellLineRead =
  | { readonly problem: null; readonly commands: readonly ShellCommand[] }
  | { readonly problem: string };

/** Some commands, and where in their line what ran them starts. */
interface Placed {
  readonly at: number;
  readonly commands: readonly ShellCommand[];
}

/** Text written inside a line that shell reads by itself. */
interface Nested {
  /** Where it is written in the line around it. */
  readonly at: number;
  readonly text: string;
  /**
   * Whether it is a sum (`$((…))`) and not a line of commands: nothing in it
   * runs but the commands written inside it.
   */
  readonly sum: boolean;
}

/** A stretch of a line. */
interface Stretch {
  readonly start: number;
  readonly end: number;
}

/** What the pieces of a line came to. */
interface PiecesRead {
  readonly placed: readonly Placed[];
  /** What a `trap` on the line is set to run. */
  readonly nested: readonly Nested[];
  /** The stretches whose substitutions are not read from this line. */
  readonly quiet: readonly Stretch[];
  /** How many round brackets the line has open. */
  readonly depth: number;
}

/** First words of a piece that steers the shell and starts no program. */
const SHELL_ONLY = new Set([
  "}",
  ")",
  "[",
  "[[",
  ":",
  "fi",
  "for",
  "select",
  "done",
  "case",
  "esac",
  "test",
  "true",
  "false",
  "set",
  "unset",
  "export",
  "local",
  "readonly",
  "declare",
  "typeset",
  "return",
  "exit",
  "break",
  "continue",
  "shift",
  "trap",
  "cd",
  "pushd",
  "popd",
  "echo",
  "printf",
  "read",
  "wait",
  "umask",
]);

/** First words of a piece that asks whether a program is there. */
const PROBES = new Set(["type", "which", "hash"]);

/** The words that read another file into the shell. */
const SOURCING = new Set([".", "source"]);

/** The file Husky's own first line reads, in the versions that have one. */
const HUSKY_BOOTSTRAP = "husky.sh";

/** The word that says what to run when the shell ends or is signalled. */
const TRAP = "trap";

/**
 * Tell whether some words call Lisa's own carrier or the gate runner.
 * @param words - The words of a command, quotes taken off
 * @returns Whether the command is the carrier, not a check of the host's
 */
function isCarrierCall(words: readonly string[]): boolean {
  const carriers = CARRIER_MOMENTS.map(moment => carrierScriptPath(moment));
  return words.some(
    word =>
      carriers.includes(word) || path.basename(word) === CARRIER_RUNNER_FILE
  );
}

/**
 * Tell whether some words are the line that starts Husky.
 * @param words - The words of a command
 * @returns Whether they read Husky's own script into the shell
 */
function isHuskyBootstrap(words: readonly Word[]): boolean {
  const [first] = words;
  return (
    first !== undefined &&
    SOURCING.has(first.raw) &&
    words.some(word => word.text.endsWith(HUSKY_BOOTSTRAP))
  );
}

/**
 * Tell whether the words left of a piece start a program of the host's.
 * @param words - The words after the ones shell puts in front
 * @returns Whether to report them as a command
 */
function runsSomething(words: readonly Word[]): boolean {
  const [first] = words;
  return !(
    first === undefined ||
    SHELL_ONLY.has(first.raw) ||
    PROBES.has(first.raw) ||
    isCarrierCall(words.map(word => word.text))
  );
}

/**
 * Say where some words stand in their line.
 * @param words - At least one word
 * @returns From the start of the first to the end of the last
 */
function stretchOf(words: readonly Word[]): Stretch {
  const start = words[0]?.start ?? 0;
  const last = words.at(-1);
  return {
    end: last === undefined ? start : last.start + last.raw.length,
    start,
  };
}

/**
 * Find what a `trap` is set to run.
 * @param words - The words of a command
 * @returns The word that holds it; `undefined` when the command is no
 *   `trap`, or sets nothing to run
 */
function trapAction(words: readonly Word[]): Word | undefined {
  const [first, action] = words;
  return first?.raw === TRAP &&
    action !== undefined &&
    !action.raw.startsWith("-") &&
    action.text.trim() !== ""
    ? action
    : undefined;
}

/**
 * Add what one command of a line came to.
 * @param so - What the pieces before it came to
 * @param words - The command's words, as they are written
 * @param line - The line's number, counted from 1
 * @param text - The line
 * @returns What the pieces came to with this one
 */
function withCommand(
  so: PiecesRead,
  words: readonly Word[],
  line: number,
  text: string
): PiecesRead {
  const stretch = stretchOf(words);
  if (isHuskyBootstrap(words)) {
    return { ...so, quiet: [...so.quiet, stretch] };
  }
  const action = trapAction(words);
  if (action !== undefined) {
    return {
      ...so,
      nested: [
        ...so.nested,
        { at: action.start, sum: false, text: action.text },
      ],
      quiet: [...so.quiet, stretchOf([action])],
    };
  }
  if (!runsSomething(words)) return so;
  const command: ShellCommand = {
    command: text.slice(stretch.start, stretch.end),
    line,
    words: words.map(word => word.text),
  };
  return {
    ...so,
    placed: [...so.placed, { at: stretch.start, commands: [command] }],
  };
}

/**
 * Read the commands of a line whose substitutions are already replaced.
 * @param text - The line as it is written
 * @param masked - The same line, each substitution replaced by filler
 * @param line - The line's number, counted from 1
 * @returns The commands, what a `trap` runs, and the stretches to leave be
 */
function readPieces(text: string, masked: string, line: number): PiecesRead {
  const all = pieces(masked).map(piece => ({
    ...piece,
    words: withoutCaseHead(piece.words),
  }));
  const patterns = casePatterns(all);
  return all.reduce<PiecesRead>(
    (so, piece, at) => {
      if (so.depth === 0 && patterns[at] === true) return so;
      const { depth, words } = commandOfPiece(piece.words, so.depth);
      // The words are read from the masked line and reported from the line
      // as it is written; filler keeps every word in its place.
      const written = words.map(word =>
        wordAt(text.slice(word.start, word.start + word.raw.length), word.start)
      );
      return written.length === 0
        ? { ...so, depth }
        : { ...withCommand(so, written, line, text), depth };
    },
    { depth: 0, nested: [], placed: [], quiet: [] }
  );
}

/** What a sum comes to: it has no pieces, so nothing but what is inside it. */
const NO_PIECES: PiecesRead = { depth: 0, nested: [], placed: [], quiet: [] };

/**
 * Say why some text is more than this reader takes on, when it is.
 * @param text - The text
 * @param line - The line's number, counted from 1
 * @param level - How many commands the text is written inside of
 * @returns The reason, or `null` when the text is read
 */
function beyondBounds(
  text: string,
  line: number,
  level: number
): string | null {
  if (text.length > MAX_SHELL_LINE_LENGTH) {
    return `line ${line} is ${text.length} characters long, and this command reads lines of up to ${MAX_SHELL_LINE_LENGTH}`;
  }
  return level > MAX_SUBSTITUTION_DEPTH
    ? `line ${line} nests commands inside commands more than ${MAX_SUBSTITUTION_DEPTH} deep, which is further than this command follows them`
    : null;
}

/**
 * Read the commands of one line of shell, and of every command written
 * inside another on it.
 * @param source - The line, continuations already joined; or text written
 *   inside one
 * @param line - The line's number, counted from 1
 * @param level - How many commands this text is written inside of
 * @returns Each command it runs, in order, or why it was not read
 */
function readAt(source: Nested, line: number, level: number): ShellLineRead {
  const { text } = source;
  const problem = beyondBounds(text, line, level);
  if (problem !== null) return { problem };
  const spans = shellSpans(text);
  const read = source.sum
    ? NO_PIECES
    : readPieces(text, maskSpans(text, spans), line);
  const nested: readonly Nested[] = [
    ...spans.flatMap(span =>
      read.quiet.some(
        quiet => span.start >= quiet.start && span.end <= quiet.end
      )
        ? []
        : [{ at: span.start, sum: span.arithmetic, text: span.inner }]
    ),
    ...read.nested,
  ];
  const inside = nested.map(each => ({
    at: each.at,
    read: readAt(each, line, level + 1),
  }));
  const unread = inside.find(each => each.read.problem !== null);
  if (unread?.read.problem !== undefined && unread.read.problem !== null) {
    return { problem: unread.read.problem };
  }
  // What is written inside a command runs before it, so on a tie it is
  // listed first: the sort keeps the order of equal places.
  const placed: readonly Placed[] = [
    ...inside.map(each => ({
      at: each.at,
      commands: each.read.problem === null ? each.read.commands : [],
    })),
    ...read.placed,
  ];
  return {
    commands: [...placed]
      .sort((left, right) => left.at - right.at)
      .flatMap(each => each.commands),
    problem: null,
  };
}

/**
 * Read the commands of one line of shell.
 * @param text - The line, continuations already joined
 * @param line - The line's number, counted from 1
 * @returns Each command it runs, in order; or why the line was not read.
 *   Never throws
 */
export function readShellLine(text: string, line: number): ShellLineRead {
  try {
    return readAt({ at: 0, sum: false, text }, line, 0);
  } catch (error) {
    return {
      problem: `line ${line} could not be read as shell (${error instanceof Error ? error.message : String(error)})`,
    };
  }
}
