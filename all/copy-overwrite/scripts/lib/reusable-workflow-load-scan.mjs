// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

import {
  classifyRunLoad,
  windowCoverage,
} from "./reusable-workflow-load-failure.mjs";
/**
 * Whether a run predates the window, so everything after it can be ignored.
 * @param run - The run being considered
 * @param windowStart - ISO timestamp the scan intends to cover back to
 * @returns True only when this run is at or before the start of the window
 */
function reachedWindow(run, windowStart) {
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
function findingFor(run, inPopulation) {
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
/**
 * Fold one page into the running scan state.
 * @param state - Everything the scan has accumulated so far
 * @param page - The page just fetched
 * @param request - The scan request, for its window and population test
 * @returns The scan state after absorbing this page
 */
function absorb(state, page, request) {
  const findings = page.runs
    .filter(run => !reachedWindow(run, request.windowStart))
    .map(run => findingFor(run, request.inPopulation(run.path)));
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
export async function scanForLoadFailures(request) {
  const initial = {
    findings: [],
    inspected: 0,
    oldestSeen: null,
    exhausted: false,
    done: false,
  };
  const final = await Array.from(
    { length: request.maxPages },
    (_unused, index) => index + 1
  ).reduce(async (carried, pageNumber) => {
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
