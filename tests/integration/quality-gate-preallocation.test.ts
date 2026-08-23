/**
 * Proves an explicitly-off gate can stand down before GitHub allocates its
 * proving runner without letting planning ambiguity satisfy a required check.
 *
 * The existing in-job facade remains the execution authority. Planning is a
 * cost hint with one safe negative answer: `off`. Every other answer — an
 * absent declaration, an old resolver, malformed output, or a failed planner
 * job — must run the existing job and its current fallback unchanged.
 *
 * @module tests/integration/quality-gate-preallocation
 */

import * as fs from "fs-extra";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

import {
  QUALITY_JOB_GATES,
  qualityJobPlan,
} from "../../all/copy-overwrite/scripts/lisa-gates.mjs";
import { loadWorkflow } from "../helpers/workflow-test-utils.js";
import type { WorkflowJob } from "../helpers/workflow-test-utils.js";
import { boundedSpawnSync } from "../helpers/io-latency-budget.js";
import { GATES_SCRIPT, QUALITY_YML } from "./quality-gate-facade-fixture.js";

/** Workflow job fields used by the preallocation contract. */
interface PlannedWorkflowJob extends WorkflowJob {
  name?: string;
  needs?: string | string[];
  "runs-on"?: string;
}

/** The workflow parsed as the fields this contract inspects. */
const workflow = loadWorkflow(QUALITY_YML) as {
  jobs: Record<string, PlannedWorkflowJob>;
};

/** Every quality job that invokes the existing in-job gate facade. */
const facadeJobs = Object.entries(workflow.jobs)
  .filter(([, job]) => job.steps?.some(step => step.id === "gate"))
  .map(([jobId]) => jobId);

/** Every registry-mapped job that still lives in quality.yml. */
const plannedJobs = Object.keys(QUALITY_JOB_GATES).filter(job =>
  Object.hasOwn(workflow.jobs, job)
);

/**
 * Normalise either legal `needs:` shape.
 * @param job The workflow job to inspect.
 * @returns Every declared dependency as an array.
 */
function needsOf(job: PlannedWorkflowJob): string[] {
  if (Array.isArray(job.needs)) return job.needs;
  return job.needs ? [job.needs] : [];
}

describe("quality gate preallocation", () => {
  it("plans only an explicit off declaration as skip", () => {
    const plan = qualityJobPlan({
      gates: {
        "code-style": { "pull-request": "off" },
        "test-correctness": { "pull-request": "required" },
        "dependency-vulnerability": {
          "pull-request": { level: "optional", run: "security:audit" },
        },
      },
      moment: "pull-request",
    });

    expect(plan.lint).toBe("skip");
    expect(plan.test_unit).toBe("run");
    expect(plan.npm_security_scan).toBe("run");
    expect(plan.snyk).toBe("run");
    expect(plan.typecheck).toBe("run");
  });

  it("runs every existing job when no gate is declared", () => {
    const plan = qualityJobPlan({ gates: {}, moment: "pull-request" });

    expect(Object.keys(plan)).toEqual(Object.keys(QUALITY_JOB_GATES));
    expect(new Set(Object.values(plan))).toEqual(new Set(["run"]));
  });

  it("exposes the same plan through the shipped CLI", async () => {
    const project = await fs.mkdtemp(path.join(os.tmpdir(), "quality-plan-"));
    try {
      await fs.writeJson(path.join(project, "package.json"), {
        scripts: { lint: "oxlint" },
      });
      await fs.writeJson(path.join(project, ".lisa.config.json"), {
        gates: {
          "code-style": { "pull-request": "off" },
          "type-correctness": { "pull-request": "required" },
        },
      });

      const result = boundedSpawnSync({
        label: "the shipped quality preallocation planner",
        command: process.execPath,
        args: [GATES_SCRIPT, "quality-plan", "--moment=pull-request"],
        cwd: project,
      });

      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({
        lint: "skip",
        typecheck: "run",
        test_unit: "run",
      });
    } finally {
      await fs.remove(project);
    }
  });

  it("places one cheap planner ahead of every mapped quality job", () => {
    const planner = workflow.jobs.gate_plan;

    expect(planner).toBeDefined();
    expect(planner?.["runs-on"]).toBe("ubuntu-latest");
    expect(planner?.steps?.map(step => step.name)).toEqual([
      "📥 Checkout repository",
      "🗺️ Plan explicit-off gates",
    ]);
    expect(planner?.steps?.some(step => step.name?.includes("Setup"))).toBe(
      false
    );
    expect(
      planner?.steps?.some(step => step.name?.includes("Install dependencies"))
    ).toBe(false);

    expect(new Set(plannedJobs)).toEqual(new Set(facadeJobs));
    expect(plannedJobs).toHaveLength(27);
    for (const jobId of plannedJobs) {
      const job = workflow.jobs[jobId];
      expect(needsOf(job), `${jobId} must wait for gate_plan`).toContain(
        "gate_plan"
      );
      expect(job.if, `${jobId} must fail open to its existing proof`).toContain(
        "needs.gate_plan.result != 'success'"
      );
      expect(
        job.if,
        `${jobId} must skip only its explicit plan entry`
      ).toContain(`"${jobId}":"skip"`);
    }
  });

  it("makes planner ambiguity run the old jobs", () => {
    const planner = workflow.jobs.gate_plan;
    const planStep = planner?.steps?.find(step => step.id === "plan");

    expect(planStep?.run).toContain('PLAN="{}"');
    expect(planStep?.run).toContain("quality-plan");
    expect(planStep?.run).toContain("running every existing quality job");

    for (const jobId of plannedJobs) {
      const condition = workflow.jobs[jobId].if ?? "";
      expect(condition).toContain("always()");
      expect(condition).toContain("!cancelled()");
      expect(condition).toContain(
        `(needs.gate_plan.result != 'success' || !contains(needs.gate_plan.outputs.plan, '"${jobId}":"skip"'))`
      );
    }
  });
});
