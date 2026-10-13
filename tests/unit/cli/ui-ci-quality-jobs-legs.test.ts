/**
 * The console's quality-jobs rows for the five checks a declared gate leg now
 * runs (CodySwannGT/lisa#3052). A leg exists only while its gate is declared
 * at pull-request at a level that runs, and it answers to that declaration
 * rather than to `skip_jobs`.
 * @module tests/unit/cli/ui-ci-quality-jobs-legs
 */
import { describe, expect, it } from "vitest";
import {
  computeCiQualityJobs,
  type CiWorkflowInputs,
  type RepoSecretsPresence,
} from "../../../src/cli/ui-ci-quality-jobs.js";
import type { JsonObject } from "../../../src/sync/json-path.js";

/**
 * Locate one job entry by id inside a computed value.
 * @param jobs - Computed job list
 * @param id - Stable job id
 * @returns The matching job
 */
function jobOf(
  jobs: ReturnType<typeof computeCiQualityJobs>["jobs"],
  id: string
): (typeof jobs)[number] {
  const found = jobs.find(entry => entry.id === id);
  if (found === undefined) {
    throw new Error(`Missing job ${id}`);
  }
  return found;
}

describe("computeCiQualityJobs for declared gate legs", () => {
  const baseInputs: CiWorkflowInputs = {
    skipJobs: [],
    complianceFramework: "none",
    requireApproval: false,
  };
  const secretsPresent: RepoSecretsPresence = {
    state: "value",
    names: new Set(["GITGUARDIAN_API_KEY"]),
  };
  const configMutationOff: JsonObject = {
    quality: { mutation: { gate: { enabled: false } } },
  };

  // #3052: these checks are run by a declared gate leg, which exists only
  // while the gate is declared at pull-request and answers to that
  // declaration rather than to `skip_jobs`.
  it.each([
    ["typecheck", "type-correctness"],
    ["lint_slow", "code-style-slow"],
    ["format", "format-conformance"],
    ["build", "build-integrity"],
    ["dead_code", "dead-code"],
  ])("shows %s active only while %s is declared to run", (id, gate) => {
    const undeclared = computeCiQualityJobs(
      baseInputs,
      configMutationOff,
      secretsPresent
    );
    expect(jobOf(undeclared.jobs, id)).toMatchObject({
      active: false,
      reason: `gates.${gate} is off or not declared at pull-request, so no declared gate leg runs it`,
    });

    const declared = computeCiQualityJobs(
      { ...baseInputs, skipJobs: [id] },
      {
        ...configMutationOff,
        gates: { [gate]: { "pull-request": "required" } },
      },
      secretsPresent
    );
    expect(jobOf(declared.jobs, id)).toMatchObject({
      active: true,
      reason: "",
    });

    const off = computeCiQualityJobs(
      baseInputs,
      {
        ...configMutationOff,
        gates: { [gate]: { "pull-request": { level: "off" } } },
      },
      secretsPresent
    );
    expect(jobOf(off.jobs, id)).toMatchObject({ active: false });

    // A malformed declaration runs nothing, so it must not read as active.
    for (const malformed of [null, "sometimes", { run: "x" }]) {
      const value = computeCiQualityJobs(
        baseInputs,
        {
          ...configMutationOff,
          gates: { [gate]: { "pull-request": malformed } },
        },
        secretsPresent
      );
      expect(jobOf(value.jobs, id)).toMatchObject({ active: false });
    }

    const optional = computeCiQualityJobs(
      baseInputs,
      {
        ...configMutationOff,
        gates: { [gate]: { "pull-request": { level: "optional", run: "x" } } },
      },
      secretsPresent
    );
    expect(jobOf(optional.jobs, id)).toMatchObject({ active: true });
  });
});
