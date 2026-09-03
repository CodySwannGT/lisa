/**
 * Directory names a repository-wide scan must not descend into.
 *
 * ## Why this is shared rather than hand-rolled per scan
 *
 * A test that walks the repository to assert something about the source — this
 * file is unique by basename, every shipped hook has a companion, no template
 * pins a stale version — is asserting a property of the SOURCE. Several
 * directories under the repository root are not source: they are copies of it,
 * or build output, or another branch entirely.
 *
 * A scratch sandbox is the dangerous one, because it is a **full second copy of
 * the tree**. Measured on this repository: a `stryker` run terminated under
 * fleet saturation left 42 MB at
 * `.stryker-tmp/bite-guard-intact/sandbox-<id>/rails/copy-overwrite/scripts/lisa-scratch-run.sh`,
 * a second copy of a file one scan asserts is unique by basename. That scan
 * failed on the NEXT run, with a clean, specific, entirely plausible message
 * about a duplicate file — and nothing in its output mentioned mutation,
 * saturation, or the run that died minutes earlier
 * (CodySwannGT/lisa#3653, the fourth rendering catalogued in #3630).
 *
 * Measured at the same time: **42 test files walk from the repository root and
 * none of them excluded the sandbox root.** Every one of them is exposed to the
 * same debris; the basename scan is simply the one that happened to trip first.
 * Each had hand-rolled its own skip list, so each could forget a different
 * entry — which is why this list is one importable constant rather than a
 * convention.
 *
 * ## The falsifier, because the obvious reading is wrong
 *
 * `.stryker-tmp/` EXISTING is normal and harmless. The mutation gate recreates
 * it every run and it comes back empty. Only a POPULATED sandbox, left by an
 * interrupted or racing run, is a second copy of the tree. Anyone who reads the
 * directory's presence as the defect will delete it, watch it return empty, and
 * conclude wrongly that the fix did not take.
 *
 * This list is defence in depth, not the cure. The cure is that an interrupted
 * run's sandbox gets reclaimed — see `reclaimAbandonedSandboxes` in
 * `lisa-mutation.mjs`. Both are wanted: reclamation removes the debris, and
 * this stops a scan reading whatever debris reclamation has not reached yet.
 * @module configs/repo-scan
 */
import { WORKTREE_ROOTS } from "./worktrees.js";

/**
 * Stryker's sandbox root when a project declares no `tempDirName`.
 *
 * Duplicated from `lisa-mutation.mjs`'s `DEFAULT_TEMP_DIR_NAME` rather than
 * imported: that module is an untyped `.mjs` shipped under `typescript/`, and a
 * `src/` config importing a stack template would invert the dependency
 * direction the package is built on. The value is Stryker's own default and is
 * pinned by a test in both places.
 */
export const DEFAULT_SANDBOX_ROOT = ".stryker-tmp";

/**
 * Directory names a repository-wide source scan skips.
 *
 * Names, not paths, because these are matched against a single directory entry
 * during a walk. A project that configures a different `tempDirName` should add
 * it alongside these rather than replacing the list.
 */
export const REPO_SCAN_EXCLUSIONS: readonly string[] = [
  ".git",
  "node_modules",
  "dist",
  "coverage",
  ".claude",
  "scratchpad",
  // Not source: a full second copy of the tree, and the one that has actually
  // broken a scan on this repository.
  DEFAULT_SANDBOX_ROOT,
  // Not this branch's source: another checkout entirely. One host project
  // measured 13,821 of 14,277 collected files coming from worktrees.
  ...WORKTREE_ROOTS.map(root => root.split("/").at(-1) as string),
];

/**
 * Whether a walk should skip a directory entry by name.
 * @param name - A single directory entry name, never a path.
 * @returns True when the entry is not source and must not be descended into.
 */
export function isExcludedFromRepoScan(name: string): boolean {
  return REPO_SCAN_EXCLUSIONS.includes(name);
}
