/**
 * Tests for gates that share one prover.
 *
 * Two gates legitimately name the same command: a coverage-instrumented suite
 * proves `test-correctness` by passing and `coverage-adequacy` by clearing its
 * threshold. One run answers both, and the assertions here are about what the
 * runner must not do with that fact — run the command twice, or let the two
 * gates disagree about what the single run proved.
 *
 * The load-bearing case is the mixed-level one. If a shared command fails and
 * the optional gate is reached first, attributing the failure only to it would
 * leave a required gate satisfied by a run that failed, which is the defect the
 * whole subsystem exists to prevent, arriving through a side door.
 * @module tests/unit/scripts/lisa-run-gates-shared-prover
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
  stubExec,
} from "./lisa-run-gates-fixtures.js";

const COVERAGE = "coverage-adequacy";
const CORRECTNESS = "test-correctness";
const SHARED_TASK = "test:cov";
const SHARED_COMMAND = `${RUNNER} ${SHARED_TASK}`;
const SHARED = { level: "required", run: SHARED_TASK };
const REVIEW = "code-review";

/**
 * Declare both gates at commit, at the levels a case needs.
 * @param correctness - Level for `test-correctness`
 * @returns A gates block naming one command twice
 */
const sharing = (correctness = "required") => ({
  [COVERAGE]: { [COMMIT]: SHARED },
  [CORRECTNESS]: { [COMMIT]: { level: correctness, run: SHARED_TASK } },
});

/**
 * Run both gates against a stubbed exit code for the shared command.
 * @param codes - Exit code per command
 * @param correctness - Level for `test-correctness`
 * @returns The run, the commands actually executed, and the printed lines
 */
function run(codes = {}, correctness = "required") {
  const { exec, calls } = stubExec(codes);
  const { lines, out } = sink();
  const result = runGates({
    gates: sharing(correctness),
    moment: COMMIT,
    runner: RUNNER,
    exec,
    out,
  }) as GateRun;
  return { result, calls, lines };
}

/**
 * The verdict recorded for one gate id.
 * @param result - A completed run
 * @param id - Gate id
 * @returns That gate's result entry
 */
const verdict = (result: GateRun, id: string) =>
  result.results.find(entry => entry.id === id);

describe("gates that share one prover", () => {
  it("runs the shared command once, not once per gate", () => {
    // The regression: `bun run test:cov` ran twice on every push, and on one
    // push the second run failed seconds after the first passed. A red that
    // means nothing costs the register the trust a false pass does.
    const { result, calls } = run();
    expect(calls).toEqual([SHARED_COMMAND]);
    expect(result.total).toBe(2);
    expect(result.passed).toHaveLength(2);
  });

  it("reports both gates proved, naming the run that proved them", () => {
    const { result, lines } = run();
    expect(verdict(result, COVERAGE)?.state).toBe(STATE.PASSED);
    expect(verdict(result, CORRECTNESS)?.state).toBe(STATE.PASSED);
    // The second gate must not read as a separate execution that happened.
    expect(lines.join("\n")).toContain(`proved by the ${COVERAGE} run`);
    expect(verdict(result, CORRECTNESS)?.provedBy).toBe(COVERAGE);
  });

  it("fails every gate the run was meant to prove", () => {
    const { result, calls } = run({ [SHARED_COMMAND]: 1 });
    expect(calls).toEqual([SHARED_COMMAND]);
    expect(result.blocked).toBe(true);
    expect(verdict(result, COVERAGE)?.state).toBe(STATE.FAILED);
    expect(verdict(result, CORRECTNESS)?.state).toBe(STATE.FAILED);
  });

  it("does not re-run a command killed by a signal", () => {
    // `execute` reports `code: null` for a terminated command, so inferring
    // "did this run?" from the exit code treats a kill as never having happened
    // — and sends the next gate to run the whole suite the operator has just
    // interrupted. The verdicts alone cannot catch this: re-running produces
    // the same two failures, so the assertion has to be on the executor.
    const { result, calls } = run({ [SHARED_COMMAND]: null });
    expect(calls).toEqual([SHARED_COMMAND]);
    // KILLED, not FAILED: a terminated command measured neither property, so
    // neither gate may report a verdict on one (CodySwannGT/lisa#3032). Both
    // still block, and the assertion this case exists for is `calls`.
    expect(verdict(result, COVERAGE)?.state).toBe(STATE.KILLED);
    expect(verdict(result, CORRECTNESS)?.state).toBe(STATE.KILLED);
    expect(result.blocked).toBe(true);
    expect(verdict(result, CORRECTNESS)?.provedBy).toBe(COVERAGE);
  });

  it("lets a gate that cannot run say so, rather than inherit a verdict", () => {
    // Structural, not a live regression: every skip today also resolves to a
    // null command, so the cache lookup was already unreachable for a skipped
    // gate. Deciding the gate's own skip *before* consulting the cache makes
    // that correct by construction rather than by coincidence, which matters
    // the moment a skip reason arrives that coexists with a command.
    const { lines } = run();
    const awaited = runGates({
      gates: {
        [COVERAGE]: { [COMMIT]: SHARED },
        [REVIEW]: { [COMMIT]: { level: "required", await: "CodeRabbit" } },
      },
      moment: COMMIT,
      runner: RUNNER,
      exec: stubExec({}).exec,
      out: () => undefined,
    }) as GateRun;

    expect(verdict(awaited, REVIEW)?.state).toBe(STATE.SKIPPED);
    expect(verdict(awaited, REVIEW)?.provedBy).toBeNull();
    expect(lines.join("\n")).not.toContain(REVIEW);
  });

  it("blocks when the required gate shares a prover with an optional one", () => {
    // `coverage-adequacy` sorts first and is optional here, so nothing blocks
    // at the moment the command fails. The required gate reached afterwards
    // must still inherit the failure rather than the run's mere completion.
    const { result } = run({ [SHARED_COMMAND]: 1 }, "required");
    const optional = runGates({
      gates: {
        [COVERAGE]: { [COMMIT]: { level: "optional", run: SHARED_TASK } },
        [CORRECTNESS]: { [COMMIT]: SHARED },
      },
      moment: COMMIT,
      runner: RUNNER,
      exec: stubExec({ [SHARED_COMMAND]: 1 }).exec,
      out: () => undefined,
    }) as GateRun;

    expect(result.blocked).toBe(true);
    expect(optional.blocked).toBe(true);
    expect(verdict(optional, CORRECTNESS)?.state).toBe(STATE.FAILED);
  });

  it("still runs distinct commands separately", () => {
    // A control against over-fitting: dedupe must key on the command, not
    // collapse every gate at a moment into one execution.
    const { exec, calls } = stubExec({});
    runGates({
      gates: {
        [COVERAGE]: { [COMMIT]: SHARED },
        "code-style": { [COMMIT]: { level: "required", run: "lint" } },
      },
      moment: COMMIT,
      runner: RUNNER,
      exec,
      out: () => undefined,
    });
    expect(
      calls.slice().sort((left, right) => left.localeCompare(right))
    ).toEqual([`${RUNNER} lint`, SHARED_COMMAND]);
  });
});
