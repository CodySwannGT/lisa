import { beforeAll, describe, expect, it, vi } from "vitest";
import type { SpawnSyncOptions } from "node:child_process";
import type { ChildBudgetObservation } from "../helpers/fresh-child-budget.js";
import { currentTimedInvocation } from "../helpers/timed-invocation.js";
import type { TimedInvocation } from "../helpers/timed-invocation.js";

import { ioLatencyBudgetMs } from "../helpers/io-latency-budget.js";
import {
  assertReferenceRefusal,
  assertSelectedChild,
  assertWindow,
  type HookReading,
  type Stage,
} from "../helpers/child-budget-hook-observations.js";

const HOOK_LIMIT = ioLatencyBudgetMs(1_000);
const LATE_START = HOOK_LIMIT - 200;

const profile = vi.hoisted(() => ({
  active: false,
  targetProgram: "",
  targetDispatchCount: 0,
  stages: [] as Stage[],
}));
vi.mock("node:child_process", async original => {
  const actual = await original<typeof import("node:child_process")>();
  return {
    ...actual,
    spawnSync: (command: string, args: string[], options: SpawnSyncOptions) => {
      const reference =
        command === process.execPath && JSON.stringify(args) === '["-e",""]';
      if (profile.active && !reference) profile.targetDispatchCount += 1;
      const startedAtMs = performance.now();
      const outcome = actual.spawnSync(
        command,
        profile.active && reference
          ? [
              "-e",
              "Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,72)",
            ]
          : args,
        { ...options, timeout: options.timeout }
      );
      const endedAtMs = performance.now();
      if (profile.active) {
        profile.stages.push({
          kind: reference ? "reference" : "target",
          expectedInvocation:
            reference ||
            (command === process.execPath &&
              JSON.stringify(args) ===
                JSON.stringify(["-e", profile.targetProgram])),
          boundMs: options.timeout,
          startedAtMs,
          endedAtMs,
          status: outcome.status,
          signal: outcome.signal,
          errorCode: (outcome.error as NodeJS.ErrnoException | undefined)?.code,
          errorMessage: outcome.error?.message,
          pid: outcome.pid,
          directPidAbsent: directPidAbsent(outcome.pid),
          stdout: String(outcome.stdout ?? ""),
        });
      }
      return outcome;
    },
  };
});

let helper: typeof import("../helpers/io-latency-budget.js");
beforeAll(async () => {
  helper = await import("../helpers/io-latency-budget.js");
});

/**
 * Observe only the direct returned PID, without asserting descendant cleanup.
 * @param pid - PID actually returned by the owned primitive
 * @returns Absence observation, or undefined when no positive PID was returned
 */
function directPidAbsent(pid: number): boolean | undefined {
  if (pid <= 0) return undefined;
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ESRCH";
  }
}

/**
 * Run one declared real program, retaining absent work as absent values.
 * @param priorWorkMs - Unchanged declared work before child admission
 * @param targetProgram - The declared real Node program
 * @returns Actual stages, errors and original native invocation values
 */
async function runHook(
  priorWorkMs: number,
  targetProgram: string
): Promise<HookReading> {
  const invocation = currentTimedInvocation();
  const started = performance.now();
  const timing: { beforeChild?: TimedInvocation } = {};
  let reading: ChildBudgetObservation | undefined;
  let error: string | undefined;
  expect(vi.isFakeTimers()).toBe(false);
  if (priorWorkMs > 0) {
    await new Promise(resolve => setTimeout(resolve, priorWorkMs));
  }
  profile.stages = [];
  profile.targetDispatchCount = 0;
  profile.targetProgram = targetProgram;
  profile.active = true;
  timing.beforeChild = currentTimedInvocation();
  try {
    helper.boundedSpawnSync({
      label: priorWorkMs ? "actual-late-hook" : "actual-healthy-hook",
      command: process.execPath,
      args: ["-e", targetProgram],
      baseMs: 40,
      observeBudget: value => {
        reading = value;
      },
    });
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught);
  } finally {
    profile.active = false;
  }
  return {
    priorWorkMs,
    invocation,
    beforeChild: timing.beforeChild,
    completed: currentTimedInvocation(),
    callbackElapsedMs: performance.now() - started,
    stages: [...profile.stages],
    targetDispatchCount: profile.targetDispatchCount,
    reading,
    error,
  };
}

describe("actual late short hook retains remaining2.5headroom", () => {
  let result: HookReading;
  beforeAll(async () => {
    result = await runHook(LATE_START, "setInterval(()=>{},1000)");
  }, HOOK_LIMIT);
  it("requires an attributable reference refusal or all dispatched-target bounds", () => {
    const reference = assertWindow(result, HOOK_LIMIT);
    expect(
      result.beforeChild.nowMs - result.invocation.startedAtMs
    ).toBeGreaterThanOrEqual(LATE_START);
    if (result.targetDispatchCount === 0) {
      assertReferenceRefusal(result, reference, HOOK_LIMIT);
    } else {
      const target = assertSelectedChild(result, reference, HOOK_LIMIT);
      expect(result.reading!.parentElapsedMs).toBeGreaterThanOrEqual(
        LATE_START
      );
      expect(target.errorCode).toBe("ETIMEDOUT");
      expect(target.signal).toBe("SIGKILL");
      expect(target.status).toBeNull();
      expect(result.error).toBeDefined();
    }
  });
});

describe("actual ordinary short hook permits healthy work", () => {
  let result: HookReading;
  beforeAll(async () => {
    result = await runHook(0, 'process.stdout.write("healthy-hook\\n")');
  }, HOOK_LIMIT);
  it("requires a successful reference and healthy target, never a refusal", () => {
    const reference = assertWindow(result, HOOK_LIMIT);
    const target = assertSelectedChild(result, reference, HOOK_LIMIT);
    expect(result.error).toBeUndefined();
    expect(target.errorCode).toBeUndefined();
    expect(target.errorMessage).toBeUndefined();
    expect(target.signal).toBeNull();
    expect(target.status).toBe(0);
    expect(target.stdout).toBe("healthy-hook\n");
  });
});
