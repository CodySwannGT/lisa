/**
 * Page a repository's run history and report reusable-workflow load failures
 * (CodySwannGT/lisa#3581).
 *
 * `core/reusable-workflow-load-failure` decides what a single run means. This
 * module is the part that has to READ enough runs for that verdict to be worth
 * anything, and it is a separate module because the two failure modes are
 * unrelated: one is a misclassification, the other is a detector reporting on
 * a window it never covered.
 *
 * The page fetcher is injected rather than imported. That is not a testing
 * convenience — it is the only way the paging and coverage logic here can be
 * exercised at all, because the alternative is a live API call whose rate
 * limit decides whether the suite passes. Every rule below is proven against
 * fixture pages; the `gh api` adapter that supplies real ones is a caller's
 * job and is deliberately not part of this module.
 * @module core/reusable-workflow-load-scan
 */
import {
  classifyRunLoad,
  windowCoverage,
  type RunLoadClass,
} from "./reusable-workflow-load-failure.js";

/** One run as this scan needs to see it. */
export interface ScannedRun {
  /** The run's id, for the operator to open. */
  readonly id: number;
  /** The caller workflow's path, e.g. `.github/workflows/nightly.yml`. */
  readonly path: string;
  /** ISO timestamp the run was created. */
  readonly createdAt: string;
  /** Length of the run's `referenced_workflows` array. */
  readonly referencedCount: number;
  /** Number of jobs the run created. */
  readonly jobCount: number;
  /** The run's `conclusion`, or null while in flight. */
  readonly conclusion: string | null;
}

/** One page of run history. */
export interface RunPage {
  /** Runs on this page, newest first, as the API returns them. */
  readonly runs: readonly ScannedRun[];
  /** Whether another page exists after this one. */
  readonly hasMore: boolean;
}

/** What the scan needs in order to run. */
export interface ScanRequest {
  /** Fetches one 1-based page of run history. */
  readonly fetchPage: (page: number) => Promise<RunPage>;
  /** ISO timestamp to cover back to. */
  readonly windowStart: string;
  /** Whether a caller path declares a reusable workflow. */
  readonly inPopulation: (path: string) => boolean;
  /** Hard cap on pages read, so a busy repository cannot spin forever. */
  readonly maxPages: number;
}

/** One run the scan is reporting on. */
export interface ScanFinding {
  /** The run's id. */
  readonly id: number;
  /** The caller workflow's path. */
  readonly path: string;
  /** What this run turned out to be. */
  readonly verdict: RunLoadClass;
}

/** The scan's answer. */
export interface ScanResult {
  /** Runs classified as load failures. */
  readonly loadFailures: readonly ScanFinding[];
  /** How many runs were read. */
  readonly inspected: number;
  /**
   * True only when the window was covered AND the scan can speak for it.
   *
   * A false here is an ERROR, not a pass with a caveat: the whole reason this
   * field exists is that an earlier implementation read one page, missed four
   * known load failures that had fallen off it, and reported "OK, 100 runs
   * inspected". A detector that reports success for a range it failed to read
   * also retires the suspicion that would have found the failures by hand.
   */
  readonly covered: boolean;
  /** Why the window was not covered, empty when it was. */
  readonly reason: string;
}

/**
 * Whether a run predates the window, so everything after it can be ignored.
 * @param run - The run being considered
 * @param windowStart - ISO timestamp the scan intends to cover back to
 * @returns True only when this run is at or before the start of the window
 */
function reachedWindow(run: ScannedRun, windowStart: string): boolean {
  const created = Date.parse(run.createdAt);
  const start = Date.parse(windowStart);
  // An unparseable timestamp must not read as "we are past the window" —
  // that would end the scan early and call the short read complete.
  if (Number.isNaN(created) || Number.isNaN(start)) return false;
  return created <= start;
}

/**
 * Classify one run through the shared decision.
 * @param run - The run being classified
 * @param inPopulation - Whether this run's caller declares a reusable workflow
 * @returns The run's id, caller path, and verdict
 */
function findingFor(run: ScannedRun, inPopulation: boolean): ScanFinding {
  return {
    id: run.id,
    path: run.path,
    verdict: classifyRunLoad({
      inPopulation,
      referencedCount: run.referencedCount,
      jobCount: run.jobCount,
      conclusion: run.conclusion,
    }),
  };
}

/** State carried between pages. */
interface ScanState {
  readonly findings: readonly ScanFinding[];
  readonly inspected: number;
  readonly oldestSeen: string | null;
  readonly exhausted: boolean;
  readonly done: boolean;
}

/**
 * Fold one page into the running scan state.
 * @param state - Everything the scan has accumulated so far
 * @param page - The page just fetched
 * @param request - The scan request, for its window and population test
 * @returns The scan state after absorbing this page
 */
function absorb(
  state: ScanState,
  page: RunPage,
  request: ScanRequest
): ScanState {
  const findings = page.runs.map(run =>
    findingFor(run, request.inPopulation(run.path))
  );
  const oldest = page.runs.at(-1)?.createdAt ?? state.oldestSeen;
  const reached = page.runs.some(run =>
    reachedWindow(run, request.windowStart)
  );
  return {
    findings: [...state.findings, ...findings],
    inspected: state.inspected + page.runs.length,
    oldestSeen: oldest,
    exhausted: !page.hasMore,
    done: reached || !page.hasMore,
  };
}

/**
 * Read run history until the window is covered, then report load failures.
 *
 * Paging stops on the first of three conditions: a run older than the window
 * was seen, the history ran out, or `maxPages` was reached. Only the first
 * two are coverage; hitting the cap leaves `covered` false, because a cap is
 * a budget the operator set and not evidence about the runs beyond it.
 * @param request - Fetcher, window, population test, and page cap
 * @returns Findings plus whether the window was actually covered
 */
export async function scanForLoadFailures(
  request: ScanRequest
): Promise<ScanResult> {
  const initial: ScanState = {
    findings: [],
    inspected: 0,
    oldestSeen: null,
    exhausted: false,
    done: false,
  };

  const final = await Array.from(
    { length: request.maxPages },
    (_unused, index) => index + 1
  ).reduce(async (carried: Promise<ScanState>, pageNumber: number) => {
    const state = await carried;
    if (state.done) return state;
    return absorb(state, await request.fetchPage(pageNumber), request);
  }, Promise.resolve(initial));

  const coverage = windowCoverage({
    oldestSeen: final.oldestSeen,
    windowStart: request.windowStart,
    exhausted: final.exhausted,
  });

  return {
    loadFailures: final.findings.filter(
      finding => finding.verdict === "load-failure"
    ),
    inspected: final.inspected,
    covered: coverage.covered,
    reason: coverage.reason,
  };
}
