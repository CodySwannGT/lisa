/**
 * Check-run review evidence through the real third-party evidence CLI.
 *
 * The reviewer this repository declares stopped posting commit statuses between
 * 2026-10-26 and 2026-10-27 and now reports only as a check run. The prover read
 * statuses alone, so it reported `absent` at every head after the switch —
 * including one the reviewer had approved — and every pull request needed a
 * hand-written substitute (CodySwannGT/lisa#4553).
 *
 * Every case runs the real CLI from its source location, with its real import
 * closure and a real `.lisa.config.json`, against raw GitHub API payloads served
 * by a journaling `gh` with no network and no write route. The harness throws on
 * any unsupported call, so a missing route can never pass as a behavioural
 * result. This file holds the credit and the binding; its siblings hold the
 * opposing controls that must not earn it (`-refusals`), the unchanged legacy
 * behaviour (`-legacy`), the objection boundary (`-objection`) and agreement
 * with the registration prover (`-parity`). An all-allowing prover fails those,
 * and an all-refusing one fails this.
 * @module tests/integration/third-party-review-check-run-cli
 */
import { describe, expect, it } from "vitest";

import { useIoLatencyBudget } from "../helpers/io-latency-budget.js";
import {
  CHECK_RUNS_ROUTE,
  COMPLETED_RESULT,
  COMPLETED_SUMMARY,
  FINISHED,
  HEAD,
  OTHER_HEAD,
  onlyReading,
  PINNED_CONFIG,
  RATE_LIMITED_RUN,
  rawCheckRun,
  REVIEW_COMPLETED,
  REVIEWER,
  ROUTES,
  routesRead,
  runThirdPartyReviewCli,
  substituteComment,
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

describe("a completed declared check run is recognised as review work", () => {
  it("credits a successful completed run whose multiline summary opens with the completed result", () => {
    const result = run({ checkRuns: [rawCheckRun()] });

    expect(result.status).toBe(0);
    expect(result.verdict.outcome).toBe("satisfied");
    const reading = onlyReading(result);
    expect(reading.reviewed).toBe(true);
    expect(reading.reading).toBe("reviewed");
    expect(reading.source).toBe("check-run");
    expect(reading.observed).toBe(COMPLETED_RESULT);
    expect(reading.state).toBe("success");
  });

  it("credits the same result when the summary uses CRLF line endings", () => {
    const result = run({
      checkRuns: [
        rawCheckRun({
          output: {
            title: FINISHED,
            summary: COMPLETED_SUMMARY.replaceAll("\n", "\r\n"),
          },
        }),
      ],
    });

    expect(result.status).toBe(0);
    expect(onlyReading(result).reviewed).toBe(true);
  });

  it("credits it on the path a check_run event wakes, named by --context", () => {
    const result = run({
      checkRuns: [rawCheckRun()],
      args: [`--context=${REVIEWER}`],
    });

    expect(result.status).toBe(0);
    expect(result.verdict.outcome).toBe("satisfied");
  });

  it("needs no weakening: the declaration still names only Review completed", () => {
    const declared =
      PINNED_CONFIG.gates["code-review"]["pull-request"].evidence.proof;
    expect(declared).toEqual([REVIEW_COMPLETED]);

    expect(run({ checkRuns: [rawCheckRun()] }).verdict.outcome).toBe(
      "satisfied"
    );
  });

  it.each([
    ["no summary", null],
    ["an empty summary", ""],
    ["a summary with no result line", "Run metadata only"],
  ])("grants Finished alone nothing — %s", (_name, summary) => {
    const result = run({
      checkRuns: [rawCheckRun({ output: { title: FINISHED, summary } })],
    });

    expect(result.status).toBe(1);
    expect(result.verdict.outcome).toBe("unsatisfied");
    expect(onlyReading(result).reviewed).toBe(false);
    expect(onlyReading(result).observed).toBe(FINISHED);
  });

  it("reads the reviewer's runs from a name-filtered route, once per reviewer", () => {
    const result = run({ checkRuns: [rawCheckRun()] });

    expect(
      routesRead(result).filter(route => route === CHECK_RUNS_ROUTE)
    ).toHaveLength(1);
  });

  it("says which run decided", () => {
    expect(onlyReading(run({ checkRuns: [rawCheckRun()] })).checkRunId).toBe(
      125245587534
    );
  });
});

describe("substitutes keep their distinct meaning on a check run", () => {
  it("stands a substitute at this head in for a rate-limited run without calling it reviewed", () => {
    const result = run({
      checkRuns: [RATE_LIMITED_RUN],
      comments: [substituteComment(REVIEWER, HEAD)],
    });

    expect(result.status).toBe(0);
    expect(result.verdict.outcome).toBe("substituted");
    const reading = onlyReading(result);
    expect(reading.reviewed).toBe(false);
    expect(reading.substituted).toBe(true);
    expect(reading.reading).toBe("no-work");
  });

  it.each([
    ["an earlier head", substituteComment(REVIEWER, OTHER_HEAD)],
    ["another reviewer", substituteComment("Second Reviewer", HEAD)],
  ])("refuses a substitute written for %s", (_name, comment) => {
    const result = run({
      checkRuns: [RATE_LIMITED_RUN],
      comments: [comment],
    });

    expect(result.status).toBe(1);
    expect(result.verdict.outcome).toBe("unsatisfied");
  });
});

describe("the control is bound to its source and inputs", () => {
  it("returns the command, source hash, input hash, streams and full call journal", () => {
    const result = run({ checkRuns: [rawCheckRun()] });

    expect(result.command).toContain(`--sha=${HEAD}`);
    expect(result.sourceSha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(result.inputSha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(result.stderr).toBe("");
    expect(result.calls.every(call => call.allowed)).toBe(true);
    expect(routesRead(result)).toEqual(
      expect.arrayContaining([ROUTES.pulls, ROUTES.status, ROUTES.comments])
    );
  });

  it("changes the input hash when one observed field changes", () => {
    const first = run({ checkRuns: [rawCheckRun()] });
    const second = run({
      checkRuns: [rawCheckRun({ conclusion: "neutral" })],
    });

    expect(second.inputSha256).not.toBe(first.inputSha256);
    expect(second.sourceSha256).toBe(first.sourceSha256);
  });
});
