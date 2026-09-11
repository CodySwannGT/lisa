/** Combining cheap planning checks preserves gate selection and failure modes. */
import { githubCondition } from "../helpers/github-expression.js";
import { describe, expect, it } from "vitest";

import { jobOf, loadWorkflow } from "../helpers/workflow-test-utils.js";

const workflow = loadWorkflow(".github/workflows/quality.yml");

/**
 * Evaluate the shipped scheduler condition for either planner.
 * @param combine Whether planning checks share a runner.
 * @param selectedResult The selected planner result.
 * @param count How many gates were planned.
 * @returns Whether the gate matrix runs.
 */
function runsGates(
  combine: boolean,
  selectedResult: string,
  count = "1"
): boolean {
  const condition =
    jobOf(workflow, "declared_gates").if?.replace(/^\$\{\{|\}\}$/gu, "") ??
    "false";
  return githubCondition(condition, {
    inputs: { combine_planning_checks: combine },
    needs: {
      gate_plan: {
        result: combine ? selectedResult : "success",
        outputs: { count },
      },
      gate_legs: {
        result: combine ? "skipped" : selectedResult,
        outputs: { count },
      },
    },
  });
}

describe("combined quality planning", () => {
  it("is opt-in because a caller may require separate planning contexts", () => {
    expect(
      workflow.on?.workflow_call?.inputs?.combine_planning_checks?.default
    ).toBe(false);
    for (const job of ["workflow_contract", "gate_legs"]) {
      expect(jobOf(workflow, job).if).toBe(
        "${{ !inputs.combine_planning_checks }}"
      );
    }
    expect(jobOf(workflow, "gate_plan").if).toBeUndefined();
  });

  it("runs the exact same compatibility and gate-planning scripts", () => {
    const combined = jobOf(workflow, "gate_plan").steps ?? [];
    const compatibility = combined.find(step => step.name?.startsWith("🔖"));
    const standalone = jobOf(workflow, "workflow_contract").steps?.[0];
    expect(compatibility?.run).toBe(standalone?.run);
    expect(compatibility?.env).toEqual(standalone?.env);
    const legs = combined.find(step => step.id === "legs");
    const original = jobOf(workflow, "gate_legs").steps?.find(
      step => step.id === "legs"
    );
    expect(legs?.run).toBe(original?.run);
    expect(legs?.env).toEqual(original?.env);
    expect(legs?.if).toBe(
      "always() && !cancelled() && inputs.combine_planning_checks"
    );
    for (const step of [compatibility, legs]) {
      expect(step?.run?.length).toBeGreaterThan(100);
      expect(step).not.toHaveProperty("continue-on-error");
    }
  });

  it.each([false, true])(
    "mode %s preserves successful, failed, and empty plans",
    combine => {
      expect(runsGates(combine, "success")).toBe(true);
      expect(runsGates(combine, "success", "0")).toBe(false);
      expect(runsGates(combine, "failure")).toBe(false);
      expect(runsGates(combine, "cancelled")).toBe(false);
      expect(runsGates(combine, "skipped")).toBe(false);
    }
  );

  it("retains individually named gates and their required/optional/off executor", () => {
    expect(jobOf(workflow, "declared_gates").name).toBe("${{ matrix.label }}");
    const steps = jobOf(workflow, "declared_gates").steps ?? [];
    const executions = steps.filter(step => step.run?.includes("GATE_TASK"));
    expect(executions.length).toBeGreaterThan(0);
    expect(JSON.stringify(steps)).toContain("matrix.level");
    expect(JSON.stringify(steps)).toContain("matrix.action");
  });
});
