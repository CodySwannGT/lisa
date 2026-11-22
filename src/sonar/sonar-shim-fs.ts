/**
 * Filesystem guards for repointing Sonar hook shims in place.
 *
 * CodySwannGT/lisa#4502. Split from `sonar-shim-repoint.ts` so the parsing
 * contract and the write-safety contract each stay small enough to read whole.
 * Every helper here exists to make one rewrite of a host-owned file safe: never
 * write through a symlink or out of the project, never leave a truncated shim
 * behind, and never overwrite a shim the operator made read-only.
 * @module sonar/sonar-shim-fs
 */
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  access,
  chmod,
  lstat,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import * as path from "node:path";

/**
 * Whether a path is a regular, non-symlinked file, and its permission bits.
 * @param absolute - Absolute path to inspect
 * @returns The permission bits, or undefined when missing or not a regular file
 */
export async function regularFileMode(
  absolute: string
): Promise<number | undefined> {
  const stats = await lstat(absolute).catch(() => undefined);
  if (stats === undefined || !stats.isFile()) return undefined;
  return stats.mode & 0o7777;
}

/**
 * Whether a file's real parent directory lies inside the project.
 *
 * `lstat` on the shim only rejects a symlink at the final component; a
 * symlinked ancestor such as `.claude/hooks` would still route the write to a
 * directory outside the checkout. Resolving both sides closes that.
 * @param projectRoot - Absolute project root
 * @param absolute - Absolute path of the file about to be rewritten
 * @returns True when the resolved parent is the project root or beneath it
 */
export async function parentInsideProject(
  projectRoot: string,
  absolute: string
): Promise<boolean> {
  const [root, parent] = await Promise.all([
    realpath(projectRoot),
    realpath(path.dirname(absolute)),
  ]);
  const relative = path.relative(root, parent);
  return !relative.startsWith("..") && !path.isAbsolute(relative);
}

/**
 * Replace a file's contents atomically, keeping its permission bits.
 *
 * Writes a sibling temporary file, sets its mode, then renames it over the
 * target, so a failure part-way leaves the working shim intact rather than
 * truncated. A target the operator made unwritable is refused up front: the
 * rename would otherwise succeed (it needs only directory write access) and
 * silently override that choice.
 * @param absolute - Absolute path of the file to replace
 * @param body - New contents
 * @param mode - Permission bits for the replacement
 * @throws {Error} When the target is not writable or any step fails
 */
export async function replaceFileAtomically(
  absolute: string,
  body: string,
  mode: number
): Promise<void> {
  await access(absolute, constants.W_OK);
  const temporary = path.join(
    path.dirname(absolute),
    `.${path.basename(absolute)}.lisa-${randomUUID()}.tmp`
  );
  try {
    await writeFile(temporary, body, { flag: "wx", mode });
    await chmod(temporary, mode);
    await rename(temporary, absolute);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}
