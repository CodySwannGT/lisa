/**
 * Building the disposable copy commit and push proofs run in.
 *
 * A proof plants a change that breaks a rule and then commits or pushes it,
 * to see the hook turn it away. None of that may happen in the operator's
 * repository, so a run gets its own copy, in a temporary folder that belongs
 * to that run alone.
 *
 * ## What the copy is
 *
 * A clone of the repository's last commit. The control being proved is "a
 * change that breaks the rule is rejected at commit, or at push", and a hook
 * judges a change against committed content, so the last commit is the base.
 * Work that is not committed is not in the copy and is not part of what a
 * proof says. The only files taken from the working copy are the ones that
 * describe the checks; see `./proof-copy-files.ts`.
 *
 * It is a clone and never a linked working copy of the operator's
 * repository: a linked working copy shares refs, settings and the stash with
 * the repository it came from, which are exactly what must not be touched.
 * The folder holds:
 *
 * - `remote.git`, a bare repository holding the operator's local branches.
 *   It stands in for the remote: the copy's `origin` points at it, so a push
 *   can never leave the machine.
 * - `clone`, the working copy the changes are planted in, on the same branch
 *   as the operator's.
 * - `no-hooks`, an empty folder git is pointed at for the few commits and
 *   pushes that set the copy up and must not be judged by a hook.
 *
 * ## What it inherits
 *
 * Nothing from the machine and nothing from the operator's own settings: no
 * remote but the stand-in, no credential helper, no signing, and a hooks
 * folder set only by installing the carriers there, with the same installer
 * `lisa controls install-carriers` uses. Building it only reads the
 * operator's repository.
 *
 * Whoever calls {@link buildProofCopy} names the folder and removes it on
 * every way out, whatever is returned or thrown.
 * @module controls/proof-copy
 */
import { mkdir, realpath } from "node:fs/promises";
import path from "node:path";

import { isWithin, realPathOf } from "./carrier-owner.js";
import type { CarrierMoment, CarrierResult } from "./carrier-types.js";
import { installCarriers } from "./carriers.js";
import { carriedPaths, carryFiles } from "./proof-copy-files.js";
import {
  copyCarrierGit,
  copyGit,
  gitSaid,
  sourceGit,
  type GitExit,
} from "./proof-copy-git.js";
import { BASE_COMMIT_MESSAGE } from "./proof-copy-wording.js";

/** The branch a push proof pushes to when the operator is on no branch. */
const DETACHED_PUSH_BRANCH = "lisa-proof";

/** Only the run's own user may look inside its temporary folder. */
const PRIVATE_FOLDER_MODE = 0o700;

/**
 * The copy's own git settings. An identity, because a commit needs one and
 * the machine's is not read; no signing, because there is no key; and no
 * housekeeping in the background, which could still be writing while the
 * folder is removed.
 */
const COPY_SETTINGS: readonly (readonly [string, string])[] = [
  ["user.name", "Lisa control proof"],
  ["user.email", "control-proof@lisa.invalid"],
  ["commit.gpgsign", "false"],
  ["gc.auto", "0"],
  ["maintenance.auto", "false"],
];

/** What was read from the operator's repository, without changing it. */
export interface ProofCopySource {
  /** The commit the operator is on. */
  readonly commit: string;
  /** The branch the operator is on; `null` on a detached `HEAD`. */
  readonly branch: string | null;
  /** Whether the working copy holds anything that is not committed. */
  readonly dirty: boolean;
}

/** A disposable copy, ready for proofs. */
export interface ProofCopy {
  /** The run's temporary folder, with every link resolved. */
  readonly folder: string;
  /** The working copy the changes are planted in. */
  readonly clone: string;
  /** The bare repository that stands in for the remote. */
  readonly remote: string;
  /** An empty folder: the hooks folder of commits that set the copy up. */
  readonly noHooks: string;
  /** The commit the copy is put back to after every half. */
  readonly base: string;
  /** The branch of the stand-in remote a push proof pushes to. */
  readonly pushBranch: string;
  readonly source: ProofCopySource;
  /** The files taken from the working copy that differ from the commit. */
  readonly carried: readonly string[];
  /**
   * Per moment, why git runs no carrier in the copy; `null` when it runs
   * one.
   */
  readonly unwired: Readonly<Record<CarrierMoment, string | null>>;
}

