/**
 * `runGates` times each gate, and `main` writes a push timing report
 * (CodySwannGT/lisa#4591).
 *
 * The clock is injected so a duration is a stated fact rather than a race.
 * A gate proved by another gate's run takes no time of its own, and a gate the
 * run never reached has no start. The report is a measurement: it never
 * changes a verdict, and a failing gate is recorded with its exit code.
 * @module tests/unit/scripts/lisa-run-gates-timing
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  EXIT,
  main,
  runGates,
  STATE,
} from "../../../all/copy-overwrite/scripts/lisa-run-gates.mjs";
import { RUNNER, sink, stubExec } from "./lisa-run-gates-fixtures.js";

vi.mock(
  "../../../all/copy-overwrite/scripts/lib/lisa-cleanup-sweep.mjs",
  async importOriginal => ({
    ...(await importOriginal<
      typeof import("../../../all/copy-overwrite/scripts/lib/lisa-cleanup-sweep.mjs")
    >()),
    runStartOfRunSweep: vi.fn(),
  })
);
vi.mock(
  "../../../all/copy-overwrite/scripts/lib/worktree-dependencies.mjs",
  () => ({ worktreeDependencyProblem: vi.fn(() => null) })
);

const PUSH = "push";
const PASS_SCRIPT = "check-pass";
const FAIL_SCRIPT = "check-fail";
/** A declared failure shape, so a bare exit 1 reads as FAILED, not UNPROVABLE. */
const FAILED_LINE = "fixture gate FAILED";

/**
 * A clock that advances by a fixed step on every reading.
 * @param step - Milliseconds per reading
 * @returns The clock
 */
function steppingClock(step: number): () => number {
  const state = { now: 1_000_000 };
  return () => {
    // eslint-disable-next-line functional/immutable-data -- a clock advances
    state.now += step;
    return state.now;
  };
}

describe("runGates timing", () => {
  it("records a start and a duration for every gate it executes", () => {
    const { exec } = stubExec({});
    const { out } = sink();
    const result = runGates({
      gates: {
        "type-correctness": { [PUSH]: { level: "required", run: "typecheck" } },
        "dead-code": { [PUSH]: { level: "optional", run: "knip" } },
      },
      moment: PUSH,
      runner: RUNNER,
      exec,
      out,
      priorKills: [],
      recordKill: () => true,
      interrupted: () => null,
      clock: steppingClock(500),
    });
    for (const entry of result.results) {
      expect(entry.durationMs).toBe(500);
      expect(typeof entry.startedAt).toBe("string");
    }
  });

  it("gives a gate proved by a sibling's run no time of its own", () => {
    const { exec } = stubExec({});
    const { out } = sink();
    const shared = { [PUSH]: { level: "required", run: "test:cov" } };
    const result = runGates({
      gates: { "coverage-adequacy": shared, "test-correctness": shared },
      moment: PUSH,
      runner: RUNNER,
      exec,
      out,
      priorKills: [],
      recordKill: () => true,
      interrupted: () => null,
      clock: steppingClock(700),
    });
    const sharer = result.results.find(entry => entry.provedBy !== null);
    expect(sharer?.durationMs).toBe(0);
  });

  it("leaves a gate the run never reached without a start", () => {
    const { exec } = stubExec({});
    const { out } = sink();
    const result = runGates({
      gates: { "type-correctness": { [PUSH]: "required" } },
      moment: PUSH,
      runner: RUNNER,
      exec,
      out,
      priorKills: [],
      recordKill: () => true,
      interrupted: () => "hook went away",
      clock: steppingClock(100),
    });
    expect(result.results[0]).toMatchObject({
      state: STATE.NOT_RUN,
      startedAt: null,
      durationMs: 0,
    });
  });
});

describe("main push timing report", () => {
  const roots: string[] = [];
  const cwd = process.cwd();

  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    process.chdir(cwd);
    vi.restoreAllMocks();
    for (const root of roots.splice(0))
      rmSync(root, { recursive: true, force: true });
  });

  /**
   * A throwaway project whose push gates run tiny package scripts.
   * @param failing - Whether the optional gate's script exits 1
   * @returns The project root (also the new cwd)
   */
  async function project(failing: boolean): Promise<string> {
    const { writeFileSync } = await import("node:fs");
    const root = mkdtempSync(path.join(tmpdir(), "lisa-push-timing-cli-"));
    roots.push(root);
    writeFileSync(
      path.join(root, "package.json"),
      JSON.stringify({
        name: "push-timing-fixture",
        private: true,
        scripts: {
          [PASS_SCRIPT]: 'node -e "process.exit(0)"',
          [FAIL_SCRIPT]: `node -e "console.error('${FAILED_LINE}'); process.exit(1)"`,
        },
      })
    );
    writeFileSync(
      path.join(root, ".lisa.config.json"),
      JSON.stringify({
        gates: {
          "type-correctness": {
            [PUSH]: { level: "required", run: PASS_SCRIPT },
          },
          "test-correctness": {
            [PUSH]: failing
              ? {
                  level: "required",
                  run: FAIL_SCRIPT,
                  failure_shape: [FAILED_LINE],
                }
              : { level: "required", run: PASS_SCRIPT },
          },
        },
      })
    );
    process.chdir(root);
    return root;
  }

  /**
   * Read the only report the run wrote.
   * @param root - Project root
   * @returns The parsed report
   */
  function onlyReport(root: string) {
    const dir = path.join(root, ".lisa", "push-timing");
    const files = readdirSync(dir);
    expect(files).toHaveLength(1);
    return JSON.parse(readFileSync(path.join(dir, String(files[0])), "utf8"));
  }

  it("writes a report listing every push gate and prints the ⏱ line last", async () => {
    const root = await project(false);
    const lines: string[] = [];
    vi.mocked(console.log).mockImplementation(line => {
      lines.push(String(line));
    });
    const code = main([
      `--moment=${PUSH}`,
      `--coverage=${path.join(root, "cov.txt")}`,
    ]);
    expect(code).toBe(EXIT.PROVED);
    const report = onlyReport(root);
    expect(report.gates.map((gate: { id: string }) => gate.id).sort()).toEqual([
      "test-correctness",
      "type-correctness",
    ]);
    for (const gate of report.gates) {
      expect(gate).toMatchObject({ state: "PASSED", exitCode: 0 });
      expect(gate.durationMs).toBeGreaterThanOrEqual(0);
    }
    expect(report.loadavgStart).toHaveLength(3);
    expect(report.loadavgEnd).toHaveLength(3);
    expect(lines.at(-1)).toMatch(
      /^⏱ push \S+ · 2 gates · slowest \S+ \S+ · load [\d.]+→[\d.]+\/\d+ cores · \.lisa\/push-timing\/.+\.json$/u
    );
  });

  it("refuses the push exactly as before and records the failed gate", async () => {
    const root = await project(true);
    const code = main([
      `--moment=${PUSH}`,
      `--coverage=${path.join(root, "cov.txt")}`,
    ]);
    expect(code).toBe(EXIT.BLOCKED);
    const failed = onlyReport(root).gates.find(
      (gate: { id: string }) => gate.id === "test-correctness"
    );
    expect(failed).toMatchObject({ state: "FAILED", exitCode: 1 });
  });

  it("writes nothing at another moment", async () => {
    const root = await project(false);
    main(["--moment=commit", `--coverage=${path.join(root, "cov.txt")}`]);
    expect(() => readdirSync(path.join(root, ".lisa", "push-timing"))).toThrow(
      /ENOENT/u
    );
  });
});
