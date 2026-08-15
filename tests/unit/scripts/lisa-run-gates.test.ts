/**
 * Tests for the gate runner the git hooks call.
 *
 * The assertions that matter most are the ones about what the runner REFUSES
 * to call a pass: an optional gate that failed, a gate killed by a signal, a
 * gate that resolved to no command, and every gate queued behind a blocking
 * failure. Each of those is a way a check can report satisfied without having
 * proved anything, which is the defect the whole gate subsystem exists to
 * prevent.
 *
 * The command executor is injected, so nothing here spawns a gate command. The
 * process-level contract the hooks branch on is covered in
 * `lisa-run-gates-floor.test.ts`.
 * @module tests/unit/scripts/lisa-run-gates
 */

import { describe, expect, it } from "vitest";

import {
  runGates,
  STATE,
} from "../../../all/copy-overwrite/scripts/lisa-run-gates.mjs";
import { LOCAL_REVIEW, REVIEW_BOT } from "./lisa-gates-fixtures.js";
import {
  COMMIT,
  LEAKAGE,
  LEAKAGE_COMMAND,
  LINT_COMMAND,
  LINT_TASK,
  PUSH,
  type GateRun,
  REQUIRED_AT_COMMIT,
  RUNNER,
  STYLE,
} from "./lisa-run-gates-fixtures.js";

/**
 * A recording executor that answers from a fixed map of command → exit code.
 * @param codes Exit code per command; anything unlisted passes.
 * @returns The executor plus the commands it was actually asked to run.
 */
function stubExec(codes: Record<string, number | null>): {
  exec: (command: string) => number | null;
  calls: string[];
} {
  const calls: string[] = [];
  return {
    calls,
    exec: (command: string): number | null => {
      calls.push(command);
      const code = codes[command];
      // `=== undefined`, never `?? 0`: a stubbed `null` means "killed by a
      // signal", and `??` would quietly turn that into a passing gate —
      // reproducing inside the test harness the exact defect under test.
      return code === undefined ? 0 : code;
    },
  };
}

/**
 * Collects the runner's operator-facing output for assertion.
 * @returns The collected lines plus the sink to hand the runner.
 */
function sink(): { lines: string[]; out: (line: string) => void } {
  const lines: string[] = [];
  return { lines, out: (line: string) => lines.push(line) };
}

describe("runGates: required failures block", () => {
  const gates = {
    [STYLE]: REQUIRED_AT_COMMIT,
    [LEAKAGE]: REQUIRED_AT_COMMIT,
  };

  it("blocks when a required gate exits nonzero", () => {
    const { exec } = stubExec({ [LINT_COMMAND]: 1 });
    const result: GateRun = runGates({
      gates,
      moment: COMMIT,
      runner: RUNNER,
      exec,
      out: () => {},
    });

    expect(result.blocked).toBe(true);
    expect(result.failed.map(entry => entry.id)).toEqual([STYLE]);
  });

  it("does not run, or claim, the gates queued behind the failure", () => {
    const { calls, exec } = stubExec({ [LINT_COMMAND]: 1 });
    const { lines, out } = sink();
    const result: GateRun = runGates({
      gates,
      moment: COMMIT,
      runner: RUNNER,
      exec,
      out,
    });

    expect(calls).toEqual([LINT_COMMAND]);
    expect(result.notRun.map(entry => entry.id)).toEqual([LEAKAGE]);
    expect(result.passed).toEqual([]);
    expect(lines.some(line => line.includes("NOT-RUN"))).toBe(true);
  });

  it("passes when every required gate exits zero", () => {
    const { calls, exec } = stubExec({});
    const result: GateRun = runGates({
      gates,
      moment: COMMIT,
      runner: RUNNER,
      exec,
      out: () => {},
    });

    expect(result.blocked).toBe(false);
    expect(calls).toEqual([LINT_COMMAND, LEAKAGE_COMMAND]);
    expect(result.passed.map(entry => entry.id)).toEqual([STYLE, LEAKAGE]);
  });

  it("treats a signal-killed gate as failed, never as passed", () => {
    const { exec } = stubExec({ [LINT_COMMAND]: null });
    const { lines, out } = sink();
    const result: GateRun = runGates({
      gates: { [STYLE]: REQUIRED_AT_COMMIT },
      moment: COMMIT,
      runner: RUNNER,
      exec,
      out,
    });

    expect(result.blocked).toBe(true);
    expect(result.passed).toEqual([]);
    expect(lines.some(line => line.includes("terminated"))).toBe(true);
  });
});

