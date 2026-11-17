/**
 * Reading a file a carrier is about to touch, and making the writes a run
 * decided on.
 *
 * Every write of `lisa controls install-carriers` is planned first and made
 * afterwards, in one place. That is what lets `--check` report exactly what a
 * run would write without writing it, and what makes a second run a no-op: a
 * file whose content and permissions are already right produces no write.
 * @module controls/carrier-edits
 */
import { chmod, lstat, mkdir, readFile, writeFile } from "node:fs/promises";
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
 * @param root - Real path of the repository
 * @param edits - The writes
 * @param git - Git, for a setting
 */
export async function applyCarrierEdits(
  root: string,
  edits: readonly CarrierEdit[],
  git: CarrierGit
): Promise<void> {
  await edits.reduce(
    (done, edit) => done.then(() => apply(root, edit, git)),
    Promise.resolve()
  );
}
