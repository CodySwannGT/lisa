/** Tooling suites run on PRs even when deployment callers use older planners. */
import { describe, expect, it } from "vitest";

import { githubCondition } from "../helpers/github-expression.js";
import { workflow } from "./quality-gate-facade-fixture.js";

/** The only lifecycle moment that schedules the tooling suite job. */
const PR_MOMENT = "pull-request";

/**
 * Evaluate the shipped job condition, including its planner fallback.
 * @param moment Requested workflow moment.
 * @param result Gate planner outcome.
 * @param plan Serialized planner output, including legacy output.
 * @param skipJobs Explicit caller skip tokens.
 * @param cancelled Whether the workflow was canceled.
 * @returns Whether GitHub would schedule the tooling suite job.
 */
const scheduled = (
  moment: string,
  result = "success",
  plan = "{}",
  skipJobs = "",
  cancelled = false
): boolean =>
  githubCondition(
    workflow.jobs.test_node_suites?.if ?? "",
    {
      inputs: { moment, skip_jobs: skipJobs },
      needs: { gate_plan: { result, outputs: { plan } } },
    },
    cancelled
  );

describe("PR-only tooling suites", () => {
  it.each([
    "push",
    "pre-deploy",
    "pre-deploy:dev",
    "pre-deploy:staging",
    "pre-deploy:main",
    "pre-deploy:production",
    "post-deploy:production",
  ])("does not schedule tooling tests at %s", moment => {
    for (const result of ["success", "failure", "skipped"]) {
      for (const plan of ["{}", '{"test_node_suites":"run"}']) {
        expect(scheduled(moment, result, plan)).toBe(false);
      }
    }
  });

  it.each(["success", "failure", "skipped"])(
    "still runs PR tests when the planner reports %s",
    result => {
      expect(scheduled(PR_MOMENT, result)).toBe(true);
    }
  );

  it("honors an explicit PR opt-out and cancellation", () => {
    expect(scheduled(PR_MOMENT, "success", '{"test_node_suites":"skip"}')).toBe(
      false
    );
    expect(scheduled(PR_MOMENT, "success", "{}", "test_node_suites")).toBe(
      false
    );
    expect(scheduled(PR_MOMENT, "success", "{}", "", true)).toBe(false);
  });
});
