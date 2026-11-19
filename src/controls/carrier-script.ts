/**
 * The text of a carrier, and the markers that let it be found again.
 *
 * Two texts are written. The carrier itself is a short POSIX `sh` script, one
 * per moment, in Lisa's own hook folder: it checks that Node is there, goes
 * to the top folder of the checkout, then hands over to the gate runner with
 * the hook's arguments and standard input untouched. The call is the few
 * lines added to a hook file the repository already has, so that file's own
 * content keeps running first and keeps deciding whether the hook fails.
 *
 * Everything this command writes into a file it does not own sits between a
 * begin marker and an end marker. The markers are how a later run finds the
 * lines, replaces them in place, and how a person removes them.
 *
 * ## Where the call looks for the carrier
 *
 * The call runs at the end of somebody else's hook, and that hook file may
 * outlive the checkout it was written for: git's own hooks folder serves
 * every working tree of a repository and every branch checked out in one.
 * So the call depends on neither the folder the shell is in nor the carrier
 * being there:
 *
 * - It asks git for the top folder of the checkout and looks for the carrier
 *   there. It asks twice, because both answers are wrong somewhere. In a
 *   linked working tree git names its own folder to the hook and not the top
 *   folder, so after the hook changed folder git answers with the folder the
 *   shell is in (measured on git 2.56). Asked again without what git named,
 *   it finds the top folder from where the shell is. The first answer that
 *   counts and holds the carrier is used.
 * - An answer counts only when it is about the repository git started the
 *   hook for. Git answers for whichever repository the shell is in, and the
 *   hook's own lines may have ended with `cd` into another one: a nested
 *   repository, a submodule. See "Which repository an answer is about".
 * - The carrier is there: it is started, and its exit status is the hook's.
 * - The carrier is not there, and the commit checked out does not contain
 *   it: one sentence says the declared checks did not run, and the hook goes
 *   on. A branch that never had Lisa's files has to stay usable. This is the
 *   one case that lets a commit through unchecked, so it is taken only when
 *   the answer is known to be about the repository being committed to.
 * - The carrier is not there in any other case (it was removed from a
 *   checkout whose commit has it, or git cannot say): the hook stops with a
 *   sentence. Carrier files are committed, which is why the commit is what
 *   is asked.
 * - No answer counts: the hook stops, and says that it can no longer tell
 *   which repository the commit is made in.
 *
 * Nothing of the host's is written into either text: every word is fixed.
 *
 * ## Which repository an answer is about
 *
 * A hook is told which repository it runs for in one of two ways, and the
 * lines use whichever git used (measured on git 2.56 with real commits and
 * pushes, in a main and a linked working tree, started from the top folder
 * and from a folder below it):
 *
 * | The hook is | `GIT_DIR` | `$0` |
 * | --- | --- | --- |
 * | in git's hooks folder, main working tree | not set | `.git/hooks/pre-commit` |
 * | in a `core.hooksPath` folder written from the top, main working tree | not set | `.githooks/pre-commit` |
 * | in a `core.hooksPath` folder written as an absolute path, main working tree | not set | that absolute path |
 * | Husky's (8.0.3 and 9.1.7), main working tree | not set | `.husky/pre-commit` |
 * | any of these in a linked working tree, or where `.git` is a file | the repository's git folder, absolute | absolute, or from the top as above |
 *
 * Git always starts the hook in the top folder. So:
 *
 * - `GIT_DIR` set to an absolute path: git named the repository, and every
 *   question asked with it is about that repository wherever the shell is.
 *   A folder git answers with counts when git, started there with nothing
 *   named, finds the same repository.
 * - Otherwise the repository is the one whose top folder the hook was
 *   started in, which nothing names once the shell has left it. A folder
 *   counts when the hook file is there under the path it was started by and
 *   holds these lines; a hook started by an absolute path has to be the
 *   file git would run for that folder.
 *
 * One case is not told apart: a nested repository that has a hook file under
 * the same path, itself holding these lines. A hook that ends there runs
 * that repository's checks, or is let through on its commit. Nothing in the
 * shell says which of the two repositories started the hook, and stopping
 * instead would stop every commit made in such a nested repository itself.
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
 *
 * Then it goes to the top folder of the checkout, which is two folders above
 * the script wherever it was started from, and only there looks for the
 * runner. A hook that changed folder before calling it would otherwise have
 * every commit stopped for a runner that is in its place.
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
    "# block of .lisa.config.json), from the top folder of the checkout, and",
    `# stops the ${operation} when a required check is not proved.`,
    `# Written by "${INSTALL_CARRIERS_INVOCATION}". Run that again to change it.`,
    "if ! command -v node >/dev/null 2>&1; then",
    `  echo "${stopped} Node.js is missing (no \\"node\\" program on PATH), and ${checks} cannot run without it." >&2`,
    "  exit 1",
    "fi",
    `if ! CDPATH= cd -- "$(dirname -- "$0")/../.." || [ ! -f ${CARRIER_RUNNER_PATH} ]; then`,
    `  echo "${stopped} ${CARRIER_RUNNER_PATH} is missing from the top folder of this checkout, so ${checks} cannot run; run \\"${INSTALL_CARRIERS_INVOCATION}\\" to put it back." >&2`,
    "  exit 1",
    "fi",
    ...changeLines(moment),
    `exec node ${CARRIER_RUNNER_PATH} --moment=${moment} --builtins=none "$@"`,
    end,
    "",
  ].join("\n");
}

/**
 * The one line that starts the carrier once the call has found it, from a
 * hook file the repository owns, after that file's own content.
 *
 * At push, that content may have read part of what git wrote on standard
 * input, and nothing can put it back. So the line says so
 * ({@link PUSH_STDIN_USED}) and starts the carrier with no standard input:
 * the runner is told nothing about the push and runs every part. A commit
 * hook is handed nothing on standard input, so its line is the plain call.
 * @param moment - The moment
 * @returns The line, which fails the hook when the carrier fails
 */
