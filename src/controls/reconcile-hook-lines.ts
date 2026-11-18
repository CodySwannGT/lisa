/**
 * Reading the commands out of a hook's text, one line at a time.
 *
 * `lisa controls reconcile` reports every command a commit or push hook runs
 * that no register entry declares. This is the reader behind it, and it is
 * deliberately small. It is given text and returns text: nothing it finds is
 * ever run.
 *
 * ## Why not the shell reader the tooling detector has
 *
 * `lisa-detect-tooling` ships a shell reader, and it answers a different
 * question: which programs would have to be installed. So it returns program
 * names only, and it drops the runtimes, the package managers, paths and the
 * usual POSIX tools. Asked about a hook that runs `npm run lint`,
 * `node scripts/check.mjs`, `./scripts/scan.sh` and `ruff check .`, it
 * answers `ruff`. A reconciler has to compare whole commands with the
 * commands the register declares and name each one to an operator, so it
 * needs the lines themselves.
 *
 * ## What counts as a command
 *
 * Every line that is not blank, not a comment and not inside a block Lisa
 * wrote is split where shell starts another command (`&&`, `||`, `;`, a
 * pipe), outside quotes (`./reconcile-shell-words.ts`). From each piece the
 * redirects are left out, and so is what shell puts around a command: the
 * words in front of it (`if`, `!`, `then`, `exec`, a `NAME=value` setting, a
 * `case` label), the bracket that opens a group (`{`, `(`) and the one that
 * closes it. What is left is a command unless its first word only steers the
 * shell (`set`, `cd`, `exit`, `[`, `echo` and the like), only tests whether a
 * program is there (`command -v`), or is the call to Lisa's own carrier.
 *
 * So `{ npm test; } || exit 1` and `( cd api && npm test ) 2>&1 | tee log`
 * both run `npm test`, and the second also runs `tee log`.
 *
 * ## What it cannot see
 *
 * It is not a shell. It does not follow a call into the script it starts, it
 * does not evaluate conditions, and it does not read a here-document as
 * data. A hook that calls a script is reported as that call. Brackets are
 * matched within one line: the last line of a group that spans several is
 * read right when its closing bracket stands on its own or after a command
 * of more than one word.
 * @module controls/reconcile-hook-lines
 */
import path from "node:path";

import { carrierScriptPath, findMarkedBlock } from "./carrier-script.js";
import { CARRIER_MOMENTS, CARRIER_RUNNER_FILE } from "./carrier-types.js";
import { commandOfPiece, isCasePattern } from "./reconcile-shell-command.js";
import { pieces, type Word } from "./reconcile-shell-words.js";

/** The line that opens the block a Lisa project type manages in a hook. */
export const MANAGED_BLOCK_BEGIN = "# BEGIN: AI GUARDRAILS";

/** The line that closes it. */
export const MANAGED_BLOCK_END = "# END: AI GUARDRAILS";

/** One command a hook runs. */
export interface ShellCommand {
  /** The line it starts on, counted from 1. */
  readonly line: number;
  /** The command as it is written, without the shell words in front of it. */
  readonly command: string;
  /** Its words, with the quotes around them taken off. */
  readonly words: readonly string[];
}

/** The commands of a hook, or why its text cannot be relied on. */
export type ShellHookRead =
  | {
      readonly problem: null;
      readonly commands: readonly ShellCommand[];
      /** The lines inside the blocks Lisa wrote, without their markers. */
      readonly lisaText: string;
    }
  | { readonly problem: string };

