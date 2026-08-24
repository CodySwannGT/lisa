/**
 * A run that executed zero test files is not a coverage regression.
 *
 * The measured instance is CodySwannGT/lisa#2883's third category. The scratch
 * namespace guard refused to start a run; vitest printed `No test files found`
 * on line 5, a complete coverage report with every file at 0% across lines
 * 11-390, and the reason on line 397. Fed that real 416-line transcript, the
 * classifier answered `threshold — coverage is below the declared floor on 4
 * metric(s)`: a verdict about coverage, off a run in which no line of code was
 * ever executed, and one that invites exactly the wrong repair.
 *
 * Both layers are pinned here, because fixing either alone leaves the defect:
 * the classifier must not call it a threshold miss, and the runner must not
 * print FAILED against a property nothing measured.
 * @module tests/unit/scripts/gate-diagnosis-no-tests-ran
 */

import { describe, expect, it } from "vitest";

import {
  DIAGNOSIS,
  diagnoseFailure,
} from "../../../all/copy-overwrite/scripts/lib/gate-failure-diagnosis.mjs";
import {
  runGates,
  STATE,
} from "../../../all/copy-overwrite/scripts/lisa-run-gates.mjs";
import {
  COMMIT,
  type GateRun,
  RUNNER,
  sink,
} from "./lisa-run-gates-fixtures.js";

/** One classified failure, typed at the boundary of the untyped `.mjs`. */
type Diagnosis = {
  kind: string;
  summary: string;
  evidence: string[];
  proves: string | null;
};

const COVERAGE = "coverage-adequacy";

/** The reason, which in the real transcript sits 392 lines below the verdict. */
const REASON =
  "Error: Test scratch namespace /tmp/lisa-scratch holds 2153 entries, past " +
  "the ceiling of 512. Scratch space is accumulating rather than being reclaimed.";

/**
 * The measured shape, abridged in the middle only.
 *
 * Every element that misled the classifier is kept: the zero-files line, four
 * 0% threshold lines, and the reason last. The abridged part is the 380-line
 * per-file table, which carries no signature.
 */
const REFUSED = [
  " RUN  v4.1.9 /repo",
  "      Coverage enabled with v8",
  "",
  "No test files found, exiting with code 1",
  "",
  " % Coverage report from v8",
  "All files          |       0 |        0 |       0 |       0 |",
  "ERROR: Coverage for lines (0%) does not meet global threshold (75%)",
  "ERROR: Coverage for functions (0%) does not meet global threshold (60%)",
  "ERROR: Coverage for statements (0%) does not meet global threshold (74%)",
  "ERROR: Coverage for branches (0%) does not meet global threshold (65%)",
  "⎯⎯⎯ Unhandled Error ⎯⎯⎯",
  REASON,
].join("\n");

/** A finished run that really did miss its floor — the control. */
const REAL_SHORTFALL = [
  " Test Files  825 passed (825)",
  "ERROR: Coverage for statements (85.12%) does not meet global threshold (86%)",
].join("\n");

/**
 * A transcript carrying BOTH the zero-files line and a run summary.
 *
 * This is not hypothetical: a suite that captures a nested runner's output
 * inherits the child's `No test files found` while its own 826 files ran
 * perfectly well.
 */
const NESTED_CHILD = [
  "No test files found, exiting with code 1",
  " Test Files  1 failed | 825 passed (826)",
  " FAIL  tests/unit/example.test.ts",
].join("\n");

/**
 * Run the coverage gate against one recorded transcript.
 * @param output - What the prover printed before exiting 1
 * @returns The run, the operator-facing transcript, and the gate's row.
 */
function runWith(output: string): {
  result: GateRun;
  transcript: string;
  entry: { state: string; detail: string } | undefined;
} {
  const { lines, out } = sink();
  const result: GateRun = runGates({
    gates: {
      [COVERAGE]: { [COMMIT]: { level: "required", run: "test:cov:unit" } },
    },
    moment: COMMIT,
    runner: RUNNER,
    exec: () => ({ code: 1, output }),
    out,
  });
  return {
    result,
    transcript: lines.join("\n"),
    entry: result.results.find((row: { id: string }) => row.id === COVERAGE) as
      | { state: string; detail: string }
      | undefined,
  };
}

describe("diagnoseFailure: a run that executed no test files", () => {
  it("is NOT classified as a coverage shortfall", () => {
    // The defect, stated as an assertion. Before the fix this was `threshold`.
    expect(diagnoseFailure(REFUSED, 1).kind).toBe(DIAGNOSIS.NO_TESTS_RAN);
  });

  it("is attributed to nobody, because nothing was measured", () => {
    const verdict: Diagnosis = diagnoseFailure(REFUSED, 1);

    expect(
      verdict.proves,
      "a run that executed nothing cannot indict a gate's property"
    ).toBeNull();
  });

  it("says in words that the zeroes are an absence, not a regression", () => {
    const verdict: Diagnosis = diagnoseFailure(REFUSED, 1);

    expect(verdict.summary).toContain("ZERO test files");
    expect(verdict.summary).toContain("NOT because coverage regressed");
  });

  it("quotes the reason and drops the coverage lines it explains", () => {
    // Four fabricated threshold lines against an evidence cap of five: left in,
    // they push the one line the reader needs off the end of the list.
    const verdict: Diagnosis = diagnoseFailure(REFUSED, 1);

    expect(verdict.evidence.join("\n")).toContain("past the ceiling of 512");
    expect(verdict.evidence.join("\n")).not.toContain("does not meet global");
  });

  it("does not claim a nested child's zero-files line as its own", () => {
    // The mirror-image defect: calling a run that DID measure a non-measurement.
    // A summary line means a verdict was reached, so content signatures rule.
    expect(diagnoseFailure(NESTED_CHILD, 1).kind).toBe(DIAGNOSIS.ASSERTION);
  });

  it("leaves a finished run's real shortfall alone", () => {
    expect(diagnoseFailure(REAL_SHORTFALL, 1).kind).toBe(DIAGNOSIS.THRESHOLD);
  });
});

describe("runGates: a refused run is not reported as a failed property", () => {
  it("reports NOT PROVED rather than FAILED", () => {
    const { entry, transcript } = runWith(REFUSED);

    expect(entry?.state).toBe(STATE.UNPROVABLE);
    expect(transcript).toContain("NOT PROVED");
    expect(transcript).not.toContain(`required gate FAILED: ${COVERAGE}`);
  });

  it("still blocks, because unmeasured is not proved", () => {
    const { result } = runWith(REFUSED);

    expect(result.blocked).toBe(true);
    expect(result.blockedBy).toBe(COVERAGE);
  });

  it("carries the reason into the operator's row", () => {
    expect(runWith(REFUSED).entry?.detail).toContain("ZERO test files");
  });

  it("still reads a genuine shortfall as FAILED", () => {
    // The control. If everything became NOT PROVED the repair would have
    // deleted the one verdict this gate exists to deliver.
    const { entry, transcript } = runWith(REAL_SHORTFALL);

    expect(entry?.state).toBe(STATE.FAILED);
    expect(transcript).toContain(`required gate FAILED: ${COVERAGE}`);
  });
});
