/**
 * Tests for the state a terminated gate reports.
 *
 * `exit 1` carried two opposite facts. A gate that measured a real regression
 * and a gate the machine killed mid-run printed the same `FAILED` token, and
 * re-running is the rational response to both — which is precisely why the
 * real one never got looked at (CodySwannGT/lisa#3032, from #2883).
 *
 * The diagnosis module has said "It was terminated, NOT failed" in prose since
 * #2813. Prose is not the half a reader skims or a parser keys off. These
 * assertions are on the VOCABULARY: the token beside that prose, the bucket the
 * gate lands in, and the headline the summary prints. A kill is NOT PROVED —
 * blocking, because an unmeasured required property is not a pass, and never
 * FAILED, because nothing was measured to be found wanting.
 * @module tests/unit/scripts/lisa-run-gates-killed
 */

import { describe, expect, it } from "vitest";
import {
  runGates,
  STATE,
} from "../../../all/copy-overwrite/scripts/lisa-run-gates.mjs";
import {
  COMMIT,
  type GateOutcome,
  type GateRun,
  LEAKAGE,
  LINT_COMMAND,
  REQUIRED_AT_COMMIT,
  RUNNER,
  sink,
  stubExec,
  STYLE,
} from "./lisa-run-gates-fixtures.js";

/** `128 + 15`: the SIGTERM a saturated box hands out. */
const SIGTERM_EXIT = 143;

/** The one phrase a terminated gate must never print anywhere. */
const FAILED_HEADLINE = "gate FAILED";

/**
 * Run one required gate whose command answers with the given code.
 * @param code - Exit code for the lint command; null means no code at all
 * @returns The run and the printed lines
 */
function killedRun(code: number | null): { result: GateRun; lines: string[] } {
  const { exec } = stubExec({ [LINT_COMMAND]: code });
  const { lines, out } = sink();
  const result = runGates({
    gates: { [STYLE]: REQUIRED_AT_COMMIT },
    moment: COMMIT,
    runner: RUNNER,
    exec,
    out,
  }) as GateRun;
  return { result, lines };
}

describe("STATE: a kill has its own member", () => {
  it("names a terminated run, so the token is not borrowed from a verdict", () => {
    // The vocabulary is the fix. `passed`/`failed`/`unprovable`/`skipped`/
    // `not-run` had no member for "the command never answered", so the runner
    // spent one of the verdict words on a non-verdict.
    expect(STATE.KILLED).toBe("killed");
  });
});

describe("runGates: a killed gate is not a failed one", () => {
  it("records KILLED, not FAILED, for a signal exit code", () => {
    const { result } = killedRun(SIGTERM_EXIT);
    const outcome = result.results.find(
      (entry: GateOutcome) => entry.id === STYLE
    );

    expect(outcome?.state).toBe(STATE.KILLED);
    expect(outcome?.state).not.toBe(STATE.FAILED);
  });

  it("records KILLED when the runner obtained no exit code at all", () => {
    // `spawnSync` reports a null status for a child killed by a signal, and
    // that path must reach the same state as an enumerated `128 + n` — the two
    // are the same event seen through different shells.
    const { result } = killedRun(null);
    const outcome = result.results.find(
      (entry: GateOutcome) => entry.id === STYLE
    );

    expect(outcome?.state).toBe(STATE.KILLED);
  });

  it("prints KILLED beside the gate id, never FAILED", () => {
    const { lines } = killedRun(SIGTERM_EXIT);
    const gateLine = lines.find(line => line.includes(STYLE));

    expect(gateLine).toContain("KILLED");
    expect(gateLine).not.toContain("FAILED");
  });

  it("headlines the kill as NOT PROVED rather than as a failure", () => {
    const { lines } = killedRun(SIGTERM_EXIT);
    const headline = lines.find(line => line.includes("NOT PROVED"));

    expect(headline).toContain("KILLED");
    expect(headline).toContain(STYLE);
    // The one sentence a reader must never see about a terminated run: no line
    // anywhere in the transcript may call it a failed gate.
    expect(lines.some(line => line.includes(FAILED_HEADLINE))).toBe(false);
  });

  it("still blocks, because an unmeasured required property is not a pass", () => {
    const { result } = killedRun(SIGTERM_EXIT);

    expect(result.blocked).toBe(true);
    expect(result.blockedBy).toBe(STYLE);
    expect(result.passed).toEqual([]);
  });

  it("buckets the kill on its own, and keeps it out of the passed bucket", () => {
    const { result } = killedRun(SIGTERM_EXIT);

    expect(result.killed.map((entry: GateOutcome) => entry.id)).toEqual([
      STYLE,
    ]);
    expect(result.unprovable).toEqual([]);
    // Still reported among the gates this run did not prove — the bucket is a
    // new NAME for the outcome, not a new place for it to hide.
    expect(result.failed.map((entry: GateOutcome) => entry.id)).toEqual([
      STYLE,
    ]);
  });

  it("does not present a kill as a coverage or a test failure", () => {
    // The scenario's second clause, on the two gates that actually share one
    // prover. A killed `test:cov` measured neither property; saying it failed
    // either one is a verdict invented from a truncated transcript.
    const shared = { level: "required", run: "test:cov" };
    const { exec } = stubExec({ [`${RUNNER} test:cov`]: SIGTERM_EXIT });
    const { lines, out } = sink();
    const result = runGates({
      gates: {
        "coverage-adequacy": { [COMMIT]: shared },
        "test-correctness": { [COMMIT]: shared },
      },
      moment: COMMIT,
      runner: RUNNER,
      exec,
      out,
    }) as GateRun;

    expect(result.killed.map((entry: GateOutcome) => entry.id)).toEqual([
      "coverage-adequacy",
      "test-correctness",
    ]);
    expect(result.blocked).toBe(true);
    expect(lines.some(line => line.includes(FAILED_HEADLINE))).toBe(false);
  });

  it("leaves one marker for one killed command shared by several gates", () => {
    const shared = { level: "required", run: "test:cov" };
    const { exec } = stubExec({ [`${RUNNER} test:cov`]: SIGTERM_EXIT });
    const marks: Array<{ kind: string; gateId: string }> = [];
    runGates({
      gates: {
        "coverage-adequacy": { [COMMIT]: shared },
        "test-correctness": { [COMMIT]: shared },
      },
      moment: COMMIT,
      runner: RUNNER,
      exec,
      recordKill: mark => {
        marks.push(mark);
        return true;
      },
    });

    expect(marks).toEqual([
      { kind: STATE.KILLED, gateId: "coverage-adequacy" },
    ]);
  });

  it("leaves an ordinary nonzero exit reporting FAILED", () => {
    // The control. Widening "killed" to cover every nonzero exit would erase
    // the distinction from the other side and make every regression NOT PROVED.
    const { exec } = stubExec({ [LINT_COMMAND]: 1 });
    const { lines, out } = sink();
    const result = runGates({
      gates: { [STYLE]: REQUIRED_AT_COMMIT, [LEAKAGE]: REQUIRED_AT_COMMIT },
      moment: COMMIT,
      runner: RUNNER,
      exec,
      out,
    }) as GateRun;

    expect(result.killed).toEqual([]);
    expect(result.failed.map((entry: GateOutcome) => entry.id)).toEqual([
      STYLE,
    ]);
    expect(lines.some(line => line.includes(FAILED_HEADLINE))).toBe(true);
  });
});
