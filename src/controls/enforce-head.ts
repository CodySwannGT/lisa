/**
 * Finding the head of the default branch in a checkout, by reading only.
 *
 * The enforce step lists the required checks that fail on the head of the
 * default branch. "The default branch" is whichever branch changes are
 * merged into, and a checkout does not always say which that is, so it is
 * looked for in this order and the report says which answer was used:
 *
 * 1. The branch the hosting platform named, when the merge-protection step
 *    read it.
 * 2. The branch the remote's `HEAD` points at (`origin/HEAD`), which a clone
 *    records.
 * 3. A branch named `main`, then `master`, when one exists.
 * 4. The branch that is checked out.
 *
 * The commit is the remote's copy of that branch as this checkout last saw
 * it (`origin/<branch>`), or the local branch when there is no such copy.
 * Nothing is fetched: a fetch would change the repository, and the enforce
 * step's own writes are the only ones it may make.
 * @module controls/enforce-head
 */
import type { DefaultBranchHead } from "./enforce-types.js";
import { gitSaid, sourceGit, type RunGit } from "./proof-copy-git.js";

/** The names a default branch usually has, tried in this order. */
const CONVENTIONAL_BRANCHES = ["main", "master"] as const;

/** The remote whose copy of the branch is preferred. */
const REMOTE = "origin";

/** The head, or the one-line reason it could not be found. */
export type DefaultHeadRead =
  | { readonly problem: null; readonly head: DefaultBranchHead }
  | { readonly problem: string };

/** A branch name and how it was chosen. */
type ChosenBranch = Pick<DefaultBranchHead, "branch" | "chosen_by">;

/**
 * Ask git one question and take a non-empty answer.
 * @param git - Read-only git in the repository
 * @param args - The question
 * @returns The answer, or `null` when git gave none
 */
function answerOf(git: RunGit, args: readonly string[]): string | null {
  const exit = git(args);
  return exit.code === 0 && exit.stdout !== "" ? exit.stdout : null;
}

/**
 * Find the refs a branch could be read from, the remote's copy first.
 * @param branch - The branch's name
 * @returns The two refs
 */
function refsOf(branch: string): readonly string[] {
  return [`refs/remotes/${REMOTE}/${branch}`, `refs/heads/${branch}`];
}

/**
 * Read the commit a branch is at.
 * @param git - Read-only git in the repository
 * @param branch - The branch's name
 * @returns The ref that was read and its commit, or `null` when the branch
 *   is in neither place
 */
function commitOf(
  git: RunGit,
  branch: string
): Pick<DefaultBranchHead, "ref" | "commit"> | null {
  return refsOf(branch).reduce<Pick<
    DefaultBranchHead,
    "ref" | "commit"
  > | null>((found, ref) => {
    if (found !== null) return found;
    const commit = answerOf(git, [
      "rev-parse",
      "--verify",
      "--quiet",
      `${ref}^{commit}`,
    ]);
    return commit === null ? null : { commit, ref };
  }, null);
}

/**
 * Choose the default branch's name.
 * @param git - Read-only git in the repository
 * @param platformBranch - The branch the hosting platform named, if it did
 * @returns The name and how it was chosen, or `null` when nothing names one
 */
function chooseBranch(
  git: RunGit,
  platformBranch: string | null
): ChosenBranch | null {
  if (platformBranch !== null && platformBranch !== "") {
    return { branch: platformBranch, chosen_by: "hosting-platform" };
  }
  const remoteHead = answerOf(git, [
    "symbolic-ref",
    "--quiet",
    "--short",
    `refs/remotes/${REMOTE}/HEAD`,
  ]);
  if (remoteHead?.startsWith(`${REMOTE}/`) === true) {
    return {
      branch: remoteHead.slice(REMOTE.length + 1),
      chosen_by: "origin-head",
    };
  }
  const conventional = CONVENTIONAL_BRANCHES.find(
    name => commitOf(git, name) !== null
  );
  if (conventional !== undefined) {
    return { branch: conventional, chosen_by: "conventional-name" };
  }
  const current = answerOf(git, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
  return current === null
    ? null
    : { branch: current, chosen_by: "current-branch" };
}

/**
 * Find the head of the default branch of a checkout.
 * @param root - Real path of the repository
 * @param platformBranch - The branch the hosting platform named, or `null`
 * @param git - Read-only git in the repository
 * @returns The branch, the ref that was read and its commit, or why none
 *   could be found
 */
export function readDefaultBranchHead(
  root: string,
  platformBranch: string | null,
  git: RunGit = sourceGit(root)
): DefaultHeadRead {
  const inside = git(["rev-parse", "--git-dir"]);
  if (inside.code !== 0) {
    return {
      problem: `This folder is not a git repository, so it has no default branch to run the checks on (${gitSaid(inside)}).`,
    };
  }
  const chosen = chooseBranch(git, platformBranch);
  if (chosen === null) {
    return {
      problem:
        "Nothing says which branch is the default one: no branch is checked out, the remote names none, and there is no branch called main or master.",
    };
  }
  const commit = commitOf(git, chosen.branch);
  return commit === null
    ? {
        problem: `The default branch is ${chosen.branch}, and this checkout holds no commit of it, so the checks were not run. Fetch it, then run this again.`,
      }
    : { head: { ...chosen, ...commit }, problem: null };
}
