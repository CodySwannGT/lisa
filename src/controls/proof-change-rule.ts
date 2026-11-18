/**
 * A proof never changes what the check is: the one rule, used by every
 * command that plants a proof's change.
 *
 * A paired proof shows that a check turns away a change that breaks its
 * rule. It shows nothing when the change rewrites the check instead. A patch
 * that edits the file declaring the checks can swap a command that always
 * passes for one that always fails; the hook then refuses the commit, the
 * declared failure text is printed, and a check that enforces nothing reads
 * as proved. The same goes for a patch that edits what starts the checks: a
 * hook script, the gate runner, or the record of the files Lisa placed.
 *
 * So a change that touches one of those files is not a proof's change, and
 * `lisa controls proof-check` and `lisa controls attest` both say so with
 * the same reason, `declaration-changed`. This module is where the rule
 * lives: which files they are ({@link checkFilesOf}), which paths a planted
 * change touches ({@link stagedPaths}), and whether one of them is such a
 * file ({@link changedCheckFile}).
 *
 * ## Which files
 *
 * - `.lisa.config.json`, which declares the checks.
 * - `.lisa/controls/carriers.json`, the record of the files Lisa placed, and
 *   every file that record lists.
 * - Everything under `.lisa/hooks/`, the hook scripts.
 * - The gate runner and every file it loads, under `scripts/`.
 *
 * ## What it does not cover
 *
 * The check's own tool and that tool's configuration. A change that edits a
 * linter's rule file is, for all this rule can tell, a change the linter is
 * there to judge.
 *
 * ## How the paths are found
 *
 * Git is asked, once the change is planted and staged, with the options the
 * gate runner itself uses to list what a commit changes. A patch's own text
 * is not parsed: git is what applied it, so git's answer is what it touched,
 * a rename's old name and a deleted file included.
 * @module controls/proof-change-rule
 */
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
 * List the paths the change staged in a copy touches.
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
