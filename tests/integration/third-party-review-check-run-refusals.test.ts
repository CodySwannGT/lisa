/**
 * Incomplete, unrelated and negative check-run signals fail closed.
 *
 * The opposing half of the check-run credit in
 * `third-party-review-check-run-cli.test.ts` (CodySwannGT/lisa#4553): a run for
 * another head or from another app, an unfinished or unsuccessful run, a
 * throttle or pause, and every result line other than the one completed form —
 * however decorated, and wherever later in the summary the positive words
 * appear — earn no credit through the real CLI. A failed read is reported as
 * unreadable, never as an absence, and the explicit no-ops keep reading
 * nothing at all.
 * @module tests/integration/third-party-review-check-run-refusals
 */
import { describe, expect, it } from "vitest";

import { useIoLatencyBudget } from "../helpers/io-latency-budget.js";
import {
  ACTIONS_APP,
  COMPLETED_RESULT,
  COMPLETED_SUMMARY,
  FINISHED,
  OTHER_HEAD,
  onlyReading,
  PAUSED_SUMMARY,
  RATE_LIMITED,
  RATE_LIMITED_RUN,
  rawCheckRun,
  REVIEW_COMPLETED,
  runThirdPartyReviewCli,
  type Observations,
} from "../helpers/third-party-review-cli-fixture.js";

useIoLatencyBudget();

/**
 * Run the real CLI against one scenario in this suite's environment.
 * @param observations - The scenario's raw GitHub observations
 * @returns The run
 */
const run = (observations: Observations) =>
  runThirdPartyReviewCli(observations, process.env);

/** Name, raw runs, the reading that must result, and the exit code. */
type RefusalCase = readonly [
  string,
  readonly Record<string, unknown>[],
  string,
  number,
];

/**
 * A run whose only difference is its summary under a generic title.
 * @param summary - The raw summary
 * @returns The run
 */
const finishedWith = (summary: unknown) =>
  rawCheckRun({ output: { title: FINISHED, summary } });

const NOT_THE_REVIEWERS: readonly RefusalCase[] = [
  [
    "a run reported for another head",
    [rawCheckRun({ head_sha: OTHER_HEAD })],
    "absent",
    1,
  ],
  [
    "a run GitHub Actions posted under the reviewer's name",
    [rawCheckRun({ app: { id: ACTIONS_APP, slug: "github-actions" } })],
    "absent",
    1,
  ],
  [
    "a run another app posted under the reviewer's name",
    [rawCheckRun({ app: { id: 999, slug: "other-app" } })],
    "absent",
    1,
  ],
];

const NOT_FINISHED_OR_NOT_SUCCESSFUL: readonly RefusalCase[] = [
  [
    "a queued run",
    [rawCheckRun({ status: "queued", conclusion: null })],
    "pending",
    0,
  ],
  [
    "an in-progress run already carrying a success conclusion",
    [rawCheckRun({ status: "in_progress" })],
    "pending",
    0,
  ],
  [
    "a completed run with no conclusion",
    [rawCheckRun({ conclusion: null })],
    "unsuccessful",
    1,
  ],
  ...["neutral", "failure", "cancelled", "timed_out", "action_required"].map(
    (conclusion): RefusalCase => [
      `a ${conclusion} run carrying the completed result line`,
      [rawCheckRun({ conclusion })],
      "unsuccessful",
      1,
    ]
  ),
  [
    "a run in a lifecycle state GitHub does not define",
    [rawCheckRun({ status: "mystery" })],
    "unrecognised",
    1,
  ],
];

const NO_WORK: readonly RefusalCase[] = [
  [
    "the rate-limited run the reviewer posts when throttled",
    [RATE_LIMITED_RUN],
    "no-work",
    1,
  ],
  [
    "the paused run the reviewer posts when it skips",
    [
      rawCheckRun({
        conclusion: "skipped",
        output: { title: "Review paused", summary: PAUSED_SUMMARY },
      }),
    ],
    "no-work",
    1,
  ],
  [
    "a successful run whose title says it was rate limited",
    [
      rawCheckRun({
        output: { title: RATE_LIMITED, summary: COMPLETED_SUMMARY },
      }),
    ],
    "no-work",
    1,
  ],
];

