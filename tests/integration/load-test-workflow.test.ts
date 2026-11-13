/**
 * `load-test.yml` must fail closed when no test ran (CodySwannGT/lisa#4526).
 *
 * The Run step executed under `set +e` and exited nonzero only when
 * `fail_on_threshold` was true, so a missing `./scripts/k6-run.sh` (exit 127),
 * a missing script, a k6 script error and a k6 configuration error (exit 104)
 * were all reported green under `fail_on_threshold: false` — with a summary
 * claiming "Test failed thresholds" when no threshold was ever evaluated. And
 * an omitted `virtual_users` (an untyped-default `number`, which GitHub
 * renders as `0`) exported `K6_VUS=0`, which k6 refuses with exit 104.
 *
 * Only a threshold breach (k6 exit 99) may be suppressed by
 * `fail_on_threshold: false`. Every other nonzero status means the test could
 * not run, and fails the job.
 *
 * The workflow cases EXECUTE the shipped step bodies (see
 * `tests/integration/support/load-test-workflow-harness.ts`) with stub `k6`
 * and runner binaries; grepping the workflow would prove nothing about its
 * behaviour. The template cases at the end read file contents. Runner, cloud,
 * thresholds_config and input-warning cases live in
 * `load-test-workflow-runner.test.ts`. Expected values are hardcoded, per the
 * Test Isolation house rule.
 * @module tests/integration/load-test-workflow
 */
import fs from "node:fs";
import path from "node:path";

import { load as loadYaml } from "js-yaml";
import { describe, expect, it } from "vitest";

import {
  loadTestStep,
  runLoadTest,
} from "./support/load-test-workflow-harness.js";

/** The caller every case starts from: a smoke run against a staging host. */
const BASE_INPUTS = {
  environment: "staging",
  base_url: "https://staging.example.test",
  test_scenario: "smoke",
} as const;

/** Where the default branch looks for a scenario when no runner is shipped. */
const SMOKE_SCENARIO = ".github/k6/scenarios/smoke.js";

/** A consumer-supplied script passed as `test_script`. */
const CUSTOM_SCRIPT = ".github/k6/scripts/api-test.js";

/** Summary wording reserved for a real threshold breach (k6 exit 99). */
const THRESHOLD_WORDING = "failed thresholds";

/** load-test.yml's three steps as shipped before #4526, pinned. */
const PRE_FIX_WORKFLOW = path.join(
  process.cwd(),
  "tests/integration/support/fixtures/load-test-pre-fix.yml"
);

const SUPPRESSED = { ...BASE_INPUTS, fail_on_threshold: false } as const;
const ENFORCED = { ...BASE_INPUTS, fail_on_threshold: true } as const;

