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

const TYPECHECK = "type-correctness";
const TASK = "typecheck";

/**
 * A failing run of the test type-check wrapper, as it prints — the shape of
 * the transcript #3946 misread, task-runner exit lines included.
 */
const TYPE_ERRORS = `type-correctness (tests): 1 file(s) with 1 error(s).

❌ 1 file(s) have type errors:
   tests/unit/config/coverage-scratch-isolation.test.ts (1)

Fix each at its cause. There is no exemption list: every file in the
test program is type-checked, and one error fails it.
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
    entry: result.results.find(row => row.id === TYPECHECK),
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
