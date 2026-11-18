/**
 * Asking the hosting platform whether a canary pull request could be merged,
 * and reading the answer as one half of a proof.
 *
 * Nothing here merges anything, or could. The platform is only asked what it
 * would do: the pull request's own `mergeable` and `mergeable_state`, and
 * what each of the entry's checks concluded on the canary commit. Both are
 * reads.
 *
 * ## Why the checks are read as well as the platform's one word
 *
 * The platform's word for a pull request is about everything at once. A
 * draft is always `draft`. A repository that requires a review holds every
 * pull request at `blocked`, whatever its checks did. Neither says whether
 * the entry's own check stopped the change, and a proof has to say exactly
 * that: a canary stopped by something else proves nothing about the entry.
 * So a half is decided by the entry's own required checks, and the
 * platform's word is used for the one thing only it knows — that it would
 * let the pull request through regardless.
 *
 * | what the platform showed | the half |
 * | --- | --- |
 * | one of the entry's required checks failed | `rejected` |
 * | … but the platform says the pull request can be merged anyway | `accepted` |
 * | every one of the entry's checks passed | `accepted` |
 * | a check never reported before the time limit | `unknown` (`timed-out`) |
 * | a check was cancelled | `unknown` (`killed`) |
 * | a check was skipped or reported nothing either way | `unknown` (`nothing-measured`) |
 *
 * The wait is bounded. The clock and the pause between two looks are handed
 * in, so a test waits no real time and a run never waits past its limit.
 * @module controls/canary-eligibility
 */
import { fieldOf, textOf, type CanaryDoor } from "./canary-door.js";
import type { HalfObservation } from "./proof-judgement.js";
import type { MergeEligibility } from "./pull-request-types.js";
import { conclusionsText } from "./pull-request-wording.js";

/** How a wait is bounded. */
export interface EligibilityWait {
  readonly clock: () => Date;
  /** Pause for some milliseconds. */
  readonly sleep: (milliseconds: number) => Promise<void>;
  /** How long to wait for the answer, in milliseconds. */
  readonly timeoutMs: number;
  /** How long to pause between two looks, in milliseconds. */
  readonly pollMs: number;
}

/** What a wait ended with. */
export interface EligibilityAnswer {
  /** The last thing the platform showed, or `null` when it showed nothing. */
  readonly eligibility: MergeEligibility | null;
  /** Whether the time limit ran out before the checks concluded. */
  readonly timedOut: boolean;
  /** Why the last look failed, when it did. */
  readonly problem: string | null;
}

/** The largest page the platform returns. */
const PAGE_SIZE = 100;

/** The most pages of check runs that are read for one commit. */
const PAGE_LIMIT = 10;

/** Conclusions that say the check found something wrong. */
const FAILING: ReadonlySet<string> = new Set([
  "failure",
  "error",
  "timed_out",
  "action_required",
  "startup_failure",
]);

/** The platform's words for a pull request it would let through. */
const WOULD_MERGE: ReadonlySet<string> = new Set([
  "clean",
  "unstable",
  "has_hooks",
]);

/**
 * Read the check runs of a commit, every page.
 * @param door - The canary door
 * @param sha - The commit
 * @param page - The page to read, from 1
 * @returns Each completed run's name and conclusion, newest last
 */
function checkRuns(
  door: CanaryDoor,
  sha: string,
  page = 1
): readonly (readonly [string, string | null])[] {
  const read = door.get(
    `commits/${sha}/check-runs?per_page=${String(PAGE_SIZE)}&page=${String(page)}`
  );
  const runs = read.ok ? fieldOf(read.value, "check_runs") : undefined;
  const items: readonly unknown[] = Array.isArray(runs) ? runs : [];
  const here = [...items]
    .sort(
      (left, right) =>
        Number(fieldOf(left, "id") ?? 0) - Number(fieldOf(right, "id") ?? 0)
    )
    .map((run): readonly [string, string | null] => [
      textOf(run, "name"),
      textOf(run, "status") === "completed"
        ? textOf(run, "conclusion") || null
        : null,
    ]);
  return items.length < PAGE_SIZE || page >= PAGE_LIMIT
    ? here
    : [...here, ...checkRuns(door, sha, page + 1)];
}

/**
 * Read the commit statuses of a commit.
 * @param door - The canary door
 * @param sha - The commit
 * @returns Each status's name and what it says
 */
function commitStatuses(
  door: CanaryDoor,
  sha: string
): readonly (readonly [string, string | null])[] {
  const read = door.get(`commits/${sha}/status?per_page=${String(PAGE_SIZE)}`);
  const statuses = read.ok ? fieldOf(read.value, "statuses") : undefined;
  return (Array.isArray(statuses) ? statuses : []).map(
    (status: unknown): readonly [string, string | null] => {
      const state = textOf(status, "state");
      return [
        textOf(status, "context"),
        state === "pending" || state === "" ? null : state,
      ];
    }
  );
}

