/**
 * Filesystem and process probes shared by the ledger lock
 * (`ledger-lock.mjs`) and its stale-lock reclaim (`ledger-lock-reclaim.mjs`).
 *
 * Ported from Lisa's learnings-ledger lock (`src/core/learnings-lock-fs.ts`)
 * rather than imported, because plugin scripts ship standalone and cannot
 * reach `src/`. Both lock halves use these exact probes: a second, subtly
 * different "is this process alive" or "is an absent file an error" is how a
 * lock grows a hole.
 * @module ledger-lock-fs
 */

import { lstat, readFile, unlink } from "node:fs/promises";

/** Largest owner record worth parsing; anything bigger is not ours. */
const MAX_OWNER_BYTES = 512;

/**
 * Read file metadata without treating an absent path as an error.
 * @param {string} filePath - Filesystem path
 * @returns {Promise<import("node:fs").Stats | undefined>} Metadata, or undefined
 */
export async function statFile(filePath) {
  try {
    return await lstat(filePath);
  } catch (error) {
    if (error?.code === "ENOENT") return undefined;
    throw error;
  }
}

/**
 * Remove one path, treating an already-absent path as success.
 * @param {string} filePath - Regular file or hard-link path
 * @returns {Promise<void>}
 */
export async function removeFileIfPresent(filePath) {
  try {
    await unlink(filePath);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

/**
 * Whether a pid may still be alive on this host. Only `ESRCH` means dead; a
 * permission error means the process exists but belongs to someone else.
 * @param {number} pid - Declared owner process id
 * @returns {boolean} Whether the process may be alive
 */
export function isProcessLive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code !== "ESRCH";
  }
}

/**
 * Whether two paths are the same regular-file inode.
 * @param {string} left - First path
 * @param {string} right - Second path
 * @returns {Promise<boolean>} Whether both name one inode
 */
export async function sameFile(left, right) {
  const [a, b] = await Promise.all([statFile(left), statFile(right)]);
  return (
    a !== undefined &&
    b !== undefined &&
    a.isFile() &&
    b.isFile() &&
    a.dev === b.dev &&
    a.ino === b.ino
  );
}

/**
 * Read a small JSON record; a missing, oversized, special or unparseable file
 * is `undefined`, never an error.
 * @param {string} filePath - Record path
 * @returns {Promise<unknown>} Parsed value, or undefined
 */
export async function readSmallJson(filePath) {
  const metadata = await statFile(filePath);
  if (!metadata?.isFile() || metadata.size > MAX_OWNER_BYTES) return undefined;
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return undefined;
  }
}

/**
 * Whether a parsed value is a plain object with exactly these keys.
 * @param {unknown} value - Parsed value
 * @param {string[]} keys - Required keys, and the only ones allowed
 * @returns {boolean} Whether the shape matches
 */
export function hasExactKeys(value, keys) {
  if (value === null || typeof value !== "object") return false;
  if (Object.getPrototypeOf(value) !== Object.prototype) return false;
  const own = Reflect.ownKeys(value);
  return own.length === keys.length && keys.every(key => own.includes(key));
}

/**
 * Whether a value is a positive safe integer (a usable pid).
 * @param {unknown} value - Candidate
 * @returns {boolean} Whether it is a pid
 */
export function isPid(value) {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}
