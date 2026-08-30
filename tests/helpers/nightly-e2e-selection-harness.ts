/**
 * Rows 41-42 of the nightly e2e gate: the shapes the SELECTION walk produces.
 *
 * Split out of `nightly-e2e-gate-harness` deliberately. Selection answers a
 * different question from the rest of the truth table — not "what is this run's
 * verdict?" but "which run is the gate entitled to score?" — and it arrived with
 * its own module facet on the guard (`runProducedEvidence`, `countDecisiveJobs`,
 * `formatSelection`, `RUN_CANDIDATE_PAGE_SIZE`). Keeping that facet in its own
 * file means the gate harness stays the truth-table view it has always been.
 *
 * Specification: `docs/nightly-e2e-gate.md` §2 rows 41-42 and §2.6.
 * @module tests/helpers/nightly-e2e-selection-harness
 */
import type { Job, Run } from "./nightly-e2e-gate-harness";

/** One run the selection walk stepped over, with the evidence it lacked. */
export interface SkippedRun {
  readonly runId: number | null;
  readonly conclusion: string | null;
  readonly createdAt: string | null;
  readonly decisiveJobs: number;
  readonly totalJobs: number;
}

/** The audit of which run a finding was scored on, and what it walked past. */
export interface RunSelection {
  readonly runId: number | null;
  readonly conclusion: string | null;
  readonly createdAt: string | null;
  /**
   * How many of the SCORED run's jobs reached a verdict, and how many there
   * were. Present so an inconclusive scored run can name its cause: `cancelled`
   * is overloaded across a displaced duplicate (0 of N), a run killed at a job's
   * own `timeout-minutes` ceiling (some of N), and an operator cancel, and the
   * counts separate the first from the rest without reading anything the gate
   * did not already fetch.
   */
  readonly decisiveJobs?: number;
  readonly totalJobs?: number;
  /** True when no conclusive run was found inside the freshness window. */
  readonly fellBack: boolean;
  readonly skipped: readonly SkippedRun[];
}

/**
 * One suite's observation, as `observe` returns it.
 *
 * Lives here because `selection` is what it gained: before rows 41-42 an
 * observation was just "the newest run and its jobs", and the whole point of
 * those rows is that those two words did not mean the same thing.
 */
export interface Observation {
  readonly workflowMissing: boolean;
  readonly run: Run | null;
  readonly jobs: readonly Job[];
  readonly selection?: RunSelection;
  readonly scope?: unknown;
}

/** The guard's selection facet, as these suites consume it. */
export interface SelectionModule {
  /** How many completed runs per event the walk may read. */
  readonly RUN_CANDIDATE_PAGE_SIZE: number;
  runProducedEvidence(run: Run | null, jobs: readonly Job[] | null): boolean;
  countDecisiveJobs(jobs: readonly Job[] | null): number;
  formatSelection(selection: RunSelection | null): string | null;
}

/** The gate's default freshness window, in hours. */
export const FRESHNESS_HOURS = 36;

/**
 * The evaluation context `observe` bounds its selection walk with.
 *
 * @param now - The instant the suite evaluates at
 * @returns The context `observe` takes
 */
export function observeContext(now: Date): {
  freshnessHours: number;
  now: Date;
} {
  return { freshnessHours: FRESHNESS_HOURS, now };
}
