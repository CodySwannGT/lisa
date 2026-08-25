/**
 * Tests for the evidence envelope and the continuous moment family.
 *
 * The assertions that carry weight are the two demotions to `unknown`, because
 * in both the naive read is `pass`: an implementation that reported success
 * while emitting no work count, and evidence that is genuinely green but older
 * than the window it describes. Neither is a failure and neither is a pass, and
 * collapsing either into `pass` is the defect the whole subsystem exists to
 * prevent.
 * @module tests/unit/scripts/lisa-gates-evidence
 */

import { describe, expect, it } from "vitest";

import {
  isMoment,
  momentFamily,
  readEvidence,
  REGISTRY,
  validateGates,
} from "../../../all/copy-overwrite/scripts/lisa-gates.mjs";

const NOW = Date.parse("2026-08-15T18:00:00Z");

/**
 * Registry lookup that keeps TypeScript out of the way in assertions.
 * @param id - Gate id to look up
 * @returns That gate's registry definition
 */
const definition = (id: string) =>
  (REGISTRY as Record<string, { moments: string[]; work?: string }>)[id];
const COVERAGE = { work: "files measured" };
const DAY = 1440;
const GENERATIVE = "generative-testing";
const CONTINUOUS = "continuous";

/**
 * Build an evidence envelope claiming success.
 * @param over - Fields to override on the passing baseline
 * @returns An envelope accepted by `readEvidence`
 */
const passing = (over = {}) => ({
  status: "pass",
  work: 412,
  observed_at: "2026-08-15T17:50:00Z",
  max_age_minutes: DAY,
  ...over,
});

describe("readEvidence", () => {
  it("accepts fresh evidence that reports work", () => {
    expect(readEvidence(passing(), COVERAGE, NOW)).toEqual({
      status: "pass",
      reason: null,
    });
  });

  it("demotes a pass that emitted no work count", () => {
    // `passWithNoTests: true` ships in five stack configs, so a suite can
    // report green having run zero tests. Absent a count, nothing shows it ran.
    const verdict = readEvidence(passing({ work: null }), COVERAGE, NOW);
    expect(verdict.status).toBe("unknown");
    expect(verdict.status).not.toBe("pass");
    expect(verdict.reason).toContain("nothing shows it ran");
  });

  it("does not demand a work count from a gate that declares none", () => {
    expect(readEvidence(passing({ work: null }), {}, NOW).status).toBe("pass");
  });

  it("demotes evidence older than its own bound", () => {
    // A green from six days ago describes a state that may no longer exist.
    const stale = passing({ observed_at: "2026-08-08T18:00:00Z" });
    const verdict = readEvidence(stale, COVERAGE, NOW);
    expect(verdict.status).toBe("unknown");
    expect(verdict.reason).toContain("past its");
  });

  it.each([null, "not-a-timestamp"])(
    "demotes bounded evidence with an invalid observation time (%s)",
    observedAt => {
      const verdict = readEvidence(
        passing({ observed_at: observedAt }),
        COVERAGE,
        NOW
      );
      expect(verdict.status).toBe("unknown");
      expect(verdict.reason).toContain("observed_at");
    }
  );

  it("treats absent evidence as unknown, never as pass", () => {
    // A scheduler that quietly died must block promotion rather than let last
    // week's result stand in for this week's.
    expect(readEvidence(null, COVERAGE, NOW).status).toBe("unknown");
    expect(readEvidence({ status: "bogus" }, COVERAGE, NOW).status).toBe(
      "unknown"
    );
  });

  it("passes a genuine failure through unchanged", () => {
    // Freshness and work only ever demote a pass; a fail is already decided.
    expect(readEvidence({ status: "fail" }, COVERAGE, NOW)).toEqual({
      status: "fail",
      reason: null,
    });
  });

  it("ignores freshness when no bound is declared", () => {
    const ancient = passing({
      observed_at: "2020-01-01T00:00:00Z",
      max_age_minutes: null,
    });
    expect(readEvidence(ancient, COVERAGE, NOW).status).toBe("pass");
  });
});

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

  it("declares a work count, so a run that generated nothing is unknown", () => {
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
