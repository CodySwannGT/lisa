/**
 * Reading a file a carrier is about to touch, and making the writes a run
 * decided on.
 *
 * Every write of `lisa controls install-carriers` is planned first and made
 * afterwards, in one place. That is what lets `--check` report exactly what a
 * run would write without writing it, and what makes a second run a no-op: a
 * file whose content and permissions are already right produces no write.
 *
 * Planning first is also what keeps a run from stopping halfway. A file the
 * run has no permission to change is found while planning
 * ({@link isWritable}), so it becomes a blocked point and nothing of it is
 * attempted. A write can still fail for a reason planning cannot see, and
 * the writes are not undone, so {@link applyCarrierEdits} reports which ones
 * were made before the one that failed.
 * @module controls/carrier-edits
 */
import {
  access,
  chmod,
  constants,
  lstat,
  mkdir,
  readFile,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import { pathKind, type PathKind } from "./audit-report-file.js";
import type { CarrierGit } from "./carrier-git.js";
import type { CarrierEdit, FileEdit } from "./carrier-types.js";

/** The permissions of a file git must be able to start. */
const EXECUTABLE_MODE = 0o755;

/** The permission bits that let anyone start a file. */
const ANY_EXECUTE_BIT = 0o111;

/** What is at a path a carrier may write. */
export interface FileState {
  /** What is there, without following a link in the last step. */
  readonly kind: PathKind;
  /** The content of an ordinary file; `null` for anything else. */
  readonly content: Buffer | null;
  /** Whether an ordinary file there can be started. */
  readonly executable: boolean;
}

/**
 * Read what is at a path, without following a link in its last step.
 * @param absolute - The path
 * @returns What is there
 */
export async function fileState(absolute: string): Promise<FileState> {
  const kind = await pathKind(absolute);
  if (kind !== "file") return { kind, content: null, executable: false };
  const [content, stat] = await Promise.all([
    readFile(absolute),
    lstat(absolute),
  ]);
  return {
    kind,
    content,
    executable: (stat.mode & ANY_EXECUTE_BIT) !== 0,
  };
}

/** A file as a run wants it. */
export interface WantedFile {
  /** How the file is named to a person. */
  readonly path: string;
  /** Where it is on disk. */
  readonly absolute: string;
  /** What it must hold. */
  readonly content: string | Buffer;
  /** Whether git must be able to start it. */
  readonly executable: boolean;
}

/**
 * Decide the write that makes a file what a run wants.
 * @param wanted - The file as it should be
 * @param state - The file as it is
 * @returns The write, or `null` when the file is already right
 */
export function fileEdit(
  wanted: WantedFile,
  state: FileState
): FileEdit | null {
  const content = Buffer.from(wanted.content);
  const right =
    state.content !== null &&
    state.content.equals(content) &&
    (state.executable || !wanted.executable);
  return right
    ? null
    : {
        ...wanted,
        action: state.kind === "missing" ? "create" : "update",
        kind: "file",
      };
}

/**
 * Find a step on the way to a file that is not an ordinary folder.
 *
 * A link there could lead outside the repository, and this command writes
 * nowhere else.
 * @param root - Real path of the repository
 * @param relativePath - The file, from the repository root
 * @returns The step that is in the way, or `null` when the way is clear
 */
export async function blockedFolder(
  root: string,
  relativePath: string
): Promise<string | null> {
  const steps = relativePath.split("/").slice(0, -1);
  const folders = steps.map((_, index) => steps.slice(0, index + 1).join("/"));
  const kinds = await Promise.all(
    folders.map(folder => pathKind(path.join(root, folder)))
  );
  return (
    folders.find(
      (_, index) => kinds[index] !== "missing" && kinds[index] !== "folder"
    ) ?? null
  );
}

/**
 * Tell whether this user may write a file, or create it when it is missing.
 * @param absolute - The file
 * @returns Whether the file can be changed, or, for a file that is not there
 *   yet, whether the nearest folder that is there can be added to
 */
export async function isWritable(absolute: string): Promise<boolean> {
  const kind = await pathKind(absolute);
  const parent = path.dirname(absolute);
  if (kind === "missing" && parent !== absolute) return isWritable(parent);
  try {
    await access(
      absolute,
      kind === "folder" ? constants.W_OK | constants.X_OK : constants.W_OK
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Say that a file a run was about to change may not be changed.
 * @param shown - How the file is named to a person
 * @returns The sentence, up to what follows from it
 */
export function notWritable(shown: string): string {
  return `${shown} cannot be written to (this user has no permission to change it)`;
}

/** What became of the writes of a run. */
export interface AppliedEdits {
  /** The writes that were made, in order. */
  readonly written: readonly CarrierEdit[];
  /** The write that failed and stopped the run, or `null`. */
  readonly failed: {
    readonly edit: CarrierEdit;
    /** Why, in a sentence that names no path of the machine. */
    readonly why: string;
  } | null;
}

/**
 * Say why a write failed, without what the system said about where.
 *
 * A system error names the full path it failed on, which is the operator's
 * own folder. The file is already named by its path in the repository, so
 * only the error's code is kept.
 * @param edit - The write
 * @param error - What it was rejected with
 * @returns One sentence
 */
function failureOf(edit: CarrierEdit, error: unknown): string {
  if (edit.kind === "setting") {
    return `${edit.path} could not be set: git refused to write the setting.`;
  }
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String(error.code)
      : "the write failed";
  return `${edit.path} could not be written (${code}).`;
}

/**
 * Make one write.
 * @param root - Real path of the repository
 * @param edit - The write
 * @param git - Git, for a setting
 */
async function apply(
  root: string,
  edit: CarrierEdit,
  git: CarrierGit
): Promise<void> {
  if (edit.kind === "setting") {
    await git.setHooksPath(root, edit.value);
    return;
  }
  await mkdir(path.dirname(edit.absolute), { recursive: true });
  await writeFile(edit.absolute, edit.content);
  if (edit.executable) await chmod(edit.absolute, EXECUTABLE_MODE);
}

/**
 * Make every write of a run, in the order they were planned.
 *
 * In order, and one at a time: the files a hook starts are planned before
 * the setting or the line that makes git start the hook, so a run that is
 * interrupted never leaves a hook pointing at a file that is not there yet.
 *
 * The first write that fails stops the run. The writes before it stay: they
 * are files a later run finds already right, and undoing them could fail
 * too. What matters is that the caller is told, so it never reports that
 * nothing was written.
 * @param root - Real path of the repository
 * @param edits - The writes
 * @param git - Git, for a setting
 * @returns The writes that were made, and the one that failed when one did
 */
export function applyCarrierEdits(
  root: string,
  edits: readonly CarrierEdit[],
  git: CarrierGit
): Promise<AppliedEdits> {
  return edits.reduce<Promise<AppliedEdits>>(
    async (earlier, edit) => {
      const done = await earlier;
      if (done.failed !== null) return done;
      try {
        await apply(root, edit, git);
        return { failed: null, written: [...done.written, edit] };
      } catch (error) {
        return { ...done, failed: { edit, why: failureOf(edit, error) } };
      }
    },
    Promise.resolve({ failed: null, written: [] })
  );
}
