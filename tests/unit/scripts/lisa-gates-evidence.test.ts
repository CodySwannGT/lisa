/**
 * Tests for the continuous moment family.
 *
 * The `readEvidence` cases that used to live here went with the reader itself
 * when the gate evidence envelope was slimmed (CodySwannGT/lisa#4794).
 * @module tests/unit/scripts/lisa-gates-evidence
 */

import { describe, expect, it } from "vitest";

import {
  isMoment,
  momentFamily,
  REGISTRY,
  validateGates,
} from "../../../all/copy-overwrite/scripts/lisa-gates.mjs";

/**
 * Registry lookup that keeps TypeScript out of the way in assertions.
 * @param id - Gate id to look up
 * @returns That gate's registry definition
 */
const definition = (id: string) =>
  (REGISTRY as Record<string, { moments: string[]; work?: string }>)[id];
const GENERATIVE = "generative-testing";
const CONTINUOUS = "continuous";

describe("the continuous moment", () => {
  it("is a well-formed moment when it carries a target", () => {
    expect(isMoment("continuous:staging")).toBe(true);
    expect(momentFamily("continuous:staging")).toBe("continuous");
  });

  it("requires a target, like the deploy families", () => {
    expect(isMoment("continuous")).toBe(false);
  });

  it("accepts a gate declared against a target", () => {
    expect(
      validateGates({ "e2e-browser": { "continuous:staging": "required" } })
    ).toEqual([]);
  });

  it("still refuses a gate whose legal moments exclude it", () => {
    // Commit-scoped work has no stable target to run against on a schedule.
    const problems = validateGates({
      "commit-conformance": { "continuous:main": "required" },
    });
    expect(problems.join(" ")).toContain("cannot run at");
  });
});

describe(GENERATIVE, () => {
  it("is legal continuously, which is the point of it", () => {
    // TASC SI9: re-running one suite against every change explores far less of
    // the input space than generating new cases against a stable one.
    expect(definition(GENERATIVE).moments).toContain(CONTINUOUS);
  });

  it("declares what its work count measures", () => {
    expect(definition(GENERATIVE).work).toBe("cases generated");
  });

  it("catches a CVE published without a change", () => {
    // The strongest case for continuous: yesterday's green becomes wrong with
    // no diff to trigger a re-scan.
    expect(definition("dependency-vulnerability").moments).toContain(
      "continuous"
    );
  });
});
