/**
 * A gate command that exits 0 having collected zero tests is not a pass.
 *
 * The failure branch of `execute()` has known this event by name since #2883 —
 * `NO_TESTS_RAN`, with a paragraph explaining that a 0% coverage table off such
 * a run is an absence rather than a regression. None of it could ever fire on
 * the path that needed it: `execute()` returned PASSED on `code === 0` without
 * reading the transcript, so the diagnosis was reachable only from the one
 * branch that could not carry a vacuous green (CodySwannGT/lisa#3715).
 *
 * Every transcript below is measured rather than composed — vitest 4.1.9 and
 * jest, each invoked with `--passWithNoTests` against a directory holding no
 * tests, and each invoked again with one real test in place for the control.
 * The flag matters: it ships in the integration script of several stack
 * templates, so a consumer's integration gate really does exit 0 on nothing.
 * @module tests/unit/scripts/gate-hollow-success
 */

import { describe, expect, it } from "vitest";

import {
  DIAGNOSIS,
  diagnoseHollowSuccess,
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

/** One classified outcome, typed at the boundary of the untyped `.mjs`. */
type Diagnosis = {
  kind: string;
  summary: string;
  evidence: string[];
  proves: string | null;
};

/** The gate the stack templates ship `--passWithNoTests` on. */
const INTEGRATION = "test-integration";

/** The project root the measured runs printed, quoted back as evidence. */
const ROOT = "/repo/consumer";

/** vitest 4.1.9, `--passWithNoTests`, no test files present. Measured. */
const VITEST_EMPTY = [
  "",
  ` RUN  v4.1.9 ${ROOT}`,
  "",
  "No test files found, exiting with code 0",
  "",
  "filter:  tests/integration",
  "include: **/*.{test,spec}.?(c|m)[jt]s?(x)",
  "exclude:  **/node_modules/**, **/.git/**",
].join("\n");

/** The same invocation with one real test in place. Measured. */
const VITEST_RAN = [
  "",
  ` RUN  v4.1.9 ${ROOT}`,
  "",
  " Test Files  1 passed (1)",
  "      Tests  1 passed (1)",
  "   Duration  308ms",
].join("\n");

/** jest, `--passWithNoTests`, no matching test files. Measured. */
const JEST_EMPTY = "No tests found, exiting with code 0";

/** The same invocation with one real test in place. Measured. */
const JEST_RAN = [
  "PASS ./jest.integration.test.js",
  "  ✓ adds (2 ms)",
  "",
  "Test Suites: 1 passed, 1 total",
  "Tests:       1 passed, 1 total",
].join("\n");

/**
 * A transcript carrying a child's zero-files line under a parent that ran.
 *
 * The mirror-image defect, and the reason emptiness needs two conditions
 * rather than one: a suite that captures a nested runner's output inherits the
 * child's `No test files found` while its own 826 files ran perfectly well.
 * Calling that run empty would be this fix in reverse.
 */
const NESTED_CHILD = [
  "No test files found, exiting with code 0",
  " Test Files  826 passed (826)",
].join("\n");

/** A gate command that says nothing at all about a count — most of them. */
const SILENT = "Checked 41 files. All matched.";

/**
 * Run one required gate whose command exits 0 with the given transcript.
 * @param output What the gate command printed before exiting 0.
 * @returns The run, the operator-facing transcript, and the gate's row.
 */
function runWith(output: string): {
  result: GateRun;
  transcript: string;
  entry: { state: string; detail: string; evidence?: string[] } | undefined;
} {
  const { lines, out } = sink();
  const result: GateRun = runGates({
    exec: () => ({ code: 0, output }),
    gates: {
      [INTEGRATION]: {
        [COMMIT]: { level: "required", run: "test:integration" },
      },
    },
    moment: COMMIT,
    out,
    runner: RUNNER,
  });
  return {
    entry: result.results.find((row: { id: string }) => row.id === INTEGRATION),
    result,
    transcript: lines.join("\n"),
  };
}

describe("diagnoseHollowSuccess: exit 0 is not the observation", () => {
  it("reads a vitest run that collected nothing as having measured nothing", () => {
    expect(diagnoseHollowSuccess(VITEST_EMPTY)?.kind).toBe(
      DIAGNOSIS.NO_TESTS_RAN
    );
  });

  it("reads a jest run that collected nothing the same way", () => {
    // A second tool, because the defect is "exit 0 attests to work that never
    // happened" and not "vitest prints a particular line".
    expect(diagnoseHollowSuccess(JEST_EMPTY)?.kind).toBe(
      DIAGNOSIS.NO_TESTS_RAN
    );
  });

  it("says in words that nothing ran, rather than that something passed", () => {
    const verdict = diagnoseHollowSuccess(VITEST_EMPTY) as Diagnosis;

    expect(verdict.summary).toContain("ZERO test");
    expect(verdict.summary).toContain("NOT that anything passed");
  });

  it("names which tool said so, since two of them can", () => {
    // The operator's next question after "nothing ran" is "according to what",
    // and the answer decides which invocation they go and look at.
    expect(
      (diagnoseHollowSuccess(VITEST_EMPTY) as Diagnosis).summary
    ).toContain("vitest");
    expect((diagnoseHollowSuccess(JEST_EMPTY) as Diagnosis).summary).toContain(
      "jest"
    );
  });

  it("attributes the non-measurement to nobody", () => {
    // Nothing was measured, so nothing may be indicted — the same reasoning
    // that keeps `no-tests-ran` out of `ATTRIBUTION` on the failure path.
    expect(
      (diagnoseHollowSuccess(VITEST_EMPTY) as Diagnosis).proves
    ).toBeNull();
  });

  it("names the root the run used, so the wrong tree is visible", () => {
    // Direction 3 of the issue, delivered where it is asked for: several agents
    // lost time inferring which checkout an empty run had executed in.
    const evidence = (
      diagnoseHollowSuccess(VITEST_EMPTY, "/repo/elsewhere") as Diagnosis
    ).evidence.join("\n");

    // The tool's own header wins over the injected cwd, and says so.
    expect(evidence).toContain(`the run's root was ${ROOT}`);
    expect(evidence).toContain("as the tool reported it");
  });

  it("still names a root when the tool printed none", () => {
    // jest prints no header at all, and on CI the vitest header did not reach
    // the captured transcript either — measured. A root line that appears only
    // when the tool volunteers one does not satisfy "make the run state its
    // root"; it is the same defect one field over.
    const evidence = (
      diagnoseHollowSuccess(JEST_EMPTY, "/repo/consumer") as Diagnosis
    ).evidence.join("\n");

    expect(evidence).toContain("the run's root was /repo/consumer");
    expect(evidence).toContain("the tool printed none");
  });

  it("tells the operator the two things that are actually true", () => {
    const evidence = (
      diagnoseHollowSuccess(VITEST_EMPTY) as Diagnosis
    ).evidence.join("\n");

    expect(evidence).toContain("declare the gate `off`");
    expect(evidence).toContain("--passWithNoTests");
  });

  it("leaves a run that really did execute tests alone", () => {
    expect(diagnoseHollowSuccess(VITEST_RAN)).toBeNull();
    expect(diagnoseHollowSuccess(JEST_RAN)).toBeNull();
  });

  it("does not claim a nested child's zero-files line as the parent's", () => {
    expect(diagnoseHollowSuccess(NESTED_CHILD)).toBeNull();
  });

  it("says nothing about a command that reported no count at all", () => {
    // The blast-radius guard. Silence is not an admission, so every non-test
    // gate — lint, format, build — is untouched by this read.
    expect(diagnoseHollowSuccess(SILENT)).toBeNull();
  });

  it("says nothing when the runner could not capture the output", () => {
    // Capture is on by default and `LISA_GATES_CAPTURE=0` turns it off. A lost
    // transcript is an absence of evidence, never evidence of an absence.
    expect(diagnoseHollowSuccess(null)).toBeNull();
    expect(diagnoseHollowSuccess(undefined)).toBeNull();
    expect(diagnoseHollowSuccess("")).toBeNull();
  });
});

describe("runGates: a gate that collected nothing does not report PASSED", () => {
  it("records NOT PROVED rather than PASSED", () => {
    // The defect, stated as an assertion. Before the fix this was PASSED, with
    // the exit code as its whole justification.
    const { entry, transcript } = runWith(VITEST_EMPTY);

    expect(entry?.state).toBe(STATE.UNPROVABLE);
    expect(transcript).toContain("NOT PROVED");
  });

  it("blocks, because an unmeasured required property is not a pass", () => {
    const { result } = runWith(VITEST_EMPTY);

    expect(result.blocked).toBe(true);
    expect(result.blockedBy).toBe(INTEGRATION);
  });

  it("keeps the command's own exit code on the record", () => {
    // Exit 0 is the INPUT to this defect, not the symptom, so it is reported
    // as it was rather than rewritten into something that looks like a failure.
    expect(runWith(VITEST_EMPTY).entry).toMatchObject({ code: 0 });
  });

  it("counts it among the gates this run did not prove", () => {
    const { result } = runWith(VITEST_EMPTY);

    expect(result.unprovable.map(row => row.id)).toEqual([INTEGRATION]);
    expect(result.passed).toEqual([]);
  });

  it("still passes a run that really did execute its tests", () => {
    // The negative control. A check that only ever fails has deleted the
    // verdict the gate exists to deliver.
    const { entry, result } = runWith(VITEST_RAN);

    expect(entry?.state).toBe(STATE.PASSED);
    expect(result.blocked).toBe(false);
  });

  it("still passes a gate whose command reported no count at all", () => {
    expect(runWith(SILENT).entry?.state).toBe(STATE.PASSED);
  });
});
