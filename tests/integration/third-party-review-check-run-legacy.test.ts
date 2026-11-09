/**
 * Legacy commit-status evidence reads exactly as it did, beside check runs,
 * for a gate that does not pin `posted_by`.
 *
 * Unpinned reviewers that still post statuses must keep being credited, and
 * every refusal they used to earn must still be refused, through the real CLI
 * (CodySwannGT/lisa#4553). A gate that pins `posted_by` accepts no status at
 * all, because a status cannot show which app posted it
 * (CodySwannGT/lisa#4652); the pinned cases here pin that refusal. The second half pins which run speaks for the
 * reviewer when both representations, or several runs, are present: the
 * reviewer's own check run is authoritative over its status and the newest run
 * wins, the two rules the registration prover already applies (#4547), and an
 * unpinned declaration accepts any app, as GitHub's own unpinned required check
 * does.
 * @module tests/integration/third-party-review-check-run-legacy
 */
import { describe, expect, it } from "vitest";

import { useIoLatencyBudget } from "../helpers/io-latency-budget.js";
import {
  onlyReading,
  PINNED_CONFIG,
  RATE_LIMITED,
  RATE_LIMITED_RUN,
  rawCheckRun,
  REVIEW_COMPLETED,
  reviewerStatus,
  runThirdPartyReviewCli,
  UNPINNED_CONFIG,
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

/**
 * Run the real CLI under the unpinned declaration, the one statuses still prove.
 * @param observations - The scenario's raw GitHub observations
 * @returns The run
 */
const runUnpinned = (observations: Observations) =>
  run({ config: UNPINNED_CONFIG, ...observations });

describe("legacy commit-status evidence is preserved", () => {
  it("credits a Review completed status under an unpinned declaration", () => {
    const result = runUnpinned({
      statuses: [reviewerStatus("success", REVIEW_COMPLETED)],
    });

    expect(result.status).toBe(0);
    expect(result.verdict.outcome).toBe("satisfied");
    expect(onlyReading(result).observed).toBe(REVIEW_COMPLETED);
  });

  it("refuses a Review completed status under the pinned declaration, and says why (#4652)", () => {
    const result = run({
      config: PINNED_CONFIG,
      statuses: [reviewerStatus("success", REVIEW_COMPLETED)],
    });

    expect(result.status).toBe(1);
    expect(result.verdict.outcome).toBe("unsatisfied");
    expect(onlyReading(result).reading).toBe("absent");
    expect(JSON.stringify(onlyReading(result).ignoredStatuses)).toContain(
      "a commit status cannot show which app posted it"
    );
  });

  it("credits the shipped default proof phrase Review approved", () => {
    const result = runUnpinned({
      statuses: [reviewerStatus("success", "Review approved")],
    });

    expect(result.status).toBe(0);
    expect(result.verdict.outcome).toBe("satisfied");
  });

  it.each([
    [RATE_LIMITED, "no-work"],
    [
      "Review skipped: manual review required for this OSS repository",
      "no-work",
    ],
    ["Everything looks fine to me", "unrecognised"],
    ["", "empty"],
  ])("still refuses a %j status", (description, expected) => {
    const result = runUnpinned({
      statuses: [reviewerStatus("success", description)],
    });

    expect(result.status).toBe(1);
    expect(onlyReading(result).reading).toBe(expected);
  });

  it("still defers on a pending status", () => {
    const result = runUnpinned({
      statuses: [reviewerStatus("pending", "Review in progress")],
    });

    expect(result.status).toBe(0);
    expect(result.verdict.outcome).toBe("pending");
  });

  it("keeps an unpinned status's credit when the check-run read fails", () => {
    const result = runUnpinned({
      statuses: [reviewerStatus("success", REVIEW_COMPLETED)],
      checkRunEnvelope: {
        __refuse__: "HTTP 403: Resource not accessible by integration",
      },
    });

    expect(result.status).toBe(0);
    expect(result.verdict.outcome).toBe("satisfied");
  });

  it("reads a pinned reviewer as unreadable, never credited by its status, when the check-run read fails", () => {
    const result = run({
      config: PINNED_CONFIG,
      statuses: [reviewerStatus("success", REVIEW_COMPLETED)],
      checkRunEnvelope: {
        __refuse__: "HTTP 403: Resource not accessible by integration",
      },
    });

    expect(result.status).toBe(1);
    expect(onlyReading(result).reading).toBe("unreadable");
  });

  it("reports no status AND no run as absent", () => {
    const result = run({});

    expect(result.status).toBe(1);
    expect(onlyReading(result).reading).toBe("absent");
  });

  it("says which representation each reading came from", () => {
    const fromStatus = onlyReading(
      runUnpinned({ statuses: [reviewerStatus("success", REVIEW_COMPLETED)] })
    );
    const fromRun = onlyReading(run({ checkRuns: [rawCheckRun()] }));

    expect(fromStatus.source).toBe("status");
    expect(fromRun.source).toBe("check-run");
  });
});

describe("which run speaks for the reviewer", () => {
  it("treats the reviewer's own check run as authoritative over its status, as the registration prover does", () => {
    const result = run({
      statuses: [reviewerStatus("success", REVIEW_COMPLETED)],
      checkRuns: [RATE_LIMITED_RUN],
    });

    expect(result.status).toBe(1);
    expect(onlyReading(result).reading).toBe("no-work");
  });

  it("credits the reviewer's completed run over its own throttled status, the other direction of the same rule", () => {
    const result = run({
      statuses: [reviewerStatus("success", RATE_LIMITED)],
      checkRuns: [rawCheckRun()],
    });

    expect(result.status).toBe(0);
    expect(onlyReading(result).source).toBe("check-run");
  });

  it("does not let another app's newer run under the reviewer's name hide the reviewer's own", () => {
    const result = run({
      checkRuns: [
        rawCheckRun({ id: 1 }),
        { ...RATE_LIMITED_RUN, id: 2, app: { id: 999, slug: "other-app" } },
      ],
    });

    expect(result.status).toBe(0);
    expect(onlyReading(result).checkRunId).toBe(1);
  });

  it.each([
    [
      "an older success behind a newer throttle",
      [rawCheckRun({ id: 1 }), { ...RATE_LIMITED_RUN, id: 2 }],
      false,
    ],
    [
      "an older throttle behind a newer success",
      [{ ...RATE_LIMITED_RUN, id: 1 }, rawCheckRun({ id: 2 })],
      true,
    ],
  ])("judges the newest run — %s", (_name, checkRuns, reviewed) => {
    expect(onlyReading(run({ checkRuns })).reviewed).toBe(reviewed);
  });

  it("accepts any app's run under an unpinned declaration, as GitHub's any-source rule does", () => {
    const result = run({
      config: UNPINNED_CONFIG,
      checkRuns: [rawCheckRun({ app: { id: 999, slug: "other-app" } })],
    });

    expect(result.status).toBe(0);
    expect(result.verdict.outcome).toBe("satisfied");
  });
});
