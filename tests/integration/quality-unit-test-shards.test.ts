/**
 * `unit_test_shards`: the sharded 🧪 Run Unit Tests job (CodySwannGT/lisa#4479).
 *
 * The contract has two halves, and both are pinned here. With the default of
 * 1, `test_unit` is the job it always was, under the same name and with the
 * same outputs, because a ruleset context and seven downstream readers key on
 * it. With more, `test_unit` becomes the aggregate. A matrix of shard legs runs
 * the suite, and `test_unit` merges their coverage and enforces the project's
 * floor once. It is still the single `🧪 Run Unit Tests` context, so it must
 * fail when the plan failed or any shard failed, was cancelled, or never ran.
 *
 * The shell bodies are executed, not string-matched, wherever they decide
 * something.
 */
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { jobIn, stepsIn, workflow } from "./quality-gate-facade-fixture.js";
import {
  executeStep,
  stepNamed as step,
  type ShardSuiteJob as Job,
} from "./quality-unit-test-shards-fixture.js";

const SKIP_TOKEN =
  "!contains(format(',{0},', inputs.skip_jobs), ',test:unit,')";
const PLAN_SKIP =
  "(needs.gate_plan.result != 'success' || !contains(needs.gate_plan.outputs.plan, '\"test_unit\":\"skip\"'))";
const SKIP_CONDITIONS = `${SKIP_TOKEN} && ${PLAN_SKIP}`;
const TESTS_RAN =
  "steps.gate_run.outcome == 'success' || steps.gate_run.outcome == 'failure' || steps.test_coverage.outcome == 'success' || steps.test_coverage.outcome == 'failure'";

const unit = jobIn("test_unit") as Job;
const plan = jobIn("test_unit_shard_plan") as Job;
const shard = jobIn("test_unit_shard") as Job;
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

describe("the unit_test_shards input", () => {
  it("is a number that defaults to one unsharded job", () => {
    expect(workflow.on?.workflow_call?.inputs?.unit_test_shards).toMatchObject({
      type: "number",
      default: 1,
      required: false,
    });
  });
});

describe("test_unit keeps its identity at every shard count", () => {
  it("keeps the static name the ruleset context resolves", () => {
    expect(unit.name).toBe("🧪 Run Unit Tests");
    expect(unit.strategy).toBeUndefined();
  });

  it("is the only job whose check context could satisfy that ruleset entry", () => {
    // A skipped or idle matrix context can show green, so no new job may post
    // a name that equals or merely contains the aggregate's.
    const claimants = Object.entries(workflow.jobs)
      .filter(([, job]) => (job.name ?? "").includes("Run Unit Tests"))
      .map(([id]) => id);
    expect(claimants).toEqual(["test_unit"]);
  });

  it("keeps the outputs downstream readers take", () => {
    expect(
      Object.keys(unit.outputs ?? {}).sort((left, right) =>
        left.localeCompare(right)
      )
    ).toEqual(["coverage_artifact_id", "registry_path"]);
  });

  it("waits for the shards without letting a skipped shard skip it", () => {
    expect(unit.needs).toEqual([
      "gate_plan",
      "test_unit_shard_plan",
      "test_unit_shard",
    ]);
    expect(unit.if).toBe(
      `\${{ always() && !cancelled() && ${SKIP_CONDITIONS} }}`
    );
  });
});

describe("test_unit_shard_plan", () => {
  const compute = step(
    "test_unit_shard_plan",
    "🧮 Compute the unit-test shard matrix"
  );

  it("runs only when the caller asked for shards and the gate is not off", () => {
    expect(plan.name).toBe("🧮 Plan Unit-Test Shards");
    expect(plan.if).toBe(
      `\${{ always() && !cancelled() && inputs.unit_test_shards != 1 && ${PLAN_SKIP} }}`
    );
    expect(plan.outputs).toEqual({
      shards: "${{ steps.plan.outputs.shards }}",
      nonce: "${{ steps.plan.outputs.nonce }}",
    });
    expect(compute.env).toEqual({
      SHARDS: "${{ inputs.unit_test_shards }}",
      SKIP_JOBS: "${{ inputs.skip_jobs }}",
    });
  });

  it("carries no skip_jobs token, so test:unit still names one job", () => {
    // The registry derives SKIP_JOB_TOKENS from job conditions; a second job
    // on the token would flip what gateForSkipJob("test:unit") advertises.
    expect(plan.if).not.toContain("skip_jobs");
    expect(shard.if).not.toContain("skip_jobs");
  });

  it("refuses to shard a suite the same caller skips", () => {
    const result = execute(compute.run, {
      SHARDS: "4",
      SKIP_JOBS: "lint,test:unit",
    });

    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain(
      "::error title=unit_test_shards contradicts skip_jobs::"
    );
    expect(result.output).toBe("");
    expect(
      execute(compute.run, { SHARDS: "4", SKIP_JOBS: "test:unit:watch" }).status
    ).toBe(0);
  });

  it.each([
    ["2", "[1,2]"],
    ["4", "[1,2,3,4]"],
    ["20", `[${Array.from({ length: 20 }, (_, i) => i + 1).join(",")}]`],
  ])("lays out %s shards", (shards, matrix) => {
    const result = execute(compute.run, { SHARDS: shards });

    expect(result.status, result.stdout).toBe(0);
    expect(result.output).toContain(`shards=${matrix}\n`);
    expect(result.output).toMatch(/nonce=[0-9a-f-]{36}\n/);
  });

  it("gives every call its own nonce", () => {
    const nonce = (): string =>
      /nonce=(.*)/.exec(execute(compute.run, { SHARDS: "2" }).output)?.[1] ??
      "";
    expect(nonce()).not.toBe(nonce());
  });

  it.each(["0", "21", "-2", "2.5", "four", ""])(
    "refuses %j instead of guessing a layout",
    shards => {
      const result = execute(compute.run, { SHARDS: shards });

      expect(result.status).not.toBe(0);
      expect(result.stdout).toContain(
        "::error title=unit_test_shards is invalid::"
      );
      expect(result.output).toBe("");
    }
  );
});

