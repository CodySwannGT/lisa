// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/**
 * Conclusions worth spending two extra requests on.
 *
 * Kept in step with `PRE_JOB_FAILURES` in the classifier by the test that
 * asserts no other conclusion triggers a detail fetch: if the classifier ever
 * accepts a new conclusion, that test fails rather than this adapter silently
 * declining to gather the evidence for it.
 */
const DETAIL_WORTH_FETCHING = ["failure", "startup_failure"];
/** GitHub's default and maximum page size for the runs endpoint. */
export const RUNS_PER_PAGE = 100;
/**
 * Path for one page of run history, newest first.
 * @param repo - Repository in `owner/name` form
 * @param page - 1-based page number
 * @param perPage - Page size
 * @returns The API path to request
 */
export function runsPath(repo, page, perPage) {
  return `repos/${repo}/actions/runs?per_page=${perPage}&page=${page}`;
}
/**
 * Path for one run's detail, which is where `referenced_workflows` lives.
 * @param repo - Repository in `owner/name` form
 * @param id - The run id
 * @returns The API path to request
 */
export function runPath(repo, id) {
  return `repos/${repo}/actions/runs/${id}`;
}
/**
 * Path for one run's jobs, read only for its `total_count`.
 * @param repo - Repository in `owner/name` form
 * @param id - The run id
 * @returns The API path to request
 */
export function jobsPath(repo, id) {
  return `repos/${repo}/actions/runs/${id}/jobs?per_page=1`;
}
/**
 * Read a property off an unknown decoded body without asserting a shape.
 * @param body - Decoded response body
 * @param key - Property name
 * @returns The value, or undefined when the body is not an object
 */
function field(body, key) {
  if (typeof body !== "object" || body === null) return undefined;
  return body[key];
}
/**
 * Coerce an unknown to a number, defaulting rather than throwing.
 * @param value - Any decoded value
 * @returns The number, or 0 when it is not a finite one
 */
function count(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
/**
 * Coerce an unknown to a string, or empty.
 * @param value - Any decoded value
 * @returns The string, or empty when it is not one
 */
function text(value) {
  return typeof value === "string" ? value : "";
}
/**
 * Read the list endpoint's runs array into the fields the scan needs.
 * @param body - Decoded body of the runs list response
 * @returns One entry per run, in the order GitHub returned them
 */
function listedRuns(body) {
  const runs = field(body, "workflow_runs");
  if (!Array.isArray(runs)) {
    throw new Error(
      "Workflow run list is unreadable: expected workflow_runs array."
    );
  }
  return runs.map(run => ({
    id: count(field(run, "id")),
    path: text(field(run, "path")),
    createdAt: text(field(run, "created_at")),
    conclusion:
      typeof field(run, "conclusion") === "string"
        ? text(field(run, "conclusion"))
        : null,
  }));
}
/**
 * Gather the two extra facts a candidate run's verdict turns on.
 * @param listed - The run as the list endpoint described it
 * @param options - Repository, request function and page size
 * @returns The run with its referenced-workflow and job counts filled in
 */
async function withDetail(listed, options) {
  const detail = await options.request(runPath(options.repo, listed.id));
  const jobs = await options.request(jobsPath(options.repo, listed.id));
  const referenced = field(detail, "referenced_workflows");
  return {
    ...listed,
    referencedCount: Array.isArray(referenced) ? referenced.length : 0,
    jobCount: count(field(jobs, "total_count")),
  };
}
/**
 * Build the page fetcher `scanForLoadFailures` consumes.
 *
 * `hasMore` is derived from a full page rather than from `total_count`,
 * because a run created while the scan is paging shifts `total_count` under
 * it. A full page means "ask again"; a short page means the history ended.
 * @param options - Repository, request function and page size
 * @returns A fetcher for one 1-based page of run history
 */
export function createRunPageFetcher(options) {
  const perPage = options.perPage ?? RUNS_PER_PAGE;
  return async page => {
    const body = await options.request(runsPath(options.repo, page, perPage));
    const listed = listedRuns(body);
    const runs = await Promise.all(
      listed.map(async run => {
        if (
          run.conclusion === null ||
          !DETAIL_WORTH_FETCHING.includes(run.conclusion)
        ) {
          return { ...run, referencedCount: 0, jobCount: 0 };
        }
        return withDetail(run, options);
      })
    );
    return { runs, hasMore: listed.length === perPage };
  };
}
