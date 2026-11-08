/**
 * The unit-test shard variables reach the test command and nothing else
 * (CodySwannGT/lisa#4479).
 *
 * `lisa-test-run` turns into a shard leg or the merge whenever it sees these
 * variables. A `$GITHUB_ENV` write is visible to every later step in the job,
 * so the arm steps must hand their values over as step outputs, and only the
 * steps listed here may bind them.
 *
 * Lisa's own named regression specs (Node 24, Rails hook installation, nightly
 * discovery, required-check registration, host-name target-scope, completion
 * authorization) also run `lisa-test-run`. They live in their own job,
 * `🧾 Named Regression Specs`, which starts beside the shards instead of
 * after the aggregate (CodySwannGT/lisa#4675). A shard variable visible there
 * could make those steps replay shard reports and pass without running their
 * tests, so that job must never mention one either.
 * Split from `quality-unit-test-shards.test.ts` for the file-length cap.
 */
import * as fs from "node:fs";

import { afterEach, describe, expect, it } from "vitest";

import { jobIn, stepsIn } from "./quality-gate-facade-fixture.js";
import { executeStep } from "./quality-unit-test-shards-fixture.js";
import type { WorkflowJob } from "../helpers/workflow-test-utils.js";

const SHARD_VARIABLES = [
  "LISA_TEST_SHARD",
  "LISA_TEST_SHARD_OUTPUT",
  "LISA_TEST_SHARD_MERGE",
  "LISA_TEST_SHARD_TOTAL",
] as const;

/** Each step that may see the variables, and the ones it sees. */
const READERS: Readonly<Record<string, readonly string[]>> = {
  gate_run: SHARD_VARIABLES,
  test_coverage: SHARD_VARIABLES,
  "🧾 Prove this shard ran only its slice": ["LISA_TEST_SHARD_OUTPUT"],
};

const OUTPUT_OF: Readonly<Record<string, string>> = {
  LISA_TEST_SHARD: "shard",
  LISA_TEST_SHARD_OUTPUT: "output",
  LISA_TEST_SHARD_MERGE: "merge",
  LISA_TEST_SHARD_TOTAL: "total",
};

const ARMS = {
  test_unit: {
    name: "🧩 Arm the unit-test shard merge",
    env: { TOTAL: "4" },
    output: (temp: string) => `merge=${temp}/lisa-unit-test-shards\ntotal=4\n`,
  },
  test_unit_shard: {
    name: "🧩 Arm this unit-test shard",
    env: { SHARD: "3", TOTAL: "4" },
    output: (temp: string) =>
      `shard=3/4\noutput=${temp}/lisa-unit-test-shard\n`,
  },
} as const;

/** Every named regression step, and only those, starts with this. */
const NAMED_PREFIX = "Execute and name";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});

describe.each(Object.keys(ARMS) as (keyof typeof ARMS)[])(
  "%s shard variable scope",
  job => {
    const arm = ARMS[job];
    const steps = stepsIn(job);

    it("hands the values over as step outputs, never through GITHUB_ENV", () => {
      const step = steps.find(s => s.name === arm.name);
      expect(step?.id).toBe("shard_arm");
      const armed = executeStep(step?.run, arm.env, root => roots.push(root));
      expect(armed.status, armed.stdout).toBe(0);
      expect(armed.env).toBe("");
      expect(armed.output).toBe(arm.output(armed.runnerTemp));
    });

    it("sets none of them at job level", () => {
      const { env } = jobIn(job) as WorkflowJob & {
        env?: Record<string, unknown>;
      };
      expect(Object.keys(env ?? {})).not.toEqual(
        expect.arrayContaining([expect.stringMatching(/^LISA_TEST_SHARD/u)])
      );
    });

    it("binds them only on the test command and the shard proof", () => {
      for (const step of steps) {
        const key = step.id ?? step.name ?? "";
        const bound = Object.keys(step.env ?? {}).filter(name =>
          name.startsWith("LISA_TEST_SHARD")
        );
        const allowed = READERS[key] ?? READERS[step.name ?? ""] ?? [];
        expect(bound, key).toEqual(
          allowed.filter(name => bound.includes(name))
        );
        for (const name of bound)
          expect(step.env?.[name], `${key} ${name}`).toBe(
            `\${{ steps.shard_arm.outputs.${OUTPUT_OF[name]} }}`
          );
      }
      for (const id of ["gate_run", "test_coverage"]) {
        const step = steps.find(s => s.id === id);
        expect(Object.keys(step?.env ?? {}), id).toEqual(
          expect.arrayContaining([...SHARD_VARIABLES])
        );
      }
    });

    it("runs none of Lisa's named regression specs", () => {
      expect(
        steps.filter(s => (s.name ?? "").startsWith(NAMED_PREFIX))
      ).toEqual([]);
    });
  }
);

