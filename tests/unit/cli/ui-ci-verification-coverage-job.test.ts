/**
 * Tests for the verification-coverage row in the Console Quality-jobs table.
 *
 * The row used to be keyed off `verify_enforced`, a workflow input that was a
 * SECOND adoption control for the job alongside the `coverage-adequacy` gate
 * declaration it already answered to. The input was retired in
 * CodySwannGT/lisa#3021, so a console still reading it would call the job
 * inactive for a project that DID declare the gate — the same silent
 * disagreement the collapse removed from CI, left standing one surface over.
 *
 * The assertion that carries the weight is the first one, and it is the exact
 * OPPOSITE of its sibling in `ui-ci-traceability-job.test.ts`: here an
 * undeclared gate really is inactive. `verification_coverage` is the one façade
 * job that stands down rather than falling back when nothing declares its gate
 * (`DECLARATION_REQUIRED_JOBS` in lisa-gates.mjs), so rendering absence as
 * "active" would tell an operator a check is guarding the repository when it
 * proves nothing at all.
 * @module tests/unit/cli/ui-ci-verification-coverage-job
 */

import { describe, expect, it } from "vitest";

import {
  computeCiQualityJobs,
  type CiWorkflowInputs,
  type JsonObject,
  type RepoSecretsPresence,
} from "../../../src/cli/ui-ci-quality-jobs-compute.js";

const INPUTS: CiWorkflowInputs = {
  skipJobs: [],
  complianceFramework: "",
  requireApproval: false,
};
const NO_SECRETS: RepoSecretsPresence = {
  state: "unknown",
  reason: "not-probed",
  message: "secret inventory was not read for this test",
};

const JOB = "verification_coverage";
const GATE = "coverage-adequacy";
const MOMENT = "pull-request";

/**
 * The verification-coverage row for a given gates declaration.
 * @param declared - What `gates["coverage-adequacy"]["pull-request"]` holds, or
 *   undefined to declare nothing at all
 * @returns The row's active flag and reason
 */
function row(declared?: unknown): { active: boolean | null; reason: string } {
  const config: JsonObject =
    declared === undefined ? {} : { gates: { [GATE]: { [MOMENT]: declared } } };
  const value = computeCiQualityJobs(INPUTS, config, NO_SECRETS);
  const entry = value.jobs.find(job => job.id === JOB);
  if (entry === undefined) throw new Error(`${JOB} row is missing`);
  return { active: entry.active, reason: entry.reason };
}

describe("the verification-coverage row", () => {
  it("is off when nothing declares the gate", () => {
    expect(row()).toEqual({
      active: false,
      reason: "gates.coverage-adequacy is off or not declared at pull-request",
    });
  });

  it("is active when the gate is declared required", () => {
    expect(row("required").active).toBe(true);
  });

  it("is active for the levelled declaration the migration writes", () => {
    // The `{ level, run }` form must not read as "off" merely because it is an
    // object rather than a string.
    expect(row({ level: "required", run: "check:verification" }).active).toBe(
      true
    );
  });

  it("is off for an explicit off, by a different mechanism", () => {
    // `off` is a real declaration, so the workflow's stand-down never fires for
    // it — the preallocation plan skips the whole job instead. Two mechanisms,
    // one console state; reporting it active because "something is declared"
    // would show a job running that never starts.
    expect(row("off").active).toBe(false);
    expect(row({ level: "off" }).active).toBe(false);
  });
});
