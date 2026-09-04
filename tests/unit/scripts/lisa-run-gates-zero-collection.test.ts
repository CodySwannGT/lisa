/**
 * A gate that exits 0 having run nothing is not a gate that passed.
 *
 * The runner had excellent zero-collection language and could not reach it.
 * `execute()` returned `PASSED` the instant a command exited 0 and never looked
 * at the output, so `diagnoseFailure` — with its `No test files found` pattern
 * and its explanation that a coverage report from such a run reads 0% because
 * nothing executed — ran only on the failure branch (CodySwannGT/lisa#3715).
 *
 * That is unreachable on the one path that needs it. `--passWithNoTests` was
 * removed from the unit lane under #2603 but still ships in the integration
 * scripts of three package templates, so a consumer's integration gate exits 0
 * having collected nothing and the gate records a pass for a suite that never
 * ran. The repository already contained the contract, the vocabulary and the
 * detection pattern, and applied them exactly where they could not fire.
 *
 * ## Why these cases and not "fail on an empty collection"
 *
 * `--passWithNoTests` is in the integration lane for a real reason: a project
 * may legitimately have no integration tests yet. So the trigger is not
 * "collected zero" — it is the runner POSITIVELY STATING it ran nothing and
 * reached no verdict. The two controls below are what stop that becoming a
 * blanket rule: a gate whose transcript says no such thing still passes, and a
 * transcript carrying a NESTED runner's empty line while its own suite reached
 * a verdict still passes.
 *
 * That second control is this module's own defect in mirror image, and it is
 * why the predicate requires the summary line to be absent rather than merely
 * matching on the empty-collection line.
 * @module tests/unit/scripts/lisa-run-gates-zero-collection
 */

import { describe, expect, it } from "vitest";

import {
  runGates,
  STATE,
} from "../../../all/copy-overwrite/scripts/lisa-run-gates.mjs";
import { COMMIT, RUNNER, sink } from "./lisa-run-gates-fixtures.js";

/**
 * The runner's own result shape.
 *
 * Taken from `runGates` rather than from the fixtures module, which exports a
 * structurally similar `GateRun` that is a DIFFERENT type to the compiler.
 * Annotating with the fixtures' one type-errors under `tsconfig.tests.json`,
 * which is exactly what the newly-live test type gate caught here.
 */
type GateRunResult = ReturnType<typeof runGates>;

const INTEGRATION = "test-integration";
const TASK = "test:integration";

/**
 * What a runner prints when told not to mind an empty collection.
 *
 * The exit code is the defect's input, not its symptom: `--passWithNoTests`
 * turns this transcript into a zero exit.
 */
const RAN_NOTHING = [
  " RUN  v4.1.9 /repo",
  "",
  "No test files found, exiting with code 0",
  "",
  "filter:  tests/integration",
].join("\n");

/**
 * A real run that reached a verdict while quoting a CHILD's empty collection.
 *
 * The control for the mirror-image defect: 826 files genuinely ran here, and
 * calling this a non-measurement would be the same error pointed the other way.
 */
const NESTED_EMPTY_BUT_RAN = [
  " RUN  v4.1.9 /repo",
  "",
  "stdout | tests/integration/fixture-consumer.test.ts",
  "  No test files found, exiting with code 0",
  "",
  " Test Files  826 passed (826)",
  "      Tests  9214 passed (9214)",
].join("\n");

/** An ordinary gate that measured something and said so. */
const MEASURED = [
  " Test Files  132 passed (132)",
  "      Tests  2430 passed (2430)",
].join("\n");

/** A non-test gate: nothing in its output resembles a collection count. */
const NON_TEST_GATE = "✅ 6/6 routing artifacts valid, 0 invalid";

/**
 * Run one gate against a recorded transcript and a chosen exit code.
 * @param output - What the prover printed.
 * @param code - The exit status the prover returned.
 * @returns The run, the operator-facing transcript, and this gate's row.
 */
function runWith(
  output: string,
  code = 0
): {
  result: GateRunResult;
  transcript: string;
  entry: { state: string; detail: string } | undefined;
} {
  const { lines, out } = sink();
  const result: GateRunResult = runGates({
    gates: { [INTEGRATION]: { [COMMIT]: { level: "required", run: TASK } } },
    moment: COMMIT,
    runner: RUNNER,
    exec: () => ({ code, output }),
    out,
  });
  return {
    result,
    transcript: lines.join("\n"),
    entry: result.results.find(
      (row: { id: string }) => row.id === INTEGRATION
    ) as { state: string; detail: string } | undefined,
  };
}

describe("runGates: a zero exit is not by itself a measurement", () => {
  it("records NOT PROVED when the runner says it executed nothing", () => {
    // The defect, stated as the state rather than the exit code: exit 0 is the
    // input here, so asserting on it would assert the bug.
    const { entry } = runWith(RAN_NOTHING);

    expect(entry?.state).toBe(STATE.UNPROVABLE);
    expect(entry?.state).not.toBe(STATE.PASSED);
  });

  it("still blocks, because a suite that did not run has proved nothing", () => {
    const { result } = runWith(RAN_NOTHING);

    expect(result.blocked).toBe(true);
    expect(result.blockedBy).toBe(INTEGRATION);
    expect(result.passed).toEqual([]);
  });

  it("tells the operator that the zero exit is the runner being permissive", () => {
    // Without this the reader sees NOT PROVED against a command that exited 0
    // and reasonably concludes the runner is broken.
    expect(runWith(RAN_NOTHING).entry?.detail).toContain("executed ZERO");
    expect(runWith(RAN_NOTHING).entry?.detail).toContain("exit 0");
  });

  describe("controls — this is not a blanket rule about empty collections", () => {
    it("CONTROL: a suite that reached a verdict passes despite a nested empty line", () => {
      // The mirror-image defect. 826 files ran; the empty line belongs to a
      // child. Requiring the summary line to be ABSENT is what separates them.
      const { entry, result } = runWith(NESTED_EMPTY_BUT_RAN);

      expect(entry?.state).toBe(STATE.PASSED);
      expect(result.blocked).toBe(false);
    });

    it("CONTROL: an ordinary passing suite is untouched", () => {
      expect(runWith(MEASURED).entry?.state).toBe(STATE.PASSED);
    });

    it("CONTROL: a non-test gate with no collection count still passes", () => {
      // The blast-radius control. Most gates print nothing resembling a test
      // count, and a rule keyed on absence would have failed every one of them.
      expect(runWith(NON_TEST_GATE).entry?.state).toBe(STATE.PASSED);
    });

    it("produces both verdicts, so neither set is vacuous", () => {
      const states = new Set([
        runWith(MEASURED).entry?.state,
        runWith(RAN_NOTHING).entry?.state,
      ]);

      expect(states).toEqual(new Set([STATE.PASSED, STATE.UNPROVABLE]));
    });
  });

  it("leaves the failure path alone — a nonzero exit still diagnoses", () => {
    // The pre-existing behaviour this change must not disturb: the same
    // transcript arriving with a nonzero exit was already handled, and still is.
    const { entry } = runWith(RAN_NOTHING, 1);

    expect(entry?.state).toBe(STATE.UNPROVABLE);
    expect(entry?.detail).toContain("ZERO test files");
  });
});
