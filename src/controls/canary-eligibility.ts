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
 * ## Which result counts as the entry's check
 *
 * A required check is a name and, where the platform's settings say so, the
 * one app allowed to report it. A result under the right name from another
 * app does not satisfy the requirement, so it is not read as the entry's
 * check either: where the settings pin a check to an app, only that app's
 * check run counts. A commit status does not say which app wrote it, so for
 * a pinned check a commit status is never counted. A pinned check that only
 * ever reports as a commit status therefore ends `timed-out`, which is
 * `unknown` and never a pass.
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

/** One check an entry is proved by, as the platform requires it. */
export interface RequiredRun {
  /** The exact name the platform matches on. */
  readonly context: string;
  /** The apps the settings pin the check to; empty when any source counts. */
  readonly app_ids: readonly number[];
}

/** One check run of a commit. */
interface CheckRun {
  readonly id: number;
  readonly name: string;
  /** The app that reported it, or `null` when the platform did not say. */
  readonly app: number | null;
  /** What it concluded, or `null` while it has not finished. */
  readonly conclusion: string | null;
}

/**
 * Read the check runs of a commit, every page.
 * @param door - The canary door
 * @param sha - The commit
 * @param page - The page to read, from 1
 * @returns Every run, oldest first within a page
 */
function checkRuns(
  door: CanaryDoor,
  sha: string,
  page = 1
): readonly CheckRun[] {
  const read = door.get(
    `commits/${sha}/check-runs?per_page=${String(PAGE_SIZE)}&page=${String(page)}`
  );
  const runs = read.ok ? fieldOf(read.value, "check_runs") : undefined;
  const items: readonly unknown[] = Array.isArray(runs) ? runs : [];
  const here = items.map((run): CheckRun => {
    const app = fieldOf(run, "app", "id");
    return {
      id: Number(fieldOf(run, "id") ?? 0),
      name: textOf(run, "name"),
      app: typeof app === "number" ? app : null,
      conclusion:
        textOf(run, "status") === "completed"
          ? textOf(run, "conclusion") || null
          : null,
    };
  });
  return items.length < PAGE_SIZE || page >= PAGE_LIMIT
    ? here
    : [...here, ...checkRuns(door, sha, page + 1)];
}

/**
 * What the newest run under a name concluded.
 * @param runs - The commit's check runs
 * @param name - The check's name
 * @param app - The one app whose run counts, or `null` for any
 * @returns Its conclusion; `null` when there is none or it has not finished
 */
function newestConclusion(
  runs: readonly CheckRun[],
  name: string,
  app: number | null
): string | null {
  const newest = runs
    .filter(run => run.name === name && (app === null || run.app === app))
    .reduce<CheckRun | null>(
      (latest, run) => (latest === null || run.id >= latest.id ? run : latest),
      null
    );
  return newest?.conclusion ?? null;
}

/**
 * What one required check concluded on a commit.
 *
 * A check pinned to several apps is required from each of them, so it has
 * failed when any of them failed, and has passed only when all of them did.
 * @param check - The check, and the apps it is pinned to
 * @param runs - The commit's check runs
 * @param statuses - The commit's statuses by name; used only for a check
 *   that is pinned to no app
 * @returns The conclusion, or `null` while it has not fully reported
 */
function requiredConclusion(
  check: RequiredRun,
  runs: readonly CheckRun[],
  statuses: ReadonlyMap<string, string | null>
): string | null {
  if (check.app_ids.length === 0) {
    return (
      newestConclusion(runs, check.context, null) ??
      statuses.get(check.context) ??
      null
    );
  }
  const each = check.app_ids.map(app =>
    newestConclusion(runs, check.context, app)
  );
  const failing = each.find(conclusion => FAILING.has(conclusion ?? ""));
  if (failing !== undefined) return failing;
  if (each.includes(null)) return null;
  return each.find(conclusion => conclusion !== "success") ?? "success";
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
 * @param checks - The entry's checks, each with the apps it is pinned to
 * @returns What the platform showed, or why it could not be read
 */
export function readEligibility(
  door: CanaryDoor,
  pullRequest: number,
  sha: string,
  checks: readonly RequiredRun[]
):
  | { readonly ok: true; readonly eligibility: MergeEligibility }
  | { readonly ok: false; readonly problem: string } {
  const pull = door.get(`pulls/${String(pullRequest)}`);
  if (!pull.ok) return { ok: false, problem: pull.reason };
  const runs = checkRuns(door, sha);
  const none: ReadonlyMap<string, string | null> = new Map();
  // A check pinned to no app may report as a commit status instead of a
  // check run. The statuses are read only while such a check is unreported.
  const wanted = checks.some(
    check =>
      check.app_ids.length === 0 &&
      requiredConclusion(check, runs, none) === null
  );
  const statuses = wanted ? new Map(commitStatuses(door, sha)) : none;
  const mergeable = fieldOf(pull.value, "mergeable");
  return {
    ok: true,
    eligibility: {
      mergeable: typeof mergeable === "boolean" ? mergeable : null,
      mergeable_state: textOf(pull.value, "mergeable_state") || null,
      checks: checks.map(check => ({
        context: check.context,
        conclusion: requiredConclusion(check, runs, statuses),
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