describe("test_unit_shard", () => {
  it("is a matrix over the plan that lets every shard finish", () => {
    expect(shard.needs).toEqual(["gate_plan", "test_unit_shard_plan"]);
    expect(shard.if).toBe(
      "${{ always() && !cancelled() && needs.test_unit_shard_plan.result == 'success' }}"
    );
    expect(shard.strategy).toEqual({
      "fail-fast": false,
      matrix: {
        shard:
          "${{ fromJSON(needs.test_unit_shard_plan.outputs.shards || '[1]') }}",
      },
    });
    expect(shard["timeout-minutes"]).toBe(unit["timeout-minutes"]);
  });

  it("names each leg so none can be mistaken for the aggregate context", () => {
    expect(shard.name).toBe(
      "🧪 Unit Tests shard ${{ matrix.shard }}/${{ inputs.unit_test_shards }}"
    );
  });

  it("copies every other step from the unsharded job exactly, in order", () => {
    // The copies are what make the leg the same run as test_unit; this is the
    // only thing that keeps them from drifting apart.
    const own = [
      "🧩 Arm this unit-test shard",
      "🧾 Prove this shard ran only its slice",
      "📤 Upload this shard's results",
    ];
    const copied = stepsIn("test_unit_shard").filter(
      s => !own.includes(s.name ?? "")
    );
    const names = copied.map(s => s.name);
    expect(copied).toEqual(
      stepsIn("test_unit").filter(s => names.includes(s.name))
    );
    for (const id of ["gate", "check_script", "gate_run", "test_coverage"])
      expect(
        copied.some(s => s.id === id),
        id
      ).toBe(true);
  });

  it("arms the shard before the test command runs", () => {
    const steps = stepsIn("test_unit_shard");
    const arm = steps.findIndex(s => s.name === "🧩 Arm this unit-test shard");
    expect(arm).toBeGreaterThan(-1);
    expect(arm).toBeLessThan(steps.findIndex(s => s.id === "gate_run"));

    const armed = execute(steps[arm]?.run, { SHARD: "3", TOTAL: "4" });

    expect(armed.status, armed.stdout).toBe(0);
    expect(armed.env).toBe(
      `LISA_TEST_SHARD=3/4\nLISA_TEST_SHARD_OUTPUT=${armed.runnerTemp}/lisa-unit-test-shard\n`
    );
    expect(
      fs.statSync(`${armed.runnerTemp}/lisa-unit-test-shard`).isDirectory()
    ).toBe(true);
  });

  it("refuses a leg whose test command never applied the shard", () => {
    const proof = step(
      "test_unit_shard",
      "🧾 Prove this shard ran only its slice"
    );
    expect(proof.if).toBe(`always() && (${TESTS_RAN})`);
    const root = fs.mkdtempSync(path.join(tmpdir(), "lisa-shard-proof-"));
    roots.push(root);

    const unapplied = execute(proof.run, { LISA_TEST_SHARD_OUTPUT: root });
    expect(unapplied.status).not.toBe(0);
    expect(unapplied.stdout).toContain(
      "::error title=Unit-test shard was not applied::"
    );

    fs.writeFileSync(path.join(root, "lisa-shard-receipt.json"), "{}");
    expect(execute(proof.run, { LISA_TEST_SHARD_OUTPUT: root }).status).toBe(0);
  });

  it("uploads each leg under the plan's per-call nonce", () => {
    const upload = step("test_unit_shard", "📤 Upload this shard's results");
    expect(upload.if).toBe(`always() && (${TESTS_RAN})`);
    expect(upload.with).toMatchObject({
      name: "unit-test-shard-${{ needs.test_unit_shard_plan.outputs.nonce }}-${{ matrix.shard }}",
      path: "${{ runner.temp }}/lisa-unit-test-shard",
      "if-no-files-found": "error",
    });
  });

  it("leaves the unproven verdict and coverage upload to the aggregate", () => {
    const names = stepsIn("test_unit_shard").map(s => s.name);
    expect(names).not.toContain("⏭️ Skip unit tests (no test:unit script)");
    expect(names).not.toContain("📤 Upload coverage for the scan job");
  });
});
