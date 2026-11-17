/**
 * The text of a carrier, and the markers that let it be found again.
 *
 * Two texts are written. The carrier itself is a short POSIX `sh` script, one
 * per moment, in Lisa's own hook folder: it checks that Node is there, then
 * hands over to the gate runner with the hook's arguments and standard input
 * untouched. The call is the few lines added to a hook file the repository
 * already has, so that file's own content keeps running first and keeps
 * deciding whether the hook fails.
 *
 * Everything this command writes into a file it does not own sits between a
 * begin marker and an end marker. The markers are how a later run finds the
 * lines, replaces them in place, and how a person removes them.
 * @module controls/carrier-script
 */
import {
  CARRIER_HOOKS,
  CARRIER_HOOKS_FOLDER,
  CARRIER_RUNNER_PATH,
  INSTALL_CARRIERS_INVOCATION,
  type CarrierMoment,
} from "./carrier-types.js";

/** What the operation at each moment is called in a sentence. */
const OPERATION: Readonly<Record<CarrierMoment, string>> = {
  commit: "commit",
  push: "push",
};

/** The begin and end marker of one block. */
export interface CarrierMarkers {
  readonly begin: string;
  readonly end: string;
}

/**
 * The markers around one block this command writes.
 * @param name - What the block is: a moment, or `ignore`
 * @returns The begin and end marker lines, without indentation
 */
export function carrierMarkers(name: string): CarrierMarkers {
  return {
    begin: `# >>> lisa-carrier ${name}`,
    end: `# <<< lisa-carrier ${name}`,
  };
}

/**
 * Where the carrier for a moment lives, from the repository root.
 * @param moment - The moment
 * @returns For example `.lisa/hooks/pre-commit`
 */
export function carrierScriptPath(moment: CarrierMoment): string {
  return `${CARRIER_HOOKS_FOLDER}/${CARRIER_HOOKS[moment]}`;
}

/**
 * Write a word with its first letter in upper case.
 * @param word - The word
 * @returns The word, capitalised
 */
function capitalised(word: string): string {
  return `${word.charAt(0).toUpperCase()}${word.slice(1)}`;
}

/**
 * The carrier for one moment: the whole content of its file.
 *
 * It asks for Node before anything else, because the runner is a Node
 * program: without Node the operation must stop with a sentence that names
 * what is missing, never pass having checked nothing.
 * @param moment - The moment
 * @returns The script, ending with a newline
 */
export function carrierScript(moment: CarrierMoment): string {
  const { begin, end } = carrierMarkers(moment);
  const operation = OPERATION[moment];
  const stopped = `${capitalised(operation)} stopped:`;
  const checks = `the checks this repository requires before a ${operation}`;
  return [
    "#!/bin/sh",
    begin,
    `# Runs the checks this repository declares for a ${operation} (the "gates"`,
    `# block of .lisa.config.json) and stops the ${operation} when a required`,
    "# check is not proved.",
    `# Written by "${INSTALL_CARRIERS_INVOCATION}". Run that again to change it.`,
    "if ! command -v node >/dev/null 2>&1; then",
    `  echo "${stopped} Node.js is missing (no \\"node\\" program on PATH), and ${checks} cannot run without it." >&2`,
    "  exit 1",
    "fi",
    `if [ ! -f ${CARRIER_RUNNER_PATH} ]; then`,
    `  echo "${stopped} ${CARRIER_RUNNER_PATH} is missing, so ${checks} cannot run; run \\"${INSTALL_CARRIERS_INVOCATION}\\" to put it back." >&2`,
    "  exit 1",
    "fi",
    `exec node ${CARRIER_RUNNER_PATH} --moment=${moment} --builtins=none "$@"`,
    end,
    "",
  ].join("\n");
}

/**
 * The lines that call the carrier from a hook file the repository owns.
 *
 * The first command reads the exit status of whatever ran last above it. A
 * hook whose own content failed therefore still fails, with the same status,
 * and the carrier does not run.
 * @param moment - The moment
 * @returns The lines between the markers
 */
export function carrierCall(moment: CarrierMoment): readonly string[] {
  return [
    `# Added by "${INSTALL_CARRIERS_INVOCATION}". When everything above has`,
    `# passed, this runs the checks the repository declares for a ${OPERATION[moment]}.`,
    "lisa_status=$?",
    '[ "$lisa_status" -eq 0 ] || exit "$lisa_status"',
    `sh ${carrierScriptPath(moment)} "$@" || exit $?`,
  ];
}

/** Where a marked block is in a file, or why it cannot be used. */
export type MarkedBlock =
  | { readonly problem: null; readonly found: false }
  | {
      readonly problem: null;
      readonly found: true;
      /** Index of the begin marker's line. */
      readonly start: number;
      /** Index of the end marker's line. */
      readonly end: number;
      /** The whitespace before the begin marker. */
      readonly indent: string;
    }
  | { readonly problem: string };

/**
 * Find the block between one pair of markers.
 * @param lines - The file, one item per line
 * @param name - What the block is
 * @returns Where the block is, that there is none, or why the markers cannot
 *   be trusted
 */
export function findMarkedBlock(
  lines: readonly string[],
  name: string
): MarkedBlock {
  const { begin, end } = carrierMarkers(name);
  const at = (marker: string): readonly number[] =>
    lines.flatMap((line, index) => (line.trim() === marker ? [index] : []));
  const begins = at(begin);
  const ends = at(end);
  if (begins.length === 0 && ends.length === 0) {
    return { problem: null, found: false };
  }
  const [start] = begins;
  const [finish] = ends;
  if (
    begins.length !== 1 ||
    ends.length !== 1 ||
    start === undefined ||
    finish === undefined ||
    finish < start
  ) {
    return {
      problem: `the lines "${begin}" and "${end}" do not appear exactly once each, in that order`,
    };
  }
  const line = lines[start] ?? "";
  return {
    problem: null,
    found: true,
    start,
    end: finish,
    indent: line.slice(0, line.length - line.trimStart().length),
  };
}

/** A file with a block written into it, or why it was not. */
export type BlockEdit =
  | {
      readonly problem: null;
      /** The file's new content. */
      readonly text: string;
      /** Whether the block was already right, added at the end, or replaced. */
      readonly state: "present" | "added" | "replaced";
    }
  | { readonly problem: string };

/**
 * Write a marked block into a file's text: in place when the markers are
 * there, at the end when they are not.
 *
 * Nothing outside the markers is changed, so whatever the file already holds
 * stays exactly as it was, above the block.
 * @param text - The file's content; empty for a new file
 * @param name - What the block is
 * @param body - The lines between the markers
 * @returns The new content, or why the file's markers cannot be trusted
 */
export function withMarkedBlock(
  text: string,
  name: string,
  body: readonly string[]
): BlockEdit {
  const lines = text.split("\n");
  const block = findMarkedBlock(lines, name);
  if (block.problem !== null) return { problem: block.problem };
  const { begin, end } = carrierMarkers(name);
  if (!block.found) {
    const above = text === "" || text.endsWith("\n") ? text : `${text}\n`;
    const gap = above === "" || above.endsWith("\n\n") ? "" : "\n";
    return {
      problem: null,
      state: "added",
      text: `${above}${gap}${[begin, ...body, end].join("\n")}\n`,
    };
  }
  const written = [begin, ...body, end].map(line => `${block.indent}${line}`);
  const next = [
    ...lines.slice(0, block.start),
    ...written,
    ...lines.slice(block.end + 1),
  ].join("\n");
  return {
    problem: null,
    state: next === text ? "present" : "replaced",
    text: next,
  };
}
