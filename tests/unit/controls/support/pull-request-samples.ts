/**
 * Pull-request points and canary halves, written by hand, for the suite that
 * checks how they become evidence results (CodySwannGT/lisa#4997,
 * CodySwannGT/lisa#4998).
 *
 * The suites that settle a real run against the in-memory platform build
 * these through the code under test. Here each one is spelled out, so a case
 * can say exactly which point it starts from.
 * @module tests/unit/controls/support/pull-request-samples
 */
import type { ProofHalfResult } from "../../../../src/controls/proof-types.js";
import type {
  PullRequestPoint,
  PullRequestSettlement,
} from "../../../../src/controls/pull-request-types.js";

/** The entry every sample point is about. */
export const SAMPLE_ENTRY = "code-style@.";

/** The check that entry reports on a pull request. */
export const SAMPLE_CHECK = "Quality Checks / Lint";

/** The moment every sample stands for. */
export const PULL_REQUEST = "pull-request";

/** The reason of a point whose check the platform requires. */
export const OBSERVED_REQUIRED = "observed-required";

/** When the sample settings were read. */
export const READ_AT = "2026-11-17T12:00:30.000Z";

/** When the first sample canary began: the next reading of the clock. */
export const CANARY_BEGAN = "2026-11-17T12:00:31.000Z";

/** When the sample canaries finished. */
const CANARIES_DONE = "2026-11-17T12:00:40.000Z";

/**
 * One entry's pull-request point, as settling the moment leaves it.
 * @param change - What differs from a point whose check is required
 * @returns The point
 */
export function point(
  change: Partial<PullRequestPoint> = {}
): PullRequestPoint {
  return {
    entry_id: SAMPLE_ENTRY,
    gate: "code-style",
    scope: ".",
    criteria: ["SI7"],
    moment: PULL_REQUEST,
    outcome: "unproved",
    failed_halves: [],
    reason: OBSERVED_REQUIRED,
    detail: "Observed, not exercised.",
    time_limit_seconds: null,
    halves: [],
    rung: "observed",
    settles_entry: true,
    observed: "required",
    checks: [{ context: SAMPLE_CHECK, state: "required", app_ids: [] }],
    completed_at: READ_AT,
    ...change,
  };
}

/**
 * One canary half, as the canary step reports it.
 * @param half - Which half
 * @param outcome - What the platform did with the change
 * @returns The half's result
 */
export function canaryHalf(
  half: ProofHalfResult["half"],
  outcome: ProofHalfResult["outcome"]
): ProofHalfResult {
  return {
    entry_id: SAMPLE_ENTRY,
    half,
    moment: PULL_REQUEST,
    patch: `.lisa/controls/proofs/lint.${half}.patch`,
    command: null,
    exit_status: null,
    started_at: CANARY_BEGAN,
    completed_at: CANARIES_DONE,
    output_excerpt: `pull request #1 (draft): "${SAMPLE_CHECK}": failure`,
    output_truncated: false,
    matched_lines: [],
    outcome,
    reason: outcome === "rejected" ? "rejected-as-declared" : "accepted",
    detail: `The ${half} change was ${outcome}.`,
  };
}

/**
 * A point whose two canaries were run.
 * @param violation - What the platform did with the violating change
 * @param clean - What it did with the clean change
 * @returns The point
 */
export function exercisedPoint(
  violation: ProofHalfResult["outcome"] = "rejected",
  clean: ProofHalfResult["outcome"] = "accepted"
): PullRequestPoint {
  return point({
    rung: "exercised",
    outcome: "passed",
    reason: "proved",
    detail: "The hosting platform would not let the violating change through.",
    halves: [canaryHalf("violation", violation), canaryHalf("clean", clean)],
    completed_at: CANARIES_DONE,
  });
}

/**
 * What a run recorded about the pull-request moment.
 * @param points - Its points
 * @param mode - Whether canaries were asked for
 * @returns The settlement
 */
export function settled(
  points: readonly PullRequestPoint[],
  mode: PullRequestSettlement["mode"] = "observed"
): PullRequestSettlement {
  return {
    mode,
    platform: {
      name: "github",
      repository: "example-owner/example-repo",
      detected_from: "remote",
      reachable: true,
      note: null,
    },
    branch: "main",
    canary_lifetime_seconds: 7200,
    run_id: null,
    permission: null,
    sweep: null,
    base_head: null,
    canaries: [],
    requests: [],
    points,
  };
}
