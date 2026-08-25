/**
 * A gated job may have exactly one adoption control, or say why it has two.
 *
 * A job with a `QUALITY_JOB_GATES` row already has a declaration that decides
 * whether it runs. A job whose `if:` additionally reads a workflow input has a
 * SECOND control, and the two can disagree — which is worse than one control in
 * the wrong place, because the losing one fails silently.
 *
 * Measured, and the reason this file exists: `verification_coverage` carried the
 * `coverage-adequacy` row and the gate façade, and its `if:` also gated on
 * `verify_enforced`, whose default is `false`. A project declaring
 * `coverage-adequacy: required` at pull-request and leaving the input alone got
 * no job at all, and its declaration was ignored with no signal (#2930, #3016).
 *
 * BOTH ENTRIES ARE NOW RETIRED — `bdd_mode` by #3016, `verify_enforced` by
 * #3021 — so the table is empty and this file guards a boundary rather than a
 * backlog. The defect it pins was never that a second control existed; it is
 * that nothing SAID SO anywhere a consumer could read. So the set is DERIVED
 * from the shipped workflows and compared against the shipped table: a second
 * such job cannot appear in silence, and an entry cannot outlive the job it
 * describes.
 *
 * @module tests/integration/quality-dual-adoption-controls
 */

import { describe, expect, it } from "vitest";

import { committedCaseTable } from "../helpers/committed-case-table.js";
import {
  DUAL_ADOPTION_CONTROLS,
  QUALITY_JOB_GATES,
} from "../../all/copy-overwrite/scripts/lisa-gates.mjs";
import { WORKFLOW_FILES, workflowIn } from "./quality-gate-facade-fixture.js";

/** One recorded dual control, as the shipped table holds it. */
interface DualControl {
  /** The workflow input that forms the second control. */
  input: string;
  /** Why it has not been collapsed yet. */
  reason: string;
  /** The issue that resolves it, so the entry expires. */
  owner: string;
}

/** The shipped table, as this file consumes it. */
const RECORDED = DUAL_ADOPTION_CONTROLS as Record<
  string,
  DualControl | undefined
>;

/** The shipped job → gate table, as this file consumes it. */
const GOVERNED = QUALITY_JOB_GATES as Record<string, string | undefined>;

/**
 * The input every job's `if:` legitimately reads without being a second control.
 *
 * `skip_jobs` is the legacy escape the registry is replacing, and it is a
 * property of the CALLER rather than an adoption state of the job. Its own
 * retirement is tracked elsewhere; counting it here would put every job in this
 * table and say nothing.
 */
const NOT_AN_ADOPTION_CONTROL = new Set(["skip_jobs"]);

/**
 * Alphabetical order both sides of a set comparison are put into.
 *
 * @param left - One id
 * @param right - The other
 * @returns Negative, zero or positive, per `localeCompare`
 */
const byName = (left: string, right: string): number =>
  left.localeCompare(right);

/** Every gated job whose `if:` reads an input beyond `skip_jobs`, derived. */
const derived: Record<string, string[]> = (() => {
  const found: Record<string, string[]> = {};
  for (const file of WORKFLOW_FILES) {
    for (const [job, definition] of Object.entries(workflowIn(file).jobs)) {
      if (GOVERNED[job] === undefined) continue;
      const inputs = [
        ...new Set(
          [...String(definition.if ?? "").matchAll(/inputs\.(\w+)/gu)]
            .map(match => match[1] ?? "")
            .filter(name => name !== "" && !NOT_AN_ADOPTION_CONTROL.has(name))
        ),
      ];
      if (inputs.length > 0) found[job] = inputs;
    }
  }
  return found;
})();

describe("a gated job has one adoption control, or says why it has two", () => {
  it("finds gated jobs to check at all", () => {
    // The absent-case rule. Every assertion below is derived from the parsed
    // workflows, so a discovery bug would make them pass by comparing nothing
    // to nothing.
    expect(Object.keys(GOVERNED).length).toBeGreaterThanOrEqual(25);
  });

  it("records exactly the gated jobs that read a second control", () => {
    // Not a subset check in either direction. An unrecorded job is the defect
    // regrowing in silence; a recorded job that no longer reads its input is a
    // stale entry that keeps telling an operator a control exists after it went.
    expect(Object.keys(derived).sort(byName)).toEqual(
      Object.keys(RECORDED).sort(byName)
    );
  });

  // Committed, not derived. The assertion above compares two derived sets, so
  // it is satisfied by both sides being empty — retire the last dual control
  // and the cases below stop registering with nothing red
  // (CodySwannGT/lisa#3043).
  // EMPTY, as of CodySwannGT/lisa#3021, which retired the last entry. The
  // literal stays because emptiness is the thing that must be loud: a `.each`
  // over nothing registers zero cases and reports green, so the day a new dual
  // control arrives it fails HERE naming what arrived rather than adding a tick
  // nobody counts.
  const ENTRIES: readonly string[] = [];

  it.each(committedCaseTable("dual-control", RECORDED, ENTRIES))(
    "the %s entry",
    (job, entry) => {
      expect(derived[job], `${job} no longer reads a second input`).toContain(
        entry?.input
      );
      // Same bar as the ungated-jobs exemptions: a one-word reason is a
      // placeholder wearing a reason's clothes.
      expect(entry?.reason.length).toBeGreaterThanOrEqual(60);
      expect(entry?.owner).toMatch(/^#\d+$/u);
    }
  );
});
