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

import { cleanGitEnv, resolveGit } from "../support/git-executable.js";

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
