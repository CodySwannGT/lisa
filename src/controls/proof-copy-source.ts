/** Read the immutable Git baseline for a disposable proof copy. */
import { realpath } from "node:fs/promises";

import { gitSaid, sourceGit } from "./proof-copy-git.js";

/** What was read from the operator's repository, without changing it. */
export interface ProofCopySource {
  /** The commit the operator is on. */
  readonly commit: string;
  /** Traceability and attribution trailers from that committed baseline. */
  readonly commitTrailers?: string;
  /** The branch the operator is on; `null` on a detached `HEAD`. */
  readonly branch: string | null;
  /** Whether the working copy holds anything that is not committed. */
  readonly dirty: boolean;
}

/**
 * Read the commit and branch the operator is on, and whether anything is
 * uncommitted, without changing the repository.
 * @param root - Real path of the operator's repository
 * @returns What was read, or why the repository cannot be copied
 */
export async function readProofCopySource(
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
  const trailers = git([
    "show",
    "--no-patch",
    "--format=%(trailers:key=Work-Item,key=Co-authored-by,key=AI-Agent,key=AI-Model,key=AI-Effort,only,unfold)",
    commit,
  ]);
  if (trailers.code !== 0) {
    return {
      problem: `The baseline commit's trailers could not be read, so no proof was run: ${gitSaid(trailers)}`,
    };
  }
  return {
    problem: null,
    source: {
      branch: head === "(detached)" ? null : head,
      commit,
      ...(trailers.stdout.trim() === ""
        ? {}
        : { commitTrailers: trailers.stdout.trim() }),
      dirty: lines.some(line => line !== "" && !line.startsWith("# ")),
    },
  };
}
