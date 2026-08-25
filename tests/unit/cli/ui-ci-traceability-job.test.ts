/**
 * Tests for the work-item traceability row in the Console Quality-jobs table.
 *
 * The gate has been enforced in CI for a long time and the Console could not
 * show it, so an operator reading the table saw a complete-looking list with a
 * required check missing from it.
 *
 * The assertion that carries the weight is the middle one: an **undeclared**
 * gate is still active. The gates block narrows and overrides — it does not
 * enable — so a project that never mentions traceability still runs the
 * built-in check. Rendering absence as "off" would tell an operator a gate is
 * disabled while CI keeps enforcing it, which is the reverse of the usual
 * defect and just as untrue.
 * @module tests/unit/cli/ui-ci-traceability-job
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

const JOB = "work_item";

/**
 * The traceability row for a given gates declaration.
 * @param gates - The `gates` block to place in merged config
 * @returns That row, or undefined when the table omits it
 */
function row(gates: unknown) {
  const config = (gates === undefined ? {} : { gates }) as JsonObject;
  const value = computeCiQualityJobs(INPUTS, config, NO_SECRETS);
  return value.jobs.find(entry => entry.id === JOB);
}

describe("the traceability job row", () => {
  it("appears in the table at all", () => {
    expect(row(undefined)?.label).toBe("🔗 Work-Item Traceability");
  });

  it("is active when the project never declares the gate", () => {
    // Absence is not off. The built-in check still runs.
    expect(row(undefined)?.active).toBe(true);
  });

  it("is active when declared required or optional", () => {
    expect(row({ traceability: { "pull-request": "required" } })?.active).toBe(
      true
    );
    expect(row({ traceability: { "pull-request": "optional" } })?.active).toBe(
      true
    );
  });

  it("is off only when the project explicitly says off", () => {
    const off = row({ traceability: { "pull-request": "off" } });
    expect(off?.active).toBe(false);
    expect(off?.reason).toContain("gates.traceability is off");
  });

  it("reads the expanded declaration form too", () => {
    // A gate may be declared as a bare level or as an object carrying `run`,
    // and a reader that understands only one form silently misreads the other.
    expect(
      row({ traceability: { "pull-request": { level: "off" } } })?.active
    ).toBe(false);
    expect(
      row({ traceability: { "pull-request": { level: "required" } } })?.active
    ).toBe(true);
  });

  it("ignores a declaration at some other moment", () => {
    // The Console row describes the CI job, which runs at pull-request. A
    // commit-time declaration says nothing about whether that job runs.
    expect(row({ traceability: { commit: "off" } })?.active).toBe(true);
  });
});
