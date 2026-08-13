/**
 * Filesystem and process primitives shared by the file lock and its stale-lock
 * reclaim capability.
 *
 * Extracted verbatim from `learnings-lock.ts` so the reclaim capability
 * (`learnings-lock-capability.ts`) can reuse the exact same probes the lock
 * itself uses. A second, subtly different copy of "is this process alive" or
 * "is an absent file an error" is precisely how a lock grows a hole.
 * @module core/learnings-lock-fs
 */
import { lstat, unlink } from "node:fs/promises";

/**
 * Read file metadata without treating an absent path as an error.
 * @param filePath - Filesystem path
 * @returns File metadata or undefined
 */
export async function statFile(
  filePath: string
): Promise<Awaited<ReturnType<typeof lstat>> | undefined> {
  try {
    return await lstat(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

/**
 * Remove one path without recursive deletion.
 * @param filePath - Regular file or hard-link path
 */
export async function removeFileIfPresent(filePath: string): Promise<void> {
  try {
    await unlink(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
}

/**
 * Treat permission-denied PID probes as live and missing PIDs as dead.
 * @param pid - Declared owner process id
 * @returns Whether the process may still be alive
 */
export function isProcessLive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}
