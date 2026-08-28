/**
 * RED contract for stable reviewer identities in latest-review reduction.
 *
 * Every case executes the jq program extracted from the authored skill. The
 * v4.23.26 unguarded reducer therefore remains the expected pre-fix RED.
 * @module tests/unit/strategies/latest-review-stable-identity
 */
import { describe, expect, it } from "vitest";

import {
  INVALID_REVIEWER_FIXTURES,
  MIXED_HOSTILE_REVIEWS,
  PAGINATED_NAMED_REVIEWS,
  REVIEW_ACCOUNT_SECRET,
  REVIEW_PAYLOAD_SECRET,
  review,
  type ReviewRecord,
} from "../../helpers/latest-review-identity-fixtures.js";
import {
  extractReviewCommand,
  readRepositoryFile,
  runDocumentedReviewCommand,
  runRawDocumentedReviewCommand,
  runRawReviewReducer,
  runReviewReducer,
  SOURCE_REVIEW_SKILL,
  type ReviewReducerRun,
} from "../../helpers/latest-review-reducer-harness.js";

/**
 * Require one successful reducer result and parse its array.
 * @param run - Bounded jq process result.
 * @returns Effective review records emitted by the reducer.
 */
const successfulRows = (run: ReviewReducerRun): readonly ReviewRecord[] => {
  expect(run.signal).toBeNull();
  expect(run.status).toBe(0);
  expect(run.stderr).toBe("");
  return JSON.parse(run.stdout) as readonly ReviewRecord[];
};

/**
 * Produce stable identity and record-id pairs for an effective set.
 * @param rows - Effective named review records.
 * @returns Sorted identity and id pairs.
 */
const identityIds = (rows: readonly ReviewRecord[]): readonly string[] =>
  rows
    .map(row => `${String(row.user?.login)}:${String(row.id)}`)
    .toSorted((left, right) => left.localeCompare(right));

