/**
 * The verdict WORD for a measured type failure, end to end through the runner.
 *
 * The classifier deciding `type-errors` is only half of CodySwannGT/lisa#3946.
 * The half an operator acts on is the word the runner prints, and that word is
 * chosen by `MEASURED_NOTHING` membership in `lisa-run-gates.mjs`, not by the
 * classifier. A kind can be classified perfectly and still render `UNPROVABLE`
 * if it is listed there — which is exactly how `killed` is made to behave, on
 * purpose.
 *
 * So this file drives the real runner and reads the real transcript. It is the
 * sibling of `lisa-run-gates-unproved.test.ts`, which pins the opposite
 * direction, and the two together are the actual contract: **measured failures
 * say FAILED, unmeasured ones say NOT PROVED, and neither may borrow the
 * other's word.**
 * @module tests/unit/scripts/lisa-run-gates-type-errors
 */

import { describe, expect, it } from "vitest";

import {
  runGates,
  STATE,
} from "../../../all/copy-overwrite/scripts/lisa-run-gates.mjs";
import { COMMIT, RUNNER, sink } from "./lisa-run-gates-fixtures.js";

/**
 * Just the slice of a gate run these cases read.
 *
 * Deliberately NOT the fixtures' `GateRun`. `runGates` comes from an untyped
 * `.mjs`, so its inferred shape and that exported alias are two structurally
 * different types and assigning one to the other is a real TS2322 — which is
 * why every sibling suite doing it sits in `typecheck-quarantine.json`. That
 * list only shrinks, so this declares what it actually uses instead of
 * borrowing a name that does not fit.
 */
type GateResults = {
  results: { id: string; state: string; detail: string }[];
};

const TYPECHECK = "type-correctness";
const TASK = "typecheck";

/** The transcript from #3946, verbatim. */
const TYPE_ERRORS = `type-correctness (tests): 371 file(s) with 1568 error(s); 370 quarantined.

❌ 1 file(s) outside the quarantine have type errors:
   tests/unit/config/coverage-scratch-isolation.test.ts (1)

Fix them. Do NOT add them to typecheck-quarantine.json — that list
only shrinks, and the threshold-ratchet flags additions to it.
error: script "typecheck:tests" exited with code 1
error: script "typecheck" exited with code 1`;

/**
 * Run the type-correctness gate against one recorded transcript.
 * @param output - What the prover printed before exiting
 * @param code - The exit code the prover left
 * @returns The operator-facing transcript and this gate's row
 */
function runWith(
  output: string,
  code = 1
): {
  transcript: string;
  entry: { state: string; detail: string } | undefined;
} {
  const { lines, out } = sink();
  const result = runGates({
    gates: { [TYPECHECK]: { [COMMIT]: { level: "required", run: TASK } } },
    moment: COMMIT,
    runner: RUNNER,
    exec: () => ({ code, output }),
    out,
  });
  return {
    transcript: lines.join("\n"),
    entry: (result as GateResults).results.find(row => row.id === TYPECHECK),
  };
}

describe("a type checker that found errors reports as measured", () => {
  it("reads FAILED rather than NOT PROVED", () => {
    const { entry } = runWith(TYPE_ERRORS);

    expect(entry?.state).toBe(STATE.FAILED);
    expect(entry?.state).not.toBe(STATE.UNPROVABLE);
  });

  it("never prints the word this fleet reads as 're-run it'", () => {
    // The whole cost of #3946. `UNPROVABLE` routes a named, one-line,
    // single-file defect into the re-run path, and a push-gate cycle here
    // costs 10-12 minutes.
    const { transcript } = runWith(TYPE_ERRORS);

    expect(transcript).not.toContain("UNPROVABLE");
    expect(transcript).not.toContain("NOT PROVED");
    expect(transcript).not.toContain("no recognised failure signature");
  });

  it("names the offending file in the operator's transcript", () => {
    // The transcript already contained this line, six above the verdict. The
    // repair is that the VERDICT now carries it.
    expect(runWith(TYPE_ERRORS).transcript).toContain(
      "tests/unit/config/coverage-scratch-isolation.test.ts"
    );
  });
});

describe("the constraint: a run that measured nothing keeps its own word", () => {
  it("a terminated typecheck still reads as killed, not FAILED", () => {
    // 137 is SIGKILL. This is the direction #3946 forbids trading away: a
    // false 'measured and wanting' is how a correct diff gets blamed for a
    // saturated machine.
    const { entry } = runWith(TYPE_ERRORS, 137);

    expect(entry?.state).toBe(STATE.KILLED);
    expect(entry?.state).not.toBe(STATE.FAILED);
  });

  it("an OS refusal above the same transcript still reads NOT PROVED", () => {
    const { entry } = runWith(
      `child setpgid(12345 to 12340): Operation not permitted\n${TYPE_ERRORS}`
    );

    expect(entry?.state).toBe(STATE.UNPROVABLE);
  });

  it("an unrecognised failure still reads NOT PROVED", () => {
    // The residual bucket has to keep working, or the repair has replaced one
    // collapse with another.
    const { entry } = runWith(
      "the widget exploded, and took the build with it"
    );

    expect(entry?.state).toBe(STATE.UNPROVABLE);
  });
});
