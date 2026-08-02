/**
 * Single source of truth for where agent worktrees live.
 *
 * Lisa parks isolated per-session checkouts under TWO roots — `.claude/worktrees/`
 * (Claude Code sessions) and a bare `.worktrees/` (loops and hand-created ticket
 * worktrees). Every surface that enumerates project files has to know about both:
 * git, EAS uploads, ESLint, jest, and vitest.
 *
 * They were previously registered one file at a time, and the bare root was
 * missed everywhere. The failure mode is quiet in each case — a gate that still
 * reports green while measuring the wrong tree:
 *
 * - jest/vitest collect sibling branches' tests, so the local suite reports other
 *   agents' in-flight failures (one host project measured 13,821 of 14,277
 *   collected files coming from worktrees).
 * - ESLint lints those same files, so the pre-push gate fails on code the
 *   developer never touched (measured: 1122 errors in this repo).
 * - EAS packs them into the build upload archive (measured: a 1.8 GB archive
 *   that failed metadata upload with a 400).
 *
 * CI never has worktrees, which is exactly why these stayed hidden.
 */

/** Repo-relative roots under which agent worktrees are created. */
export const WORKTREE_ROOTS: readonly string[] = [
  ".claude/worktrees",
  ".worktrees",
];

/**
 * Matches a path that is INSIDE one of the worktree roots.
 *
 * Used against `process.cwd()` so a run launched from within a worktree does not
 * exclude itself — the same glob that skips siblings from the primary checkout
 * would otherwise match every path under root and find zero tests.
 */
export const WORKTREE_CWD_PATTERN =
  /[/\\]\.claude[/\\]worktrees(?:[/\\]|$)|[/\\]\.worktrees(?:[/\\]|$)/;

/**
 * Report whether a directory sits inside an agent worktree.
 * @param cwd Directory to test; defaults to the current working directory.
 * @returns True when the path is inside one of {@link WORKTREE_ROOTS}.
 */
export function isInsideWorktree(cwd: string = process.cwd()): boolean {
  return WORKTREE_CWD_PATTERN.test(cwd);
}