const NOT_THE_COMPLETED_RESULT: readonly RefusalCase[] = [
  [
    "an unknown result",
    [finishedWith("Result: Unknown - Review completed")],
    "unrecognised",
    1,
  ],
  [
    "a failure result under a positive title",
    [
      rawCheckRun({
        output: {
          title: REVIEW_COMPLETED,
          summary: "Result: Failure - Review completed",
        },
      }),
    ],
    "unrecognised",
    1,
  ],
  [
    "the completed result only on a later line",
    [finishedWith(`Run metadata\n${COMPLETED_RESULT}`)],
    "unrecognised",
    1,
  ],
  [
    "a blank first line before the completed result",
    [finishedWith(`\n${COMPLETED_RESULT}`)],
    "unrecognised",
    1,
  ],
  ...[
    ["quoted", `> ${COMPLETED_RESULT}`],
    ["a heading", `# ${COMPLETED_RESULT}`],
    ["a table cell", `| ${COMPLETED_RESULT} |`],
    ["a malformed separator", "Result: Success: Review completed"],
    ["an extra suffix", `${COMPLETED_RESULT}, partially`],
  ].map(
    ([shape, summary]): RefusalCase => [
      `the completed result as ${shape}`,
      [finishedWith(summary)],
      "unrecognised",
      1,
    ]
  ),
  [
    "a summary that is not text",
    [rawCheckRun({ output: { title: REVIEW_COMPLETED, summary: 42 } })],
    "unrecognised",
    1,
  ],
  [
    "a run with an empty title and summary",
    [rawCheckRun({ output: { title: "", summary: "" } })],
    "empty",
    1,
  ],
  [
    "a run with no output at all",
    [rawCheckRun({ output: undefined })],
    "empty",
    1,
  ],
];

describe("incomplete, unrelated and negative signals fail closed", () => {
  it.each([
    ...NOT_THE_REVIEWERS,
    ...NOT_FINISHED_OR_NOT_SUCCESSFUL,
    ...NO_WORK,
    ...NOT_THE_COMPLETED_RESULT,
  ])("earns no credit from %s", (_name, checkRuns, expected, exit) => {
    const result = run({ checkRuns });

    expect(result.status).toBe(exit);
    expect(result.verdict.outcome).not.toBe("satisfied");
    const reading = onlyReading(result);
    expect(reading.reviewed).toBe(false);
    expect(reading.reading).toBe(expected);
  });

  it("names why a run under the reviewer's name was not the reviewer's", () => {
    const wrongApp = onlyReading(
      run({
        checkRuns: [
          rawCheckRun({ app: { id: ACTIONS_APP, slug: "github-actions" } }),
        ],
      })
    );
    const wrongHead = onlyReading(
      run({ checkRuns: [rawCheckRun({ head_sha: OTHER_HEAD })] })
    );

    expect(JSON.stringify(wrongApp.ignoredCheckRuns)).toContain(
      String(ACTIONS_APP)
    );
    expect(JSON.stringify(wrongHead.ignoredCheckRuns)).toContain(OTHER_HEAD);
  });
});

describe("a read that failed is never an absence", () => {
  it.each([
    [
      "the API refused the read",
      { __refuse__: "HTTP 403: Resource not accessible by integration" },
    ],
    [
      "the response is past one page",
      { total_count: 101, check_runs: [rawCheckRun()] },
    ],
    ["the response has no check_runs list", { total_count: 0 }],
  ])("reports unreadable when %s", (_name, checkRunEnvelope) => {
    const result = run({ checkRunEnvelope });

    expect(result.status).toBe(1);
    expect(result.verdict.outcome).toBe("unsatisfied");
    expect(onlyReading(result).reading).toBe("unreadable");
  });
});

describe("the explicit no-ops keep their meaning", () => {
  it("reads nothing when no reviewer is configured", () => {
    const result = run({ config: { gates: {} } });

    expect(result.status).toBe(0);
    expect(result.verdict.outcome).toBe("no-reviewer-configured");
    expect(result.calls).toEqual([]);
  });

  it("reads nothing for a check run from an app nobody declared", () => {
    const result = run({
      checkRuns: [rawCheckRun()],
      args: ["--context=GitGuardian Security Checks"],
    });

    expect(result.status).toBe(0);
    expect(result.verdict.outcome).toBe("not-a-configured-reviewer");
    expect(result.calls).toEqual([]);
  });

  it("judges nothing at a commit that is nobody's pull request head", () => {
    const result = run({ checkRuns: [rawCheckRun()], pulls: [] });

    expect(result.status).toBe(0);
    expect(result.verdict.outcome).toBe("not-a-pull-request-head");
  });
});
