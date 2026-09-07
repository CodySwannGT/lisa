/**
 * The scan half of #3581: reading enough runs for the verdict to mean anything.
 *
 * The classifier is tested next door. What is tested here is the failure the
 * ticket actually recorded from a first implementation — it read one page,
 * filtered by timestamp, and reported "OK, 100 runs inspected" across a window
 * that contained four known load failures. Every assertion below exists to
 * make that specific green impossible to produce again.
 * @module tests/unit/core/reusable-workflow-load-scan
 */
import { describe, expect, it } from "vitest";

import {
  scanForLoadFailures,
  type RunPage,
  type ScannedRun,
} from "../../../src/core/reusable-workflow-load-scan.js";

/** A run that loaded nothing despite declaring a reusable workflow. */
const LOAD_FAILURE: ScannedRun = {
  id: 1,
  path: ".github/workflows/nightly.yml",
  createdAt: "2026-09-05T12:00:00Z",
  referencedCount: 0,
  jobCount: 0,
  conclusion: "failure",
};

/** An ordinary failing run whose caller declares no reusable workflow. */
const ORDINARY: ScannedRun = {
  id: 2,
  path: ".github/workflows/lint.yml",
  createdAt: "2026-09-05T11:00:00Z",
  referencedCount: 0,
  jobCount: 3,
  conclusion: "failure",
};

/** A window start that the fixture pages sit inside. */
const WINDOW_START = "2026-09-05T00:00:00Z";

/** A window start far enough back that no fixture page reaches it. */
const EARLY_WINDOW = "2026-08-01T00:00:00Z";

/**
 * Every caller except `lint.yml` declares a reusable workflow.
 * @param path - The caller workflow's path
 * @returns True when this caller declares a reusable workflow
 */
const inPopulation = (path: string): boolean => !path.endsWith("lint.yml");

/**
 * A fetcher serving fixed pages, recording which pages were asked for.
 * @param pages - Pages to serve, in order
 * @returns The fetcher plus the list of page numbers it was asked for
 */
function pager(pages: readonly RunPage[]): {
  readonly fetchPage: (page: number) => Promise<RunPage>;
  readonly seen: number[];
} {
  const seen: number[] = [];
  return {
    seen,
    fetchPage: (page: number): Promise<RunPage> => {
      seen.push(page);
      return Promise.resolve(pages[page - 1] ?? { runs: [], hasMore: false });
    },
  };
}

describe("finding load failures across a covered window", () => {
  it("reports the load failure and not the ordinary failure beside it", async () => {
    const { fetchPage } = pager([
      { runs: [LOAD_FAILURE, ORDINARY], hasMore: false },
    ]);

    const result = await scanForLoadFailures({
      fetchPage,
      windowStart: WINDOW_START,
      inPopulation,
      maxPages: 5,
    });

    expect(result.loadFailures.map(f => f.id)).toEqual([1]);
    expect(result.inspected).toBe(2);
    expect(result.covered).toBe(true);
  });

  it("keeps paging until a run older than the window is seen", async () => {
    const { fetchPage, seen } = pager([
      { runs: [LOAD_FAILURE], hasMore: true },
      { runs: [ORDINARY], hasMore: true },
      {
        runs: [{ ...LOAD_FAILURE, id: 3, createdAt: "2026-09-04T00:00:00Z" }],
        hasMore: true,
      },
    ]);

    const result = await scanForLoadFailures({
      fetchPage,
      windowStart: WINDOW_START,
      inPopulation,
      maxPages: 5,
    });

    // Three pages read, and it stopped once it was past the window rather than
    // reading all five it was allowed.
    expect(seen).toEqual([1, 2, 3]);
    expect(result.loadFailures.map(f => f.id)).toEqual([1, 3]);
    expect(result.covered).toBe(true);
  });
});

describe("rejection controls: a short read must never report a pass", () => {
  it("refuses when the page cap is hit before the window is covered", async () => {
    // THE control. Every page is inside the window and more remain, which is
    // exactly the state the one-page implementation called clean.
    const { fetchPage } = pager([
      { runs: [LOAD_FAILURE], hasMore: true },
      { runs: [LOAD_FAILURE], hasMore: true },
    ]);

    const result = await scanForLoadFailures({
      fetchPage,
      windowStart: EARLY_WINDOW,
      inPopulation,
      maxPages: 2,
    });

    expect(result.covered).toBe(false);
    expect(result.reason).toContain("did not reach");
  });

  it("does not let a clean short read report covered", async () => {
    // The precise shape of the recorded bug: nothing found, window not
    // covered. "No load failures" and "covered" must be separate answers, or
    // the caller cannot tell silence from blindness.
    const { fetchPage } = pager([{ runs: [ORDINARY], hasMore: true }]);

    const result = await scanForLoadFailures({
      fetchPage,
      windowStart: EARLY_WINDOW,
      inPopulation,
      maxPages: 1,
    });

    expect(result.loadFailures).toEqual([]);
    expect(result.covered).toBe(false);
  });

  it("treats an exhausted history as covered even inside the window", async () => {
    const { fetchPage } = pager([{ runs: [ORDINARY], hasMore: false }]);

    const result = await scanForLoadFailures({
      fetchPage,
      windowStart: EARLY_WINDOW,
      inPopulation,
      maxPages: 5,
    });

    expect(result.covered).toBe(true);
  });

  it("does not end the scan early on an unparseable timestamp", async () => {
    // A bad timestamp reading as "past the window" would stop paging and hide
    // everything on later pages. The load failure is deliberately on page two,
    // and page one's LAST run carries a good timestamp — otherwise coverage
    // fails for an unrelated reason and the assertion cannot tell the two
    // implementations apart. (The first version of this test did exactly that
    // and passed against both.)
    const { fetchPage, seen } = pager([
      {
        runs: [{ ...ORDINARY, createdAt: "not-a-date" }, ORDINARY],
        hasMore: true,
      },
      {
        runs: [
          { ...LOAD_FAILURE, id: 9 },
          { ...ORDINARY, id: 10, createdAt: "2026-09-04T00:00:00Z" },
        ],
        hasMore: true,
      },
    ]);

    const result = await scanForLoadFailures({
      fetchPage,
      windowStart: WINDOW_START,
      inPopulation,
      maxPages: 5,
    });

    expect(seen).toEqual([1, 2]);
    expect(result.loadFailures.map(f => f.id)).toEqual([9]);
    expect(result.covered).toBe(true);
  });
});
