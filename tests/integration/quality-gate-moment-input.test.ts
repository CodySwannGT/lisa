/**
 * Tests that `quality.yml` resolves its gates at a caller-chosen moment.
 *
 * Every façade job hardcoded `--moment=pull-request`, which is why a scheduled
 * caller that wants a different set of gates has no way to ask for one and
 * inverts `skip_jobs` instead — naming the two dozen jobs it does NOT want.
 * That inversion is the thing being retired, and it exists solely because of
 * this hardcoding.
 *
 * The default is `pull-request`, so every existing caller resolves exactly what
 * it resolved before.
 * @module tests/integration/quality-gate-moment-input
 */

import { describe, expect, it } from "vitest";

import {
  CONVERTED,
  resolveStep,
  source,
  workflow,
} from "./quality-gate-facade-fixture.js";

/** The input a caller sets to choose which gates apply. */
const MOMENT_INPUT = "moment";

/** How the moment reaches the resolver's shell. */
const MOMENT_ENV = "GATE_MOMENT";

describe("quality.yml exposes the moment as an input", () => {
  const inputs = workflow.on?.workflow_call?.inputs;

  it("declares a moment input", () => {
    expect(inputs?.[MOMENT_INPUT]).toBeDefined();
  });

  it("defaults to pull-request, so every existing caller is unchanged", () => {
    expect(inputs?.[MOMENT_INPUT]?.default).toBe("pull-request");
    expect(inputs?.[MOMENT_INPUT]?.type).toBe("string");
  });

  it("does not require callers to pass it", () => {
    expect(inputs?.[MOMENT_INPUT]?.required).not.toBe(true);
  });
});

describe("every façade job resolves at the caller's moment", () => {
  it.each(CONVERTED)("$job passes the moment through env", ({ job }) => {
    expect(resolveStep(job)?.env?.[MOMENT_ENV]).toBe("${{ inputs.moment }}");
  });

  it.each(CONVERTED)(
    "$job reads the moment as a shell variable, never interpolated into the command",
    ({ job }) => {
      // `.lisa.config.json` values are already kept out of the YAML for this
      // reason; a caller-supplied input is the same class of value. Written as
      // `${{ inputs.moment }}` inside the run body it would BE workflow source.
      const body = resolveStep(job)?.run ?? "";
      expect(body).toContain(`--moment="$${MOMENT_ENV}"`);
      expect(body).not.toContain("${{ inputs.moment }}");
    }
  );

  it.each(CONVERTED)("$job hardcodes no moment", ({ job }) => {
    expect(resolveStep(job)?.run ?? "").not.toContain("--moment=pull-request");
  });

  it("leaves no hardcoded moment anywhere in the workflow", () => {
    // Counted across the file rather than per job: a resolve block added later
    // and missed by CONVERTED would otherwise reintroduce the hardcoding
    // without failing anything.
    expect(source).not.toContain("--moment=pull-request");
  });

  it("covers every resolve block in the workflow, not just the listed ones", () => {
    const byName = (left: string, right: string) => left.localeCompare(right);
    const withGateStep = Object.keys(workflow.jobs)
      .filter(job => resolveStep(job) !== undefined)
      .toSorted(byName);
    expect(withGateStep).toEqual(CONVERTED.map(c => c.job).toSorted(byName));
  });
});
