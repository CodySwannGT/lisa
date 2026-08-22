/**
 * Tests for the classifier that turns a failed gate's output into a verdict.
 *
 * The assertions that carry weight are the PRECEDENCE ones. A vitest run whose
 * tests timed out still prints coverage errors, and they are always low,
 * because the code the dead tests would have exercised went unexercised.
 * Reading the threshold line off such a run is how "the machine was busy"
 * became "coverage regressed" six times in a row.
 * @module tests/unit/scripts/gate-failure-diagnosis
 */

import { describe, expect, it } from "vitest";

import {
  DIAGNOSIS,
  diagnoseFailure,
} from "../../../all/copy-overwrite/scripts/lib/gate-failure-diagnosis.mjs";

/** One classified failure, typed at the boundary of the untyped `.mjs`. */
type Diagnosis = {
  kind: string;
  summary: string;
  evidence: string[];
  proves: string | null;
};

const TIMEOUT_LINE = "Error: Test timed out in 60000ms.";
const HOOK_TIMEOUT_LINE = "Error: Hook timed out in 60000ms.";
const THRESHOLD_LINE =
  "ERROR: Coverage for statements (85.12%) does not meet global threshold (86%)";

describe("diagnoseFailure: a killed command is not a failed one", () => {
  // CodySwannGT/lisa#2897. `exit 143` is `128 + 15` — SIGTERM. On a saturated
  // box a contention kill arrives with a TRUNCATED transcript that reads
  // exactly like a real gate failure, so one `exit 1` on this gate had at least
  // three distinct causes and re-running was a rational response to all three.
  // That is why the real one never got looked at.
  //
  // The kill is legible only in the exit code, so these cases pass one. The
  // output handed alongside it is deliberately a convincing failure transcript:
  // if the classifier read it, it would say the wrong thing confidently.

  const TRUNCATED = [
    " FAIL  tests/unit/a.test.ts > does a thing",
    "Tests  3 failed | 900 passed (903)",
  ].join("\n");

  it.each([
    [143, "SIGTERM"],
    [137, "SIGKILL"],
    [130, "SIGINT"],
    [152, "SIGXCPU"],
  ])("reads exit %i as a kill by %s", (code, signal) => {
    const verdict: Diagnosis = diagnoseFailure(TRUNCATED, code);

    expect(verdict.kind).toBe(DIAGNOSIS.KILLED);
    expect(verdict.summary).toContain(signal);
  });

  it("shows the arithmetic, so 143 stops looking like an ordinary code", () => {
    expect(diagnoseFailure(TRUNCATED, 143).summary).toContain("128 + 15");
  });

  it("says terminated, NOT failed, and does not count the tests", () => {
    const verdict: Diagnosis = diagnoseFailure(TRUNCATED, 143);

    expect(verdict.summary).toContain("NOT failed");
    expect(verdict.summary).not.toContain("ran and failed");
  });

  it("outranks the failure signatures the truncated transcript carries", () => {
    // Without the exit code this same output is an assertion failure, and the
    // next case proves that it still is. The kill is what changes the verdict.
    expect(diagnoseFailure(TRUNCATED, 143).kind).toBe(DIAGNOSIS.KILLED);
    expect(diagnoseFailure(TRUNCATED).kind).toBe(DIAGNOSIS.ASSERTION);
  });

  it("blames nobody, because a terminated command measured nothing", () => {
    // The load-bearing half. `proves: "test-correctness"` on a kill would print
    // a verdict about a property no run ever reached.
    expect(diagnoseFailure(TRUNCATED, 143).proves).toBeNull();
  });

  it("treats a missing exit code as a termination", () => {
    // What the runner produces for a child killed by a signal: `spawnSync`
    // reports `status: null`, and the runner already calls that terminated.
    const verdict: Diagnosis = diagnoseFailure(TRUNCATED, null);

    expect(verdict.kind).toBe(DIAGNOSIS.KILLED);
    expect(verdict.summary).toContain("no exit code");
  });

  it("does not read an ordinary failure as a kill", () => {
    expect(diagnoseFailure(TRUNCATED, 1).kind).toBe(DIAGNOSIS.ASSERTION);
    expect(diagnoseFailure(TRUNCATED, 127).kind).toBe(DIAGNOSIS.ASSERTION);
  });

  it("leaves the no-code caller alone, because absent is not terminated", () => {
    // `undefined` means the caller supplied nothing. Conflating it with `null`
    // would turn every code-less caller's verdict into a kill — this module's
    // own defect, committed again one level down.
    expect(diagnoseFailure(TRUNCATED, undefined).kind).toBe(
      DIAGNOSIS.ASSERTION
    );
  });
});

