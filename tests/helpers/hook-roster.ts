/**
 * The tracked copies of a hook, derived once for every parity test.
 *
 * Three tests named "parity" each wrote their own two-entry roster, so a third
 * tracked copy of the pre-push hook sat six commits behind for four weeks with
 * every one of them green: each proved parity across the copies it happened to
 * list (CodySwannGT/lisa#2847). Importing the roster from here means a fourth
 * copy joins every consumer the moment it is tracked, with no test edited.
 *
 * The `git ls-files` call itself lives in `./tracked-files`, shared with the
 * shipped-`.mjs` roster. A second copy of "ask git what it tracks" inside the
 * test tree would be the same duplication this helper was created to remove,
 * one level down.
 *
 * It is reached through `checkoutFiles` rather than `trackedPaths` so the
 * roster also derives inside a tree git cannot describe — Stryker copies the
 * project into an untracked sandbox, where this helper used to throw at module
 * scope and take the whole mutation gate down with it.
 * @module tests/helpers/hook-roster
 */
import {
  deriveHookCopyGroups,
  type HookCopyGroup,
} from "../../src/core/hook-copy-parity.js";
import { checkoutFiles } from "./tracked-files.js";

/**
 * Every hook in this checkout and all its tracked copies.
 * @param root - Repository root, defaulting to the vitest working directory
 * @returns One group per hook name, sorted by hook name
 */
export function trackedHookGroups(
  root: string = process.cwd()
): readonly HookCopyGroup[] {
  return deriveHookCopyGroups(checkoutFiles(root));
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
