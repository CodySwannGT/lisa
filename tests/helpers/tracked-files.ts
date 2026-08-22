/**
 * The one implementation of "what does git track here", shared by every roster
 * a test derives instead of writing down.
 *
 * @remarks
 * Two separate defects in this repository share a root: a test that enumerates
 * its subject from a hardcoded list, and a test that enumerates it by walking
 * the filesystem. The first misses a copy nobody added (CodySwannGT/lisa#2847 —
 * a third tracked copy of the pre-push hook sat six commits behind for four
 * weeks with three "parity" tests green). The second picks up files that are
 * not part of anything (CodySwannGT/lisa#2824 — an UNTRACKED scratch file
 * blocked a required push gate for an agent who could not see it, could not
 * attribute it, and was not shipping it).
 *
 * The index answers both. It is exactly the set a commit can carry, which is
 * exactly the set a push can deliver and a package can publish.
 *
 * Failure is loud rather than silent: a roster that quietly resolves to nothing
 * turns every assertion over it into a check on the empty set, which is the
 * "reported success while proving nothing" shape this whole area exists to
 * avoid. So `git ls-files` failing throws instead of falling back to a walk.
 * @module tests/helpers/tracked-files
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import * as path from "node:path";

import { cleanGitEnv, resolveGit } from "../support/git-executable.js";
import { walkRepoFiles } from "./repo-file-walk.js";

const GIT = resolveGit();

/**
 * Every path git tracks in this checkout.
 * @param root - Repository root
 * @returns Repo-relative tracked paths
 */
export function trackedPaths(root: string): readonly string[] {
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
 * The tracked paths as a set, for filtering a filesystem walk down to what a
 * commit can actually carry.
 *
 * Some suites discover their subject by walking directories — deliberately, so
 * a new stack tree is picked up with nobody editing a list. Walking is the
 * right way to FIND candidates and the wrong way to decide which of them a push
 * is responsible for; intersecting with this set keeps the first property and
 * drops the second.
 * @param root - Repository root
 * @returns Every repo-relative tracked path
 */
export function trackedSet(root: string): ReadonlySet<string> {
  return new Set(trackedPaths(root));
}

/**
 * Whether `root` is a checkout git can describe, rather than a copy of one.
 *
 * A checkout carries its own `.git` — a directory normally, a file in a
 * worktree. A copy of a tree carries neither, and git's discovery then walks
 * UP to whatever real checkout encloses the copy and answers about that
 * instead. The answer is not an error and not empty-because-broken: it is a
 * correct answer to a different question, which is why it has to be detected
 * here rather than inferred from a disappointing result.
 * @param root - Directory to classify
 * @returns True when `root` is the top of its own checkout
 */
function isOwnCheckout(root: string): boolean {
  return existsSync(path.join(root, ".git"));
}

/**
 * Every file this tree is responsible for, whether or not git can describe it.
 *
 * `trackedPaths` is the right answer in a checkout and is used unchanged there,
 * so the protection it exists for still holds: an untracked scratch file stays
 * out of every roster built on it (CodySwannGT/lisa#2824). This function only
 * adds the case that has no tracked answer at all.
 *
 * That case is Stryker's sandbox. The mutation gate copies the project to
 * `.stryker-tmp/` and runs the suite there, and the copy has no `.git`, so
 * discovery finds the enclosing worktree and reports nothing under the sandbox
 * prefix as tracked. Rosters built on it came back empty: the hook-copy roster
 * threw at module scope, and the hook-manifest roster reported
 * `expected 0 to be greater than 0`. Either one is fatal well beyond its own
 * file, because a red test in Stryker's DRY RUN aborts the gate before a single
 * mutant is tried — every guard's score vanishes with it
 * (CodySwannGT/lisa#2839).
 *
 * Note what is NOT being done here. The module header rejects falling back to a
 * walk when `git ls-files` FAILS, and that stands: a failure inside a real
 * checkout still throws, loudly, because a roster that quietly empties is the
 * silent-success shape this area exists to refuse. The walk is reached only
 * when the tree is not a checkout, which git cannot answer about even in
 * principle — a different condition, detected explicitly, never inferred from
 * an empty result.
 * @param root - Repository root, or a copy of one
 * @returns Repo-relative paths, tracked where that is knowable
 */
export function checkoutFiles(root: string): readonly string[] {
  return isOwnCheckout(root) ? trackedPaths(root) : walkRepoFiles(root);
}
