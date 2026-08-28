/**
 * Review-history fixtures for stable reviewer identity reduction (#3382).
 * @module tests/helpers/latest-review-identity-fixtures
 */

/** Minimal GitHub review shape consumed by the documented jq reducer. */
export interface ReviewRecord {
  /** Adversarial payload that must never reach diagnostics. */
  readonly body?: string;
  /** Stable ordering tie-break returned by GitHub. */
  readonly id?: number;
  /** GitHub review state. */
  readonly state?: string;
  /** Primary chronological ordering value returned by GitHub. */
  readonly submitted_at?: string;
  /** Reviewer envelope, which GitHub may omit or return as null. */
  readonly user?: {
    /** Reviewer login, deliberately unknown for hostile fixtures. */
    readonly login?: unknown;
  } | null;
}

/** One identity shape that must be excluded before keyed reduction. */
export interface InvalidReviewerFixture {
  /** Human-readable table-row identity. */
  readonly label: string;
  /** Approval-shaped record carrying the unusable identity. */
  readonly review: ReviewRecord;
}

/** Sentinel forbidden from reducer diagnostics and retained output. */
export const REVIEW_PAYLOAD_SECRET = "review-payload-secret-3382";

/** Account-detail sentinel forbidden from diagnostics and retained output. */
export const REVIEW_ACCOUNT_SECRET = "review-account-secret-3382";

/**
 * Construct one ordinary review record.
 * @param overrides - Fields that replace the valid default record.
 * @returns Review record suitable for a paginated REST fixture.
 */
export const review = (
  overrides: Partial<ReviewRecord> = {}
): ReviewRecord => ({
  body: "ordinary-review-body",
  id: 1,
  state: "APPROVED",
  submitted_at: "2026-08-28T00:00:00Z",
  user: { login: "trusted-reviewer" },
  ...overrides,
});

/** Every absent, blank, or non-string reviewer identity refusal arm. */
export const INVALID_REVIEWER_FIXTURES: readonly InvalidReviewerFixture[] = [
  {
    label: "missing user",
    review: {
      body: "ordinary-review-body",
      id: 1,
      state: "APPROVED",
      submitted_at: "2026-08-28T00:00:00Z",
    },
  },
  {
    label: "null user",
    review: review({ user: null }),
  },
  {
    label: "missing login",
    review: review({ user: {} }),
  },
  {
    label: "null login",
    review: review({ user: { login: null } }),
  },
  {
    label: "empty login",
    review: review({ user: { login: "" } }),
  },
  {
    label: "whitespace login",
    review: review({ user: { login: " \t\n" } }),
  },
  {
    label: "numeric login",
    review: review({ user: { login: 17 } }),
  },
  {
    label: "boolean login",
    review: review({ user: { login: false } }),
  },
  {
    label: "object login",
    review: review({ user: { login: { value: "unstable" } } }),
  },
  {
    label: "array login",
    review: review({ user: { login: ["unstable"] } }),
  },
];

/** Named review history spanning pagination, dismissal, and repeated states. */
export const PAGINATED_NAMED_REVIEWS: readonly (readonly ReviewRecord[])[] = [
  [
    review({
      id: 22,
      state: "CHANGES_REQUESTED",
      submitted_at: "2026-08-28T00:03:00Z",
      user: { login: "bob" },
    }),
    review({
      id: 10,
      state: "APPROVED",
      submitted_at: "2026-08-28T00:01:00Z",
      user: { login: "alice" },
    }),
  ],
  [
    review({
      id: 23,
      state: "DISMISSED",
      submitted_at: "2026-08-28T00:04:00Z",
      user: { login: "bob" },
    }),
    review({
      id: 21,
      state: "APPROVED",
      submitted_at: "2026-08-28T00:02:00Z",
      user: { login: "bob" },
    }),
    review({
      id: 11,
      state: "COMMENTED",
      submitted_at: "2026-08-28T00:05:00Z",
      user: { login: "alice" },
    }),
  ],
];

/** Mixed hostile records with one valid blocking named review. */
export const MIXED_HOSTILE_REVIEWS: readonly (readonly ReviewRecord[])[] = [
  [
    review({
      body: REVIEW_PAYLOAD_SECRET,
      id: 30,
      user: null,
    }),
    review({
      body: REVIEW_PAYLOAD_SECRET,
      id: 31,
      user: { login: "   " },
    }),
  ],
  [
    review({
      id: 32,
      state: "CHANGES_REQUESTED",
      submitted_at: "2026-08-28T00:06:00Z",
      user: { login: "trusted-blocker" },
    }),
    review({
      body: REVIEW_PAYLOAD_SECRET,
      id: 33,
      state: "APPROVED",
      user: { login: { secret: REVIEW_ACCOUNT_SECRET } },
    }),
  ],
];
