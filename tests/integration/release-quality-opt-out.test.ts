/** Release quality opt-out preserves scheduling and reports skipped honestly. */
import { githubCondition } from "../helpers/github-expression.js";
import { describe, expect, it } from "vitest";

import { jobOf, loadWorkflow } from "../helpers/workflow-test-utils.js";

const workflow = loadWorkflow(".github/workflows/release.yml");

/**
 * Evaluate the shipped boolean expression with explicit GitHub job results.
 * @param enabled Whether release quality is requested.
 * @param quality Quality job result.
 * @param overrides Other job results.
 * @param cancelled Whether the workflow was canceled.
 * @returns Whether versioning is scheduled.
 */
function canVersion(
  enabled: boolean,
  quality: string,
  overrides: Record<string, string> = {},
  cancelled = false
): boolean {
  const results = {
    release_init: "success",
    release_schedule: "success",
    check_promotion: "success",
    release_approval: "skipped",
    quality,
    ...overrides,
  };
  const needs = Object.fromEntries(
    Object.entries(results).map(([key, result]) => [
      key,
      { result, outputs: { is_promotion: "false" } },
    ])
  );
  return githubCondition(
    jobOf(workflow, "version").if ?? "false",
    {
      inputs: { run_quality_checks: enabled },
      needs,
    },
    cancelled
  );
}

describe("release quality opt-out", () => {
  it("preserves quality execution unless the caller opts out", () => {
    expect(
      workflow.on?.workflow_call?.inputs?.run_quality_checks
    ).toMatchObject({
      type: "boolean",
      required: false,
      default: true,
    });
    expect(jobOf(workflow, "quality").if).toBe("inputs.run_quality_checks");
    expect(canVersion(true, "success")).toBe(true);
    expect(canVersion(true, "skipped")).toBe(false);
    expect(canVersion(false, "skipped")).toBe(true);
  });

  it.each(["failure", "cancelled", "", "pending"])(
    "does not accept quality result %s even with opt-out",
    result => {
      expect(canVersion(true, result)).toBe(false);
      expect(canVersion(false, result)).toBe(false);
    }
  );

  it.each([
    "release_init",
    "release_schedule",
    "check_promotion",
    "release_approval",
  ])("still blocks on failed %s when quality is disabled", job => {
    expect(canVersion(false, "skipped", { [job]: "failure" })).toBe(false);
  });

  it("does not restart a canceled release", () => {
    expect(canVersion(false, "skipped", {}, true)).toBe(false);
  });

  it.each(["release_attestation", "release_compliance"])(
    "%s distinguishes a skipped suite from passing checks",
    job => {
      const body = jobOf(workflow, job)
        .steps?.map(step => step.run ?? "")
        .join("\n");
      expect(body).toContain(
        "\"passed\": ${{ needs.quality.result == 'success' }}"
      );
      expect(body).toContain('"requested": ${{ inputs.run_quality_checks }}');
      expect(body).toContain(
        '"workflow_result": "${{ needs.quality.result }}"'
      );
    }
  );
});
