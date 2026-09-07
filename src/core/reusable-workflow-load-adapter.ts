/**
 * Turn GitHub's run endpoints into the pages `core/reusable-workflow-load-scan`
 * expects (CodySwannGT/lisa#3581).
 *
 * The HTTP request is injected. That keeps the endpoint shapes, the paging
 * parameters and the response handling under test against a stub, which is the
 * only way to prove this wiring without a live call whose rate limit decides
 * whether the suite passes — the lesson a sibling lane paid twenty minutes of
 * held-dirty tree to learn.
 *
 * ## Why this needs three endpoints and not one
 *
 * The run LIST gives id, caller path, timestamp and conclusion. It does not
 * give the two facts the verdict actually turns on: `referenced_workflows`
 * comes from the single-run endpoint, and the job count from the run's jobs
 * endpoint. So a full scan is inherently N+1, and reading every run's detail
 * across a wide window is the kind of request volume that gets a scheduled job
 * rate-limited into a false green.
 *
 * The narrowing that makes it affordable is sound rather than convenient: a
 * load failure is only reachable from a conclusion GitHub can produce BEFORE
 * creating a job. Detail is therefore fetched only for those, and a run with
 * any other conclusion keeps zeroes it never fetched.
 *
 * **Those zeroes are not measurements.** For a `success` run they are simply
 * absent evidence, and the classifier's label for such a run is not meaningful
 * — the only verdict this adapter's output supports is `load-failure`, which
 * is the one the scan filters for. Anything that starts reporting per-verdict
 * counts from these pages must fetch detail unconditionally first.
 * @module core/reusable-workflow-load-adapter
 */
import type { RunPage, ScannedRun } from "./reusable-workflow-load-scan.js";

/**
 * Conclusions worth spending two extra requests on.
 *
 * Kept in step with `PRE_JOB_FAILURES` in the classifier by the test that
 * asserts no other conclusion triggers a detail fetch: if the classifier ever
 * accepts a new conclusion, that test fails rather than this adapter silently
 * declining to gather the evidence for it.
 */
const DETAIL_WORTH_FETCHING: readonly string[] = ["failure", "startup_failure"];

/** GitHub's default and maximum page size for the runs endpoint. */
export const RUNS_PER_PAGE = 100;

/** Performs one authenticated GET and returns the decoded JSON body. */
export type GithubRequest = (path: string) => Promise<unknown>;

/** What the fetcher needs to address a repository. */
export interface AdapterOptions {
  /** Repository in `owner/name` form. */
  readonly repo: string;
  /** The injected request function. */
  readonly request: GithubRequest;
  /** Page size; defaults to `RUNS_PER_PAGE`. */
  readonly perPage?: number;
}

/**
 * Path for one page of run history, newest first.
 * @param repo - Repository in `owner/name` form
 * @param page - 1-based page number
 * @param perPage - Page size
 * @returns The API path to request
 */
export function runsPath(repo: string, page: number, perPage: number): string {
  return `repos/${repo}/actions/runs?per_page=${perPage}&page=${page}`;
}

/**
 * Path for one run's detail, which is where `referenced_workflows` lives.
 * @param repo - Repository in `owner/name` form
 * @param id - The run id
 * @returns The API path to request
 */
export function runPath(repo: string, id: number): string {
  return `repos/${repo}/actions/runs/${id}`;
}

/**
 * Path for one run's jobs, read only for its `total_count`.
 * @param repo - Repository in `owner/name` form
 * @param id - The run id
 * @returns The API path to request
 */
export function jobsPath(repo: string, id: number): string {
  return `repos/${repo}/actions/runs/${id}/jobs?per_page=1`;
}

/**
 * Read a property off an unknown decoded body without asserting a shape.
 * @param body - Decoded response body
 * @param key - Property name
 * @returns The value, or undefined when the body is not an object
 */
function field(body: unknown, key: string): unknown {
  if (typeof body !== "object" || body === null) return undefined;
  return (body as Record<string, unknown>)[key];
}

/**
 * Coerce an unknown to a number, defaulting rather than throwing.
 * @param value - Any decoded value
 * @returns The number, or 0 when it is not a finite one
 */
function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/**
 * Coerce an unknown to a string, or empty.
 * @param value - Any decoded value
 * @returns The string, or empty when it is not one
 */
function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** One run as the LIST endpoint describes it, before detail is gathered. */
interface ListedRun {
  readonly id: number;
  readonly path: string;
  readonly createdAt: string;
  readonly conclusion: string | null;
}

/**
 * Read the list endpoint's runs array into the fields the scan needs.
 * @param body - Decoded body of the runs list response
 * @returns One entry per run, in the order GitHub returned them
 */
function listedRuns(body: unknown): readonly ListedRun[] {
  const runs = field(body, "workflow_runs");
  if (!Array.isArray(runs)) return [];
  return runs.map((run: unknown) => ({
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
async function withDetail(
  listed: ListedRun,
  options: AdapterOptions
): Promise<ScannedRun> {
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
export function createRunPageFetcher(
  options: AdapterOptions
): (page: number) => Promise<RunPage> {
  const perPage = options.perPage ?? RUNS_PER_PAGE;

  return async (page: number): Promise<RunPage> => {
    const body = await options.request(runsPath(options.repo, page, perPage));
    const listed = listedRuns(body);

    const runs = await Promise.all(
      listed.map(async (run: ListedRun): Promise<ScannedRun> => {
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
