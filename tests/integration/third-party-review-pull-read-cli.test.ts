/**
 * Failed PR reads are unknown, never evidence that the commit has no PR (#4631).
 * These controls execute the real reader and CLI with journaled raw responses.
 * @module tests/integration/third-party-review-pull-read-cli
 */
import { describe, expect, it } from "vitest";

import { useIoLatencyBudget } from "../helpers/io-latency-budget.js";
import {
  OTHER_HEAD,
  PULL,
  routesRead,
  ROUTES,
  runThirdPartyReviewCli,
} from "../helpers/third-party-review-cli-fixture.js";

useIoLatencyBudget();

const FAILED_READ = { __refuse__: "HTTP 502: simulated PR read failure" };

describe("real pull-request read acceptance (#4631)", () => {
  it.each([
    ["failed", FAILED_READ],
    ["malformed", { message: "a non-list response" }],
  ])("reports a %s read as unreadable and exits 1", (_name, pullResponse) => {
    const run = runThirdPartyReviewCli({ pullResponse }, process.env);
    expect(run.verdict.outcome).toBe("pull-requests-unreadable");
    expect(run.status).toBe(1);
    expect(routesRead(run)).toEqual([ROUTES.pulls]);
  });

  it.each([
    ["empty", []],
    [
      "nonmatching",
      [{ number: PULL, state: "open", head: { sha: OTHER_HEAD } }],
    ],
  ])("keeps a successful %s list as an exit-0 no-op", (_name, pulls) => {
    const run = runThirdPartyReviewCli({ pulls }, process.env);
    expect(run.verdict.outcome).toBe("not-a-pull-request-head");
    expect(run.status).toBe(0);
    expect(routesRead(run)).toEqual([ROUTES.pulls]);
  });

  it("decides without any follow-up read after an API failure", () => {
    const run = runThirdPartyReviewCli(
      { pullResponse: FAILED_READ },
      process.env
    );
    expect(run.verdict).toMatchObject({
      outcome: "pull-requests-unreadable",
      readings: [],
    });
    expect(run.calls).toHaveLength(1);
    expect(run.calls[0]).toMatchObject({ allowed: true, refused: true });
    expect(routesRead(run)).not.toContain(ROUTES.status);
    expect(routesRead(run)).not.toContain(ROUTES.checkRuns);
    expect(routesRead(run)).not.toContain(ROUTES.comments);
  });
});
