/**
 * Tests for the third rendering of machine saturation.
 *
 * A kill announces itself in the exit code. A timeout announces itself by
 * leaving the streams empty. This one announces nothing: under resource
 * exhaustion the OS declines to create a process group, the shell prints one
 * line about it, the tool carries on and produces the WRONG OUTPUT, and the
 * suite reports a specific, plausible, entirely fictional content mismatch.
 *
 * Measured on this repository at `load1` 59 with 23 agent processes and 22
 * node/vitest processes: `/bin/echo: child setpgid (38941 to 38941): Operation
 * not permitted` surfaced as an assertion that a string should have been
 * `"wor ld"`. The test was fine. It passed in isolation at one worker on the
 * same commit. An agent reading that failure debugs healthy code, and the retry
 * adds the load that caused it.
 *
 * The assertion that carries the most weight here is the NEGATIVE one. This
 * module can only do harm in one direction — by excusing a real regression as
 * machine noise — so the patterns are anchored to the syscall that failed and
 * never to the bare errno text, and the suite proves that an ordinary
 * permissions message does not trip it.
 * @module tests/unit/scripts/gate-resource-refused
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
  type GateOutcome,
  type GateRun,
  LINT_COMMAND,
  REQUIRED_AT_COMMIT,
  RUNNER,
  sink,
  STYLE,
} from "./lisa-run-gates-fixtures.js";

/** One classified failure, typed at the boundary of the untyped `.mjs`. */
type Diagnosis = {
  kind: string;
  summary: string;
  evidence: string[];
  proves: string | null;
};

/** A machine carrying more than two runnable threads per core. */
const SATURATED = { load1: 59.4, cores: 18, ratio: 59.4 / 18 };

/** The transcript measured on this repository, trimmed to its shape. */
const SETPGID = [
  "/bin/echo: child setpgid (38941 to 38941): Operation not permitted",
  "FAIL tests/unit/scripts/vendored-script-defects.test.ts > paths travel as argv",
  "AssertionError: expected '' to be 'wor ld\\n'",
].join("\n");

describe("an OS resource refusal is not a content failure", () => {
  it("classifies the measured setpgid refusal as a refusal", () => {
    expect(diagnoseFailure(SETPGID, 1, SATURATED).kind).toBe(
      DIAGNOSIS.RESOURCE_REFUSED
    );
  });

  it("outranks the assertion sitting directly underneath it", () => {
    // The whole point. The transcript contains a real-looking FAIL line and a
    // real-looking AssertionError, and both are artefacts of the refusal. A
    // classifier that reads them reports a defect in code that is fine.
    const verdict: Diagnosis = diagnoseFailure(SETPGID, 1, SATURATED);

    expect(verdict.kind).not.toBe(DIAGNOSIS.ASSERTION);
    expect(verdict.summary).toContain("NOT a content failure");
  });

  it("indicts nobody, because nothing was measured", () => {
    expect(diagnoseFailure(SETPGID, 1, SATURATED).proves).toBeNull();
  });

  it("quotes the refusal line so the reader can see the syscall", () => {
    expect(diagnoseFailure(SETPGID, 1, SATURATED).evidence.join(" ")).toContain(
      "setpgid"
    );
  });

  it("carries the machine's load beside the refusal", () => {
    // Same reason as a kill: the number is what decides re-run vs investigate.
    expect(diagnoseFailure(SETPGID, 1, SATURATED).evidence.join(" ")).toContain(
      "load1 59.4"
    );
  });

  it("stays below a kill, which is the same event one rung later", () => {
    // A refusal in the transcript of a run that was then killed is still a
    // kill: the exit code is the harder fact.
    expect(diagnoseFailure(SETPGID, 143, SATURATED).kind).toBe(
      DIAGNOSIS.KILLED
    );
  });
});

describe("the refusal patterns do not excuse a real failure", () => {
  it.each([
    ["a plain permissions error", "Error: EACCES: Operation not permitted"],
    ["a test about permissions", "✓ rejects when the user is not permitted"],
    ["a file the tool could not open", "error: could not open input file"],
    ["a message merely containing 'fork'", "forked the config before writing"],
    [
      "an assertion mentioning ENOMEM",
      "AssertionError: expected ENOMEM to equal EACCES",
    ],
    [
      "an assertion mentioning EMFILE",
      "AssertionError: EMFILE fixture was not returned",
    ],
    [
      "an ordinary too-many-files message",
      "expected 'Too many open files' in the help text",
    ],
  ])("does not classify %s as a refusal", (_label, output) => {
    // The one way this module can do harm is by explaining away a regression.
    // `Operation not permitted` unanchored is a message honest tests print.
    expect(diagnoseFailure(output, 1, SATURATED).kind).not.toBe(
      DIAGNOSIS.RESOURCE_REFUSED
    );
  });

  it("still reports an ordinary assertion failure as one", () => {
    const verdict: Diagnosis = diagnoseFailure(
      "FAIL tests/widget.test.ts > explodes\n1 failed",
      1,
      SATURATED
    );

    expect(verdict.kind).toBe(DIAGNOSIS.ASSERTION);
    expect(verdict.evidence.join(" ")).not.toContain("load1");
  });
});

describe("a refused run is NOT PROVED, never FAILED", () => {
  it("reports UNPROVABLE so nobody reads it as a verdict on the code", () => {
    // The state is the half a reader skims and a parser keys off. FAILED here
    // would be a verdict on a property this run never measured.
    const { lines, out } = sink();
    const result = runGates({
      gates: { [STYLE]: REQUIRED_AT_COMMIT },
      moment: COMMIT,
      runner: RUNNER,
      exec: () => ({ code: 1, output: SETPGID }),
      out,
    }) as GateRun;
    const outcome = result.results.find(
      (entry: GateOutcome) => entry.id === STYLE
    );

    expect(outcome?.state).toBe(STATE.UNPROVABLE);
    expect(outcome?.state).not.toBe(STATE.FAILED);
    expect(lines.some(line => /^\s*FAILED\s/.test(line))).toBe(false);
  });

  it("still blocks, because an unmeasured required property is not a pass", () => {
    // Naming the cause must never soften the outcome. The run proved nothing.
    const { out } = sink();
    const result = runGates({
      gates: { [STYLE]: REQUIRED_AT_COMMIT },
      moment: COMMIT,
      runner: RUNNER,
      exec: () => ({ code: 1, output: SETPGID }),
      out,
    }) as GateRun;

    expect(result.blocked).toBe(true);
    expect(result.blockedBy).toBe(STYLE);
  });
});

describe("an executor may answer with the object shape", () => {
  it("accepts {code, output} from the executor, as the shipped one returns", () => {
    // `runGates`'s `exec` was documented as returning `number|null`, which the
    // default executor `spawnExec` has never done. The number-only type can
    // express a killed run's null code while silently erasing the transcript
    // that says what the run was doing when it died — the one case this runner
    // exists to report. Asserting the object shape here keeps the contract and
    // the documentation from drifting apart again.
    const { out } = sink();
    const result = runGates({
      gates: { [STYLE]: REQUIRED_AT_COMMIT },
      moment: COMMIT,
      runner: RUNNER,
      exec: (command: string) => ({
        code: command === LINT_COMMAND ? 1 : 0,
        output: SETPGID,
      }),
      out,
    }) as GateRun;
    const outcome = result.results.find(
      (entry: GateOutcome) => entry.id === STYLE
    );

    expect(outcome?.state).toBe(STATE.UNPROVABLE);
    expect(outcome?.detail).toContain("resource");
  });
});
