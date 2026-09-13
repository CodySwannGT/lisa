/**
 * Tests for what the gate runner does when the run it serves goes away.
 *
 * The measured incident (CodySwannGT/lisa#3829): a hook was killed to free a
 * contended machine, the kill reported success, and the gate runner — now
 * reparented to pid 1 — kept working through the rest of the push chain for a
 * caller that no longer existed. Nothing in its output said so.
 *
 * Two claims are asserted separately here, because a fix for one is not a fix
 * for the other: the chain must STOP, and the report must be distinguishable
 * from the report of a run that finished. A run that stops silently is the same
 * defect with the CPU cost removed.
 * @module tests/unit/scripts/lisa-run-gates-interrupted
 */

import { describe, expect, it } from "vitest";

import {
  runGates,
  STATE,
} from "../../../all/copy-overwrite/scripts/lisa-run-gates.mjs";
import {
  COMMIT,
  type GateRun,
  LEAKAGE,
  LEAKAGE_COMMAND,
  LINT_COMMAND,
  REQUIRED_AT_COMMIT,
  RUNNER,
  sink,
  stubExec,
  STYLE,
} from "./lisa-run-gates-fixtures.js";

const GATES = {
  [STYLE]: REQUIRED_AT_COMMIT,
  [LEAKAGE]: REQUIRED_AT_COMMIT,
};

const REASON = "the run that started it (pid 4242) exited";
const COMPLETION_TALLY = "gate(s) declared.";

/**
 * Run two required gates, interrupting after a chosen number of boundaries.
 * @param afterGates - How many gate boundaries pass before the caller is gone.
 * @returns The run, the printed lines, and the commands actually executed.
 */
function interruptedRun(afterGates: number): {
  result: GateRun;
  lines: string[];
  calls: string[];
} {
  const { exec, calls } = stubExec({});
  const { lines, out } = sink();
  let asked = 0;
  const result = runGates({
    gates: GATES,
    moment: COMMIT,
    runner: RUNNER,
    exec,
    out,
    priorKills: [],
    recordKill: () => true,
    interrupted: () => {
      asked += 1;
      return asked > afterGates ? REASON : null;
    },
  }) as GateRun;
  return { result, lines, calls };
}

describe("a gate run whose caller has gone away", () => {
  it("stops the chain instead of running the remaining gates", () => {
    const { calls } = interruptedRun(1);

    // Gates run alphabetically, so `code-style` is the one that got in first.
    expect(calls).toEqual([LINT_COMMAND]);
    expect(calls).not.toContain(LEAKAGE_COMMAND);
  });

  it("gives the gates it never reached no verdict at all", () => {
    const { result } = interruptedRun(1);

    expect(result.notRun.map(entry => entry.id)).toEqual([LEAKAGE]);
    expect(result.notRun[0]?.state).toBe(STATE.NOT_RUN);
    expect(result.notRun[0]?.detail).toContain("interrupted");
    // Never SKIPPED: a skipped gate's verdict IS established.
    expect(result.skipped).toEqual([]);
  });

  it("blocks without inventing a gate to blame", () => {
    const { result } = interruptedRun(1);

    expect(result.blocked).toBe(true);
    expect(result.interrupted).toBe(REASON);
    // The half that matters: no gate failed, so naming one would send an
    // operator hunting a regression that does not exist.
    expect(result.blockedBy).toBeNull();
    expect(result.failed).toEqual([]);
  });

  it("says it was interrupted rather than printing a completion tally", () => {
    const { lines } = interruptedRun(1);
    const report = lines.join("\n");

    expect(report).toContain("INTERRUPTED, not completed");
    expect(report).toContain(REASON);
    expect(report).toContain("This is NOT a pass");
    // The exact sentence a completed run ends on, and the one an interrupted
    // run must never borrow.
    expect(report).not.toContain(COMPLETION_TALLY);
  });

  it("explains the unrun gates by the interruption, not by a failure", () => {
    const { lines } = interruptedRun(1);
    const report = lines.join("\n");

    expect(report).toContain("interrupted before it reached them");
    expect(report).not.toContain("failed first and stopped them");
  });

  it("runs nothing at all when the caller is already gone at the first gate", () => {
    const { result, calls } = interruptedRun(0);

    expect(calls).toEqual([]);
    expect(result.notRun).toHaveLength(2);
    expect(result.passed).toEqual([]);
  });
});

describe("a gate run whose caller is still there", () => {
  it("reports a completion tally and no interruption", () => {
    const { exec, calls } = stubExec({});
    const { lines, out } = sink();
    const result = runGates({
      gates: GATES,
      moment: COMMIT,
      runner: RUNNER,
      exec,
      out,
      priorKills: [],
      recordKill: () => true,
      interrupted: () => null,
    }) as GateRun;

    expect(calls).toHaveLength(2);
    expect(result.interrupted).toBeNull();
    expect(result.blocked).toBe(false);
    expect(result.notRun).toEqual([]);
    const report = lines.join("\n");
    expect(report).toContain(COMPLETION_TALLY);
    expect(report).not.toContain("INTERRUPTED");
  });
});

describe("interruption during the final optional gate", () => {
  it.each([false, true])(
    "keeps a killed optional gate distinct from caller interruption: %s",
    callerDisappears => {
      const { lines, out } = sink();
      const calls: string[] = [];
      let callerExited = false;
      const result = runGates({
        gates: {
          [STYLE]: REQUIRED_AT_COMMIT,
          [LEAKAGE]: { commit: "optional" },
        },
        moment: COMMIT,
        runner: RUNNER,
        exec: command => {
          calls.push(command);
          if (command === LEAKAGE_COMMAND) {
            callerExited = callerDisappears;
            return { code: null, output: "the final gate was terminated" };
          }
          return { code: 0, output: "" };
        },
        out,
        priorKills: [],
        recordKill: () => true,
        interrupted: () => (callerExited ? REASON : null),
      }) as GateRun;

      expect(calls).toEqual([LINT_COMMAND, LEAKAGE_COMMAND]);
      expect(result.passed.map(gate => gate.id)).toEqual([STYLE]);
      expect(result.killed.map(gate => gate.id)).toEqual([LEAKAGE]);
      expect(result.notRun).toEqual([]);
      expect(result.blockedBy).toBeNull();
      expect(result.blocked).toBe(callerDisappears);
      expect(result.interrupted).toBe(callerDisappears ? REASON : null);
      expect(lines.join("\n")).not.toContain("the rest were not run");
      expect(lines.join("\n").includes("INTERRUPTED, not completed")).toBe(
        callerDisappears
      );
      expect(lines.join("\n").includes(COMPLETION_TALLY)).toBe(
        !callerDisappears
      );
    }
  );
});
