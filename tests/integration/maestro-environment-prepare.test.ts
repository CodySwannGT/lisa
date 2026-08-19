/**
 * Environment preparation in the native e2e workflow.
 *
 * Two seams, and the dangerous one is the second.
 *
 * **Before the run** — `pre_suite` prepares when `prepare_environment` is set,
 * BEFORE `pre_suite_command`, so a project's own command layers onto a known
 * state rather than having its work discarded.
 *
 * **Between the legs** — the reason this is its own job rather than steps
 * appended to `leg_order`: `android` deliberately runs when `leg_order` FAILS,
 * so a broken serializer degrades to concurrent legs instead of dropping the
 * Android suite. A reset living in that job would inherit that fail-OPEN
 * treatment. Here it is result-gated on the same allowlist `pre_suite` uses.
 *
 * The assertion that matters most is the one about NOT preparing: when the legs
 * are not serialized they run concurrently, and a reset between them would
 * empty the environment underneath a running suite. A guard that is merely
 * absent looks identical to a guard that is present and permissive, so the
 * negative cases are asserted explicitly rather than inferred from the
 * positive ones passing.
 * @module tests/integration/maestro-environment-prepare
 */

import yaml from "js-yaml";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { evaluateIf } from "../helpers/workflow-job-graph";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKFLOW = path.resolve(
  __dirname,
  "..",
  "..",
  ".github",
  "workflows",
  "maestro-native-e2e.yml"
);

/**
 *
 */
interface Step {
  name: string;
  if?: string;
}

const BETWEEN_LEGS_STEP = "Prepare the environment for";

const doc = yaml.load(readFileSync(WORKFLOW, "utf8")) as {
  jobs: Record<string, { needs?: string[]; if?: string; steps: Step[] }>;
};

/**
 * The guard on a named step of a named job.
 * @param job The job key in the workflow.
 * @param fragment A distinctive substring of the step name.
 * @returns The step's `if:` expression, or undefined when it has none.
 */
function guardFor(job: string, fragment: string): string | undefined {
  const step = doc.jobs[job].steps.find(candidate =>
    candidate.name.includes(fragment)
  );
  if (!step) throw new Error(`no step matching "${fragment}" in ${job}`);
  return step.if;
}

/**
 * A context for the between-legs guards, with everything switched on.
 * @param overrides Values to change from the all-conditions-hold baseline.
 * @param overrides.inputs Caller inputs to override.
 * @param overrides.legOrder The result the ordering gate concluded with.
 * @param overrides.runIos Whether the iOS leg is in the run.
 * @param overrides.runAndroid Whether the Android leg is in the run.
 * @returns The evaluation context.
 */
function context(
  overrides: {
    inputs?: Record<string, unknown>;
    legOrder?: string;
    runIos?: string;
    runAndroid?: string;
  } = {}
) {
  return {
    inputs: {
      prepare_environment: "dev",
      prepare_between_legs: true,
      serialize_platform_legs: true,
      ...overrides.inputs,
    },
    needs: {
      preflight: {
        outputs: {
          run_ios: overrides.runIos ?? "true",
          run_android: overrides.runAndroid ?? "true",
        },
      },
      leg_order: { result: overrides.legOrder ?? "success" },
    },
  };
}

describe("preparing before the run", () => {
  it("prepares before the project's own pre-suite command", () => {
    const names = doc.jobs.pre_suite.steps.map(step => step.name);
    const prepareAt = names.findIndex(name =>
      name.includes("Prepare the environment")
    );
    const commandAt = names.findIndex(name =>
      name.includes("Run pre-suite command")
    );

    expect(prepareAt).toBeGreaterThanOrEqual(0);
    expect(prepareAt).toBeLessThan(commandAt);
  });

  it("installs dependencies whenever preparing, not only when the command asks", () => {
    // A reset goes through the project's own tooling and database client far
    // more often than not, and one that needed node_modules and did not get
    // them fails in a way that reads as a broken reset rather than a missing
    // install.
    //
    // Asserted on the guard's TEXT, not by evaluating it. This guard is a
    // disjunction and the shared evaluator handles conjunctions only, so
    // running it through `evaluateIf` would throw rather than answer. Saying so
    // is better than a weaker assertion that looks like a real evaluation.
    const guard = guardFor("pre_suite", "Install dependencies") ?? "";

    expect(guard).toContain("|| inputs.prepare_environment != ''");
  });

  it("leaves a project that prepares nothing exactly as it was", () => {
    const guard = guardFor("pre_suite", "Prepare the environment");

    expect(evaluateIf(guard, { inputs: { prepare_environment: "" } })).toBe(
      false
    );
  });
});

