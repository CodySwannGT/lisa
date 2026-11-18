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
 *
 * ## What the push carrier says about the push
 *
 * At push the runner leaves out a part the push does not touch, and it works
 * that out from what git writes on the push hook's standard input. It cannot
 * tell a list that is short from one that something read part of first, so it
 * must be handed everything git wrote or nothing (CodySwannGT/lisa#4988).
 *
 * The push carrier therefore tells the runner to read its standard input
 * (`--push-refs=-`) unless its caller says some of it may be gone. That is
 * right with nothing set, which is how git starts the carrier when it is the
 * hook itself, and how Lefthook starts it with `use_stdin`. The one caller
 * that cannot promise a whole standard input is the call added after a
 * repository's own hook content, which may have read a line. That call sets
 * {@link PUSH_STDIN_USED} and gives the carrier no standard input at all, so
 * the runner is told nothing and runs every part.
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

/**
 * The variable a caller of the push carrier sets, to any value, when
 * something that ran before the carrier may have read part of what git wrote
 * on the hook's standard input.
 *
 * Set, the carrier tells the runner nothing about what is being pushed, so
 * every part runs. Unset is the case where standard input is whole, so the
 * carrier git runs directly needs nothing set to work.
 */
export const PUSH_STDIN_USED = "LISA_PUSH_STDIN_USED";

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
 * The lines of a carrier that say what change is being checked.
 *
 * Only a push has any: a commit's change is the index, which the runner
 * reads for itself.
 * @param moment - The moment
 * @returns The lines that go just before the runner is started
 */
function changeLines(moment: CarrierMoment): readonly string[] {
  return moment === "push"
    ? [
        "# Git says what is being pushed on standard input, and the runner reads it",
        `# there, unless a hook that ran first may have read some (${PUSH_STDIN_USED}).`,
        `[ -n "\${${PUSH_STDIN_USED}:-}" ] || set -- --push-refs=- "$@"`,
      ]
    : [];
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
    ...changeLines(moment),
    `exec node ${CARRIER_RUNNER_PATH} --moment=${moment} --builtins=none "$@"`,
    end,
    "",
  ].join("\n");
}

/**
 * The one line that starts the carrier from a hook file the repository owns,
 * after that file's own content.
 *
 * At push, that content may have read part of what git wrote on standard
 * input, and nothing can put it back. So the line says so
 * ({@link PUSH_STDIN_USED}) and starts the carrier with no standard input:
 * the runner is told nothing about the push and runs every part. A commit
 * hook is handed nothing on standard input, so its line is the plain call.
 * @param moment - The moment
 * @returns The line, which fails the hook when the carrier fails
 */
export function carrierCallLine(moment: CarrierMoment): string {
  const script = carrierScriptPath(moment);
  return moment === "push"
    ? `${PUSH_STDIN_USED}=1 sh ${script} "$@" </dev/null || exit $?`
    : `sh ${script} "$@" || exit $?`;
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
    ...(moment === "push"
      ? [
          "# What is above may have read some of what git said is being pushed, so",
          "# the checks are not told, and every part of the repository is checked.",
        ]
      : []),
    "lisa_status=$?",
    '[ "$lisa_status" -eq 0 ] || exit "$lisa_status"',
    carrierCallLine(moment),
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
