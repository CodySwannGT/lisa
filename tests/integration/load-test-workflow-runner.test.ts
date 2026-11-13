/**
 * `load-test.yml` runner, cloud, thresholds_config and input-warning cases
 * (CodySwannGT/lisa#4526, quality-review follow-ups).
 *
 * - A `./scripts/k6-run.sh` that exists but cannot execute fails closed (126)
 *   instead of quietly running the scenario file in its place.
 * - The runner no longer receives `--no-thresholds`, so its exit 99 reaches
 *   the workflow and `fail_on_threshold` decides, reporting the breach either
 *   way.
 * - A cloud run is `k6 cloud run <script>`: `k6 run` has no `--cloud` flag and
 *   refuses it as unknown (proven against k6 v2.4.0).
 * - A `thresholds_config` that does not exist fails before anything runs.
 * - A `virtual_users` value that is set but unusable is named in a warning.
 *
 * Every case EXECUTES the shipped step bodies through
 * `tests/integration/support/load-test-workflow-harness.ts`. Expected values
 * are hardcoded, per the Test Isolation house rule.
 * @module tests/integration/load-test-workflow-runner
 */
import { describe, expect, it } from "vitest";

import { runLoadTest } from "./support/load-test-workflow-harness.js";

const SUPPRESSED = {
  environment: "staging",
  base_url: "https://staging.example.test",
  test_scenario: "smoke",
  fail_on_threshold: false,
} as const;

const SMOKE_SCENARIO = ".github/k6/scenarios/smoke.js";
const CUSTOM_SCRIPT = ".github/k6/scripts/api-test.js";
const THRESHOLDS = ".github/k6/thresholds.json";

describe("load-test.yml with a repository-provided runner (#4526)", () => {
  it("fails closed with 126 when ./scripts/k6-run.sh exists but is not executable", () => {
    const result = runLoadTest({
      inputs: SUPPRESSED,
      runnerExit: 0,
      runnerMode: 0o644,
      files: [SMOKE_SCENARIO],
    });

    expect(result.runStatus).toBe(126);
    expect(result.outputs["exit_code"]).toBe("126");
    expect(result.outputs["passed"]).toBe("false");
    expect(result.runLog).toContain("chmod +x ./scripts/k6-run.sh");
    expect(result.runLog).toContain("test_script");
    expect(result.k6Argv).toBeUndefined();
    expect(result.runnerArgv).toBeUndefined();
  });

  it("reports a runner's threshold breach (99) without failing under fail_on_threshold: false", () => {
    const result = runLoadTest({ inputs: SUPPRESSED, runnerExit: 99 });

    expect(result.runStatus).toBe(0);
    expect(result.outputs["exit_code"]).toBe("99");
    expect(result.outputs["passed"]).toBe("false");
  });

  it("never passes --no-thresholds to the runner", () => {
    const result = runLoadTest({ inputs: SUPPRESSED, runnerExit: 0 });

    expect(result.runnerArgv).toContain("--scenario");
    expect(result.runnerArgv).not.toContain("--no-thresholds");
  });

  it("warns that thresholds_config is not passed to the runner", () => {
    const result = runLoadTest({
      inputs: { ...SUPPRESSED, thresholds_config: THRESHOLDS },
      runnerExit: 0,
      files: [THRESHOLDS],
    });

    expect(result.runStatus).toBe(0);
    expect(result.runLog).toMatch(/::warning title=thresholds_config/u);
    expect(result.runnerArgv).not.toContain(THRESHOLDS);
  });
});

describe("load-test.yml cloud runs (#4526)", () => {
  it("runs `k6 cloud run <script>` with no local --out files", () => {
    const result = runLoadTest({
      inputs: { ...SUPPRESSED, test_script: CUSTOM_SCRIPT, cloud_run: true },
      files: [CUSTOM_SCRIPT],
    });

    expect(result.runStatus).toBe(0);
    expect(result.k6Argv?.slice(0, 2)).toEqual(["cloud", "run"]);
    expect(result.k6Argv?.at(-1)).toBe(CUSTOM_SCRIPT);
    expect(result.k6Argv).not.toContain("--out");
    expect(result.k6Argv).not.toContain("--cloud");
  });

  it("keeps the local --out files on a local run", () => {
    const result = runLoadTest({
      inputs: { ...SUPPRESSED, test_script: CUSTOM_SCRIPT },
      files: [CUSTOM_SCRIPT],
    });

    expect(result.k6Argv?.[0]).toBe("run");
    expect(result.k6Argv).toContain("--out");
  });
});

describe("load-test.yml thresholds_config (#4526)", () => {
  it("fails, naming the input and path, when thresholds_config does not exist", () => {
    const result = runLoadTest({
      inputs: {
        ...SUPPRESSED,
        test_script: CUSTOM_SCRIPT,
        thresholds_config: THRESHOLDS,
      },
      files: [CUSTOM_SCRIPT],
    });

    expect(result.runStatus).toBe(1);
    expect(result.outputs["exit_code"]).toBe("1");
    expect(result.runLog).toContain(`thresholds_config '${THRESHOLDS}'`);
    expect(result.k6Argv).toBeUndefined();
  });

  it("passes an existing thresholds_config to k6 as --config", () => {
    const result = runLoadTest({
      inputs: {
        ...SUPPRESSED,
        test_script: CUSTOM_SCRIPT,
        thresholds_config: THRESHOLDS,
      },
      files: [CUSTOM_SCRIPT, THRESHOLDS],
    });

    const at = result.k6Argv?.indexOf("--config") ?? -1;
    expect(at).toBeGreaterThan(-1);
    expect(result.k6Argv?.[at + 1]).toBe(THRESHOLDS);
  });
});

describe("load-test.yml virtual_users warnings (#4526)", () => {
  it.each(["2.5", "-3"])("warns, naming %j, and exports no K6_VUS", value => {
    const result = runLoadTest({
      inputs: { ...SUPPRESSED, virtual_users: value },
      files: [SMOKE_SCENARIO],
    });

    expect(result.prepareLog).toContain(
      `::warning title=virtual_users ignored::virtual_users '${value}'`
    );
    expect(result.preparedEnv["K6_VUS"]).toBeUndefined();
  });

  it("stays silent for 0, the omitted value", () => {
    const result = runLoadTest({
      inputs: { ...SUPPRESSED, virtual_users: 0 },
      files: [SMOKE_SCENARIO],
    });

    expect(result.prepareLog).not.toContain("::warning");
    expect(result.preparedEnv["K6_VUS"]).toBeUndefined();
  });
});
