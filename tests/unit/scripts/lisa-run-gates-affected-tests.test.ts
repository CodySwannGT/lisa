/**
 * The gate runner's side of affected-test selection (CodySwannGT/lisa#4600).
 *
 * A push test command that narrowed itself reports so through the selection
 * channel. With `pushGate.affectedCoverage: "skip"` coverage-adequacy then
 * reports SKIPPED, "partial selection — enforced by CI", while
 * test-correctness keeps the run's verdict, so a failing selected test still
 * blocks the push. A partial pass is never handed to the pass cache.
 * @module tests/unit/scripts/lisa-run-gates-affected-tests
 */
import { describe, expect, it } from "vitest";

import { runGates } from "../../../all/copy-overwrite/scripts/lisa-run-gates.mjs";
import { sink } from "./lisa-run-gates-fixtures.js";

const PUSH = "push";
const TASK = "test:cov:unit:push";
const COMMAND = `bun run ${TASK}`;
const GATES = {
  "test-correctness": { [PUSH]: { level: "required", run: TASK } },
  "coverage-adequacy": { [PUSH]: { level: "required", run: TASK } },
};

/**
 * Run the two shared-prover gates with one exit code and one report.
 * @param code - Exit code of the shared command
 * @param report - What the command said it selected
 * @returns The run, the printed lines and what the cache was asked to remember
 */
function run(code: number, report: Record<string, unknown> | null) {
  const { lines, out } = sink();
  const remembered: string[] = [];
  const cache = {
    lookup: () => null,
    remember: (gate: { id: string }) => {
      remembered.push(gate.id);
    },
    commit: () => undefined,
  };
  const result = runGates({
    gates: GATES,
    moment: PUSH,
    runner: "bun run",
    exec: () => ({ code, output: "" }),
    out,
    cache,
    selection: {
      read: (command: string) => (command === COMMAND ? report : null),
    },
    priorKills: [],
    recordKill: () => true,
    interrupted: () => null,
  });
  return { result, lines, remembered };
}

/**
 * The state each gate ended in.
 * @param result - The run
 * @returns State per gate id
 */
const states = (result: { results: Array<{ id: string; state: string }> }) =>
  Object.fromEntries(result.results.map(entry => [entry.id, entry.state]));

describe("affected-test selection in the gate runner", () => {
  it("reports coverage-adequacy SKIPPED for a partial run that left coverage to CI", () => {
    const { result, lines, remembered } = run(0, {
      selection: "partial",
      coverage: "skip",
    });
    expect(states(result)).toEqual({
      "coverage-adequacy": "skipped",
      "test-correctness": "passed",
    });
    expect(lines.join("\n")).toContain("partial selection — enforced by CI");
    expect(result.blocked).toBe(false);
    expect(remembered).toEqual([]);
  });

  it("still blocks the push when a selected test fails", () => {
    const { result } = run(1, { selection: "partial", coverage: "skip" });
    expect(states(result)["test-correctness"]).toBe("failed");
    expect(result.blocked).toBe(true);
  });

  it("keeps coverage-adequacy's own verdict when coverage was measured", () => {
    const { result, remembered } = run(0, {
      selection: "partial",
      coverage: "changed-files",
    });
    expect(states(result)).toEqual({
      "coverage-adequacy": "passed",
      "test-correctness": "passed",
    });
    expect(remembered).toEqual([]);
  });

  it("remembers a full run exactly as before", () => {
    const { result, remembered } = run(0, {
      selection: "full",
      coverage: "measured",
    });
    expect(states(result)["coverage-adequacy"]).toBe("passed");
    expect(remembered.toSorted((a, b) => a.localeCompare(b))).toEqual([
      "coverage-adequacy",
      "test-correctness",
    ]);
  });

  it("reports as before when the command wrote no report", () => {
    const { result, remembered } = run(0, null);
    expect(states(result)["coverage-adequacy"]).toBe("passed");
    expect(remembered).toHaveLength(2);
  });
});
