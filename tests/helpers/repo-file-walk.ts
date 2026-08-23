/**
 * Enumerate the files in a checkout without asking git.
 *
 * Suites that derive a roster from `git ls-files` are correct from the
 * repository root and silently wrong everywhere else, because git lists
 * **tracked** paths and the interesting copies of a tree are not always tracked.
 * The case that bites in this repository is the mutation gate: Stryker runs the
 * suite inside a sandbox copy (`stryker.conf.json` sets
 * `tempDirName: ".stryker-tmp"`), no `.git` is copied into it, and git discovery
 * walks up to the real worktree — where nothing under the sandbox prefix is
 * tracked. `git ls-files` therefore returns the empty set there.
 *
 * That failure is worse than one red assertion. A roster resolving to nothing
 * turns every assertion built on it into a check over the empty set, and any
 * assertion that does notice goes red in Stryker's **dry run**, which aborts the
 * whole gate before a single mutant is tried — so every guard's mutation score
 * disappears along with it. Two separate suites hit this (CodySwannGT/lisa#2839
 * for the hook-manifest roster, and the hook-copy roster it shares a mechanism
 * with), which is why the walk lives here rather than in either of them.
 *
 * This is a filesystem walk, so it answers "what is in this tree?" rather than
 * "what does git know about?" — the question a sandbox copy can actually answer.
 *
 * **Callers should not reach for this directly.** `checkoutFiles` in
 * `./tracked-files` is the seam a roster wants: it prefers git wherever git can
 * answer, so an untracked stray stays out of every roster built in a real
 * checkout (CodySwannGT/lisa#2824), and reaches this walk only for a tree that
 * is not a checkout at all. Using the walk unconditionally gives up that
 * protection.
 * @module tests/helpers/repo-file-walk
 */
import { readdirSync } from "node:fs";
import * as path from "node:path";

/**
 * Directories the walk never descends into.
 *
 * `node_modules` is the one that matters for cost — it is roughly two orders of
 * magnitude larger than the rest of the tree and carries files belonging to
 * dependencies rather than to this checkout. The rest are build output, git's
 * own store, the mutation sandbox, and sibling worktrees: none of them are part
 * of the surface a roster is meant to describe, and `.stryker-tmp` in
 * particular would let a sandbox copy count every file in the tree twice.
 *
 * This matches the skip set the in-repo precedent already uses
 * (`tests/unit/config/workspace-suite-collection.test.ts`), plus the two paths
 * that only exist here: the mutation sandbox and sibling worktrees.
 */
export const UNWALKED_DIRECTORIES: ReadonlySet<string> = new Set([
  ".git",
  ".stryker-tmp",
  ".worktrees",
  "build",
  "coverage",
  "dist",
  "node_modules",
]);

/**
 * Every file beneath a root, as root-relative POSIX paths.
 *
 * Symlinked directories are stepped over rather than followed: `isDirectory()`
 * is false for a symlink, so the sandbox's symlinked `node_modules` is skipped
 * before its name is even consulted, and no cycle can be walked into.
 *
 * Paths are POSIX-separated regardless of platform so a caller can compare them
 * against the repo-relative spellings used in manifests and rosters.
 * @param root - Directory to walk, a repository root or a sandbox copy of one
 * @returns Root-relative file paths, sorted
 */
export function walkRepoFiles(root: string): readonly string[] {
  const walk = (dir: string): readonly string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        return UNWALKED_DIRECTORIES.has(entry.name) ? [] : walk(full);
      }
      return entry.isFile() ? [full] : [];
    });

  return walk(root)
    .map(full => path.relative(root, full).split(path.sep).join("/"))
    .sort((a, b) => a.localeCompare(b));
}