/** A range of lines, both ends included. */
interface LineRange {
  readonly start: number;
  readonly end: number;
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
  "function",
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
const PROBES = new Set(["command", "type", "which", "hash"]);

/** The words that read another file into the shell. */
const SOURCING = new Set([".", "source"]);

/** The file Husky's own first line reads, in the versions that have one. */
const HUSKY_BOOTSTRAP = "husky.sh";

/** A word that names a function being defined, such as `check()`. */
const FUNCTION_NAME = /^[A-Za-z_][\w-]*\(\)$/u;

/**
 * Tell whether some words call Lisa's own carrier or the gate runner.
 * @param words - The words of a command, quotes taken off
 * @returns Whether the command is the carrier, not a check of the host's
 */
export function isCarrierCall(words: readonly string[]): boolean {
  const carriers = CARRIER_MOMENTS.map(moment => carrierScriptPath(moment));
  return words.some(
    word =>
      carriers.includes(word) || path.basename(word) === CARRIER_RUNNER_FILE
  );
}

/**
 * Tell whether the words left of a piece start a program of the host's.
 * @param words - The words after the ones shell puts in front
 * @returns Whether to report them as a command
 */
function runsSomething(words: readonly Word[]): boolean {
  const [first, second] = words;
  if (first === undefined) return false;
  const texts = words.map(word => word.text);
  const defines = FUNCTION_NAME.test(first.raw) || second?.raw === "()";
  const bootstrap =
    SOURCING.has(first.raw) &&
    texts.some(text => text.endsWith(HUSKY_BOOTSTRAP));
  return !(
    SHELL_ONLY.has(first.raw) ||
    PROBES.has(first.raw) ||
    defines ||
    bootstrap ||
    isCarrierCall(texts)
  );
}

/** The commands of a line read so far. */
interface LineRead {
  readonly commands: readonly ShellCommand[];
  /** How many round brackets the line has open. */
  readonly depth: number;
}

/**
 * Read the commands of one line of shell.
 * @param text - The line, continuations already joined
 * @param line - The line's number, counted from 1
 * @returns Each command it runs, in order
 */
export function commandsInLine(
  text: string,
  line: number
): readonly ShellCommand[] {
  const all = pieces(text);
  return all.reduce<LineRead>(
    (so, piece, at) => {
      if (so.depth === 0 && isCasePattern(all, at)) return so;
      const { depth, words } = commandOfPiece(piece.words, so.depth);
      const first = words[0];
      const last = words.at(-1);
      if (first === undefined || last === undefined || !runsSomething(words)) {
        return { ...so, depth };
      }
      const command: ShellCommand = {
        command: text.slice(first.start, last.start + last.raw.length),
        line,
        words: words.map(word => word.text),
      };
      return { commands: [...so.commands, command], depth };
    },
    { commands: [], depth: 0 }
  ).commands;
}

/**
 * Find the block a Lisa project type manages in a hook.
 * @param lines - The hook, one item per line
 * @returns The block's lines, `null` when there is none, or why its markers
 *   cannot be trusted
 */
function managedBlock(
  lines: readonly string[]
): { readonly range: LineRange | null } | { readonly problem: string } {
  const at = (marker: string): readonly number[] =>
    lines.flatMap((line, index) =>
      line.trim().startsWith(marker) ? [index] : []
    );
  const begins = at(MANAGED_BLOCK_BEGIN);
  const ends = at(MANAGED_BLOCK_END);
  if (begins.length === 0 && ends.length === 0) return { range: null };
  const [start] = begins;
  const [end] = ends;
  return begins.length === 1 &&
    ends.length === 1 &&
    start !== undefined &&
    end !== undefined &&
    start < end
    ? { range: { end, start } }
    : {
        problem: `the lines "${MANAGED_BLOCK_BEGIN}" and "${MANAGED_BLOCK_END}" do not appear exactly once each, in that order`,
      };
}

/**
 * Find every block of a hook that Lisa wrote.
 * @param lines - The hook, one item per line
 * @returns The blocks, or why a pair of markers cannot be trusted
 */
function lisaBlocks(
  lines: readonly string[]
):
  | { readonly problem: null; readonly ranges: readonly LineRange[] }
  | { readonly problem: string } {
  const managed = managedBlock(lines);
  if ("problem" in managed) return managed;
  const carriers = CARRIER_MOMENTS.map(moment =>
    findMarkedBlock(lines, moment)
  );
  const broken = carriers.find(block => block.problem !== null);
  if (broken?.problem !== undefined && broken.problem !== null) {
    return { problem: broken.problem };
  }
  return {
    problem: null,
    ranges: [
      ...(managed.range === null ? [] : [managed.range]),
      ...carriers.flatMap(block =>
        block.problem === null && block.found
          ? [{ end: block.end, start: block.start }]
          : []
      ),
    ],
  };
}

/** A line of shell with the lines it continues onto joined to it. */
interface LogicalLine {
  /** The number of the line it starts on, counted from 1. */
  readonly line: number;
  readonly text: string;
  /** Whether the next line continues it. */
  readonly open: boolean;
}

/**
 * Join each line that ends with a backslash to the line after it.
 * @param lines - The hook's lines; a line Lisa wrote is already empty
 * @returns The lines as shell reads them, each with where it starts
 */
function logicalLines(lines: readonly string[]): readonly LogicalLine[] {
  return lines.reduce<readonly LogicalLine[]>((joined, raw, index) => {
    const continues = /(?:^|[^\\])(?:\\\\)*\\$/u.test(raw);
    const text = continues ? raw.slice(0, -1) : raw;
    const previous = joined.at(-1);
    return previous?.open === true
      ? [
          ...joined.slice(0, -1),
          { ...previous, open: continues, text: `${previous.text}${text}` },
        ]
      : [...joined, { line: index + 1, open: continues, text }];
  }, []);
}

/**
 * Read the commands a shell hook runs, leaving out what Lisa wrote in it.
 * @param text - The hook file's content
 * @returns The commands with their lines, or why the file's markers cannot
 *   be trusted to say which lines are Lisa's
 */
export function readShellHook(text: string): ShellHookRead {
  const lines = text.split(/\r?\n/u);
  const blocks = lisaBlocks(lines);
  if (blocks.problem !== null) return { problem: blocks.problem };
  const inBlock = (index: number): boolean =>
    blocks.ranges.some(range => index >= range.start && index <= range.end);
  const isMarker = (index: number): boolean =>
    blocks.ranges.some(range => index === range.start || index === range.end);
  return {
    commands: logicalLines(
      lines.map((line, index) => (inBlock(index) ? "" : line))
    ).flatMap(logical =>
      logical.text.trim() === "" || logical.text.trim().startsWith("#")
        ? []
        : commandsInLine(logical.text, logical.line)
    ),
    lisaText: lines
      .filter((_, index) => inBlock(index) && !isMarker(index))
      .join("\n"),
    problem: null,
  };
}