describe("executed stable reviewer identity reducer", () => {
  it("fetches all pages before applying the documented reducer", () => {
    const named = review({ id: 6, user: { login: "stable-reviewer" } });
    const run = runDocumentedReviewCommand([[named]]);

    expect(run.signal).toBeNull();
    expect(run.status).toBe(0);
    expect(run.stderr).toBe("");
    expect(run.ghArguments).toEqual([
      "api",
      "--paginate",
      "repos/acme/widgets/pulls/42/reviews",
      "--slurp",
    ]);
    expect(JSON.parse(run.stdout)).toEqual([named]);
  });

  it("preserves bounded fetch and filter failures", () => {
    const fetchFailure = runRawDocumentedReviewCommand(
      `[[{"body":"${REVIEW_PAYLOAD_SECRET}"}]]`,
      23
    );
    const filterFailure = runRawDocumentedReviewCommand(
      `{"body":"${REVIEW_PAYLOAD_SECRET}",` +
        `"account":"${REVIEW_ACCOUNT_SECRET}`
    );

    expect(fetchFailure.status).toBe(23);
    expect(fetchFailure.stdout).toBe("");
    expect(fetchFailure.stderr).toBe("review fetch failed\n");
    expect(filterFailure.status).not.toBe(0);
    expect(filterFailure.stdout).toBe("");
    for (const run of [fetchFailure, filterFailure]) {
      expect(run.signal).toBeNull();
      expect(run.stderr).not.toContain(REVIEW_PAYLOAD_SECRET);
      expect(run.stderr).not.toContain(REVIEW_ACCOUNT_SECRET);
      expect(Buffer.byteLength(run.stderr)).toBeLessThanOrEqual(4096);
    }
  });

  it("retains one ordinary stable named reviewer unchanged", () => {
    const named = review({
      body: "kept-body",
      id: 7,
      user: { login: "Reviewer-01" },
    });

    expect(successfulRows(runReviewReducer([[named]]))).toEqual([named]);
  });

  it.each(INVALID_REVIEWER_FIXTURES)(
    "excludes $label before keyed reduction",
    ({ review: invalid }) => {
      expect(successfulRows(runReviewReducer([[invalid]]))).toEqual([]);
    }
  );

  it("selects each named reviewer's latest non-dismissed record", () => {
    const forward = successfulRows(runReviewReducer(PAGINATED_NAMED_REVIEWS));
    const reversed = successfulRows(
      runReviewReducer(
        [...PAGINATED_NAMED_REVIEWS].reverse().map(page => [...page].reverse())
      )
    );

    expect(identityIds(forward)).toEqual(["alice:11", "bob:22"]);
    expect(identityIds(reversed)).toEqual(identityIds(forward));
    expect(forward.find(row => row.id === 22)?.state).toBe("CHANGES_REQUESTED");
  });

  it("uses review id as the deterministic submitted-time tie-break", () => {
    const timestamp = "2026-08-28T00:07:00Z";
    const pages = [
      [
        review({
          id: 40,
          state: "APPROVED",
          submitted_at: timestamp,
          user: { login: "same-time" },
        }),
        review({
          id: 41,
          state: "CHANGES_REQUESTED",
          submitted_at: timestamp,
          user: { login: "same-time" },
        }),
      ],
    ];

    expect(identityIds(successfulRows(runReviewReducer(pages)))).toEqual([
      "same-time:41",
    ]);
  });

  it("excludes dismissal events without erasing earlier valid state", () => {
    const pages = [
      [
        review({ id: 50, user: { login: "dismissed-later" } }),
        review({
          id: 51,
          state: "DISMISSED",
          submitted_at: "2026-08-28T00:08:00Z",
          user: { login: "dismissed-later" },
        }),
      ],
    ];

    expect(identityIds(successfulRows(runReviewReducer(pages)))).toEqual([
      "dismissed-later:50",
    ]);
  });

  it("lets a named change request survive hostile anonymous approvals", () => {
    const run = runReviewReducer(MIXED_HOSTILE_REVIEWS);
    const rows = successfulRows(run);

    expect(identityIds(rows)).toEqual(["trusted-blocker:32"]);
    expect(rows[0]?.state).toBe("CHANGES_REQUESTED");
    expect(run.stdout).not.toContain(REVIEW_PAYLOAD_SECRET);
    expect(run.stdout).not.toContain(REVIEW_ACCOUNT_SECRET);
  });

  it("never counts a mixed set of identity-less approval records", () => {
    const anonymous = INVALID_REVIEWER_FIXTURES.map(({ review: row }, id) => ({
      ...row,
      body: REVIEW_PAYLOAD_SECRET,
      id: id + 60,
      state: "APPROVED",
    }));
    const run = runReviewReducer([anonymous]);

    expect(successfulRows(run)).toEqual([]);
    expect(run.stdout).not.toContain(REVIEW_PAYLOAD_SECRET);
  });

  it("preserves a valid login exactly instead of reinterpreting it", () => {
    const named = review({
      id: 80,
      user: { login: "Trusted-Reviewer-2" },
    });
    const rows = successfulRows(runReviewReducer([[named]]));

    expect(rows[0]?.user?.login).toBe("Trusted-Reviewer-2");
  });

  it("fails closed on malformed JSON with a bounded private diagnosis", () => {
    const run = runRawReviewReducer(
      `{"body":"${REVIEW_PAYLOAD_SECRET}",` +
        `"account":"${REVIEW_ACCOUNT_SECRET}`
    );

    expect(run.signal).toBeNull();
    expect(run.status).not.toBe(0);
    expect(run.stdout).toBe("");
    expect(run.stderr).not.toContain(REVIEW_PAYLOAD_SECRET);
    expect(run.stderr).not.toContain(REVIEW_ACCOUNT_SECRET);
    expect(Buffer.byteLength(run.stderr)).toBeLessThanOrEqual(4096);
  });

  it("documents only a paginated read command for effective reviews", () => {
    const command = extractReviewCommand(
      readRepositoryFile(SOURCE_REVIEW_SKILL)
    );

    expect(command).toContain("gh api --paginate");
    expect(command).toContain("/pulls/<pr>/reviews --slurp");
    expect(command).not.toMatch(/(?:^|\s)-[XfFH]\S*/u);
    expect(command).not.toMatch(
      /(?:^|\s)--(?:field|raw-field|header|input|method)(?:=|\s|$)/u
    );
    expect(command).not.toContain("/dismissals");
  });
});
