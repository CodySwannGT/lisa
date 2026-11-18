/**
 * A proof never changes what the check is: the one rule, used by every
 * command that plants a proof's change.
 *
 * A paired proof shows that a check turns away a change that breaks its
 * rule. It shows nothing when the change rewrites the check instead. A patch
 * that edits the file declaring the checks can swap a command that always
 * passes for one that always fails; the hook then refuses the commit, the
 * declared failure text is printed, and a check that enforces nothing reads
 * as proved. The same goes for a patch that edits what starts the checks (a
 * hook script, the gate runner, the record of the files Lisa placed), for
 * one that edits the script or target the check's command runs, and for one
 * that puts a file where git will not look.
 *
 * So `lisa controls proof-check` and `lisa controls attest` both hold every
 * change of a pair to {@link changeFinding}, and both turn the pair away
 * with the same reason when it finds something.
 *
 * ## What a change may not touch
 *
 * 1. **A file that says what the checks are, or runs them**
 *    ({@link checkFilesOf}): `.lisa.config.json`;
 *    `.lisa/controls/carriers.json` and every file it lists; everything
 *    under `.lisa/hooks/`; the gate runner and every file it loads, under
 *    `scripts/`. Reason `declaration-changed`.
 * 2. **The program the check's command starts**, when the command names it
 *    by a path into the repository. Reason `declaration-changed`.
 * 3. **The scripts or targets the check's command runs**, when the command
 *    goes through a package manager or task runner. Which runners, which
 *    files and what counts as a change are in `./proof-task-runners.ts`.
 *    Reason `declaration-changed`.
 * 4. **A path the repository ignores**, when the change leaves a file
 *    there. Git leaves an ignored file out of a commit, so the hook is shown
 *    a change without it while the check's command finds it on disk: a
 *    program dropped under `node_modules/.bin/` answers for the check and no
 *    list of changed files names it. Reason `ignored-path`. A change that
 *    removes a tracked file is a change git shows, wherever the file was.
 *
 * ## What it does not cover
 *
 * The check's own tool and that tool's configuration. A change that edits a
 * linter's rule file is, for all this rule can tell, a change the linter is
 * there to judge. `./proof-task-runners.ts` lists the rest.
 *
 * ## How the paths are found
 *
 * From the patch itself ({@link patchPaths} in `./proof-patch.ts`): git
 * reads the patch and lists every path it names, a rename under both names
 * and a deleted file under the one it had. What git staged is not the
 * source, because git stages nothing at an ignored path, and that is
 * exactly the path this rule has to see. Whether a path is ignored is asked
 * once the change is planted, so an ignore rule the same patch adds counts.
 * @module controls/proof-change-rule
 */
import { lstatSync } from "node:fs";
import path from "node:path";

import { compareCodeUnits } from "./canonical-json.js";
import { readRecordedFiles } from "./carrier-owned-files.js";
import { runnerFiles } from "./carrier-runner-files.js";
import {
  CARRIER_HOOKS_FOLDER,
  CARRIER_RECORD_PATH,
  type PlacedFile,
} from "./carrier-types.js";
import { GATES_DECLARATION_PATH } from "./gates-declaration.js";
import { gitSaid, type RunGit } from "./proof-copy-git.js";
import { ignoredPaths, patchPaths } from "./proof-patch.js";
import {
  runnerManifestChange,
  startedProgram,
  type ManifestSides,
  type TaskRunnerKind,
} from "./proof-task-runners.js";

/**
 * How the gate runner asks git for the names a commit changes: one name per
 * NUL, a rename as a removal and an arrival, and a moved nested repository
 * reported whatever the project configured.
 */
export const STAGED_NAMES = [
  "diff",
  "--cached",
  "--name-only",
  "-z",
  "--no-renames",
  "--ignore-submodules=none",
  "--no-ext-diff",
  "--",
] as const;

/** The files that say what a repository's checks are, or run them. */
export interface CheckFiles {
  /** Each such file, from the repository root, in order. */
  readonly files: readonly string[];
  /** Each folder everything in which is such a file. */
  readonly folders: readonly string[];
}

/** What a change touches that a proof's change may not. */
export type ChangeFinding =
  /** A file that says what the checks are, or runs them. */
  | { readonly kind: "check-file"; readonly file: string }
  /** The program the check's command starts. */
  | { readonly kind: "program"; readonly file: string }
  /** The file a task runner reads what to run from. */
  | {
      readonly kind: "runner-manifest";
      readonly file: string;
      readonly runner: TaskRunnerKind;
    }
  /** A path the repository ignores, so git leaves it out of a commit. */
  | { readonly kind: "ignored-path"; readonly file: string };

/** The command of the check a change belongs to. */
export interface CheckCommand {
  /** The command, the program first. */
  readonly argv: readonly string[];
  /** The folder it is started in, from the repository root. */
  readonly scope: string;
}

/** A change that is planted and staged, and what it is held to. */
export interface PlantedChangeSubject {
  /** Real path of the folder the change is planted in. */
  readonly directory: string;
  /** Git in that folder. */
  readonly git: RunGit;
  /** The content of the patch file that was planted. */
  readonly patch: string;
  /** The files that say what the checks are, or run them. */
  readonly checkFiles: CheckFiles;
  /** The check's command; `null` when what measures it is not a command. */
  readonly command: CheckCommand | null;
}