/**
 * Tell whether what was read is enough to decide the half.
 * @param eligibility - What the platform showed
 * @returns Whether a check failed, or every check concluded
 */
function isSettled(eligibility: MergeEligibility): boolean {
  return (
    eligibility.checks.some(check => FAILING.has(check.conclusion ?? "")) ||
    eligibility.checks.every(check => check.conclusion !== null)
  );
}

/**
 * Look once at a canary pull request and its checks.
 * @param door - The canary door
 * @param pullRequest - The pull request's number
 * @param sha - The canary commit
 * @param contexts - The entry's checks
 * @returns What the platform showed, or why it could not be read
 */
export function readEligibility(
  door: CanaryDoor,
  pullRequest: number,
  sha: string,
  contexts: readonly string[]
):
  | { readonly ok: true; readonly eligibility: MergeEligibility }
  | { readonly ok: false; readonly problem: string } {
  const pull = door.get(`pulls/${String(pullRequest)}`);
  if (!pull.ok) return { ok: false, problem: pull.reason };
  const runs = new Map(checkRuns(door, sha));
  // A check may report as a commit status instead of a check run.
  const concluded = (context: string): boolean =>
    (runs.get(context) ?? null) !== null;
  const statuses = contexts.every(concluded)
    ? new Map<string, string | null>()
    : new Map(commitStatuses(door, sha));
  const mergeable = fieldOf(pull.value, "mergeable");
  return {
    ok: true,
    eligibility: {
      mergeable: typeof mergeable === "boolean" ? mergeable : null,
      mergeable_state: textOf(pull.value, "mergeable_state") || null,
      checks: contexts.map(context => ({
        context,
        conclusion: runs.get(context) ?? statuses.get(context) ?? null,
      })),
    },
  };
}

/**
 * Wait, no longer than the time limit, for the platform's answer about a
 * canary.
 * @param look - Looks once
 * @param wait - The clock, the pause and the limits
 * @param deadline - When to stop, as the clock counts; set on the first call
 * @returns The last thing the platform showed
 */
export async function awaitEligibility(
  look: () => ReturnType<typeof readEligibility>,
  wait: EligibilityWait,
  deadline = wait.clock().getTime() + wait.timeoutMs
): Promise<EligibilityAnswer> {
  const seen = look();
  if (seen.ok && isSettled(seen.eligibility)) {
    return { eligibility: seen.eligibility, timedOut: false, problem: null };
  }
  if (wait.clock().getTime() >= deadline) {
    return {
      eligibility: seen.ok ? seen.eligibility : null,
      timedOut: true,
      problem: seen.ok ? null : seen.problem,
    };
  }
  await wait.sleep(wait.pollMs);
  return awaitEligibility(look, wait, deadline);
}

/**
 * Read the platform's answer as one half of a proof.
 * @param answer - What the wait ended with
 * @param limitSeconds - How long the half was allowed
 * @returns What the half showed, and a sentence saying so
 */
export function judgeEligibility(
  answer: EligibilityAnswer,
  limitSeconds: number
): HalfObservation & { readonly detail: string } {
  const { eligibility } = answer;
  const limit = `${String(limitSeconds)} seconds, the time one half of this proof is allowed`;
  if (eligibility === null) {
    return {
      outcome: "unknown",
      reason: "timed-out",
      detail:
        `The hosting platform gave no answer about the canary pull request within ${limit}. ${answer.problem ?? ""}`.trim(),
    };
  }
  const said = conclusionsText(eligibility.checks);
  const failed = eligibility.checks.filter(check =>
    FAILING.has(check.conclusion ?? "")
  );
  if (failed.length > 0) {
    return WOULD_MERGE.has(eligibility.mergeable_state ?? "")
      ? {
          outcome: "accepted",
          reason: "accepted",
          detail: `The entry's check failed on the canary (${said}), but the hosting platform reports the pull request as ${JSON.stringify(eligibility.mergeable_state)}: it would let this change through anyway.`,
        }
      : {
          outcome: "rejected",
          reason: "rejected-as-declared",
          detail: `The hosting platform would not let this change through: the required check failed on the canary (${said}).`,
        };
  }
  if (eligibility.checks.every(check => check.conclusion === "success")) {
    return {
      outcome: "accepted",
      reason: "accepted",
      detail: `The entry's required check passed on the canary (${said}), so it does not stop this change.`,
    };
  }
  if (eligibility.checks.some(check => check.conclusion === null)) {
    return {
      outcome: "unknown",
      reason: "timed-out",
      detail: `The entry's check had not reported on the canary after ${limit} (${said}), so the canary was closed without an answer.`,
    };
  }
  return eligibility.checks.some(check => check.conclusion === "cancelled")
    ? {
        outcome: "unknown",
        reason: "killed",
        detail: `The entry's check was cancelled on the canary before it answered (${said}).`,
      }
    : {
        outcome: "unknown",
        reason: "nothing-measured",
        detail: `The entry's check neither passed nor failed on the canary (${said}), so it measured nothing.`,
      };
}