describe("diagnoseFailure: precedence", () => {
  it("calls a run with timeouts AND threshold errors a timeout", () => {
    const verdict: Diagnosis = diagnoseFailure(
      [TIMEOUT_LINE, THRESHOLD_LINE, "Tests  1 failed | 10 passed"].join("\n")
    );

    expect(verdict.kind).toBe(DIAGNOSIS.TIMEOUT);
  });

  it("says a timed-out run is not a coverage shortfall, in words", () => {
    expect(diagnoseFailure(TIMEOUT_LINE).summary).toContain(
      "NOT a coverage shortfall"
    );
  });

  it("counts hook timeouts as timeouts too", () => {
    expect(diagnoseFailure(HOOK_TIMEOUT_LINE).kind).toBe(DIAGNOSIS.TIMEOUT);
  });

  it("names the budget that was blown", () => {
    expect(diagnoseFailure(TIMEOUT_LINE).summary).toContain("60000ms");
  });

  it("calls a completed run with failures an assertion failure", () => {
    const verdict: Diagnosis = diagnoseFailure(
      [
        " FAIL  tests/unit/thing.test.ts > does a thing",
        "Tests  3 failed | 7 passed (10)",
        THRESHOLD_LINE,
      ].join("\n")
    );

    expect(verdict.kind).toBe(DIAGNOSIS.ASSERTION);
    expect(verdict.summary).toContain("3 test(s)");
  });

  it("calls a clean run below its floor a threshold miss", () => {
    const verdict: Diagnosis = diagnoseFailure(
      ["Tests  10 passed (10)", THRESHOLD_LINE].join("\n")
    );

    expect(verdict.kind).toBe(DIAGNOSIS.THRESHOLD);
    expect(verdict.evidence).toContain("statements 85.12% < 86% (global)");
  });

  it("reads a per-glob threshold as well as the global one", () => {
    const verdict: Diagnosis = diagnoseFailure(
      'ERROR: Coverage for lines (33.33%) does not meet "src/math.ts" threshold (85%)'
    );

    expect(verdict.kind).toBe(DIAGNOSIS.THRESHOLD);
    expect(verdict.evidence[0]).toContain("33.33% < 85%");
  });
});

describe("diagnoseFailure: when it cannot tell", () => {
  it("refuses to guess when no output was captured", () => {
    expect(diagnoseFailure(null).kind).toBe(DIAGNOSIS.UNCAPTURED);
  });

  it("treats empty output as uncaptured rather than as a clean run", () => {
    expect(diagnoseFailure("").kind).toBe(DIAGNOSIS.UNCAPTURED);
  });

  it("quotes the last meaningful lines when nothing is recognised", () => {
    const verdict: Diagnosis = diagnoseFailure(
      "tsc: error TS2307: Cannot find module './missing'\n\n"
    );

    expect(verdict.kind).toBe(DIAGNOSIS.UNDIAGNOSED);
    expect(verdict.evidence).toContain(
      "tsc: error TS2307: Cannot find module './missing'"
    );
  });

  it("reaches past a task runner's own exit line to the real one", () => {
    // Measured on this runner: the last line of a failing `bun run` chain says
    // only what the exit code already said. Quoting one line would have quoted
    // that one and nothing else.
    const verdict: Diagnosis = diagnoseFailure(
      [
        "Run `bun run build:lisa-owned-hash-ledger` and commit the result.",
        'error: script "check:lisa-owned-hash-ledger" exited with code 1',
        'error: script "check:artifacts" exited with code 1',
      ].join("\n")
    );

    expect(verdict.evidence).toContain(
      "Run `bun run build:lisa-owned-hash-ledger` and commit the result."
    );
  });

  it("never claims a coverage shortfall it did not read", () => {
    expect(diagnoseFailure("oxlint found 4 errors").summary).not.toContain(
      "coverage"
    );
  });
});

describe("diagnoseFailure: evidence stays readable", () => {
  it("caps the named examples and says how many were dropped", () => {
    const many = Array.from(
      { length: 9 },
      (_unused, index) => ` FAIL  tests/unit/suite-${index}.test.ts > case`
    ).join("\n");
    const verdict: Diagnosis = diagnoseFailure(`${many}\n${TIMEOUT_LINE}`);

    expect(verdict.evidence).toHaveLength(6);
    expect(verdict.evidence.at(-1)).toBe("…and 4 more");
  });

  it("does not repeat a suite that failed more than once", () => {
    const verdict: Diagnosis = diagnoseFailure(
      [
        " FAIL  tests/unit/same.test.ts > one",
        " FAIL  tests/unit/same.test.ts > two",
        TIMEOUT_LINE,
      ].join("\n")
    );

    expect(verdict.evidence).toEqual(["tests/unit/same.test.ts"]);
  });
});

describe("diagnoseFailure: whose property the failure was", () => {
  // Hardcoded gate ids rather than read back off ATTRIBUTION: a test that
  // asserts a mapping by consulting the same mapping proves only that it
  // equals itself.
  it("blames the test suite for a timeout, not the coverage number", () => {
    const verdict: Diagnosis = diagnoseFailure(
      [TIMEOUT_LINE, THRESHOLD_LINE].join("\n")
    );

    expect(verdict.proves).toBe("test-correctness");
  });

  it("blames the test suite for a failed assertion", () => {
    const verdict: Diagnosis = diagnoseFailure(
      "Tests  2 failed | 14274 passed (14276)"
    );

    expect(verdict.proves).toBe("test-correctness");
  });

  it("blames coverage only when the suite finished and the floor was missed", () => {
    const verdict: Diagnosis = diagnoseFailure(
      ["Tests  14276 passed (14276)", THRESHOLD_LINE].join("\n")
    );

    expect(verdict.proves).toBe("coverage-adequacy");
  });

  it("blames nobody when it recognised nothing", () => {
    // An attribution invented from an unrecognised transcript would be the
    // original defect with better prose: a verdict asserted about a property
    // nothing measured.
    expect(diagnoseFailure("boom: the widget exploded").proves).toBeNull();
    expect(diagnoseFailure(null).proves).toBeNull();
  });
});