describe("preparing between the legs — when it must NOT happen", () => {
  it("does not prepare when the legs are not serialized", () => {
    // The legs run CONCURRENTLY in that mode. Preparing between them would
    // empty the environment underneath a running suite.
    const guard = guardFor("inter_leg_prepare", BETWEEN_LEGS_STEP);

    expect(
      evaluateIf(guard, context({ inputs: { serialize_platform_legs: false } }))
    ).toBe(false);
  });

  it("does not prepare when only one leg is in the run", () => {
    const guard = guardFor("inter_leg_prepare", BETWEEN_LEGS_STEP);

    expect(evaluateIf(guard, context({ runAndroid: "false" }))).toBe(false);
    expect(evaluateIf(guard, context({ runIos: "false" }))).toBe(false);
  });

  it("does not prepare when the caller turned the seam off", () => {
    const guard = guardFor("inter_leg_prepare", BETWEEN_LEGS_STEP);

    expect(
      evaluateIf(guard, context({ inputs: { prepare_between_legs: false } }))
    ).toBe(false);
  });

  it("does not prepare when no environment was named", () => {
    const guard = guardFor("inter_leg_prepare", BETWEEN_LEGS_STEP);

    expect(
      evaluateIf(guard, context({ inputs: { prepare_environment: "" } }))
    ).toBe(false);
  });

  it("does not prepare when the ordering gate did not succeed", () => {
    // `leg_order` is what proves the iOS leg FINISHED. Without that proof the
    // iOS leg may still be running, and a reset would wipe the environment
    // underneath it.
    const guard = guardFor("inter_leg_prepare", BETWEEN_LEGS_STEP);

    for (const result of ["failure", "cancelled", "skipped"]) {
      expect(evaluateIf(guard, context({ legOrder: result }))).toBe(false);
    }
  });
});

describe("preparing between the legs — when it must happen", () => {
  it("prepares once every condition holds", () => {
    // The positive control. Without it every assertion above is equally
    // consistent with a guard that never passes at all.
    const guard = guardFor("inter_leg_prepare", BETWEEN_LEGS_STEP);

    expect(evaluateIf(guard, context())).toBe(true);
  });

  it("refuses loudly when the ordering gate did not succeed", () => {
    // Not merely "does not prepare" — the run FAILS, because nobody can say
    // what state the environment is in, and testing anyway is the outcome this
    // subsystem exists to prevent.
    const guard = guardFor("inter_leg_prepare", "Refuse to prepare");

    expect(evaluateIf(guard, context({ legOrder: "failure" }))).toBe(true);
    expect(evaluateIf(guard, context())).toBe(false);
  });
});

describe("the Android leg is gated on the preparation", () => {
  it("depends on the preparation job", () => {
    expect(doc.jobs.android.needs).toContain("inter_leg_prepare");
  });

  it("starts only on an allowlisted preparation result", () => {
    // An allowlist, not a denylist: `failure`, `cancelled`, and anything
    // GitHub adds later all fall through to "do not start". `!cancelled()`
    // deliberately does not cover this — that is what lets a job run despite a
    // failed dependency, which is right for a build artifact and wrong for
    // established state.
    const guard = doc.jobs.android.if ?? "";

    expect(guard).toContain("needs.inter_leg_prepare.result");
    expect(
      evaluateIf(guard, {
        inputs: {},
        needs: {
          preflight: { outputs: { run_android: "true" } },
          pre_suite: { result: "success" },
          inter_leg_prepare: { result: "failure" },
        },
      })
    ).toBe(false);
  });
});
