/**
 * Reading the commit a repository is at.
 *
 * Every evidence record names the commit the repository was at when the
 * record was made, so a reader can go back to exactly what was checked. A
 * folder that is not a git repository, a repository with no commit yet, and
 * a machine without git all have no such commit, and none of them is a
 * reason to stop: the record then says `null`.
 *
 * Git is started the way a proof's patch is applied (`./proof-patch.ts`):
 * in the folder it is given, told not to look above it for a repository,
 * and without the machine's own git settings.
 * @module controls/head-commit
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { isolatedGit } from "./proof-patch.js";

const run = promisify(execFile);

/** How long reading the commit may take, in milliseconds. */
const GIT_TIMEOUT_MS = 10_000;

/** A full commit hash, in either of git's two lengths. */
const COMMIT_HASH = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;

/**
 * Read the commit a repository's HEAD is at.
 * @param root - Real path of the repository
 * @returns The full commit hash, or `null` when there is none to read
 */
export async function readHeadCommit(root: string): Promise<string | null> {
  const [program, ...git] = isolatedGit(root);
  if (program === undefined) return null;
  try {
    const { stdout } = await run(
      program,
      [...git, "rev-parse", "--verify", "--quiet", "HEAD^{commit}"],
      { cwd: root, encoding: "utf8", timeout: GIT_TIMEOUT_MS }
    );
    const hash = stdout.trim();
    return COMMIT_HASH.test(hash) ? hash : null;
  } catch {
    return null;
  }
}
