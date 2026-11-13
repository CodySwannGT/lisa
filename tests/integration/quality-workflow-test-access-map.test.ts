/**
 * Workflow contract for the test-to-file access map (CodySwannGT/lisa#4593):
 * the unit job, every unit shard leg and the integration job of the shipped
 * `quality.yml` turn the tracer on only in Lisa's own PR runs, key it on the
 * PR's base commit, and upload `tmp/test-access-map/*.json` as
 * `test-access-map-<baseSha>-<run_id>-<job>` — the names
 * `scripts/fetch-test-access-map.mjs` parses.
 */
import * as fs from "node:fs";
import * as path from "node:path";

import yaml from "js-yaml";
import { describe, expect, it } from "vitest";

import { parseArtifacts } from "../../scripts/fetch-test-access-map.mjs";

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
  jobs: Record<
    string,
    { env?: Readonly<Record<string, string>>; steps: readonly Step[] }
  >;
};

const BASE = "${{ github.event.pull_request.base.sha }}";
const PREFIX = `test-access-map-${BASE}-\${{ github.run_id }}-`;

/** The per-leg suffix `test_integration` and its shard legs share (#4599). */
const LEG_SUFFIX =
  "${{ strategy.job-total > 1 && format('-shard-{0}', strategy.job-index) || '' }}";

/** Job, artifact name, rendered suffix, and what LEG_SUFFIX renders to there. */
const cases = [
  ["test_unit", `${PREFIX}unit`, "unit", ""],
  [
    "test_unit_shard",
    `${PREFIX}unit-shard-\${{ matrix.shard }}`,
    "unit-shard-3",
    "",
  ],
  // One step list: the suffix is empty outside a matrix and
  // `-shard-<index>` in a leg.
  ["test_integration", `${PREFIX}integration${LEG_SUFFIX}`, "integration", ""],
  [
    "test_integration_shard",
    `${PREFIX}integration${LEG_SUFFIX}`,
    "integration-shard-0",
    "-shard-0",
  ],
] as const;

/**
 * The job's access-map upload steps.
 * @param job - Job id
 * @returns Steps whose artifact name starts with test-access-map-
 */
function mapSteps(job: string): readonly Step[] {
  return (workflow.jobs[job]?.steps ?? []).filter(step =>
    String(step.with?.["name"] ?? "").startsWith("test-access-map-")
  );
}

describe("quality.yml test access map", () => {
  it.each(cases)("%s turns the tracer on only for Lisa's PR runs", job => {
    expect(workflow.jobs[job]?.env).toEqual({
      LISA_ACCESS_MAP:
        "${{ github.repository == 'CodySwannGT/lisa' && github.event.pull_request.base.sha != '' && '1' || '' }}",
      LISA_ACCESS_MAP_BASE_SHA: BASE,
      LISA_ACCESS_MAP_HEAD_SHA:
        "${{ github.event.pull_request.head.sha || github.sha }}",
    });
  });

  it.each(cases)("%s uploads its map as %s", (job, name) => {
    const steps = mapSteps(job);
    expect(steps).toHaveLength(1);
    const [step] = steps;
    expect(step?.uses).toBe("actions/upload-artifact@v7");
    expect(step?.if).toBe(
      "always() && github.repository == 'CodySwannGT/lisa' && github.event.pull_request.base.sha != ''"
    );
    expect(step?.with).toEqual({
      name,
      path: "${{ inputs.working_directory || '.' }}/tmp/test-access-map/*.json",
      "if-no-files-found": "ignore",
      overwrite: true,
      "retention-days": 30,
    });
  });

  it.each(cases)(
    "%s's artifact name is one the fetch script can parse",
    (_job, name, job, leg) => {
      const sha = "a".repeat(40);
      const rendered = name
        .replace(BASE, sha)
        .replace("${{ github.run_id }}", "123")
        .replace("${{ matrix.shard }}", "3")
        .replace(LEG_SUFFIX, leg);
      expect(rendered).toBe(`test-access-map-${sha}-123-${job}`);
      expect(
        parseArtifacts(JSON.stringify({ name: rendered, runId: 123 }))
      ).toEqual([
        { name: rendered, baseSha: sha, runId: "123", createdAt: "" },
      ]);
    }
  );

  it.each(cases)("%s uploads the map after its timings", job => {
    const steps = workflow.jobs[job]?.steps ?? [];
    const timings = steps.findIndex(step =>
      String(step.with?.["name"] ?? "").startsWith("test-timings-")
    );
    const map = steps.findIndex(step =>
      String(step.with?.["name"] ?? "").startsWith("test-access-map-")
    );
    expect(timings).toBeGreaterThan(-1);
    expect(map).toBe(timings + 1);
  });
});
