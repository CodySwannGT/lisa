/**
 * What a canary run left on the hosting platform, said out loud.
 *
 * A canary is a real branch and a real pull request in somebody's
 * repository. The results of a run say whether each control works; they do
 * not say whether the run cleaned up after itself, and a table of passes
 * printed over a repository full of leftover branches would say nothing was
 * wrong. So everything a run could not undo is put on standard error, one
 * line each, naming the branch or pull request so that a person can remove
 * it by hand:
 *
 * - a canary whose pull request is not closed or whose branch is not gone;
 * - a canary of an earlier run that the sweep could not remove;
 * - a canary pull request that was merged;
 * - the protected branch having moved while canaries were open.
 *
 * The last two are more than untidiness. This command never merges a
 * canary, opens only drafts, and reads the head of the protected branch
 * before and after. A canary that was merged all the same put a test change
 * into the protected branch, and that fails the run whatever its controls
 * showed. A protected branch that moved fails the run too unless the
 * platform said of every canary that it was not merged: a move with a
 * canary unaccounted for cannot be called somebody else's push.
 * @module controls/pull-request-notices
 */
import { proofSummary } from "./proof-report.js";
import type { ProofRun } from "./proof-types.js";
import {
  pullRequestSettlementOf,
  type CanaryRecord,
  type PullRequestSettlement,
} from "./pull-request-types.js";

/** What a canary run left behind, for the operator. */
export interface CanaryNotices {
  /** One line per thing to know, for standard error. */
  readonly lines: readonly string[];
  /**
   * Why the run must not be reported as a pass whatever its controls showed,
   * or `null` when nothing found here fails it.
   */
  readonly failure: string | null;
}

/**
 * Name a canary by what was created for it.
 * @param canary - The canary's record
 * @returns Its branch, and its pull request when one was opened
 */
function named(canary: CanaryRecord): string {
  return canary.pull_request === null
    ? `branch ${canary.branch}`
    : `pull request #${String(canary.pull_request)} (branch ${canary.branch})`;
}

/**
 * Say what of one canary is still on the platform.
 * @param canary - The canary's record
 * @returns One line, or nothing when it was removed
 */
function leftBehind(canary: CanaryRecord): readonly string[] {
  if (canary.closed && canary.branch_removed) return [];
  const pull =
    canary.pull_request === null
      ? "its pull request"
      : `pull request #${String(canary.pull_request)}`;
  const left = [
    ...(canary.closed ? [] : [`${pull} is still open`]),
    ...(canary.branch_removed
      ? []
      : [`the branch ${canary.branch} still exists`]),
  ].join(" and ");
  const why =
    canary.cleanup_problem === null
      ? ""
      : ` The platform answered: ${canary.cleanup_problem.replaceAll(/\s+/gu, " ")}.`;
  return [
    `A canary of ${canary.entry_id} (${canary.half} half) could not be removed: ${left}.${why} Remove it by hand on the hosting platform. Never merge it.`,
  ];
}

/**
 * Say that a canary pull request was merged.
 * @param canary - The canary's record
 * @param branch - The protected branch
 * @returns One line
 */
function mergedLine(canary: CanaryRecord, branch: string): string {
  return `Canary ${named(canary)} was merged into ${branch}. This command never merges a canary, so something else on the hosting platform did, and ${branch} now holds the ${canary.half} test change of ${canary.entry_id}. Undo that merge, find what merged it, and do not run canaries again until it no longer can.`;
}

/**
 * Say what the head of the protected branch did while canaries were open.
 * @param settlement - What the run did about the pull-request moment
 * @param merged - The canaries the platform says were merged
 * @param unaccounted - The canaries it is not known whether were merged
 * @returns The line, when there is one, and whether it fails the run
 */
function baseHeadNotice(
  settlement: PullRequestSettlement,
  merged: readonly CanaryRecord[],
  unaccounted: readonly CanaryRecord[]
): { readonly lines: readonly string[]; readonly fails: boolean } {
  const head = settlement.base_head;
  const branch = settlement.branch ?? "the protected branch";
  if (head === null || head.unchanged === true) {
    return { lines: [], fails: false };
  }
  if (head.unchanged === null) {
    return {
      lines:
        settlement.canaries.length === 0
          ? []
          : [
              `The head of ${branch} could not be read both before and after the canaries, so it is not confirmed that ${branch} is where it was.`,
            ],
      fails: false,
    };
  }
  const moved = `The head of ${branch} moved while canaries were open, from ${String(head.before)} to ${String(head.after)}.`;
  if (merged.length > 0) {
    return {
      lines: [
        `${moved} A canary was merged into it (${merged.map(named).join(", ")}).`,
      ],
      fails: true,
    };
  }
  return unaccounted.length > 0
    ? {
        lines: [
          `${moved} It could not be read whether ${unaccounted.map(named).join(", ")} was merged, so it cannot be ruled out that a canary moved it. Look at what ${branch} gained.`,
        ],
        fails: true,
      }
    : {
        lines: [
          `${moved} The platform said of every canary that it was not merged, so something else moved it.`,
        ],
        fails: false,
      };
}

/** How the attest command begins each line it prints for a person. */
const COMMAND = "attest";

/**
 * Print everything a canary run left on the hosting platform, and say
 * whether that fails the run.
 * @param run - The run, with its pull-request moment settled or not
 * @param say - Prints one line on standard error
 * @returns Whether the run must exit as not passed, whatever its proofs
 *   showed. When it must, the last line printed says so and why
 */
export function reportCanaryNotices(
  run: ProofRun,
  say: (line: string) => void
): boolean {
  const notices = canaryNotices(run);
  notices.lines.forEach(line => {
    say(`${COMMAND}: ${line}`);
  });
  if (notices.failure === null) return false;
  say(`${COMMAND}: FAIL. ${notices.failure}. ${proofSummary(run)}`);
  return true;
}

/**
 * Say everything a canary run left on the hosting platform.
 * @param run - The run, with its pull-request moment settled or not
 * @returns The lines for standard error, and whether the run fails on them
 */
export function canaryNotices(run: ProofRun): CanaryNotices {
  const settlement = pullRequestSettlementOf(run);
  if (settlement === null) return { lines: [], failure: null };
  const branch = settlement.branch ?? "the protected branch";
  const opened = settlement.canaries.filter(
    canary => canary.pull_request !== null
  );
  const merged = opened.filter(canary => canary.merged === true);
  const unaccounted = opened.filter(canary => canary.merged === null);
  const head = baseHeadNotice(settlement, merged, unaccounted);
  const swept = (settlement.sweep?.problems ?? []).map(
    problem =>
      `A canary an earlier run left behind needs attention: ${problem.replaceAll(/\s+/gu, " ").replace(/\.$/u, "")}. Remove what is left under lisa-attest/ by hand on the hosting platform.`
  );
  const failed = merged.length > 0 || head.fails;
  return {
    lines: [
      ...merged.map(canary => mergedLine(canary, branch)),
      ...head.lines,
      ...settlement.canaries.flatMap(leftBehind),
      ...swept,
    ],
    failure: failed
      ? merged.length > 0
        ? `A canary pull request was merged into ${branch} (${merged.map(named).join(", ")}), which must never happen`
        : `${branch} moved while canaries were open and it could not be ruled out that a canary moved it`
      : null,
  };
}
