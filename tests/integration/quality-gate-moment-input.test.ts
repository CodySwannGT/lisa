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

import * as path from "node:path";
import { describe, expect, it } from "vitest";

import {
  CONVERTED,
  WORKFLOW_FILES,
  resolveStep,
  sourceOf,
  workflow,
  workflowIn,
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

describe("every workflow carrying a resolve block declares the input it reads", () => {
  it.each(WORKFLOW_FILES)("%s declares a moment input", file => {
    // `GATE_MOMENT: ${{ inputs.moment }}` against an undeclared input is not
    // an error on GitHub — it is the empty string, and the resolver then reads
    // the config at no moment at all and finds no gate. Every declaration in
    // the project would silently stop applying, with every job still green.
    const declared = workflowIn(file).on?.workflow_call?.inputs;
    expect(declared?.[MOMENT_INPUT]).toBeDefined();
    expect(declared?.[MOMENT_INPUT]?.type).toBe("string");
  });
});

describe("every façade job resolves at the caller's moment", () => {
  it.each(CONVERTED)("$job passes the moment through env", ({ job, file }) => {
    expect(resolveStep(job, file)?.env?.[MOMENT_ENV]).toBe(
      "${{ inputs.moment }}"
    );
  });

  it.each(CONVERTED)(
    "$job reads the moment as a shell variable, never interpolated into the command",
    ({ job, file }) => {
      // `.lisa.config.json` values are already kept out of the YAML for this
      // reason; a caller-supplied input is the same class of value. Written as
      // `${{ inputs.moment }}` inside the run body it would BE workflow source.
      const body = resolveStep(job, file)?.run ?? "";
      expect(body).toContain(`--moment="$${MOMENT_ENV}"`);
      expect(body).not.toContain("${{ inputs.moment }}");
    }
  );

  it.each(CONVERTED)("$job hardcodes no moment", ({ job, file }) => {
    expect(resolveStep(job, file)?.run ?? "").not.toContain(
      "--moment=pull-request"
    );
  });

  it.each(WORKFLOW_FILES)("leaves no hardcoded moment anywhere in %s", file => {
    // Counted across the file rather than per job: a resolve block added
    // later and missed by CONVERTED would otherwise reintroduce the
    // hardcoding without failing anything. Both files carry resolve blocks
    // now, and the one that moved defaults to a DIFFERENT moment, which is
    // exactly the case a hardcoded `pull-request` would silently defeat.
    expect(sourceOf(file)).not.toContain("--moment=pull-request");
  });

  it("covers every resolve block in either workflow, not just the listed ones", () => {
    const byName = (left: string, right: string) => left.localeCompare(right);
    const withGateStep = WORKFLOW_FILES.flatMap(file =>
      Object.keys(workflowIn(file).jobs)
        .filter(job => resolveStep(job, file) !== undefined)
        .map(job => `${path.basename(file)}:${job}`)
    )
      .slice()
      .sort(byName);
    expect(withGateStep).toEqual(
      CONVERTED.map(c => `${path.basename(c.file)}:${c.job}`)
        .slice()
        .sort(byName)
    );
  });
});
