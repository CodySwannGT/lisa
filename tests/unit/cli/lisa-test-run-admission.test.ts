/**
 * `lisa-test-run` admission (CodySwannGT/lisa#4596): off unless the project
 * sets `pushGate.admission`, and when on the suite is sized to the headroom and
 * hands the grant to the Vitest presets through `LISA_ADMITTED_WORKERS`.
 */
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { resolveMaxWorkers } from "../../../src/configs/vitest/base.js";
import {
  admitTestRun,
  declaredTestWorkers,
} from "../../../src/cli/lisa-test-run-admission.js";
import type { AdmissionRuntime } from "../../../src/core/admission.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

/**
 * A private directory.
 * @returns Path
 */
const dir = (): string => {
  const root = mkdtempSync(join(tmpdir(), "lisa-test-"));
  roots.push(root);
  return root;
};

/**
 * A project with the given `pushGate`.
 * @param pushGate - The block, or undefined for none
 * @returns Project root
 */
const project = (pushGate?: unknown): string => {
  const root = dir();
  writeFileSync(
    join(root, ".lisa.config.json"),
    JSON.stringify(pushGate === undefined ? {} : { pushGate })
  );
  return root;
};

/**
 * A runtime on a machine with `load1` busy cores out of eight.
 * @param load1 - Load average
 * @param cores - Logical cores the machine reports
 * @returns Runtime plus its log
 */
const machine = (
  load1: number,
  cores = 8
): AdmissionRuntime & { lines: string[] } => {
  const lines: string[] = [];
  const clock = { now: 1_800_000_000_000 };
  return {
    lines,
    pid: 900_002,
    readMachine: () => ({ cores, load1, freeMemoryMb: 8192 }),
    probes: { isAlive: () => false, startTimes: () => new Map() },
    now: () => clock.now,
    sleep: async ms => {
      clock.now += ms;
    },
    log: line => lines.push(line),
  };
};

describe("declaredTestWorkers", () => {
  it("is half the cores, at least two, unless LISA_VITEST_MAX_WORKERS says otherwise", () => {
    expect(declaredTestWorkers({}, 18)).toBe(9);
    expect(declaredTestWorkers({}, 2)).toBe(2);
    expect(declaredTestWorkers({ LISA_VITEST_MAX_WORKERS: "5" }, 18)).toBe(5);
  });
});

describe("admitTestRun", () => {
  it("does not consult admission state when the project leaves the switch off", async () => {
    const state = dir();
    const environment: NodeJS.ProcessEnv = { LISA_ADMISSION_STATE_DIR: state };
    const release = await admitTestRun(
      ["vitest", "run"],
      environment,
      project({ buildOnce: true }),
      machine(8)
    );
    expect(typeof release).toBe("function");
    expect(readdirSync(state)).toEqual([]);
    expect(environment.LISA_ADMITTED_WORKERS).toBeUndefined();
  });

  it("sizes the suite to the headroom and hands the grant to resolveMaxWorkers", async () => {
    const state = dir();
    const environment: NodeJS.ProcessEnv = { LISA_ADMISSION_STATE_DIR: state };
    const release = await admitTestRun(
      ["vitest", "run"],
      environment,
      project({ admission: true }),
      machine(5)
    );
    expect(environment.LISA_ADMITTED_WORKERS).toBe("3");
    expect(environment.LISA_ADMISSION_HOLDER).toBe("900002");
    expect(resolveMaxWorkers(environment, 8, () => 1)).toBe(3);
    expect(existsSync(join(state, "900002.json"))).toBe(true);
    if (typeof release === "function") release();
    expect(existsSync(join(state, "900002.json"))).toBe(false);
  });

  it("sizes its demand from the machine it was admitted on, not the host running the test", async () => {
    // CI caught this: demand came from the HOST's core count while headroom
    // came from the runtime, so a 4-core runner granted 2 where the same
    // inputs on an 18-core laptop granted 3. An idle 4-core machine demands
    // half its cores, two, whatever machine this test happens to run on.
    const environment: NodeJS.ProcessEnv = { LISA_ADMISSION_STATE_DIR: dir() };
    const release = await admitTestRun(
      ["vitest", "run"],
      environment,
      project({ admission: true }),
      machine(0, 4)
    );
    expect(environment.LISA_ADMITTED_WORKERS).toBe("2");
    if (typeof release === "function") release();
  });

  it("refuses with the admission exit status once the bound expires", async () => {
    const environment: NodeJS.ProcessEnv = {
      LISA_ADMISSION_STATE_DIR: dir(),
      LISA_ADMISSION_MAX_WAIT: "2s",
    };
    const seams = machine(8);
    expect(
      await admitTestRun(
        ["vitest", "run"],
        environment,
        project({ admission: true }),
        seams
      )
    ).toBe(75);
    expect(seams.lines.join("\n")).toMatch(/refused `vitest run`/u);
  });
});