/** The six named steps, in the order the job runs them. */
const NAMED_REGRESSION_STEPS = [
  "Execute and name Node 24 regression specs",
  "Execute and name Rails hook installation regression specs",
  "Execute and name nightly discovery regression specs",
  "Execute and name required-check registration regression specs",
  "Execute and name host-name target-scope regression cases",
  "Execute and name completion authorization regression specs",
] as const;

describe("test_named_regression_specs job (#4675)", () => {
  const job = jobIn("test_named_regression_specs") as WorkflowJob & {
    needs?: string | string[];
  };
  const steps = stepsIn("test_named_regression_specs");
  const named = steps.filter(s => (s.name ?? "").startsWith(NAMED_PREFIX));

  it("is the 🧾 Named Regression Specs job, Lisa-only", () => {
    expect(job.name).toBe("🧾 Named Regression Specs");
    expect(job.if).toContain("github.repository == 'CodySwannGT/lisa'");
  });

  it("starts beside the shards: it needs only gate_plan", () => {
    expect([job.needs ?? []].flat()).toEqual(["gate_plan"]);
    expect(job.if).toContain("always() && !cancelled()");
    expect(job.if).toContain('"test_unit":"skip"');
    expect(job.if).not.toContain(",test:unit,");
  });

  it("runs the six named steps in order", () => {
    expect(named.map(step => step.name)).toEqual([...NAMED_REGRESSION_STEPS]);
  });

  it("keeps each step Lisa-only, verbose, and failing CI on a failure", () => {
    for (const step of named) {
      expect(step.if, step.name).toContain(
        "github.repository == 'CodySwannGT/lisa'"
      );
      expect(step.run, step.name).toContain("--reporter=verbose");
    }
    for (const step of steps) {
      const key = step.name ?? step.id ?? "";
      expect(JSON.stringify(step), key).not.toContain("steps.gate_run");
      expect(step, key).not.toHaveProperty("continue-on-error");
      expect(JSON.stringify(step), key).not.toContain("LISA_TEST_SHARD");
    }
  });

  it("leaves the coverage enforcement in 🧪 Run Unit Tests", () => {
    const ids = stepsIn("test_unit").map(step => step.id);
    expect(ids).toEqual(expect.arrayContaining(["gate_run", "test_coverage"]));
  });

  it("keeps the enforcing host-name target-scope run in 🧪 Run Unit Tests", () => {
    const unit = stepsIn("test_unit");
    const at = unit.findIndex(
      step => step.name === "🔒 Enforce host-name target scope"
    );
    const enforce = unit[at];
    expect(enforce?.if).toBe(
      "github.repository == 'CodySwannGT/lisa' && steps.gate_run.outcome == 'success'"
    );
    expect(enforce?.run).toContain(
      "node scripts/verify-host-name-target-scope.mjs --hooks=plugins/lisa/hooks"
    );
    expect(enforce?.run).not.toContain("lisa-test-run");
    expect(enforce?.name?.startsWith(NAMED_PREFIX)).toBe(false);
    expect(enforce).not.toHaveProperty("continue-on-error");
    expect(at).toBeGreaterThan(
      unit.findIndex(step => step.id === "test_coverage")
    );
  });
});
