/**
 * The generic pull-request gate runner, as `quality.yml` actually ships it.
 *
 * Two properties, and neither can be checked by reading `lisa-gates.mjs`.
 *
 * ## The context name
 *
 * A gate's `label` IS its branch-protection context, so the runner posts one
 * context per gate only if a matrix leg can carry a stable name. Measured, not
 * inferred (run `32719734434`, a matrix inside a reusable workflow called by a
 * named job — the exact shape of `quality.yml`):
 *
 *     🔍 Quality Checks / 🧪 Probe Static (alpha)   ← static name, SUFFIXED
 *     🔍 Quality Checks / 🧪 Probe Alpha            ← matrix name, verbatim
 *
 * So the whole design rests on `name:` being a matrix expression. A literal
 * there would suffix every context and red-wall every consumer's ruleset at
 * once, and it is one careless edit away, which is what the first case guards.
 *
 * ## One gate, one job
 *
 * The other half is that nothing may be proved twice. A gate with both a
 * hand-written block and a matrix leg has two jobs posting one context, and
 * branch protection matches whichever reported last — so the migration is one
 * gate at a time, and the order is enforced in both directions.
 *
 * The planner's own behaviour is executed rather than read, in the sibling
 * suite `quality-gate-legs-planner`.
 * @module tests/integration/quality-generic-gate-runner
 */

import * as fs from "node:fs";
import * as path from "node:path";

import * as yaml from "js-yaml";
import { describe, expect, it } from "vitest";

import {
  QUALITY_JOB_GATES,
  jobBackedGates,
} from "../../all/copy-overwrite/scripts/lisa-gates.mjs";

/** The workflow under test. */
const WORKFLOW = path.join(
  process.cwd(),
  ".github",
  "workflows",
  "quality.yml"
);

/** One step, as this suite reads it. */
interface Step {
  name?: string;
  id?: string;
  if?: string;
  run?: string;
  env?: Record<string, string>;
}

/** One job, as this suite reads it. */
interface Job {
  name?: string;
  strategy?: { matrix?: unknown; "fail-fast"?: boolean };
  steps?: Step[];
  if?: string;
  "timeout-minutes"?: string | number;
  outputs?: Record<string, string>;
}

/** The parsed workflow. */
const JOBS = (
  yaml.load(fs.readFileSync(WORKFLOW, "utf8")) as { jobs: Record<string, Job> }
).jobs;

/**
 * Alphabetical order both sides of a set comparison are put into.
 * @param left - One id
 * @param right - The other
 * @returns Negative, zero or positive, per `localeCompare`
 */
const byName = (left: string, right: string): number =>
  left.localeCompare(right);

describe("the matrix leg carries a branch-protection context", () => {
  it("names the job with a matrix expression, never a literal", () => {
    // The measurement above is the reason. A static `name:` on a matrix job is
    // suffixed with the leg's values, so `🧾 Generated Artifacts` would post
    // as `🧾 Generated Artifacts (artifact-freshness, ...)` and no ruleset
    // would match it.
    expect(JOBS["declared_gates"]?.name).toBe("${{ matrix.label }}");
  });

  it("is the only matrix job in this workflow, so no other context is suffixed", () => {
    const matrixJobs = Object.entries(JOBS)
      .filter(([, job]) => job.strategy?.matrix !== undefined)
      .map(([id]) => id);
    expect(matrixJobs).toEqual(["declared_gates"]);
  });

  it("does not let one failing gate cancel the verdicts of the others", () => {
    expect(JOBS["declared_gates"]?.strategy?.["fail-fast"]).toBe(false);
  });

  it("takes its budget from the leg rather than from a number in the file", () => {
    expect(JOBS["declared_gates"]?.["timeout-minutes"]).toBe(
      "${{ matrix.timeout }}"
    );
  });

  it("never interpolates a matrix value into a shell body", () => {
    // A matrix value dropped straight into `run:` is a shell injection with
    // extra steps, and it is not hypothetical here: one shipped gate summary
    // already carries a double quote, which would close the echo it landed in.
    // Every leg value reaches its step through `env:` instead.
    const inlined = (JOBS["declared_gates"]?.steps ?? [])
      .filter(step => (step.run ?? "").includes("${{ matrix."))
      .map(step => step.name ?? "(unnamed)")
      .sort(byName);
    expect(inlined).toEqual([]);
  });

  it("hands the leg's own values to its steps through the environment", () => {
    const reporting = (JOBS["declared_gates"]?.steps ?? []).filter(step =>
      Object.values(step.env ?? {}).some(value => value.includes("${{ matrix."))
    );
    // The absent case: a rename of the steps would otherwise leave the check
    // above passing against a job that no longer reads the matrix at all.
    expect(reporting.length).toBeGreaterThanOrEqual(3);
  });

  it("refuses to build an empty matrix, which is a workflow error not an empty set", () => {
    expect(JOBS["declared_gates"]?.if).toContain(
      "needs.gate_legs.outputs.count != '0'"
    );
    expect(JOBS["declared_gates"]?.if).toContain(
      "needs.gate_legs.result == 'success'"
    );
  });
});

describe("no gate is proved twice", () => {
  /** Every gate a hand-written façade block in this workflow names. */
  const HARDCODED = new Set(
    [
      ...fs
        .readFileSync(WORKFLOW, "utf8")
        .matchAll(/^ +GATE_ID: ([a-z0-9-]+)$/gmu),
    ]
      .map(match => match[1])
      .filter((gate): gate is string => gate !== undefined)
  );

  it("finds the hand-written blocks at all, so the comparison is not vacuous", () => {
    // The floor is high on purpose. An earlier draft matched `[a-z-]+` and
    // silently dropped every gate id carrying a digit — `e2e-native`,
    // `e2e-browser` — so the sweep below compared a subset to the table and
    // passed. A discovery bug in a derived test is the failure mode this
    // whole campaign is about, committed inside the check for it.
    expect(HARDCODED.size).toBeGreaterThan(25);
  });

  it("emits no leg for any gate a hand-written block still proves", () => {
    // THE SAFETY PROPERTY, and the one that makes the migration one gate at a
    // time. A gate with both a block and a leg has two jobs posting one
    // context, and branch protection matches whichever reported last.
    const backed = new Set(jobBackedGates() as readonly string[]);
    const both = [...HARDCODED].filter(gate => !backed.has(gate)).sort(byName);
    expect(
      both,
      `These gates still have a hand-written block in quality.yml AND would ` +
        `get a matrix leg, so two jobs would post one branch-protection ` +
        `context. Deleting the job and dropping its QUALITY_JOB_GATES row is ` +
        `ONE act, and it is what hands the gate to the runner.`
    ).toEqual([]);
  });

  it("leaves no job-table row without a hand-written block behind it", () => {
    // The other direction, and the one that catches the dangerous order. A row
    // whose job is gone would keep the gate looking job-backed while nothing
    // posted its context — no block, no leg, a required check that never
    // reports. The rows for jobs that live in other shipped workflows are the
    // legitimate exception and are named rather than assumed.
    const elsewhere = new Set(["e2e-browser"]);
    const rowsWithoutBlocks = Object.values(QUALITY_JOB_GATES)
      .filter(gate => !HARDCODED.has(gate) && !elsewhere.has(gate))
      .sort(byName);
    expect(rowsWithoutBlocks).toEqual([]);
  });

  it("records every hand-written block in the job table", () => {
    const governed = new Set(Object.values(QUALITY_JOB_GATES));
    expect(
      [...HARDCODED].filter(gate => !governed.has(gate)).sort(byName)
    ).toEqual([]);
  });
});
