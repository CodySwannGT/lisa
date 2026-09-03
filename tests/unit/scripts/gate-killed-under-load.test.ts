/**
 * Tests for what a gate says when the machine killed it.
 *
 * The token itself is CodySwannGT/lisa#3032's work and is asserted in
 * `lisa-run-gates-killed.test.ts`; this file does not restate it. Two things
 * that issue left open are asserted here instead.
 *
 * First, #3032 records that "nothing was killed in 22 runs, so this arm has
 * never been exercised end to end. It needs a positive control that terminates
 * a real gate command by signal and asserts the printed state token." Every
 * assertion on that path so far has been against a stub that returns 143. A
 * stub cannot fail the way the real one does, so it cannot prove the real one
 * works. The first block below spawns a process that genuinely dies by SIGTERM.
 *
 * Second, and this is CodySwannGT/lisa#3630's half: a kill that says only "the
 * machine was busy" is prose. What decides whether to re-run or to investigate
 * is the NUMBER, and it has to cut both ways — a quiet box at diagnosis time
 * means contention does NOT explain the kill, and saying so is what stops this
 * line becoming a rubber stamp for "not my change".
 * @module tests/unit/scripts/gate-killed-under-load
 */

import { describe, expect, it } from "vitest";

import {
  DIAGNOSIS,
  diagnoseFailure,
  machineLoad,
} from "../../../all/copy-overwrite/scripts/lib/gate-failure-diagnosis.mjs";
import {
  spawnExec,
  STATE,
} from "../../../all/copy-overwrite/scripts/lisa-run-gates.mjs";
import {
  COMMIT,
  type GateOutcome,
  type GateRun,
  REQUIRED_AT_COMMIT,
  RUNNER,
  sink,
  STYLE,
} from "./lisa-run-gates-fixtures.js";
import { runGates } from "../../../all/copy-overwrite/scripts/lisa-run-gates.mjs";

/** One classified failure, typed at the boundary of the untyped `.mjs`. */
type Diagnosis = {
  kind: string;
  summary: string;
  evidence: string[];
  proves: string | null;
};

/** A machine carrying more than two runnable threads per core. */
const SATURATED = { load1: 221.2, cores: 18, ratio: 221.2 / 18 };

/** A machine with capacity to spare. */
const QUIET = { load1: 1.8, cores: 18, ratio: 1.8 / 18 };

/**
 * A command whose real child process really dies by SIGTERM.
 *
 * A bare `kill -TERM $$` does NOT work here and the reason is worth recording:
 * `$$` is the login shell's pid even inside the pipeline `spawnExec` wraps the
 * command in, so `kill` signals the wrapper, exits 0 itself, and the status
 * file records a PASS. Signalling a real child is what the saturated machine
 * actually does, and it is the shape the shell reports as `128 + 15`.
 */
const SELF_TERMINATE = `${process.execPath} -e "process.kill(process.pid,'SIGTERM')"`;

describe("a real signal death, not a stub that returns 143", () => {
  it("spawns a process that dies by signal and reports no verdict code", () => {
    // The positive control #3032 asked for. If the executor ever starts
    // reporting a signal death as a plain nonzero exit, every stubbed
    // assertion downstream stays green while the real path regresses.
    const raw = spawnExec(SELF_TERMINATE) as {
      code: number | null;
      output: string | null;
    };

    expect(raw.code === null || raw.code === 143).toBe(true);
  });

  it("prints KILLED, not FAILED, for that real death", () => {
    const raw = spawnExec(SELF_TERMINATE) as { code: number | null };
    const { lines, out } = sink();
    const result = runGates({
      gates: { [STYLE]: REQUIRED_AT_COMMIT },
      moment: COMMIT,
      runner: RUNNER,
      exec: () => raw,
      out,
    }) as GateRun;
    const outcome = result.results.find(
      (entry: GateOutcome) => entry.id === STYLE
    );

    expect(outcome?.state).toBe(STATE.KILLED);
    expect(lines.some(line => line.includes("KILLED"))).toBe(true);
    expect(lines.some(line => /^\s*FAILED\s/.test(line))).toBe(false);
  });
});

describe("a kill carries the machine's load, so saturation is legible", () => {
  it("names the load and the core count beside a saturated kill", () => {
    const verdict: Diagnosis = diagnoseFailure("", 143, SATURATED);

    expect(verdict.kind).toBe(DIAGNOSIS.KILLED);
    expect(verdict.evidence.join(" ")).toContain("load1 221.2");
    expect(verdict.evidence.join(" ")).toContain("18 core(s)");
    expect(verdict.evidence.join(" ")).toContain("12.3x per core");
  });

  it("tells the reader to stop suspecting the change when the box was saturated", () => {
    // This is the whole cost of the defect: a killed run and a real regression
    // read the same, so the agent that receives one retries, which adds load,
    // which kills the next run.
    expect(diagnoseFailure("", 143, SATURATED).evidence.join(" ")).toContain(
      "saturation, not as a defect in the change"
    );
  });

  it("says contention does NOT explain a kill on a quiet machine", () => {
    // The line has to be falsifiable or it is a rubber stamp. A box at 0.1x
    // did not kill anything for want of capacity, and pointing the reader
    // elsewhere is the more useful half of the reading.
    const evidence = diagnoseFailure("", 143, QUIET).evidence.join(" ");

    expect(evidence).toContain("not saturation");
    expect(evidence).not.toContain("saturation, not as a defect");
  });

  it("marks the reading as a floor, because it is taken after the kill", () => {
    // Load falls once the killed processes are gone, so the number reported is
    // lower than the number that did the damage. Implying otherwise would give
    // the line a precision it does not have.
    expect(diagnoseFailure("", 143, SATURATED).evidence.join(" ")).toContain(
      "after the kill, so this is a floor"
    );
  });

  it("stays silent rather than guessing when the load cannot be read", () => {
    expect(diagnoseFailure("", 143, null).evidence).toEqual([]);
  });

  it("adds the line only to a kill, never to a verdict the run did reach", () => {
    // A machine reading beside a genuine assertion failure would invite
    // exactly the misattribution this module exists to prevent.
    const assertion: Diagnosis = diagnoseFailure(
      "FAIL tests/thing.test.ts > widget",
      1,
      SATURATED
    );

    expect(assertion.kind).toBe(DIAGNOSIS.ASSERTION);
    expect(assertion.evidence.join(" ")).not.toContain("load1");
  });
});

describe("machineLoad: the reading itself", () => {
  it("reports runnable work per core, not a bare load number", () => {
    // `load1 36` is a catastrophe on 4 cores and a busy afternoon on 64. The
    // ratio is the part that means something without knowing the machine.
    const reading = machineLoad(
      () => [36, 20, 10],
      () => 18
    );

    expect(reading).toEqual({ load1: 36, cores: 18, ratio: 2 });
  });

  it("returns null rather than a fabricated reading when a source throws", () => {
    const reading = machineLoad(
      () => {
        throw new Error("no loadavg on this platform");
      },
      () => 18
    );

    expect(reading).toBeNull();
  });

  it("returns null rather than dividing by a zero core count", () => {
    expect(
      machineLoad(
        () => [4, 2, 1],
        () => 0
      )
    ).toBeNull();
  });

  it("reads this machine when nothing is injected", () => {
    // The default path is what production uses; a test that only ever injects
    // proves the injected path and nothing else.
    const reading = machineLoad() as { load1: number; cores: number } | null;

    expect(reading).not.toBeNull();
    expect(reading?.cores).toBeGreaterThan(0);
  });
});