export function carrierStartLine(moment: CarrierMoment): string {
  return moment === "push"
    ? `${PUSH_STDIN_USED}=1 sh "$lisa_carrier" "$@" </dev/null || exit $?`
    : 'sh "$lisa_carrier" "$@" || exit $?';
}

/**
 * The lines that find the carrier from the top folder of the checkout.
 *
 * Git is asked for that folder twice: as it names the checkout to the hook,
 * and again with what it named taken away, so that it searches from the
 * folder the shell is in. Each answer is then held to the repository git
 * started the hook for, because the lines above may have left the shell in
 * another one (a nested repository, a submodule), and git answers for
 * whichever repository the shell is in:
 *
 * - Git named the repository to the hook (`GIT_DIR`, an absolute path): the
 *   answer counts when git, started in that folder with nothing named, finds
 *   the same repository.
 * - Git named none, which it does only in a checkout whose `.git` is a
 *   folder: the answer counts when the hook file is in it. Git starts such a
 *   hook by its path from the top folder (`.git/hooks/pre-commit`,
 *   `.husky/pre-commit`), so the file has to be there under that path, and
 *   has to hold these lines, which is what tells it from another
 *   repository's hook of the same name. A hook started by an absolute path,
 *   which is what an absolute `core.hooksPath` gives, has to be the file
 *   git would run for that folder.
 *
 * The first answer that counts and holds the carrier is used.
 *
 * A path is absolute when it begins with a slash or with a drive letter, a
 * colon and a slash of either kind: Git for Windows hands a hook
 * `GIT_DIR=C:/…` and starts one by `C:/…/pre-commit`. Taken for a path from
 * the top folder, neither would ever be found there, and every commit and
 * push would stop. That form has been run under `sh` against a stand-in
 * for git only, not on Windows.
 * @param script - The carrier, from the top folder
 * @param begin - The marker line these lines stand under
 * @returns The lines, which leave the carrier's path in `lisa_carrier` or
 *   leave it empty, and leave `lisa_ours` set when an answer counted and
 *   `lisa_named` set when git named the repository
 */