describe("load-test.yml fails closed when no test ran (#4526)", () => {
  describe("missing runner or script", () => {
    it("fails, naming the runner and scenario, with no runner and no scenario even under fail_on_threshold: false", () => {
      const result = runLoadTest({ inputs: SUPPRESSED });

      expect(result.runStatus).not.toBe(0);
      expect(result.runLog).toContain("./scripts/k6-run.sh");
      expect(result.runLog).toContain(SMOKE_SCENARIO);
      expect(result.outputs["passed"]).toBe("false");
      expect(result.outputs["exit_code"]).toBe("1");
      expect(result.stepSummary).not.toContain(THRESHOLD_WORDING);
      expect(result.k6Argv).toBeUndefined();
    });

    it("runs k6 on the scenario file when no runner is shipped but the scenario exists", () => {
      const result = runLoadTest({
        inputs: SUPPRESSED,
        files: [SMOKE_SCENARIO],
      });

      expect(result.runStatus).toBe(0);
      expect(result.k6Argv?.[0]).toBe("run");
      expect(result.k6Argv?.at(-1)).toBe(SMOKE_SCENARIO);
      expect(result.runLog).toContain("iterations");
      expect(result.outputs["passed"]).toBe("true");
      expect(result.outputs["exit_code"]).toBe("0");
    });

    it("keeps using an executable ./scripts/k6-run.sh when the consumer ships one", () => {
      const result = runLoadTest({
        inputs: SUPPRESSED,
        runnerExit: 0,
        files: [SMOKE_SCENARIO],
      });

      expect(result.runStatus).toBe(0);
      expect(result.runnerArgv).toContain("--scenario");
      expect(result.k6Argv).toBeUndefined();
    });

    it("fails, naming the path, when test_script does not exist even under fail_on_threshold: false", () => {
      const result = runLoadTest({
        inputs: { ...SUPPRESSED, test_script: CUSTOM_SCRIPT },
      });

      expect(result.runStatus).not.toBe(0);
      expect(result.runLog).toContain(CUSTOM_SCRIPT);
      expect(result.outputs["passed"]).toBe("false");
      expect(result.k6Argv).toBeUndefined();
    });
  });

  describe("exit classification", () => {
    const ran = { files: [CUSTOM_SCRIPT] } as const;

    it("passes a clean run and reports passed=true", () => {
      const result = runLoadTest({
        ...ran,
        inputs: { ...ENFORCED, test_script: CUSTOM_SCRIPT },
      });

      expect(result.runStatus).toBe(0);
      expect(result.runLog).toContain("iterations");
      expect(result.outputs["passed"]).toBe("true");
      expect(result.outputs["exit_code"]).toBe("0");
      expect(result.stepSummary).toContain("passed all thresholds");
    });

    it("suppresses a threshold breach (99) under fail_on_threshold: false, and says thresholds failed", () => {
      const result = runLoadTest({
        ...ran,
        k6Exit: 99,
        inputs: { ...SUPPRESSED, test_script: CUSTOM_SCRIPT },
      });

      expect(result.runStatus).toBe(0);
      expect(result.outputs["passed"]).toBe("false");
      expect(result.outputs["exit_code"]).toBe("99");
      expect(result.stepSummary).toContain(THRESHOLD_WORDING);
    });

    it("fails with exit 99 on a threshold breach under fail_on_threshold: true", () => {
      const result = runLoadTest({
        ...ran,
        k6Exit: 99,
        inputs: { ...ENFORCED, test_script: CUSTOM_SCRIPT },
      });

      expect(result.runStatus).toBe(99);
      expect(result.outputs["exit_code"]).toBe("99");
    });

    it.each([104, 107, 126, 127, 255])(
      "fails on k6 exit %i regardless of fail_on_threshold, and never calls it a threshold result",
      code => {
        const result = runLoadTest({
          ...ran,
          k6Exit: code,
          inputs: { ...SUPPRESSED, test_script: CUSTOM_SCRIPT },
        });

        expect(result.runStatus).toBe(code);
        expect(result.outputs["passed"]).toBe("false");
        expect(result.outputs["exit_code"]).toBe(String(code));
        expect(result.stepSummary).not.toContain(THRESHOLD_WORDING);
        expect(result.stepSummary).toContain(`exit code ${code}`);
      }
    );

    it("fails when the shipped runner itself errors, regardless of fail_on_threshold", () => {
      const result = runLoadTest({ inputs: SUPPRESSED, runnerExit: 127 });

      expect(result.runStatus).toBe(127);
      expect(result.outputs["exit_code"]).toBe("127");
      expect(result.runLog).toContain("must exit with k6's own status");
    });
  });

  describe("virtual_users override", () => {
    it("exports no K6_VUS and passes no --vus when virtual_users is omitted", () => {
      const prepared = runLoadTest({
        inputs: SUPPRESSED,
        files: [SMOKE_SCENARIO],
      });
      const runner = runLoadTest({ inputs: SUPPRESSED, runnerExit: 0 });

      expect(prepared.preparedEnv["K6_VUS"]).toBeUndefined();
      expect(runner.runnerArgv).not.toContain("--vus");
    });

    it("exports K6_VUS=50 and passes --vus 50 when virtual_users is 50", () => {
      const inputs = { ...SUPPRESSED, virtual_users: 50 };
      const prepared = runLoadTest({ inputs, files: [SMOKE_SCENARIO] });
      const runner = runLoadTest({ inputs, runnerExit: 0 });

      expect(prepared.preparedEnv["K6_VUS"]).toBe("50");
      const at = runner.runnerArgv?.indexOf("--vus") ?? -1;
      expect(runner.runnerArgv?.[at + 1]).toBe("50");
    });

    it("echoes the effective script, VUs and duration before running", () => {
      const result = runLoadTest({
        inputs: { ...SUPPRESSED, virtual_users: 50, test_duration: "5m" },
        files: [SMOKE_SCENARIO],
      });

      expect(result.runLog).toContain(SMOKE_SCENARIO);
      expect(result.runLog).toMatch(/VUs:\s*50/u);
      expect(result.runLog).toMatch(/duration:\s*5m/u);
    });
  });

  it("interpolates no ${{ }} expression into the Prepare, Run or summary scripts", () => {
    for (const id of ["prepare_test", "run_test", "generate_summary"]) {
      expect(loadTestStep(id).run, id).not.toContain("${{");
    }
  });

  describe("rejection control: the pre-fix workflow reported a missing runner green", () => {
    it("runs the pinned pre-fix steps through the same harness and gets status 0", () => {
      // The same caller as the first case above, against the workflow as it
      // shipped before this fix. Green here is the defect; it proves the
      // harness really delivers the missing-runner case the fixed workflow
      // now fails, rather than failing it for some reason of its own.
      const result = runLoadTest({
        inputs: SUPPRESSED,
        workflowFile: PRE_FIX_WORKFLOW,
      });

      expect(result.runStatus).toBe(0);
      expect(result.runLog).toContain("./scripts/k6-run.sh");
      expect(result.outputs["exit_code"]).toBe("127");
      expect(result.stepSummary).toContain(THRESHOLD_WORDING);
    });
  });
});

describe("k6 scenario templates survive a failed request (#4526)", () => {
  const smoke = fs.readFileSync(
    path.join(process.cwd(), "nestjs/create-only", SMOKE_SCENARIO),
    "utf-8"
  );

  it("smoke.js guards a null body instead of dereferencing r.body.length", () => {
    expect(smoke).not.toMatch(/r\.body\.length/u);
    expect(smoke).toContain('(r.body || "").length > 0');
  });

  it("the NestJS template ships the scenario its deploy caller runs, so a fresh consumer's load test executes", () => {
    const deploy = loadYaml(
      fs.readFileSync(
        path.join(
          process.cwd(),
          "nestjs/create-only/.github/workflows/deploy.yml"
        ),
        "utf-8"
      )
    ) as {
      readonly jobs: Readonly<
        Record<string, { readonly with?: Readonly<Record<string, unknown>> }>
      >;
    };
    const caller = deploy.jobs["load_testing"]?.with ?? {};

    expect(caller["test_scenario"]).toBe("smoke");
    expect(caller["test_script"]).toBeUndefined();
    expect(
      fs.existsSync(
        path.join(process.cwd(), "nestjs/create-only", SMOKE_SCENARIO)
      )
    ).toBe(true);
  });
});
