/**
 * Stale-file cleanup for the shared modules `opencode/shared-scripts-emitter`
 * writes outside skill folders (CodySwannGT/lisa#4642).
 *
 * Every comparison happens on manifest-shaped paths: relative to `.opencode/`,
 * forward slashes on every platform. `opencode/manifest` normalizes entries to
 * forward slashes when it reads them, so comparing them against
 * `path.relative` output (backslashes on Windows) would mark every shared
 * module stale on the second apply and delete the files just copied.
 * @module opencode/shared-scripts-cleanup
 */
import * as fse from "fs-extra";
import { readdir, rm } from "node:fs/promises";
import * as path from "node:path";

/**
 * Manifest prefix of the only subtree the shared-script emitter writes and may
 * clean up: `.opencode/skills/scripts/`, where `../../../scripts/<m>` from a
 * skill script lands. Host folders elsewhere under `skills/` (for example a
 * host's own `skills/<name>/`) are never selected, even if a manifest names
 * them. The emitter refuses any target outside this prefix, so it can never
 * write a file this cleanup cannot later remove.
 */
export const SHARED_SCRIPTS_PREFIX = "skills/scripts/";

/** Absolute `<destDir>/.opencode` the cleanup works under. */
interface CleanupRoots {
  /** Absolute `<destDir>/.opencode`. */
  readonly opencodeDir: string;
}

/**
 * Convert a relative path to the manifest's forward-slash form.
 * @param relativePath - Path relative to `.opencode/`, either separator.
 * @returns The same path with forward slashes.
 */
export function toManifestPath(relativePath: string): string {
  return relativePath.replaceAll("\\", "/");
}

/**
 * Choose the previous manifest entries that belong to the shared-script
 * emitter and are not emitted this run.
 *
 * The emitter owns {@link SHARED_SCRIPTS_PREFIX} only; skill folders, host
 * folders, and every other installer's entries are never selected.
 * @param previousManagedFiles - Manifest entries from the previous run.
 * @param currentShared - Shared modules emitted this run.
 * @returns Stale entries in manifest form, sorted.
 */
export function selectStaleSharedEntries(
  previousManagedFiles: readonly string[],
  currentShared: readonly string[]
): readonly string[] {
  const keep = new Set(currentShared.map(toManifestPath));
  const stale = previousManagedFiles
    .map(toManifestPath)
    .filter(rel => rel.startsWith(SHARED_SCRIPTS_PREFIX) && !keep.has(rel));
  return Object.freeze(
    Array.from(new Set(stale)).sort((a, b) => a.localeCompare(b))
  );
}

/**
 * Delete shared modules Lisa emitted last run that this run no longer needs,
 * then remove any directory the deletions left empty (never `skills/` itself).
 * Files Lisa never recorded in the manifest are left alone.
 * @param previousManagedFiles - Manifest entries from the previous run.
 * @param currentShared - Shared modules emitted this run.
 * @param roots - Emit roots for this host project.
 * @returns Deleted entries in manifest form, sorted.
 */
export async function deleteStaleSharedScripts(
  previousManagedFiles: readonly string[],
  currentShared: readonly string[],
  roots: CleanupRoots
): Promise<readonly string[]> {
  const stale = selectStaleSharedEntries(previousManagedFiles, currentShared);
  await Promise.all(
    stale.map(rel => rm(path.join(roots.opencodeDir, rel), { force: true }))
  );
  await pruneEmptiedDirs(stale, roots);
  return stale;
}

/**
 * Remove directories the deletions left empty. Deepest first, sequentially,
 * so a nested directory emptied here lets its parent — up to
 * `skills/scripts/` itself — be removed in the same pass. No-op when nothing
 * was deleted, so an untouched host directory is never pruned.
 * @param deleted - Entries just deleted, in manifest form.
 * @param roots - Emit roots for this host project.
 */
async function pruneEmptiedDirs(
  deleted: readonly string[],
  roots: CleanupRoots
): Promise<void> {
  const candidates =
    deleted.length === 0
      ? []
      : [
          ...deleted.map(rel => path.posix.dirname(rel)),
          SHARED_SCRIPTS_PREFIX.slice(0, -1),
        ];
  const ordered = Array.from(new Set(candidates)).sort(
    (a, b) => b.split("/").length - a.split("/").length
  );
  await ordered.reduce<Promise<void>>(
    (previous, dir) =>
      previous.then(() => removeIfEmpty(path.join(roots.opencodeDir, dir))),
    Promise.resolve()
  );
}

/**
 * Remove a directory only when it exists and holds nothing.
 * @param absDir - Absolute directory path.
 */
async function removeIfEmpty(absDir: string): Promise<void> {
  if (!(await fse.pathExists(absDir))) {
    return;
  }
  if ((await readdir(absDir)).length === 0) {
    await rm(absDir, { recursive: true, force: true });
  }
}