function findCarrierLines(script: string, begin: string): readonly string[] {
  const asNamed = "git rev-parse --show-toplevel 2>/dev/null";
  const gitFolder = "git rev-parse --absolute-git-dir 2>/dev/null";
  const from = 'CDPATH= cd -- "$lisa_top" 2>/dev/null &&';
  const absolute = String.raw`/*|[A-Za-z]:[\\/]*`;
  return [
    "# The carrier is looked for from the top folder of this checkout, wherever",
    "# the lines above left the shell: as git names that folder to this hook,",
    "# then as git finds it from the folder the shell is in. An answer counts",
    "# only when it is about the repository git started this hook for: the one",
    "# git named to the hook (GIT_DIR), or else the one this hook file is in.",
    "lisa_carrier=",
    "lisa_ours=",
    "lisa_named=",
    'case "${GIT_DIR:-}" in',
    `  ${absolute}) lisa_named=$(${gitFolder}) || lisa_named= ;;`,
    "esac",
    `for lisa_top in "$(${asNamed})" "$(unset GIT_DIR GIT_WORK_TREE; ${asNamed})"; do`,
    '  [ -n "$lisa_top" ] || continue',
    '  if [ -n "$lisa_named" ]; then',
    `    [ "$(unset GIT_DIR GIT_WORK_TREE; ${from} ${gitFolder})" = "$lisa_named" ] || continue`,
    "  else",
    '    case "$0" in',
    `      ${absolute}) [ "$(${from} git rev-parse --git-path "hooks/\${0##*/}" 2>/dev/null)" = "$0" ] || continue ;;`,
    `      *) grep -qF -- "${begin}" "$lisa_top/$0" 2>/dev/null || continue ;;`,
    "    esac",
    "  fi",
    "  lisa_ours=1",
    `  if [ -z "$lisa_carrier" ] && [ -f "$lisa_top/${script}" ]; then`,
    `    lisa_carrier="$lisa_top/${script}"`,
    "  fi",
    "done",
  ];
}

/**
 * The lines that call the carrier from a hook file the repository owns.
 *
 * The first command reads the exit status of whatever ran last above it. A
 * hook whose own content failed therefore still fails, with the same status,
 * and the carrier does not run.
 *
 * The rest finds the carrier and starts it, and says what happened when it
 * is not there; the module's own description says why each case ends the way
 * it does.
 * @param moment - The moment
 * @returns The lines between the markers
 */
export function carrierCall(moment: CarrierMoment): readonly string[] {
  const script = carrierScriptPath(moment);
  const operation = OPERATION[moment];
  const checks = `the checks this repository requires before a ${operation}`;
  return [
    `# Added by "${INSTALL_CARRIERS_INVOCATION}". When everything above has`,
    `# passed, this runs the checks the repository declares for a ${operation}.`,
    ...(moment === "push"
      ? [
          "# What is above may have read some of what git said is being pushed, so",
          "# the checks are not told, and every part of the repository is checked.",
        ]
      : []),
    "lisa_status=$?",
    '[ "$lisa_status" -eq 0 ] || exit "$lisa_status"',
    ...findCarrierLines(script, carrierMarkers(moment).begin),
    'if [ -n "$lisa_carrier" ]; then',
    `  ${carrierStartLine(moment)}`,
    `elif [ -n "$lisa_named$lisa_ours" ] && git rev-parse --git-dir >/dev/null 2>&1 && ! git cat-file -e "HEAD:${script}" 2>/dev/null; then`,
    "  # A branch that never had the carrier stays usable.",
    `  echo "${capitalised(checks)} did not run in this checkout: the commit checked out here does not contain ${script}, the script that runs them." >&2`,
    'elif [ -n "$lisa_ours" ]; then',
    `  echo "${capitalised(operation)} stopped: ${script}, the script that runs ${checks}, could not be found in this checkout. Run \\"${INSTALL_CARRIERS_INVOCATION}\\" to put it back." >&2`,
    "  exit 1",
    "else",
    `  echo "${capitalised(operation)} stopped: this hook can no longer tell which repository the ${operation} is made in, so ${checks} were not run. That happens when the lines above these change folder into another repository or out of this one: change back before these lines, or run those commands in a subshell." >&2`,
    "  exit 1",
    "fi",
  ];
}

/**
 * The call with its two marker lines, as a person adds it by hand to a hook
 * this command will not write to.
 *
 * The markers are part of what is handed over: a later run finds the lines
 * by them and reports the hook as wired, and `lisa controls reconcile` reads
 * them as Lisa's and not as a check of the repository's own.
 * @param moment - The moment
 * @returns The lines, one per line, with no line break at the end
 */
export function carrierCallBlock(moment: CarrierMoment): string {
  const { begin, end } = carrierMarkers(moment);
  return [begin, ...carrierCall(moment), end].join("\n");
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