/**
 * Name the files that say what a repository's checks are, or run them.
 * @param root - Real path of the repository, or of a copy of it
 * @param runner - Lists the gate runner's files; the running Lisa package's
 *   own by default
 * @returns The files and folders
 * @throws {Error} When this copy of Lisa does not hold the gate runner
 */
export async function checkFilesOf(
  root: string,
  runner: () => Promise<readonly PlacedFile[]> = () => runnerFiles()
): Promise<CheckFiles> {
  const [recorded, placed] = await Promise.all([
    readRecordedFiles(root),
    runner(),
  ]);
  return {
    files: [
      ...new Set([
        GATES_DECLARATION_PATH,
        CARRIER_RECORD_PATH,
        // A record that cannot be read names nothing. The record itself is
        // still one of the files, and so is everything the runner needs.
        ...(recorded.problem === null ? recorded.files : []),
        ...placed.map(file => file.path),
      ]),
    ].sort(compareCodeUnits),
    folders: [CARRIER_HOOKS_FOLDER],
  };
}

/**
 * Find the first path of a change that says what the checks are, or runs
 * them.
 * @param paths - The paths a change touches, from the repository root
 * @param checkFiles - The files and folders that do
 * @returns The path, or `null` when the change touches none of them
 */
export function changedCheckFile(
  paths: readonly string[],
  checkFiles: CheckFiles
): string | null {
  return (
    paths.find(
      changed =>
        checkFiles.files.includes(changed) ||
        checkFiles.folders.some(folder => changed.startsWith(`${folder}/`))
    ) ?? null
  );
}

/**
 * List the paths the change staged in a copy touches, as a commit or push
 * hook is shown them.
 *
 * This is what starts a check, not what a change is held to: a path the
 * repository ignores is never staged, so it is not in this list. The rule
 * reads the patch itself; see {@link changeFinding}.
 * @param git - Git in the copy
 * @returns The paths, from the repository root, in git's order
 * @throws {Error} When git cannot list what is staged
 */
export function stagedPaths(git: RunGit): readonly string[] {
  const listed = git(STAGED_NAMES);
  if (listed.code !== 0) {
    throw new Error(
      `The temporary copy could not say what a change touches, so nothing more was checked: ${gitSaid(listed)}`
    );
  }
  return listed.stdout.split("\0").filter(name => name !== "");
}

/**
 * Stop because git could not answer a question the rule depends on.
 * @param what - What was asked
 * @param why - Git's reason
 * @throws {Error} Always
 */
function unanswered(what: string, why: string): never {
  throw new Error(
    `The temporary copy could not say ${what}, so nothing more was checked: ${why}`
  );
}

/**
 * Read one file as it was before a planted change and as it is after.
 * @param git - Git in the folder the change is planted and staged in
 * @param file - The file, from the repository root
 * @returns Both contents; `null` where the file is absent
 */
function sidesOf(git: RunGit, file: string): ManifestSides {
  const shown = (revision: string): string | null => {
    const exit = git(["cat-file", "-p", `${revision}:${file}`]);
    return exit.code === 0 ? exit.stdout : null;
  };
  // `HEAD` is the commit the change was planted on; the empty revision is
  // the index, which holds the change once it is staged.
  return { before: shown("HEAD"), after: shown("") };
}

/**
 * Tell whether anything is at a path, without following a link.
 * @param directory - Real path of the folder the path is in
 * @param file - The path, from that folder
 * @returns Whether a file, a folder or a link is there
 */
function isThere(directory: string, file: string): boolean {
  return (
    lstatSync(path.join(directory, file), { throwIfNoEntry: false }) !==
    undefined
  );
}

/**
 * Find what a change planted in a folder touches that a proof's change may
 * not: see the list at the top of this file.
 * @param subject - The planted change, and what it is held to
 * @returns The first thing found, or `null` when the change leaves the
 *   check alone
 * @throws {Error} When git cannot say what the change touches
 */
export function changeFinding(
  subject: PlantedChangeSubject
): ChangeFinding | null {
  const { directory, git, patch, checkFiles, command } = subject;
  const read = patchPaths(directory, patch);
  if (read.problem !== null) {
    return unanswered("what a change touches", read.problem);
  }
  const { paths } = read;
  const checkFile = changedCheckFile(paths, checkFiles);
  if (checkFile !== null) return { kind: "check-file", file: checkFile };
  const program =
    command === null ? null : startedProgram(command.argv, command.scope);
  if (program !== null && paths.includes(program)) {
    return { kind: "program", file: program };
  }
  const manifest =
    command === null
      ? null
      : runnerManifestChange({
          ...command,
          paths,
          read: file => sidesOf(git, file),
        });
  if (manifest !== null) return { kind: "runner-manifest", ...manifest };
  // Only what the change leaves on disk can be hidden from a commit.
  const ignored = ignoredPaths(
    directory,
    paths.filter(file => isThere(directory, file))
  );
  if (ignored.problem !== null) {
    return unanswered(
      "which paths of a change the repository ignores",
      ignored.problem
    );
  }
  const [first] = ignored.paths;
  return first === undefined ? null : { kind: "ignored-path", file: first };
}
