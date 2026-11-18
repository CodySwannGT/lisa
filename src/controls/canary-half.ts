/**
 * One half of a pull-request proof, run as a canary: make a branch that
 * carries one patch, open a pull request from it, ask the hosting platform
 * whether it could be merged, write the answer down, and remove both.
 *
 * The order is fixed:
 *
 * 1. The canary commit is made (`./canary-tree.ts`). Until a branch points
 *    at it, nothing on the platform shows it.
 * 2. The branch is tracked for removal, and only then created.
 * 3. The pull request is opened as a draft. Where the platform does not
 *    offer drafts for the repository, it is opened as an ordinary pull
 *    request instead, and the record says so.
 * 4. The platform's answer is waited for, no longer than the half's time
 *    limit (`./canary-eligibility.ts`).
 * 5. The pull request is closed and the branch deleted, whether the answer
 *    came, the wait ran out, or something threw.
 *
 * No step accepts the pull request into its base branch, and the door the
 * requests go through has no rule that would let one (`./canary-door.ts`).
 * @module controls/canary-half
 */
import { fieldOf, type CanaryDoor } from "./canary-door.js";
import {
  awaitEligibility,
  judgeEligibility,
  readEligibility,
  type EligibilityAnswer,
} from "./canary-eligibility.js";
import type { CanaryKeeper, Removal } from "./canary-lifecycle.js";
import {
  canaryBody,
  canaryBranch,
  canaryTitle,
  type CanaryFacts,
} from "./canary-names.js";
import { buildCanaryCommit, type CanaryBase } from "./canary-tree.js";
import type { HalfObservation } from "./proof-judgement.js";
import type { ProofHalf, ProofHalfResult } from "./proof-types.js";
import {
  PULL_REQUEST_POINT_MOMENT,
  type CanaryRecord,
} from "./pull-request-types.js";
import { conclusionsText } from "./pull-request-wording.js";

/** What every half of a run shares. */
export interface CanaryRunContext {
  readonly door: CanaryDoor;
  readonly keeper: CanaryKeeper;
  /** The commit canaries are built on, or why it could not be read. */
  readonly base: CanaryBase | { readonly problem: string };
  /** The protected branch a canary asks to be merged into. */
  readonly baseBranch: string;
  readonly runId: string;
  readonly clock: () => Date;
  readonly sleep: (milliseconds: number) => Promise<void>;
  /** How long to pause between two looks at a canary, in milliseconds. */
  readonly pollMs: number;
}

/** One half to run. */
export interface CanaryHalfRequest {
  readonly entryId: string;
  readonly half: ProofHalf;
  /** The patch file and its content. */
  readonly patch: { readonly file: string; readonly text: string };
  /** The entry's checks. */
  readonly contexts: readonly string[];
  readonly timeLimitSeconds: number;
  /** The canary's number among the run's canaries, from 1. */
  readonly sequence: number;
}

/** What opening a canary gave. */
type Opened =
  | {
      readonly ok: true;
      readonly sha: string;
      readonly pullRequest: number;
      readonly draft: boolean;
    }
  | {
      readonly ok: false;
      readonly reason: "patch-not-applied" | "not-started";
      readonly problem: string;
      readonly sha: string | null;
    };

/** The removal of a canary that was never created. */
const NEVER_CREATED = { closed: true, branchRemoved: true, problem: null };

/**
 * Open a pull request from a canary branch, as a draft where that is offered.
 * @param door - The canary door
 * @param fields - The pull request's title, description, head and base
 * @returns Its number and whether it is a draft, or why it was not opened
 */
function openPullRequest(
  door: CanaryDoor,
  fields: Readonly<Record<string, unknown>>
):
  | { readonly number: number; readonly draft: boolean }
  | { readonly problem: string } {
  const asDraft = door.send("POST", "pulls", { ...fields, draft: true });
  const drafted = asDraft.ok ? fieldOf(asDraft.value, "number") : undefined;
  if (typeof drafted === "number") return { number: drafted, draft: true };
  if (asDraft.ok) return { problem: "The platform did not number it." };
  // Some repositories are not offered drafts; the platform says so.
  if (!/draft/iu.test(asDraft.reason)) return { problem: asDraft.reason };
  const plain = door.send("POST", "pulls", fields);
  const number = plain.ok ? fieldOf(plain.value, "number") : undefined;
  return typeof number === "number"
    ? { number, draft: false }
    : { problem: plain.ok ? "The platform did not number it." : plain.reason };
}

/**
 * Create a canary: its commit, its branch and its pull request.
 * @param request - The half
 * @param context - What the run shares
 * @param branch - The canary's branch name
 * @param facts - What the canary says about itself
 * @returns What was created, or why it was not
 */
function openCanary(
  request: CanaryHalfRequest,
  context: CanaryRunContext,
  branch: string,
  facts: CanaryFacts
): Opened {
  const { door, keeper, base } = context;
  if ("problem" in base) return notStarted(base.problem, null);
  const commit = buildCanaryCommit(
    door,
    base,
    request.patch.text,
    `${canaryTitle(facts)}\n\n${canaryBody(facts)}`
  );
  if (!commit.ok) return { ...commit, sha: null };
  // Tracked first, so nothing can exist that is not known to be removed.
  keeper.track(branch);
  return publishCanary(context, branch, facts, commit.sha);
}

/**
 * Say that a canary was not opened because of the platform.
 * @param problem - Why
 * @param sha - The canary commit, when one was made
 * @returns What opening gave
 */
function notStarted(problem: string, sha: string | null): Opened {
  return { ok: false, reason: "not-started", problem, sha };
}

