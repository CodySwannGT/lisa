/**
 * Workflow contract for per-file test timing artifacts (CodySwannGT/lisa#4592):
 * the unit job, every unit shard leg and the integration job of the shipped
 * `quality.yml` upload `tmp/test-timings` under a unique, run-scoped name, on
 * pass or fail, and only in Lisa's own repository so callers run no such step.
 */
import * as fs from "node:fs";
import * as path from "node:path";

import yaml from "js-yaml";
import { describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");
const QUALITY_YML = path.join(REPO_ROOT, ".github", "workflows", "quality.yml");

/** The parts of a step this contract reads. */
interface Step {
  readonly name?: string;
  readonly if?: string;
  readonly uses?: string;
  readonly with?: Readonly<Record<string, unknown>>;
}

const workflow = yaml.load(fs.readFileSync(QUALITY_YML, "utf8")) as {
  jobs: Record<string, { steps: readonly Step[] }>;
};

const PREFIX = "test-timings-${{ github.run_id }}-${{ github.run_attempt }}-";

/**
 * `test_integration` and its shard legs run one step list (#4599). Outside a
 * matrix `strategy.job-total` is 1 and the suffix is empty, so the unsharded
 * job keeps its `...-integration` name; each leg appends `-shard-<index>`.
 */
const LEG_SUFFIX =
  "${{ strategy.job-total > 1 && format('-shard-{0}', strategy.job-index) || '' }}";

const cases = [
  ["test_unit", `${PREFIX}unit`],
  ["test_unit_shard", `${PREFIX}unit-shard-\${{ matrix.shard }}`],
  ["test_integration", `${PREFIX}integration${LEG_SUFFIX}`],
] as const;

/**
 * The job's timing upload steps.
 * @param job - Job id
 * @returns Steps whose artifact name starts with test-timings-
 */
function timingSteps(job: string): readonly Step[] {
  return (workflow.jobs[job]?.steps ?? []).filter(step =>
    String(step.with?.["name"] ?? "").startsWith("test-timings-")
  );
}

describe("quality.yml test timing artifacts", () => {
  it.each(cases)("%s uploads its timings as %s", (job, name) => {
    const steps = timingSteps(job);
    expect(steps).toHaveLength(1);
    const [step] = steps;
    expect(step?.uses).toBe("actions/upload-artifact@v7");
    expect(step?.with).toEqual({
      name,
      path: "${{ inputs.working_directory || '.' }}/tmp/test-timings",
      "if-no-files-found": "ignore",
      "retention-days": 30,
    });
  });

  it.each(cases)("%s uploads on pass or fail, and only in Lisa itself", job => {
    expect(timingSteps(job)[0]?.if).toBe(
      "always() && github.repository == 'CodySwannGT/lisa'"
    );
  });

  it("uploads each integration shard leg's timings through the same step", () => {
    expect(timingSteps("test_integration_shard")).toEqual(
      timingSteps("test_integration")
    );
  });

  it("gives every upload a distinct name", () => {
    const names = cases.map(([job]) => timingSteps(job)[0]?.with?.["name"]);
    expect(new Set(names).size).toBe(cases.length);
  });

  it("declares the integration timing scope on both integration scripts", () => {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8")
    ) as { scripts: Record<string, string> };
    for (const script of ["test:integration", "test:integration:push"])
      expect(manifest.scripts[script]).toContain(
        "LISA_TEST_TIMINGS_SCOPE=integration"
      );
    expect(manifest.scripts["test:cov:unit"]).toContain(
      "LISA_COVERAGE_SCOPE=unit"
    );
  });
});
