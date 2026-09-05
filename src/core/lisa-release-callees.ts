/**
 * Resolving which of Lisa's reusable workflows actually EXIST at the commit a
 * host project's callers are about to be pinned at.
 *
 * ## Why the pinner has to ask
 *
 * `ensure-pinned-reusable-workflow-refs` rewrites every caller it finds to the
 * installed version's release commit. That is correct exactly as long as the
 * release is a superset of what the consumer references, and a reusable
 * workflow that exists only on `main` — added after the latest release — breaks
 * the assumption. A project that adopted one gets its caller rewritten to a
 * commit the file is not in.
 *
 * ## Why that is worse than a wrong pin, not milder
 *
 * Actions resolves a job's `uses:` before it creates the job. A ref that does
 * not resolve is a LOAD error: zero jobs run, so zero jobs fail, the failure
 * names no workflow, and nothing in the consumer's own diff explains it. A
 * wrong-but-resolvable pin at least runs something and reports what it did.
 *
 * ## Where the answer comes from, and why there are two sources
 *
 * A published package carries the inventory as a stamp, because `.github/` is
 * not in the npm files allowlist and therefore does not travel with the
 * package. That is the case this exists for: a consumer's `node_modules` copy
 * of Lisa is not a git repository and cannot be asked anything else without a
 * network call at apply time, which this subsystem does not make.
 *
 * A Lisa source checkout carries no stamp — its release tag does not exist yet
 * — but it does carry the history, so the same question is answered by reading
 * the tree at the pinned commit directly.
 *
 * ## Why "unknown" is a third answer and not "empty"
 *
 * Neither source can answer for a package published before the stamp existed,
 * in a tree without history. Unknown means "pin as before": the defect this
 * module closes is rare and self-heals on the next release, while treating an
 * unrecorded fact as an empty inventory would stop pinning ANY caller in every
 * such project — trading a narrow silent break for a total one.
 * @module core/lisa-release-callees
 */
import { execFile } from "node:child_process";
import * as path from "node:path";
import { promisify } from "node:util";

import { getPackageReleaseWorkflows } from "../cli/version.js";
import type { ReleaseCallees, ReleasePin } from "./reusable-workflow-pin.js";

const execFileAsync = promisify(execFile);

/** Where Lisa's reusable workflows live inside its own repository. */
const WORKFLOW_DIR = ".github/workflows";

/** The file extensions GitHub Actions recognizes for a workflow. */
const WORKFLOW_FILE = /\.ya?ml$/u;

/** Everything the resolver reads, injectable so tests need no git or package. */
export interface ReleaseCalleeDependencies {
  /** `lisaReleaseWorkflows` stamped at publish, or null in an unstamped tree. */
  readonly readStampedWorkflows: () => readonly string[] | null;
  /** Names under `.github/workflows` at one commit of the Lisa installation. */
  readonly listWorkflowsAtCommit: (
    lisaDir: string,
    sha: string
  ) => Promise<readonly string[] | null>;
}

/**
 * List `.github/workflows` at one commit using the git repository at `lisaDir`.
 *
 * Returns null for every failure and for an empty listing alike. An empty
 * result is not evidence that a release shipped no reusable workflows — it is
 * what a non-repository, a commit this clone does not have, and a moved
 * directory all look like — and the caller turns null into "pin as before"
 * rather than into "pin nothing".
 * @param lisaDir - Lisa installation directory
 * @param sha - Commit whose tree to read
 * @returns Workflow file names, or null when the tree cannot be read
 */
export async function listWorkflowsAtCommitFromGit(
  lisaDir: string,
  sha: string
): Promise<readonly string[] | null> {
  const listed = await execFileAsync(
    "git",
    ["-C", lisaDir, "ls-tree", "--name-only", sha, "--", `${WORKFLOW_DIR}/`],
    { encoding: "utf8" }
  ).catch(() => null);
  if (listed === null) return null;
  const names = listed.stdout
    .split("\n")
    .map(line => path.posix.basename(line.trim()))
    .filter(name => WORKFLOW_FILE.test(name));
  return names.length > 0 ? names : null;
}

/** The readers used when nobody injects their own. */
export const defaultReleaseCalleeDependencies: ReleaseCalleeDependencies = {
  readStampedWorkflows: getPackageReleaseWorkflows,
  listWorkflowsAtCommit: listWorkflowsAtCommitFromGit,
};

/**
 * The reusable workflows the pinned release carries, or null when unknown.
 *
 * The stamp is consulted first because it is the only source an installed
 * package has, and it was recorded from the tag checkout at publish time, so
 * it describes exactly the commit being pinned at. Local git is the fallback
 * for a Lisa checkout, where no stamp exists but the history does.
 * @param lisaDir - Lisa installation directory
 * @param pin - The identity every caller is being pinned at
 * @param deps - Injectable readers
 * @returns The callee inventory, or null when neither source can answer
 */
export async function resolveReleaseCallees(
  lisaDir: string,
  pin: ReleasePin,
  deps: ReleaseCalleeDependencies = defaultReleaseCalleeDependencies
): Promise<ReleaseCallees> {
  const stamped = toInventory(deps.readStampedWorkflows());
  if (stamped !== null) return stamped;

  return toInventory(await deps.listWorkflowsAtCommit(lisaDir, pin.sha));
}

/**
 * Normalize recorded names into the set the pinner matches a caller against.
 *
 * A caller names a bare file — `quality.yml` — so a stamp that recorded a path
 * still has to answer the same question. Basenames are taken rather than
 * refused for that reason.
 *
 * An empty result becomes null, not an empty set. Every way of recording
 * nothing — an absent stamp, a listing that failed, a directory that moved —
 * is the same fact: nobody said what this release carries. Answering "it
 * carries none" would unpin every caller in every project.
 * @param names - Recorded workflow names or paths, or null when unrecorded
 * @returns The set of workflow file names present, or null when unknown
 */
function toInventory(names: readonly string[] | null): ReleaseCallees {
  const workflows = (names ?? [])
    .map(name => path.posix.basename(name.trim()))
    .filter(name => WORKFLOW_FILE.test(name));
  return workflows.length > 0 ? new Set(workflows) : null;
}