/** A copy, or the one-line reason there is none. */
export type ProofCopyBuild =
  | { readonly problem: null; readonly copy: ProofCopy }
  | { readonly problem: string };

/** What building a copy needs from outside, replaceable in a test. */
export interface ProofCopyDependencies {
  /** Installs the carriers in the copy. */
  readonly install?: typeof installCarriers;
}

/** One git command of the build, and what it is for. */
interface Step {
  /** What the command does, to follow the words "Could not". */
  readonly doing: string;
  readonly run: () => GitExit;
}

/** Where everything in the run's folder is. */
type Layout = Pick<
  ProofCopy,
  "folder" | "clone" | "remote" | "noHooks" | "pushBranch"
>;

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
      : `Could not ${step.doing}, so no proof was run: ${gitSaid(exit)}`;
  }, null);
}

/**
 * Read the commit and branch the operator is on, and whether anything is
 * uncommitted, without changing the repository.
 * @param root - Real path of the operator's repository
 * @returns What was read, or why the repository cannot be copied
 */
async function readSource(
  root: string
): Promise<
  | { readonly problem: null; readonly source: ProofCopySource }
  | { readonly problem: string }
> {
  const git = sourceGit(root);
  const top = git(["rev-parse", "--show-toplevel"]);
  if (top.code !== 0 || (await realpath(top.stdout)) !== root) {
    return {
      problem: `${root} is not the top folder of a git repository, so there is no commit or push to prove a check at. Give the top folder of the repository.`,
    };
  }
  const status = git([
    "status",
    "--porcelain=v2",
    "--branch",
    "--untracked-files=normal",
  ]);
  const lines = status.stdout.split("\n");
  const header = (name: string): string | undefined =>
    lines.find(line => line.startsWith(`# ${name} `))?.slice(name.length + 3);
  const commit = header("branch.oid");
  const head = header("branch.head");
  if (status.code !== 0 || commit === undefined || head === undefined) {
    return {
      problem: `The state of this repository could not be read, so no proof was run: ${gitSaid(status)}`,
    };
  }
  if (commit === "(initial)") {
    return {
      problem:
        "This repository has no commit yet, so there is nothing a commit or push check could be proved against. Make a first commit, then run this again.",
    };
  }
  return {
    problem: null,
    source: {
      branch: head === "(detached)" ? null : head,
      commit,
      dirty: lines.some(line => line !== "" && !line.startsWith("# ")),
    },
  };
}

/**
 * The commands that make the stand-in remote and the working copy.
 * @param root - Real path of the operator's repository
 * @param layout - Where everything in the run's folder is
 * @param source - The commit and branch to check out
 * @returns The commands, in order
 */
function cloneSteps(
  root: string,
  layout: Layout,
  source: ProofCopySource
): readonly Step[] {
  const { folder, clone, remote } = layout;
  const inFolder = copyGit(folder);
  const inRemote = copyGit(remote);
  const inClone = copyGit(clone);
  return [
    {
      doing: "copy this repository into a temporary folder",
      run: () =>
        inFolder(["clone", "--quiet", "--bare", "--local", "--", root, remote]),
    },
    {
      // The bare copy would otherwise remember where it was cloned from.
      doing: "cut the temporary copy off from this repository",
      run: () => inRemote(["remote", "remove", "origin"]),
    },
    {
      doing: "set up the stand-in remote",
      run: () => inRemote(["config", "gc.auto", "0"]),
    },
    {
      doing: "make the working copy the proofs run in",
      run: () =>
        inFolder([
          "clone",
          "--quiet",
          "--local",
          "--no-checkout",
          "--",
          remote,
          clone,
        ]),
    },
    {
      doing: `check out commit ${source.commit} in the temporary copy`,
      run: () =>
        inClone(
          source.branch === null
            ? ["checkout", "--quiet", "--detach", source.commit]
            : ["checkout", "--quiet", "-B", source.branch, source.commit]
        ),
    },
    ...COPY_SETTINGS.map(([name, value]) => ({
      doing: `set ${name} in the temporary copy`,
      run: () => inClone(["config", "--local", name, value]),
    })),
  ];
}

