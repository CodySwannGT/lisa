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
 * wrote is read by `./reconcile-shell-line.ts`, which says what a command
 * is, which commands written inside another one it finds, and what it does
 * not follow. A line that ends with a backslash is joined to the next one
 * first.
 *
 * ## What it gives up on, without throwing
 *
 * A hook is somebody else's text, and reading it must never bring the
 * command down or leave it running. So the work is bounded, and a hook past
 * a bound is reported as not read, which makes the run incomplete. Its
 * commands are never passed over in silence:
 *
 * - more than {@link MAX_HOOK_LINES} lines, or more than
 *   {@link MAX_HOOK_CHARACTERS} characters;
 * - a line the line reader gives up on: too long, or commands nested too
 *   deep inside commands;
 * - markers of a block Lisa wrote that do not pair up, so that Lisa's lines
 *   cannot be told from the hook's own.
 * @module controls/reconcile-hook-lines
 */
import { findMarkedBlock } from "./carrier-script.js";
import { CARRIER_MOMENTS } from "./carrier-types.js";
import { readShellLine, type ShellCommand } from "./reconcile-shell-line.js";

export type { ShellCommand } from "./reconcile-shell-line.js";

/** The line that opens the block a Lisa project type manages in a hook. */
const MANAGED_BLOCK_BEGIN = "# BEGIN: AI GUARDRAILS";

/** The line that closes it. */
const MANAGED_BLOCK_END = "# END: AI GUARDRAILS";

/** The most lines a hook may have and still be read. */
export const MAX_HOOK_LINES = 10_000;

/** The most characters a hook may hold and still be read. */
export const MAX_HOOK_CHARACTERS = 262_144;

/** What is said of markers that cannot be trusted. */
const NOT_TOLD_APART =
  "so the lines Lisa wrote there cannot be told from the hook's own";

/** The commands of a hook, or why its text was not read. */
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
 * Read the commands of a hook's lines, the lines Lisa wrote already taken
 * out.
 * @param lines - The hook's lines; a line Lisa wrote is empty
 * @returns The commands with their lines, or why a line was not read
 */
function commandsOf(
  lines: readonly string[]
):
  | { readonly problem: null; readonly commands: readonly ShellCommand[] }
  | { readonly problem: string } {
  const read = logicalLines(lines).flatMap(logical =>
    logical.text.trim() === "" || logical.text.trim().startsWith("#")
      ? []
      : [readShellLine(logical.text, logical.line)]
  );
  const unread = read.find(each => each.problem !== null);
  return unread?.problem !== undefined && unread.problem !== null
    ? { problem: unread.problem }
    : {
        commands: read.flatMap(each =>
          each.problem === null ? each.commands : []
        ),
        problem: null,
      };
}

/**
 * Read a hook within the bounds this reader keeps to.
 * @param text - The hook file's content
 * @returns The commands with their lines, or why the file was not read
 */
function readWithinBounds(text: string): ShellHookRead {
  if (text.length > MAX_HOOK_CHARACTERS) {
    return {
      problem: `it holds ${text.length} characters, and this command reads hooks of up to ${MAX_HOOK_CHARACTERS}`,
    };
  }
  const lines = text.split(/\r?\n/u);
  if (lines.length > MAX_HOOK_LINES) {
    return {
      problem: `it has ${lines.length} lines, and this command reads hooks of up to ${MAX_HOOK_LINES}`,
    };
  }
  const blocks = lisaBlocks(lines);
  if (blocks.problem !== null) {
    return { problem: `${blocks.problem}, ${NOT_TOLD_APART}` };
  }
  const inBlock = (index: number): boolean =>
    blocks.ranges.some(range => index >= range.start && index <= range.end);
  const isMarker = (index: number): boolean =>
    blocks.ranges.some(range => index === range.start || index === range.end);
  const read = commandsOf(
    lines.map((line, index) => (inBlock(index) ? "" : line))
  );
  return read.problem === null
    ? {
        commands: read.commands,
        lisaText: lines
          .filter((_, index) => inBlock(index) && !isMarker(index))
          .join("\n"),
        problem: null,
      }
    : read;
}

/**
 * Read the commands a shell hook runs, leaving out what Lisa wrote in it.
 * @param text - The hook file's content
 * @returns The commands with their lines; or why the file was not read: its
 *   markers cannot be trusted to say which lines are Lisa's, or it is more
 *   than this reader takes on. Never throws
 */
export function readShellHook(text: string): ShellHookRead {
  try {
    return readWithinBounds(text);
  } catch (error) {
    return {
      problem: `it could not be read as shell (${error instanceof Error ? error.message : String(error)})`,
    };
  }
}