/**
 * Create a tracked canary's branch and open its pull request.
 * @param context - What the run shares
 * @param branch - The canary's branch name, already tracked for removal
 * @param facts - What the canary says about itself
 * @param sha - The canary commit
 * @returns What was created, or why it was not
 */
function publishCanary(
  context: CanaryRunContext,
  branch: string,
  facts: CanaryFacts,
  sha: string
): Opened {
  const { door, keeper } = context;
  const ref = door.send("POST", "git/refs", {
    ref: `refs/heads/${branch}`,
    sha,
  });
  if (!ref.ok) {
    return notStarted(
      `The canary branch could not be created: ${ref.reason}`,
      sha
    );
  }
  const pull = openPullRequest(door, {
    title: canaryTitle(facts),
    body: canaryBody(facts),
    head: branch,
    base: context.baseBranch,
    maintainer_can_modify: false,
  });
  if ("problem" in pull) {
    return notStarted(
      `The canary pull request could not be opened: ${pull.problem}`,
      sha
    );
  }
  keeper.opened(branch, pull.number);
  return { ok: true, sha, pullRequest: pull.number, draft: pull.draft };
}

/**
 * Say what a half showed, from what opening and waiting gave.
 * @param opened - What opening the canary gave
 * @param answer - What the wait ended with, when there was one
 * @param limitSeconds - How long the half was allowed
 * @returns The half's outcome, reason and sentence
 */
function observation(
  opened: Opened,
  answer: EligibilityAnswer | null,
  limitSeconds: number
): HalfObservation & { readonly detail: string } {
  if (!opened.ok) {
    return {
      outcome: "unknown",
      reason: opened.reason,
      detail:
        opened.reason === "patch-not-applied"
          ? `The change could not be put on a canary branch, so no pull request was opened. ${opened.problem}`
          : `No canary pull request was opened, so nothing was checked. ${opened.problem}`,
    };
  }
  return judgeEligibility(
    answer ?? { eligibility: null, timedOut: true, problem: null },
    limitSeconds
  );
}

/**
 * Write one half down the way a commit or push half is written.
 *
 * There is no command and no exit status: what answered is the hosting
 * platform, and `output_excerpt` holds what it said.
 * @param request - The half
 * @param opened - What opening the canary gave
 * @param answer - What the wait ended with, when there was one
 * @param branch - The canary's branch name
 * @param times - When the half began and when its answer was in
 * @param times.started_at - When it began, in UTC
 * @param times.completed_at - When its answer was in, in UTC
 * @returns The half's result
 */
function halfResult(
  request: CanaryHalfRequest,
  opened: Opened,
  answer: EligibilityAnswer | null,
  branch: string,
  times: { readonly started_at: string; readonly completed_at: string }
): ProofHalfResult {
  const shown = observation(opened, answer, request.timeLimitSeconds);
  const eligibility = answer?.eligibility ?? null;
  const conclusions = conclusionsText(eligibility?.checks ?? []);
  const draft = opened.ok && opened.draft ? " (draft)" : "";
  return {
    entry_id: request.entryId,
    half: request.half,
    moment: PULL_REQUEST_POINT_MOMENT,
    patch: request.patch.file,
    command: null,
    exit_status: null,
    ...times,
    output_excerpt: opened.ok
      ? `pull request #${String(opened.pullRequest)}${draft} from ${branch}: mergeable=${String(eligibility?.mergeable ?? null)}, mergeable_state=${String(eligibility?.mergeable_state ?? null)}; ${conclusions}`
      : opened.problem,
    output_truncated: false,
    matched_lines: shown.outcome === "rejected" ? [conclusions] : [],
    ...shown,
  };
}

/**
 * Run one half of a pull-request proof as a canary, and remove the canary.
 * @param request - The half
 * @param context - What the run shares
 * @returns The half's result and the record of its canary
 */
export async function runCanaryHalf(
  request: CanaryHalfRequest,
  context: CanaryRunContext
): Promise<{
  readonly half: ProofHalfResult;
  readonly canary: CanaryRecord;
}> {
  const { door, keeper, clock } = context;
  const started = clock();
  const facts: CanaryFacts = {
    runId: context.runId,
    createdAt: started,
    entryId: request.entryId,
    half: request.half,
  };
  const branch = canaryBranch({ ...facts, sequence: request.sequence });
  const remove = (): Omit<Removal, "branch"> =>
    keeper.open().includes(branch) ? keeper.remove(branch) : NEVER_CREATED;
  const work = async (): Promise<{
    readonly opened: Opened;
    readonly answer: EligibilityAnswer | null;
  }> => {
    const opened = openCanary(request, context, branch, facts);
    if (!opened.ok) return { opened, answer: null };
    const answer = await awaitEligibility(
      () =>
        readEligibility(door, opened.pullRequest, opened.sha, request.contexts),
      {
        clock,
        sleep: context.sleep,
        timeoutMs: request.timeLimitSeconds * 1000,
        pollMs: context.pollMs,
      }
    );
    return { opened, answer };
  };
  const { opened, answer } = await work().catch((error: unknown) => {
    remove();
    throw error;
  });
  const removal = remove();
  const eligibility = answer?.eligibility ?? null;
  const times = {
    started_at: started.toISOString(),
    completed_at: clock().toISOString(),
  };
  return {
    half: halfResult(request, opened, answer, branch, times),
    canary: {
      entry_id: request.entryId,
      half: request.half,
      branch,
      pull_request: opened.ok ? opened.pullRequest : null,
      draft: opened.ok ? opened.draft : null,
      head_sha: opened.sha,
      created_at: times.started_at,
      eligibility,
      closed: removal.closed,
      branch_removed: removal.branchRemoved,
      cleanup_problem: removal.problem,
    },
  };
}
