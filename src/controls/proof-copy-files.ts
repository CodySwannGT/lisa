/**
 * The few files a disposable copy takes from the operator's working copy.
 *
 * The copy is a clone of the last commit, so nothing the operator has not
 * committed is in it. That is deliberate: a commit hook judges a change
 * against committed content, and half-finished work is not part of what a
 * proof says. But a repository in the middle of being set up has the very
 * files the proof is about still uncommitted: the declaration of the checks,
 * the gate runner and hook scripts Lisa placed, and the proof patches. Without
 * them the copy would run an older declaration, or none.
 *
 * So exactly these are made the same in the copy as in the working copy, each
 * by its own path and never by copying a folder of the operator's work:
 *
 * - `.lisa.config.json`, the declaration.
 * - `.lisa/controls/carriers.json`, the record of the files Lisa placed, and
 *   every file that record lists.
 * - every ordinary file under `.lisa/controls/proofs/`.
 *
 * "The same" includes absence: a listed file that is gone from the working
 * copy is removed from the copy. Nothing is read or written through a link,
 * on either side, because a link can lead anywhere on the machine. A listed
 * path that is not a plain path inside the repository stops the run before
 * anything is copied.
 * @module controls/proof-copy-files
 */
import { chmod, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { compareCodeUnits } from "./canonical-json.js";
import { blockedFolder, fileState, type FileState } from "./carrier-edits.js";
import { readRecordedFiles } from "./carrier-owned-files.js";
import { CARRIER_RECORD_PATH } from "./carrier-types.js";
import { GATES_DECLARATION_PATH } from "./gates-declaration.js";
import { PROOF_FOLDER } from "./proof-patch.js";

/** The mode a carried file gets when git must be able to start it. */
const EXECUTABLE_MODE = 0o755;

/** The mode every other carried file gets. */
const PLAIN_MODE = 0o644;

/** Git's own folder, which no carried path may name. */
const GIT_FOLDER = ".git";

/** The paths to carry, or why none can be. */
export type CarriedPaths =
  | { readonly problem: null; readonly paths: readonly string[] }
  | { readonly problem: string };

/** The paths that differed and were made the same, or why none was. */
export type CarriedFiles =
  | { readonly problem: null; readonly carried: readonly string[] }
  | { readonly problem: string };

/** What became of one path: whether it differed, or what is in the way. */
type CarriedFile =
  | { readonly problem: null; readonly differed: boolean }
  | { readonly problem: string };

/**
 * Tell whether a path is a plain path to something inside a repository.
 * @param file - The path, as it is written in the record
 * @returns Whether it names a place below the repository root, outside git's
 *   own folder, with no step that climbs out
 */
function isPlainPath(file: string): boolean {
  const segments = file.split("/");
  return (
    !file.includes("\\") &&
    !file.includes("\0") &&
    segments.every(
      segment =>
        segment !== "" &&
        segment !== "." &&
        segment !== ".." &&
        segment.toLowerCase() !== GIT_FOLDER
    )
  );
}

/**
 * List every ordinary file below a folder, without following a link.
 * @param root - Real path of the repository
 * @param folder - The folder, from the repository root
 * @returns The files, from the repository root
 */
async function ordinaryFiles(
  root: string,
  folder: string
): Promise<readonly string[]> {
  const entries = await readdir(path.join(root, folder), {
    withFileTypes: true,
  }).catch(() => []);
  const named = entries.map(entry => ({
    entry,
    relative: `${folder}/${entry.name}`,
  }));
  const deeper = await Promise.all(
    named
      .filter(({ entry }) => entry.isDirectory())
      .map(({ relative }) => ordinaryFiles(root, relative))
  );
  return [
    ...named
      .filter(({ entry }) => entry.isFile())
      .map(({ relative }) => relative),
    ...deeper.flat(),
  ];
}

/**
 * Name the files a disposable copy takes from the working copy.
 * @param root - Real path of the operator's repository
 * @returns The paths, from the repository root, in order; or why the record
 *   of Lisa's own files cannot be used
 */
export async function carriedPaths(root: string): Promise<CarriedPaths> {
  const recorded = await readRecordedFiles(root);
  if (recorded.problem !== null) return recorded;
  const foreign = recorded.files.find(file => !isPlainPath(file));
  if (foreign !== undefined) {
    return {
      problem: `${CARRIER_RECORD_PATH} lists ${JSON.stringify(foreign)}, which is not a path inside this repository, so nothing was copied. Remove ${CARRIER_RECORD_PATH}, run "lisa controls install-carriers", then run this again.`,
    };
  }
  // A proofs folder reached through a link is not listed: nothing in it is
  // read as a proof either.
  const proofs =
    (await blockedFolder(root, `${PROOF_FOLDER}/any`)) === null
      ? await ordinaryFiles(root, PROOF_FOLDER)
      : [];
  return {
    problem: null,
    paths: [
      ...new Set([
        GATES_DECLARATION_PATH,
        CARRIER_RECORD_PATH,
        ...recorded.files,
        ...proofs,
      ]),
    ].sort(compareCodeUnits),
  };
}

/**
 * Say why a path cannot be carried, when something other than an ordinary
 * file or folder is on the way to it.
 * @param where - Which side: the repository or the disposable copy
 * @param folder - The folder on the way that is not an ordinary one, if any
 * @param state - What is at the path itself
 * @param file - The path, from the repository root
 * @returns The reason, or `null` when nothing is in the way
 */
function inTheWay(
  where: string,
  folder: string | null,
  state: FileState,
  file: string
): string | null {
  const ordinary = state.kind === "file" || state.kind === "missing";
  const named = folder ?? (ordinary ? null : file);
  return named === null
    ? null
    : `${named} is not an ordinary ${folder === null ? "file" : "folder"} in ${where} (it may be a link), so ${file} was not copied and no proof was run. Replace it with an ordinary ${folder === null ? "file" : "folder"}, then run this again.`;
}

/**
 * Make one path the same in the copy as in the working copy.
 * @param root - Real path of the operator's repository
 * @param clone - Real path of the disposable copy
 * @param file - The path, from the repository root
 * @returns Whether it differed, or what is in the way
 */
async function carry(
  root: string,
  clone: string,
  file: string
): Promise<CarriedFile> {
  const from = path.join(root, file);
  const to = path.join(clone, file);
  const [fromFolder, toFolder, source, target] = await Promise.all([
    blockedFolder(root, file),
    blockedFolder(clone, file),
    fileState(from),
    fileState(to),
  ]);
  const problem =
    inTheWay("this repository", fromFolder, source, file) ??
    inTheWay("the disposable copy", toFolder, target, file);
  if (problem !== null) return { problem };
  if (source.content === null) {
    if (target.content !== null) await rm(to);
    return { problem: null, differed: target.content !== null };
  }
  const same =
    target.content?.equals(source.content) === true &&
    target.executable === source.executable;
  if (same) return { problem: null, differed: false };
  await mkdir(path.dirname(to), { recursive: true });
  await writeFile(to, source.content);
  await chmod(to, source.executable ? EXECUTABLE_MODE : PLAIN_MODE);
  return { problem: null, differed: true };
}

/**
 * Make every named path the same in the copy as in the working copy.
 * @param root - Real path of the operator's repository
 * @param clone - Real path of the disposable copy
 * @param paths - The paths, from the repository root
 * @returns The paths that differed from the last commit, in order; or the
 *   first thing in the way, in which case some files may already be copied
 */
export async function carryFiles(
  root: string,
  clone: string,
  paths: readonly string[]
): Promise<CarriedFiles> {
  const outcomes = await Promise.all(
    paths.map(file => carry(root, clone, file))
  );
  const stopped = outcomes.find(outcome => outcome.problem !== null);
  if (stopped !== undefined && stopped.problem !== null) return stopped;
  return {
    problem: null,
    carried: paths.filter((_, index) => {
      const outcome = outcomes[index];
      return outcome?.problem === null && outcome.differed;
    }),
  };
}
