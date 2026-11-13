/**
 * How the gate runner consults and fills the push-gate pass cache
 * (CodySwannGT/lisa#4594).
 *
 * The cache itself — keys, the clean-tree rule, CI and opt-out — is proved in
 * `gate-pass-cache.test.ts`. This file proves the runner's half of the
 * contract with a fake cache: a hit is reported as `CACHED PASS` and not run,
 * and only a full pass is ever handed to the cache to remember.
 * @module tests/unit/scripts/lisa-run-gates-pass-cache
 */
import { describe, expect, it } from "vitest";

import {
  runGates,
  STATE,
} from "../../../all/copy-overwrite/scripts/lisa-run-gates.mjs";
import { PUSH, RUNNER, sink, stubExec } from "./lisa-run-gates-fixtures.js";

const FINGERPRINT = "f".repeat(64);
const TYPES = "type-correctness";
const DEAD = "dead-code";
const COVERAGE = "coverage-adequacy";
const CORRECTNESS = "test-correctness";
const TYPES_COMMAND = `${RUNNER} typecheck`;
const DEAD_COMMAND = `${RUNNER} knip`;
const SHARED_COMMAND = `${RUNNER} test:cov`;

type Gate = { id: string; command: string | null };

/**
 * A fake cache that hits for the listed gate ids and records what it is told.
 * @param hits - Gate ids the cache answers for
 * @returns The cache plus the ids remembered and whether commit ran
 */
function fakeCache(hits: string[] = []) {
  const remembered: string[] = [];
  const state = { committed: false };
  return {
    remembered,
    state,
    cache: {
      lookup: (gate: Gate) =>
        hits.includes(gate.id) ? { key: FINGERPRINT } : null,
      remember: (gate: Gate) => remembered.push(gate.id),
      commit: () => {
        state.committed = true;
      },
    },
  };
}

/**
 * Run a push-moment gates block against stubbed exit codes and a fake cache.
 * @param gates - The gates block
 * @param codes - Exit code per command
 * @param hits - Gate ids the cache answers for
 * @returns The run, what executed, what printed, and what was remembered
 */
function run(
  gates: object,
  codes: Record<string, number | null> = {},
  hits: string[] = []
) {
  const { exec, calls } = stubExec(codes);
  const { lines, out } = sink();
  const fake = fakeCache(hits);
  const result = runGates({
    gates,
    moment: PUSH,
    runner: RUNNER,
    exec,
    out,
    priorKills: [],
    recordKill: () => true,
    interrupted: () => null,
    cache: fake.cache,
  });
  return { result, calls, lines, ...fake };
}

const TWO = {
  [TYPES]: { [PUSH]: { level: "required", run: "typecheck" } },
  [DEAD]: { [PUSH]: { level: "required", run: "knip" } },
};

describe("gate runner with a pass cache", () => {
  it("reports a hit as CACHED PASS, counts it passed, and does not run it", () => {
    const { result, calls, lines, remembered, state } = run(TWO, {}, [TYPES]);
    expect(calls).toEqual([DEAD_COMMAND]);
    expect(result.blocked).toBe(false);
    const types = result.results.find(entry => entry.id === TYPES);
    expect(types?.state).toBe(STATE.PASSED);
    expect(types?.cached).toBe(true);
    expect(lines.join("\n")).toContain(
      `CACHED PASS (${FINGERPRINT.slice(0, 12)})`
    );
    expect(lines.join("\n")).toMatch(/1 of those proved by a remembered pass/);
    expect(remembered).toEqual([DEAD]);
    expect(state.committed).toBe(true);
  });

  it("never remembers a failure", () => {
    const { result, remembered } = run(TWO, { [TYPES_COMMAND]: 1 });
    expect(result.blocked).toBe(true);
    expect(remembered).toEqual([DEAD]);
  });

  it("never remembers a killed gate", () => {
    const { remembered } = run(TWO, { [DEAD_COMMAND]: null });
    expect(remembered).toEqual([TYPES]);
  });

  it("remembers both gates a passing shared prover proved", () => {
    const shared = {
      [COVERAGE]: { [PUSH]: { level: "required", run: "test:cov" } },
      [CORRECTNESS]: { [PUSH]: { level: "required", run: "test:cov" } },
    };
    const { calls, remembered } = run(shared);
    expect(calls).toEqual([SHARED_COMMAND]);
    expect(new Set(remembered)).toEqual(new Set([COVERAGE, CORRECTNESS]));
  });

  it("remembers neither gate when the shared prover failed", () => {
    const shared = {
      [COVERAGE]: { [PUSH]: { level: "required", run: "test:cov" } },
      [CORRECTNESS]: { [PUSH]: { level: "required", run: "test:cov" } },
    };
    const { remembered } = run(shared, { [SHARED_COMMAND]: 1 });
    expect(remembered).toEqual([]);
  });

  it("runs exactly as before without a cache", () => {
    const { exec, calls } = stubExec({});
    const { lines, out } = sink();
    runGates({
      gates: TWO,
      moment: PUSH,
      runner: RUNNER,
      exec,
      out,
      priorKills: [],
      recordKill: () => true,
      interrupted: () => null,
    });
    expect(new Set(calls)).toEqual(new Set([DEAD_COMMAND, TYPES_COMMAND]));
    expect(lines.join("\n")).not.toMatch(/CACHED|remembered/);
  });
});