describe("runGates: optional failures report and continue", () => {
  const gates = {
    [STYLE]: { commit: { level: "optional", run: LINT_TASK } },
    [LEAKAGE]: REQUIRED_AT_COMMIT,
  };

  it("keeps running after an optional gate fails", () => {
    const { calls, exec } = stubExec({ [LINT_COMMAND]: 1 });
    const result: GateRun = runGates({
      gates,
      moment: COMMIT,
      runner: RUNNER,
      exec,
      out: () => {},
    });

    expect(result.blocked).toBe(false);
    expect(calls).toEqual([LINT_COMMAND, LEAKAGE_COMMAND]);
  });

  it("prints the optional failure as FAILED, not as passing", () => {
    const { exec } = stubExec({ [LINT_COMMAND]: 1 });
    const { lines, out } = sink();
    runGates({ gates, moment: COMMIT, runner: RUNNER, exec, out });

    const gateLine = lines.find(line => line.includes(STYLE));
    expect(gateLine).toContain("FAILED");
    expect(gateLine).toContain("optional");
    expect(gateLine).not.toContain("PASSED");
  });

  it("names the optional failure in the summary, and claims no clean run", () => {
    const { exec } = stubExec({ [LINT_COMMAND]: 1 });
    const { lines, out } = sink();
    runGates({ gates, moment: COMMIT, runner: RUNNER, exec, out });

    const summary = lines.join("\n");
    expect(summary).toContain(`optional gate FAILED: ${STYLE}`);
    expect(summary).toContain("reported, not blocking");
    expect(summary).toContain("See the optional failure(s) above");
    expect(summary).toContain("1 proved, 1 failed (optional)");
  });

  it("records the optional failure as failed, not as passed", () => {
    const { exec } = stubExec({ [LINT_COMMAND]: 1 });
    const result: GateRun = runGates({
      gates,
      moment: COMMIT,
      runner: RUNNER,
      exec,
      out: () => {},
    });

    expect(result.failed.map(entry => entry.id)).toEqual([STYLE]);
    expect(result.passed.map(entry => entry.id)).toEqual([LEAKAGE]);
  });
});

describe("runGates: gates with nothing to execute locally", () => {
  it("skips an intercept gate without calling the executor", () => {
    const { calls, exec } = stubExec({});
    const { lines, out } = sink();
    const result: GateRun = runGates({
      gates: { "verification-bypass": { "pre-tool": "required" } },
      moment: "pre-tool",
      runner: RUNNER,
      exec,
      out,
    });

    expect(calls).toEqual([]);
    expect(result.skipped.map(entry => entry.id)).toEqual([
      "verification-bypass",
    ]);
    expect(result.blocked).toBe(false);
    expect(lines.some(line => line.includes("SKIPPED"))).toBe(true);
  });

  it("skips an awaited gate and says which signal it is waiting on", () => {
    const { calls, exec } = stubExec({});
    const { lines, out } = sink();
    const result: GateRun = runGates({
      gates: {
        "code-review": { push: { await: REVIEW_BOT, level: "required" } },
      },
      moment: PUSH,
      runner: RUNNER,
      exec,
      out,
    });

    expect(calls).toEqual([]);
    expect(result.skipped.map(entry => entry.state)).toEqual([STATE.SKIPPED]);
    expect(result.blocked).toBe(false);
    expect(lines.some(line => line.includes(REVIEW_BOT))).toBe(true);
  });

  it("blocks on a required gate that resolves to no command at all", () => {
    const { calls, exec } = stubExec({});
    const result: GateRun = runGates({
      gates: { "x-custom": { push: { level: "required" } } },
      moment: PUSH,
      runner: RUNNER,
      exec,
      out: () => {},
    });

    expect(calls).toEqual([]);
    expect(result.blocked).toBe(true);
    expect(result.passed).toEqual([]);
    expect(result.failed[0]?.state).toBe(STATE.UNPROVABLE);
  });

  it("still runs a real gate declared alongside a skipped one", () => {
    const { calls, exec } = stubExec({});
    const result: GateRun = runGates({
      gates: {
        "code-review": { push: { level: "required", run: LOCAL_REVIEW } },
        "verification-bypass": { push: "required" },
      },
      moment: PUSH,
      runner: RUNNER,
      exec,
      out: () => {},
    });

    expect(calls).toEqual([`${RUNNER} ${LOCAL_REVIEW}`]);
    expect(result.blocked).toBe(false);
  });
});

describe("runGates: nothing declared at the moment", () => {
  it("reports zero gates rather than inventing a verdict", () => {
    const { calls, exec } = stubExec({});
    const result: GateRun = runGates({
      gates: { [STYLE]: { push: "required" } },
      moment: COMMIT,
      runner: RUNNER,
      exec,
      out: () => {},
    });

    expect(calls).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.blocked).toBe(false);
  });
});
