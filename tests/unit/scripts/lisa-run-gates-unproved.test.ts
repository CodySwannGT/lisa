/**
 * A gate that measured nothing must not report that it measured a shortfall.
 *
 * `FAILED` is a claim: *I ran this property and it was wanting.* Two of the
 * classifier's outcomes cannot support that claim and the runner was making it
 * anyway — most visibly `undiagnosed`, whose own summary is the words "no
 * recognised failure signature". A run printed both halves of a contradiction
 * on one line: *I do not know what happened*, and *coverage-adequacy FAILED*.
 * Only the second half is actionable, so the second half is what got acted on.
 *
 * The measured instance (CodySwannGT/lisa#2961) was a coverage run that lost
 * its own scratch files to a second coverage run sharing the directory, dying
 * on a bare `ENOENT` no pattern recognised. Everything else in that push passed.
 *
 * These cases pin both halves of the repair: the verdict reads NOT PROVED, and
 * the push still stops. "Unmeasured" is a statement about the diagnosis and has
 * never been a reason to let anything through.
 * @module tests/unit/scripts/lisa-run-gates-unproved
 */

import { describe, expect, it } from "vitest";

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

const COVERAGE = "coverage-adequacy";
const TASK = "test:cov:unit";

/** Transcribed from the measured failure: the bare, unexplained shape. */
const SCRATCH_ENOENT =
  "Serialized Error: { errno: -2, code: 'ENOENT', syscall: 'open', " +
  "path: '/repo/coverage/.tmp/coverage-2.json' }";

/** A transcript nothing in the classifier recognises. */
const UNRECOGNISED = "the widget exploded, and took the build with it";

/** A transcript that really does report a coverage floor being missed. */
const REAL_SHORTFALL =
  "ERROR: Coverage for statements (85.12%) does not meet global threshold (86%)";

/**
 * Run the coverage gate against one recorded transcript.
 * @param output - What the prover printed before exiting 1
 * @returns The run and the operator-facing transcript
 */
function runWith(output: string): {
  result: GateRun;
  transcript: string;
  entry: { state: string; detail: string } | undefined;
} {
  const { lines, out } = sink();
  const result: GateRun = runGates({
    gates: { [COVERAGE]: { [COMMIT]: { level: "required", run: TASK } } },
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

describe("runGates: a failure it cannot recognise is not a failed property", () => {
  it("reports an unrecognised failure as NOT PROVED", () => {
    const { entry, transcript } = runWith(UNRECOGNISED);

    expect(entry?.state).toBe(STATE.UNPROVABLE);
    expect(transcript).toContain("NOT PROVED");
  });

  it("does not print the word FAILED against a property nothing measured", () => {
    // The exact contradiction: "no recognised failure signature" and
    // "required gate FAILED: coverage-adequacy" on the same line.
    expect(runWith(UNRECOGNISED).transcript).not.toContain(
      `required gate FAILED: ${COVERAGE}`
    );
  });

  it("still blocks, because unmeasured is not proved", () => {
    const { result } = runWith(UNRECOGNISED);

    expect(result.blocked).toBe(true);
    expect(result.blockedBy).toBe(COVERAGE);
    expect(result.passed).toEqual([]);
  });

  it("keeps the transcript, so the reader is not left with only a verdict", () => {
    expect(runWith(UNRECOGNISED).entry?.detail).toContain(
      "no recognised failure signature"
    );
  });
});

describe("runGates: scratch files deleted mid-run", () => {
  it("reports NOT PROVED and names the interference", () => {
    const { entry } = runWith(SCRATCH_ENOENT);

    expect(entry?.state).toBe(STATE.UNPROVABLE);
    expect(entry?.detail).toContain("NOT a coverage shortfall");
  });

  it("blocks the commit exactly as a failure would", () => {
    expect(runWith(SCRATCH_ENOENT).result.blocked).toBe(true);
  });
});

describe("runGates: a real shortfall still reads as FAILED", () => {
  it("does not soften a coverage floor that a finished run actually missed", () => {
    // The control. If everything became NOT PROVED, the repair would have
    // deleted the one verdict this gate exists to deliver.
    const { entry, transcript } = runWith(REAL_SHORTFALL);

    expect(entry?.state).toBe(STATE.FAILED);
    expect(transcript).toContain(`required gate FAILED: ${COVERAGE}`);
    expect(entry?.detail).toContain("below the declared floor");
  });
});
