/**
 * The tracked copies of a hook, derived once for every parity test.
 *
 * Three tests named "parity" each wrote their own two-entry roster, so a third
 * tracked copy of the pre-push hook sat six commits behind for four weeks with
 * every one of them green: each proved parity across the copies it happened to
 * list (CodySwannGT/lisa#2847). Importing the roster from here means a fourth
 * copy joins every consumer the moment it is tracked, with no test edited.
 * @module tests/helpers/hook-roster
 */
import { spawnSync } from "node:child_process";
import {
  deriveHookCopyGroups,
  type HookCopyGroup,
} from "../../src/core/hook-copy-parity.js";
import { cleanGitEnv, resolveGit } from "../support/git-executable.js";
import { walkRepoFiles } from "./repo-file-walk.js";

const GIT = resolveGit();

/**
 * Every path git tracks in this checkout.
 * @param root - Repository root
 * @returns Repo-relative tracked paths
 */
function trackedPaths(root: string): readonly string[] {
  const child = spawnSync(GIT, ["ls-files", "-z"], {
    cwd: root,
    encoding: "utf8",
    env: cleanGitEnv(),
    maxBuffer: 16 * 1024 * 1024,
  });
  if (child.status !== 0) {
    throw new Error(
      `git ls-files failed in ${root}: ${child.stderr ?? "no stderr"}`
    );
  }
  return (child.stdout ?? "").split("\0").filter(entry => entry.length > 0);
}

/**
 * Every path in this checkout, however the checkout can be enumerated.
 *
 * Git is asked first and answers everywhere this suite normally runs, which
 * keeps the roster to paths the repository actually tracks — the point of
 * deriving it at all. But git can only describe a tree it tracks, and one place
 * this suite runs is not such a tree: Stryker copies the project into an
 * untracked sandbox (`stryker.conf.json` sets `tempDirName: ".stryker-tmp"`)
 * with no `.git` of its own, so discovery walks up to the real worktree and
 * `ls-files` reports nothing under the sandbox prefix. The roster then came back
 * empty and `trackedHookCopies` threw at module scope, which is not one red
 * test: it aborts Stryker's dry run, and a failed dry run takes down the whole
 * mutation gate before a single mutant is tried. Measured on this checkout,
 * both suites importing this helper reach a mutated guard, so the gate could
 * not run at all.
 *
 * Falling back to a filesystem walk answers the question git cannot there —
 * "what is in this tree?" — and only ever runs when git found nothing, so the
 * enumeration at the repository root is byte-for-byte what it was before.
 * @param root - Repository root
 * @returns Repo-relative paths
 */
function checkoutPaths(root: string): readonly string[] {
  const tracked = trackedPaths(root);
  return tracked.length > 0 ? tracked : walkRepoFiles(root);
}

/**
 * Every hook in this checkout and all its tracked copies.
 * @param root - Repository root, defaulting to the vitest working directory
 * @returns One group per hook name, sorted by hook name
 */
export function trackedHookGroups(
  root: string = process.cwd()
): readonly HookCopyGroup[] {
  return deriveHookCopyGroups(checkoutPaths(root));
}

/**
 * Tracked copies of two hooks that sit in the same directory, paired.
 *
 * Some assertions are about a pair of hooks agreeing on where a step lives, so
 * the pair has to travel together. Derived the same way as the single-hook
 * roster: a directory holding both hooks contributes one pair, and a directory
 * holding only one contributes none.
 * @param first - First hook file name
 * @param second - Second hook file name
 * @param root - Repository root, defaulting to the vitest working directory
 * @returns One `[first, second]` pair per directory holding both, sorted
 */
export function trackedHookCopyPairs(
  first: string,
  second: string,
  root: string = process.cwd()
): readonly (readonly [string, string])[] {
  const directoryOf = (hookPath: string): string =>
    hookPath.slice(0, hookPath.lastIndexOf("/"));
  const seconds = new Set(trackedHookCopies(second, root).map(directoryOf));
  return trackedHookCopies(first, root)
    .filter(hookPath => seconds.has(directoryOf(hookPath)))
    .map(hookPath => [hookPath, `${directoryOf(hookPath)}/${second}`] as const);
}

/**
 * Every tracked copy of one hook, derived rather than written down.
 *
 * Throws when the hook has no tracked copy at all, because a roster that
 * silently resolves to nothing turns a parity assertion into a check over the
 * empty set — which is exactly the shape of failure this helper replaces.
 * @param hook - Hook file name, e.g. `pre-push`
 * @param root - Repository root, defaulting to the vitest working directory
 * @returns Repo-relative paths of every tracked copy, sorted
 */
export function trackedHookCopies(
  hook: string,
  root: string = process.cwd()
): readonly string[] {
  const group = trackedHookGroups(root).find(
    candidate => candidate.hook === hook
  );
  if (group === undefined) {
    throw new Error(`No tracked copy of a hook named "${hook}" under ${root}`);
  }
  return group.paths;
}
