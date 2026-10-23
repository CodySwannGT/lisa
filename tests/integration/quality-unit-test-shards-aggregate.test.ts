/**
 * `test_unit` as the aggregate of the unit-test shards (CodySwannGT/lisa#4479).
 *
 * With `unit_test_shards` above 1, `test_unit` is the one `🧪 Run Unit Tests`
 * context, so it must go red when the shard plan failed (a refused input) or
 * any shard failed, was cancelled, or never ran, and it must merge every
 * shard's results before its test command. Split from
 * `quality-unit-test-shards.test.ts` for the file-length cap.
 */
import * as fs from "node:fs";

import { afterEach, describe, expect, it } from "vitest";

import { stepsIn, workflow } from "./quality-gate-facade-fixture.js";
import {
  evaluateCondition,
  executeStep,
  stepNamed as step,
} from "./quality-unit-test-shards-fixture.js";

const PARTIAL_RUN =
  "inputs.unit_test_shards != 1 && (needs.test_unit_shard_plan.result != 'success' || needs.test_unit_shard.result != 'success')";
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});

/**
 * Run one step body in a registered scratch directory.
 * @param body - Step `run:` source
 * @param env - Step environment
 * @returns What the step did
 */
const execute = (body: string | undefined, env: Record<string, string>) =>
  executeStep(body, env, root => roots.push(root));

/**
 * Whether the aggregate's guard step runs (and so fails the job) for one set
 * of upstream results, evaluated from the step's own `if:`.
 * @param shards - The caller's `unit_test_shards`
 * @param planResult - `needs.test_unit_shard_plan.result`
 * @param shardResult - `needs.test_unit_shard.result`
 * @returns The condition's value
 */
function guardFires(
  shards: number,
  planResult: string,
  shardResult: string
): boolean {
  return evaluateCondition(
    step("test_unit", "🚨 Fail if the unit-test shards did not pass").if ?? "",
    {
      "inputs.unit_test_shards": shards,
      "needs.test_unit_shard_plan.result": planResult,
      "needs.test_unit_shard.result": shardResult,
    }
  );
}

describe("test_unit as the aggregate", () => {
  const guard = step(
    "test_unit",
    "🚨 Fail if the unit-test shards did not pass"
  );

  it("refuses a partial shard run before doing anything else", () => {
    expect(stepsIn("test_unit")[0]?.name).toBe(guard.name);
    expect(guard.if).toBe(PARTIAL_RUN);
    expect(guard.env).toEqual({
      PLAN_RESULT: "${{ needs.test_unit_shard_plan.result }}",
      SHARD_RESULT: "${{ needs.test_unit_shard.result }}",
      SHARDS: "${{ inputs.unit_test_shards }}",
    });

    const result = execute(guard.run, {
      SHARD_RESULT: "cancelled",
      PLAN_RESULT: "success",
      SHARDS: "4",
    });
    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain("shard matrix: 'cancelled'");
  });

  it.each([
    [4, "success", "failure"],
    [4, "success", "cancelled"],
    [4, "success", "skipped"],
    // A plan that refused 0, 21 or 2.5 fails, and its matrix never runs.
    [0, "failure", "skipped"],
    [21, "failure", "skipped"],
    [2.5, "failure", "skipped"],
  ])(
    "goes red at %s shards when the plan is %s and the matrix %s",
    (shards, planResult, shardResult) => {
      expect(guardFires(shards, planResult, shardResult)).toBe(true);
    }
  );

  it("stays out of the way when every shard passed, or at the default", () => {
    expect(guardFires(4, "success", "success")).toBe(false);
    expect(guardFires(1, "skipped", "skipped")).toBe(false);
  });

  it("names the failed plan in its verdict", () => {
    const result = execute(guard.run, {
      SHARD_RESULT: "skipped",
      PLAN_RESULT: "failure",
      SHARDS: "21",
    });
    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain("shard plan: 'failure'");
    expect(result.stdout).toContain("unit_test_shards: 21");
  });

  it("downloads every leg and arms the merge before the test command", () => {
    const steps = stepsIn("test_unit");
    const download = steps.findIndex(s => s.id === "shard_download");
    const arm = steps.findIndex(
      s => s.name === "🧩 Arm the unit-test shard merge"
    );
    const run = steps.findIndex(s => s.id === "gate_run");
    expect(download).toBeGreaterThan(-1);
    expect(download).toBeLessThan(arm);
    expect(arm).toBeLessThan(run);

    expect(steps[download]?.if).toBe(
      "inputs.unit_test_shards != 1 && (steps.gate.outputs.configured == 'true' || (steps.gate.outputs.configured == 'false' && steps.check_script.outputs.exists == 'true'))"
    );
    expect(steps[download]?.with).toEqual({
      pattern:
        "unit-test-shard-${{ needs.test_unit_shard_plan.outputs.nonce }}-*",
      path: "${{ runner.temp }}/lisa-unit-test-shards",
    });
    expect(steps[arm]?.if).toBe("steps.shard_download.outcome == 'success'");

    const armed = execute(steps[arm]?.run, { TOTAL: "4" });
    expect(armed.status, armed.stdout).toBe(0);
    // As step outputs; quality-unit-test-shards-env-scope.test.ts pins
    // that only the test command binds them.
    expect(armed.output).toBe(
      `merge=${armed.runnerTemp}/lisa-unit-test-shards\ntotal=4\n`
    );
  });
});

describe("downstream readers", () => {
  it("keep reading test_unit, never a shard leg", () => {
    for (const [id, job] of Object.entries(workflow.jobs)) {
      if (id === "test_unit") continue;
      expect(JSON.stringify(job), id).not.toContain("needs.test_unit_shard.");
    }
  });
});
