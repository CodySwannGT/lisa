/**
 * Settling the pull-request moment of a proof run in-process, against a
 * fixture repository and a platform that lives in memory
 * (CodySwannGT/lisa#4997).
 *
 * `lisa controls attest` reads a hosting platform's settings and, when asked,
 * opens pull requests there, so no suite may ever reach a real one. Every
 * case hands the code under test a request function that answers from
 * memory, and a remote address that is only ever read as text.
 * @module tests/unit/controls/support/pull-request-run
 */
import type { ProofEntryResult } from "../../../../src/controls/proof-types.js";
import type { GhRunner } from "../../../../src/controls/protect-modules.js";
import {
  settlePullRequests,
  type PullRequestDependencies,
  type PullRequestInputs,
} from "../../../../src/controls/pull-request-settle.js";
import {
  pullRequestSettlementOf,
  type PullRequestPoint,
  type PullRequestSettlement,
} from "../../../../src/controls/pull-request-types.js";
import { generateControlRegister } from "../../../../src/controls/register.js";
import {
  checks,
  F_NONE_SOURCE,
  proofFiles,
  proofPatches,
  provedGates,
  type ProofFiles,
} from "../../../helpers/control-proofs.js";
import type { GatesBlock } from "../../../helpers/control-register.js";
import { prove, setting, steppingClock } from "./proof-run.js";
import { GITHUB_REMOTE } from "./protect-fixture.js";

/** The gate the cases enforce on pull requests and nowhere else. */
export const PULL_ONLY_GATE = "code-style";

/** The entry that gate gives. */
export const PULL_ONLY_ENTRY = "code-style@.";

/** The check that gate reports on a pull request. */
export const PULL_ONLY_CHECK = "🔍 Quality Checks / 🧹 Lint";

/** The gate the cases enforce at push and on pull requests. */
export const BOTH_GATE = "test-correctness";

/** The entry that gate gives. */
export const BOTH_ENTRY = "test-correctness@.";

/** The check that gate reports on a pull request. */
export const BOTH_CHECK = "🔍 Quality Checks / 🧪 Run Unit Tests";

/** A check that works: it rejects the planted violation and nothing else. */
export const WORKING = checks(F_NONE_SOURCE);

/** One gate enforced on pull requests only, with a working proof. */
export const PULL_ONLY_GATES: GatesBlock = provedGates(
  [{ command: WORKING }],
  PULL_ONLY_GATE,
  ["pull-request"]
);

/** One gate enforced at push and on pull requests, with a working proof. */
export const BOTH_GATES: GatesBlock = provedGates(
  [{ command: WORKING }],
  BOTH_GATE,
  ["push", "pull-request"]
);

/** The proof files every case commits, and a workflow that can report a check. */
export const REPOSITORY_FILES: ProofFiles = {
  ...proofFiles(proofPatches("F-none", F_NONE_SOURCE)),
  ".github/workflows/quality.yml": "name: quality\non: pull_request\n",
};

/** A proof run with its pull-request moment settled. */
export interface Settled {
  readonly entries: readonly ProofEntryResult[];
  readonly passed: boolean;
  /** What was recorded about pull requests; `null` when nothing was. */
  readonly pullRequest: PullRequestSettlement | null;
  /** The repository the run was made in. */
  readonly repoPath: string;
}

/** How a case differs from a GitHub repository with the default options. */
export interface SettleOptions {
  readonly inputs?: Partial<Omit<PullRequestInputs, "root" | "register">>;
  readonly dependencies?: PullRequestDependencies;
  /** The `origin` address; a github.com one by default, `null` for none. */
  readonly remote?: string | null;
  /** The files committed in the repository. */
  readonly files?: ProofFiles;
}

/**
 * Run a declaration's commit and push proofs for real, then settle its
 * pull-request moment against a request function.
 * @param gates - The gates block
 * @param gh - The request function standing in for the platform
 * @param options - How the case differs from the default
 * @returns The settled run
 */
export async function settle(
  gates: GatesBlock,
  gh: GhRunner,
  options: SettleOptions = {}
): Promise<Settled> {
  const where = setting(gates, { files: options.files ?? REPOSITORY_FILES });
  const generated = await generateControlRegister(where.repoPath);
  if (generated.problems !== null) {
    throw new Error(generated.problems.join("\n"));
  }
  const remote = options.remote === undefined ? GITHUB_REMOTE : options.remote;
  const run = await settlePullRequests(
    await prove(where),
    {
      root: where.repoPath,
      register: generated.register,
      clock: steppingClock("2026-02-01T00:00:00.000Z"),
      ...options.inputs,
    },
    {
      gh,
      readRemoteUrl: () => Promise.resolve(remote),
      ...options.dependencies,
    }
  );
  return {
    entries: run.entries,
    passed: run.passed,
    pullRequest: pullRequestSettlementOf(run),
    repoPath: where.repoPath,
  };
}

/**
 * The point of one entry in a settled run.
 * @param settled - The settled run
 * @param entryId - The register entry's identifier
 * @returns The entry's pull-request point
 */
export function pointOf(settled: Settled, entryId: string): PullRequestPoint {
  const point = settled.pullRequest?.points.find(
    candidate => candidate.entry_id === entryId
  );
  if (point === undefined) throw new Error(`no point for ${entryId}`);
  return point;
}

/**
 * The result of one entry in a settled run.
 * @param settled - The settled run
 * @param entryId - The register entry's identifier
 * @returns The entry's one result
 */
export function entryOf(settled: Settled, entryId: string): ProofEntryResult {
  const entry = settled.entries.find(
    candidate => candidate.entry_id === entryId
  );
  if (entry === undefined) throw new Error(`no entry ${entryId}`);
  return entry;
}
