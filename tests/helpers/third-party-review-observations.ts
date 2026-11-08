/**
 * Raw GitHub observations for the third-party review evidence controls.
 *
 * The reviewer's own payloads, transcribed from real runs on a pull request in
 * this repository and stripped of run ids and links: what a completed review,
 * a throttle and a pause actually look like as check runs, and the routes the
 * prover reads them from (CodySwannGT/lisa#4553). Cases override only the
 * fields they are about, so every control starts from a real shape.
 * @module tests/helpers/third-party-review-observations
 */

/** The shipped prover, executed in place. */
export const PROVER =
  "all/copy-overwrite/scripts/check-third-party-review-evidence.mjs";

/** The repository every controlled route belongs to. */
export const REPO = "acme/code";

/** The inspected pull request head. */
export const HEAD = "6528e1aea8aa9a0faa2191e5beb9f18f0ea4e3fd";

/** A different commit, for stale-head and wrong-head controls. */
export const OTHER_HEAD = "37e67f7e5530ea5a96c9ee95717eec5b096346a7";

/** The pull request whose head is {@link HEAD}. */
export const PULL = 4618;

/** The declared reviewer's context and app, as this repository declares them. */
export const REVIEWER = "CodeRabbit";
export const REVIEWER_APP = 347564;

/** The app GitHub Actions posts its own check runs under. */
export const ACTIONS_APP = 15368;

/** The generic title the reviewer gives a completed run. */
export const FINISHED = "Finished";

/** The reviewer's throttle notice, as a title and as a status description. */
export const RATE_LIMITED = "Review rate limited";

/** The proof phrase this repository declares. */
export const REVIEW_COMPLETED = "Review completed";

/** The structured first line the reviewer writes when a review completed. */
export const COMPLETED_RESULT = "Result: Success - Review completed";

/**
 * A completed-review summary in the shape the reviewer actually writes.
 *
 * Transcribed from a real completed run, with its run id replaced and its
 * review link removed. Every later line is incidental: the step table repeats
 * "Completed" five times, and none of it may grant anything.
 */
export const COMPLETED_SUMMARY = [
  COMPLETED_RESULT,
  "Run ID: `00000000-0000-4000-8000-000000000001`",
  "CodeRabbit Review: review link omitted",
  "",
  "| Step | Status | Time |",
  "| --- | --- | --- |",
  "| Prepare review scope | Completed | 16s 631ms |",
  "| Prepare repository workspace | Completed | 3ms |",
  "| Run analysis checks | Completed | 3m 11s 210ms |",
  "| Generate review feedback | Completed | 4m 2s 181ms |",
  "| Publish review results | Completed | 6s 316ms |",
  "| Time taken | | 7m 36s 548ms |",
].join("\n");

/** A rate-limited summary in the shape the reviewer actually writes. */
export const RATE_LIMITED_SUMMARY = [
  "Result: Rate limited - Review rate limited",
  "Run ID: `00000000-0000-4000-8000-000000000002`",
  "",
  "| Step | Status | Time |",
  "| --- | --- | --- |",
  "| Prepare review scope | Skipped | 5s 679ms |",
  "| Prepare repository workspace | Skipped | 0s |",
  "| Run analysis checks | Skipped | 0s |",
  "| Generate review feedback | Skipped | 0s |",
  "| Publish review results | Skipped | 0s |",
  "| Time taken | | 5s 679ms |",
].join("\n");

/** A paused summary in the shape the reviewer actually writes. */
export const PAUSED_SUMMARY = [
  "Result: Skipped - Review paused",
  "Run ID: `00000000-0000-4000-8000-000000000003`",
].join("\n");

/** The declaration this repository ships: pinned to the reviewer's app. */
export const PINNED_CONFIG = {
  gates: {
    "code-review": {
      "pull-request": {
        level: "required",
        await: REVIEWER,
        posted_by: REVIEWER_APP,
        evidence: { reviewer: true, proof: [REVIEW_COMPLETED] },
      },
    },
  },
};

/** The same declaration with no `posted_by`: GitHub's "any source". */
export const UNPINNED_CONFIG = {
  gates: {
    "code-review": {
      "pull-request": {
        level: "required",
        await: REVIEWER,
        evidence: { reviewer: true, proof: [REVIEW_COMPLETED] },
      },
    },
  },
};

/**
 * One raw check run as `repos/{repo}/commits/{sha}/check-runs` returns it.
 *
 * Defaults to the reviewer's real completed run; a case overrides only the
 * fields it is about. The real API object carries no `created_at`.
 * @param overrides - Raw fields this case observes differently
 * @returns A raw check-run row, before any projection
 */
export function rawCheckRun(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    id: 125245587534,
    name: REVIEWER,
    head_sha: HEAD,
    status: "completed",
    conclusion: "success",
    started_at: "2026-11-02T11:19:41Z",
    completed_at: "2026-11-02T11:27:02Z",
    app: { id: REVIEWER_APP, slug: "coderabbitai" },
    output: {
      title: FINISHED,
      summary: COMPLETED_SUMMARY,
      text: null,
      annotations_count: 0,
    },
    ...overrides,
  };
}

/** The run the reviewer posts when it is throttled, as measured. */
export const RATE_LIMITED_RUN = rawCheckRun({
  id: 125259819379,
  conclusion: "neutral",
  output: {
    title: RATE_LIMITED,
    summary: RATE_LIMITED_SUMMARY,
    text: null,
    annotations_count: 0,
  },
});

/** The comment author the default permission routes call a writer. */
export const SUBSTITUTE_WRITER = "maintainer";

/**
 * The route the prover reads one comment author's repository permission from.
 * @param login - The comment author
 * @returns The API path
 */
export const permissionRoute = (login: string): string =>
  `repos/${REPO}/collaborators/${encodeURIComponent(login)}/permission`;

/**
 * The comment a posted substitute review carries, for one reviewer at one head.
 * @param context - The reviewer it stands in for
 * @param sha - The head it reviewed
 * @param login - Its author; a writer unless a case says otherwise
 * @returns A raw issue comment
 */
export function substituteComment(
  context: string,
  sha: string,
  login = SUBSTITUTE_WRITER
): Record<string, unknown> {
  return {
    user: { login },
    body: `<!-- lisa:review-substitute context="${context}" head="${sha}" -->\nSelf-review substitute.`,
  };
}

/**
 * One raw commit status from the declared reviewer.
 * @param state - The status state
 * @param description - Its description
 * @returns A raw status row
 */
export function reviewerStatus(
  state: string,
  description: string
): Record<string, unknown> {
  return { context: REVIEWER, state, description };
}

/** The exact route the prover reads one reviewer's check runs from. */
export const CHECK_RUNS_ROUTE = `repos/${REPO}/commits/${HEAD}/check-runs?check_name=${REVIEWER}&per_page=100`;

/** The routes every evaluating run reads, keyed for the shim. */
export const ROUTES = Object.freeze({
  pulls: `repos/${REPO}/commits/${HEAD}/pulls`,
  status: `repos/${REPO}/commits/${HEAD}/status`,
  checkRuns: CHECK_RUNS_ROUTE,
  comments: `repos/${REPO}/issues/${PULL}/comments?per_page=100`,
  reviews: `repos/${REPO}/pulls/${PULL}/reviews`,
});
