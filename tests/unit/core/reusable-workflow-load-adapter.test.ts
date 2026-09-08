/**
 * The adapter half of #3581: proving the call shape without calling GitHub.
 *
 * Everything here runs against a stub request function. That is deliberate and
 * it is the whole point of the seam — a live probe against the real API would
 * make the suite's colour depend on a rate limit, which a sibling lane already
 * paid for once.
 *
 * What is NOT proven here, stated rather than implied: that GitHub populates
 * `referenced_workflows` on the single-run endpoint with the shape assumed
 * below, and that a local (`./.github/workflows/...`) reusable call populates
 * it at all. Both are vendor semantics; neither can be established from a
 * stub, and pretending a stub settles them would be the kind of green this
 * whole ticket is about.
 * @module tests/unit/core/reusable-workflow-load-adapter
 */
import { describe, expect, it } from "vitest";

import {
  createRunPageFetcher,
  jobsPath,
  runPath,
  runsPath,
  RUNS_PER_PAGE,
} from "../../../src/core/reusable-workflow-load-adapter.js";

/** The repository the stub answers for. */
const REPO = "CodySwannGT/lisa";

/**
 * A stub that records every path asked for and answers from a table.
 * @param table - Path to response body
 * @returns The request function and the list of paths it was asked for
 */
function stub(table: Record<string, unknown>): {
  readonly request: (path: string) => Promise<unknown>;
  readonly asked: string[];
} {
  const asked: string[] = [];
  return {
    asked,
    request: (path: string): Promise<unknown> => {
      asked.push(path);
      return Promise.resolve(table[path] ?? {});
    },
  };
}

/**
 * One entry as the runs LIST endpoint returns it.
 * @param id - Run id
 * @param conclusion - Run conclusion, or null while in flight
 * @param path - Caller workflow path
 * @returns A list-shaped run object
 */
function listed(
  id: number,
  conclusion: string | null,
  path = ".github/workflows/nightly.yml"
): Record<string, unknown> {
  return {
    id,
    path,
    created_at: "2026-09-05T12:00:00Z",
    conclusion,
  };
}

describe("endpoint shapes", () => {
  it("asks for run history newest-first with explicit paging", () => {
    expect(runsPath(REPO, 2, 100)).toBe(
      "repos/CodySwannGT/lisa/actions/runs?per_page=100&page=2"
    );
  });

  it("reads referenced_workflows from the single-run endpoint", () => {
    // The list endpoint does not carry the field; this is the one that does.
    expect(runPath(REPO, 42)).toBe("repos/CodySwannGT/lisa/actions/runs/42");
  });

  it("asks the jobs endpoint for a count, not a page of jobs", () => {
    expect(jobsPath(REPO, 42)).toBe(
      "repos/CodySwannGT/lisa/actions/runs/42/jobs?per_page=1"
    );
  });

  it("defaults to GitHub's maximum page size", () => {
    expect(RUNS_PER_PAGE).toBe(100);
  });
});

describe("assembling a page", () => {
  it("fills in referenced and job counts for a failing run", async () => {
    const { request } = stub({
      [runsPath(REPO, 1, 2)]: { workflow_runs: [listed(7, "failure")] },
      [runPath(REPO, 7)]: { referenced_workflows: [] },
      [jobsPath(REPO, 7)]: { total_count: 0 },
    });

    const page = await createRunPageFetcher({
      repo: REPO,
      request,
      perPage: 2,
    })(1);

    expect(page.runs).toEqual([
      {
        id: 7,
        path: ".github/workflows/nightly.yml",
        createdAt: "2026-09-05T12:00:00Z",
        conclusion: "failure",
        referencedCount: 0,
        jobCount: 0,
      },
    ]);
  });

  it("reports hasMore from a full page, not from total_count", async () => {
    // A run created while the scan is paging moves total_count under it. A
    // full page means "ask again"; a short page means the history ended.
    const { request } = stub({
      [runsPath(REPO, 1, 2)]: {
        total_count: 9999,
        workflow_runs: [listed(1, "success"), listed(2, "success")],
      },
      [runsPath(REPO, 2, 2)]: {
        total_count: 9999,
        workflow_runs: [listed(3, "success")],
      },
    });
    const fetcher = createRunPageFetcher({ repo: REPO, request, perPage: 2 });

    expect((await fetcher(1)).hasMore).toBe(true);
    expect((await fetcher(2)).hasMore).toBe(false);
  });
});

describe("rejection controls", () => {
  it("does not spend detail requests on runs that cannot be load failures", async () => {
    // Request economy is what keeps a scheduled scan from being rate-limited
    // into a false green. It is also a correctness claim: only a conclusion
    // reachable before a job exists can be a load failure, so if the
    // classifier ever accepts a new one, this assertion is where it surfaces.
    const { request, asked } = stub({
      [runsPath(REPO, 1, 4)]: {
        workflow_runs: [
          listed(1, "success"),
          listed(2, "cancelled"),
          listed(3, "skipped"),
          listed(4, null),
        ],
      },
    });

    await createRunPageFetcher({ repo: REPO, request, perPage: 4 })(1);

    expect(asked).toEqual([runsPath(REPO, 1, 4)]);
  });

  it("does spend them on both conclusions a load failure can carry", async () => {
    const { request, asked } = stub({
      [runsPath(REPO, 1, 4)]: {
        workflow_runs: [listed(1, "failure"), listed(2, "startup_failure")],
      },
    });

    await createRunPageFetcher({ repo: REPO, request, perPage: 4 })(1);

    expect(asked).toContain(runPath(REPO, 1));
    expect(asked).toContain(runPath(REPO, 2));
  });

  it("does not invent a count from a malformed body", async () => {
    // An unreadable response must not read as "resolved nothing, no jobs" in a
    // way that manufactures a load failure downstream — it yields zeroes, and
    // the population gate plus the conclusion gate are what stop it there.
    const { request } = stub({
      [runsPath(REPO, 1, 2)]: { workflow_runs: "not-an-array" },
    });

    const page = await createRunPageFetcher({
      repo: REPO,
      request,
      perPage: 2,
    })(1);

    expect(page.runs).toEqual([]);
    expect(page.hasMore).toBe(false);
  });
});
