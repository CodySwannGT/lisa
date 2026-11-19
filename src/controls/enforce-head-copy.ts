/**
 * A fresh copy of the default branch's head, to run the required checks in.
 *
 * "This check fails on the head of the default branch" is a statement about
 * one commit, so the checks are run against that commit and nothing else:
 * not the operator's working copy, which may hold unfinished work, and not
 * the branch that happens to be checked out. The copy is a clone in a
 * temporary folder that belongs to one run, checked out at that commit with
 * no branch, and whoever builds it removes it on every way out.
 *
 * It is built with the same isolated git the proof copy uses
 * (`./proof-copy-git.ts`), so it reads the operator's repository and writes
 * nothing there, and inherits no setting, hook or credential from the
 * machine. Once the commit is checked out the copy is cut off from the
 * repository it came from. Its `origin/<branch>` still names the head, so a
 * check that compares against that name still runs.
 *
 * Nothing but committed content is in it: no installed dependencies, no
 * build output, nothing git ignores. A check that needs those fails there
 * for that reason, and its output says so.
 * @module controls/enforce-head-copy
 */
import { mkdir, realpath } from "node:fs/promises";
import path from "node:path";

import { isWithin, realPathOf } from "./carrier-owner.js";
import type { DefaultBranchHead } from "./enforce-types.js";
import { copyGit, gitSaid, type GitExit } from "./proof-copy-git.js";

/** Only the run's own user may look inside its temporary folder. */
const PRIVATE_FOLDER_MODE = 0o700;

/** The ref the head is fetched into, inside the copy. */
const HEAD_REF = "refs/lisa/default-branch-head";

/** The copy, or the one-line reason there is none. */
export type HeadCopyBuild =
  | { readonly problem: null; readonly checkout: string }
  | { readonly problem: string };

/** One git command of the build, and what it is for. */
interface Step {
  /** What the command does, to follow the words "Could not". */
  readonly doing: string;
  readonly run: () => GitExit;
}

/**
 * Run git commands in order, stopping at the first that fails.
 * @param steps - The commands
 * @returns Why the first failure happened, or `null` when all succeeded
 */
function firstFailure(steps: readonly Step[]): string | null {
  return steps.reduce<string | null>((problem, step) => {
    if (problem !== null) return problem;
    const exit = step.run();
    return exit.code === 0
      ? null
      : `Could not ${step.doing}, so the checks were not run on the default branch: ${gitSaid(exit)}`;
  }, null);
}

/**
 * The commands that make the copy and check the head out in it.
 * @param root - Real path of the operator's repository
 * @param home - Real path of the run's temporary folder
 * @param checkout - Where the copy goes
 * @param head - The commit to check out
 * @returns The commands, in order
 */
function copySteps(
  root: string,
  home: string,
  checkout: string,
  head: DefaultBranchHead
): readonly Step[] {
  const inHome = copyGit(home);
  const inCopy = copyGit(checkout);
  return [
    {
      doing: "copy this repository into a temporary folder",
      run: () =>
        inHome([
          "clone",
          "--quiet",
          "--local",
          "--no-checkout",
          "--",
          root,
          checkout,
        ]),
    },
    {
      doing: `read ${head.branch} into the temporary copy`,
      run: () =>
        inCopy(["fetch", "--quiet", "origin", `+${head.ref}:${HEAD_REF}`]),
    },
    {
      doing: `check out commit ${head.commit} in the temporary copy`,
      run: () => inCopy(["checkout", "--quiet", "--detach", HEAD_REF]),
    },
    {
      doing: "cut the temporary copy off from this repository",
      run: () => inCopy(["remote", "remove", "origin"]),
    },
    {
      doing: `name the head of ${head.branch} in the temporary copy`,
      run: () =>
        inCopy([
          "update-ref",
          `refs/remotes/origin/${head.branch}`,
          head.commit,
        ]),
    },
    {
      // Housekeeping in the background could still be writing while the
      // folder is removed.
      doing: "set up the temporary copy",
      run: () => inCopy(["config", "--local", "gc.auto", "0"]),
    },
  ];
}

/**
 * Build a fresh copy of the default branch's head in a folder that does not
 * exist yet.
 * @param root - Real path of the operator's repository
 * @param folder - The folder to create; the caller removes it on every way
 *   out
 * @param head - The commit to check out
 * @returns Where the copy is, or why the checks cannot be run
 */
export async function buildHeadCopy(
  root: string,
  folder: string,
  head: DefaultBranchHead
): Promise<HeadCopyBuild> {
  // Asked before anything is created: a folder made inside the repository
  // would itself be a change to it.
  const planned = await realPathOf(folder);
  if (isWithin(root, planned)) {
    return {
      problem: `The temporary folder ${planned} is inside this repository, so a copy made there would be part of it. Point the temporary folder (TMPDIR) outside the repository, then run this again.`,
    };
  }
  await mkdir(folder, { mode: PRIVATE_FOLDER_MODE });
  const home = await realpath(folder);
  const checkout = path.join(home, "checkout");
  const failed = firstFailure(copySteps(root, home, checkout, head));
  if (failed !== null) return { problem: failed };
  const at = copyGit(checkout)(["rev-parse", "HEAD"]);
  return at.code === 0 && at.stdout === head.commit
    ? { checkout, problem: null }
    : {
        problem: `The temporary copy is not at commit ${head.commit}, so the checks were not run on the default branch: ${gitSaid(at)}`,
      };
}