/**
 * Commit whatever the copy holds beyond the operator's commit, and put the
 * result in the stand-in remote, so every half starts from one clean commit.
 *
 * Everything is added, ignored files too: the copy holds nothing but the
 * commit, the files taken from the working copy and the carriers, and a file
 * left untracked would be swept away when the copy is reset.
 * @param layout - Where everything in the run's folder is
 * @returns The commit the copy is reset to, or why there is none
 */
function baseCommit(
  layout: Layout
):
  | { readonly problem: null; readonly base: string }
  | { readonly problem: string } {
  const inClone = copyGit(layout.clone);
  const unhooked = ["-c", `core.hooksPath=${layout.noHooks}`];
  const problem = firstFailure([
    {
      doing: "stage the temporary copy's files",
      run: () => inClone(["add", "--all", "--force"]),
    },
    {
      doing: "commit the temporary copy's files",
      run: () => {
        // Exit 1 says something is staged. Exit 0 says nothing is, and the
        // copy is already exactly the operator's commit.
        const changed = inClone(["diff", "--cached", "--quiet"]);
        return changed.code === 1
          ? inClone([
              ...unhooked,
              "commit",
              "--quiet",
              "-m",
              BASE_COMMIT_MESSAGE,
            ])
          : changed;
      },
    },
    {
      doing: "put the temporary copy's commit in the stand-in remote",
      run: () =>
        inClone([
          ...unhooked,
          "push",
          "--quiet",
          "--force",
          "origin",
          `HEAD:refs/heads/${layout.pushBranch}`,
        ]),
    },
  ]);
  if (problem !== null) return { problem };
  const head = inClone(["rev-parse", "HEAD"]);
  return head.code === 0
    ? { problem: null, base: head.stdout }
    : {
        problem: `Could not read the temporary copy's commit, so no proof was run: ${gitSaid(head)}`,
      };
}

/**
 * Say, per moment, why git runs no carrier in the copy.
 * @param result - What installing the carriers there reported
 * @returns The installer's reason for each moment, or `null` where git runs
 *   one
 */
function unwiredMoments(
  result: CarrierResult
): Readonly<Record<CarrierMoment, string | null>> {
  const reasonAt = (moment: CarrierMoment): string | null => {
    const point = result.enforcement_points.find(
      candidate => candidate.moment === moment
    );
    if (point === undefined) return "the installer reported nothing for it";
    return point.outcome === "blocked" ? (point.reason ?? result.reason) : null;
  };
  return { commit: reasonAt("commit"), push: reasonAt("push") };
}

/**
 * Build the disposable copy of a repository in a folder that does not exist
 * yet.
 * @param root - Real path of the operator's repository
 * @param folder - The folder to create; the caller removes it on every way
 *   out
 * @param dependencies - Replaceable collaborators
 * @returns The copy, or why no proof can be run
 */
export async function buildProofCopy(
  root: string,
  folder: string,
  dependencies: ProofCopyDependencies = {}
): Promise<ProofCopyBuild> {
  const read = await readSource(root);
  if (read.problem !== null) return read;
  const paths = await carriedPaths(root);
  if (paths.problem !== null) return paths;
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
  const layout: Layout = {
    clone: path.join(home, "clone"),
    folder: home,
    noHooks: path.join(home, "no-hooks"),
    pushBranch: read.source.branch ?? DETACHED_PUSH_BRANCH,
    remote: path.join(home, "remote.git"),
  };
  await mkdir(layout.noHooks);
  const cloned = firstFailure(cloneSteps(root, layout, read.source));
  if (cloned !== null) return { problem: cloned };
  const carried = await carryFiles(root, layout.clone, paths.paths);
  if (carried.problem !== null) return carried;
  const installed = await (dependencies.install ?? installCarriers)(
    layout.clone,
    {},
    { git: copyCarrierGit() }
  );
  if (installed.problems !== null) {
    return {
      problem: `The commit and push carriers could not be installed in the temporary copy, so no proof was run: ${installed.problems.join(" ")}`,
    };
  }
  const based = baseCommit(layout);
  if (based.problem !== null) return based;
  return {
    problem: null,
    copy: {
      ...layout,
      base: based.base,
      carried: carried.carried,
      source: read.source,
      unwired: unwiredMoments(installed.result),
    },
  };
}
