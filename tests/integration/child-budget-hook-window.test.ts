import { beforeAll, describe, expect, it, vi } from "vitest";
import type { SpawnSyncOptions } from "node:child_process";
import type { ChildBudgetObservation } from "../helpers/fresh-child-budget.js";
import { currentTimedInvocation } from "../helpers/timed-invocation.js";
import type { TimedInvocation } from "../helpers/timed-invocation.js";

import { ioLatencyBudgetMs } from "../helpers/io-latency-budget.js";

const HOOK_LIMIT = ioLatencyBudgetMs(1_000);
const LATE_START = HOOK_LIMIT - 200;

/** Value-only outcome of one real reference or target primitive call. */
interface Stage {
  kind: "reference" | "target";
  expectedInvocation: boolean;
  boundMs: number | undefined;
  startedAtMs: number;
  endedAtMs: number;
  status: number | null;
  signal: NodeJS.Signals | null;
  errorCode: string | undefined;
  errorMessage: string | undefined;
  pid: number;
  directPidAbsent: boolean | undefined;
  stdout: string;
}
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

/** Stage observations and unchanged native owner values from one hook. */
interface HookReading {
  priorWorkMs: number;
  invocation: TimedInvocation;
  beforeChild: TimedInvocation;
  completed: TimedInvocation;
  callbackElapsedMs: number;
  stages: Stage[];
  targetDispatchCount: number;
  reading: ChildBudgetObservation | undefined;
  error: string | undefined;
}
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

/**
 * Require one actual native hook start and deadline for all stage observations.
 * @param result - Actual hook outcome, including absent undispatched work
 */
function assertWindow(result: HookReading): void {
  // Emit in the assertion case, outside the measured hook's timed window.
  const { targetDispatchCount } = result;
  const { invocation, beforeChild, completed } = result;
  console.log(
    `HOOK_WINDOW_JOURNAL ${JSON.stringify({ classification: "Owned Node reference and target under an observed Vitest hook deadline, with 72ms of controlled reference work", branch: targetDispatchCount ? "target-dispatched" : result.stages[0]?.errorCode === "ETIMEDOUT" ? "reference-timeout/no-target" : "unexpected/no-target", originalDeadlineMs: result.invocation.startedAtMs + result.invocation.timeoutMs, ...result })}`
  );
  expect(invocation.timeoutMs).toBeCloseTo(HOOK_LIMIT, 9);
  for (const value of [invocation, beforeChild, completed]) {
    expect(Number.isFinite(value.startedAtMs)).toBe(true);
    expect(Number.isFinite(value.nowMs)).toBe(true);
    expect(value.startedAtMs).toBe(invocation.startedAtMs);
    expect(value.timeoutMs).toBeCloseTo(HOOK_LIMIT, 9);
    expect(value.nowMs).toBeGreaterThanOrEqual(value.startedAtMs);
    expect(value.nowMs).toBeLessThan(invocation.startedAtMs + HOOK_LIMIT);
  }
  expect(result.callbackElapsedMs).toBeLessThan(HOOK_LIMIT);
  expect(
    result.stages.filter(stage => stage.kind === "reference")
  ).toHaveLength(1);
  for (const stage of result.stages) {
    expect(stage.expectedInvocation).toBe(true);
    expect(Number.isFinite(stage.boundMs)).toBe(true);
    expect(stage.boundMs).toBeGreaterThan(0);
    expect(stage.boundMs).toBeLessThanOrEqual(
      invocation.startedAtMs + HOOK_LIMIT - stage.startedAtMs
    );
    expect(Number.isFinite(stage.startedAtMs)).toBe(true);
    expect(stage.startedAtMs).toBeGreaterThanOrEqual(beforeChild.nowMs);
    expect(stage.endedAtMs).toBeGreaterThan(stage.startedAtMs);
    expect(stage.endedAtMs).toBeLessThan(invocation.startedAtMs + HOOK_LIMIT);
    expect(Number.isFinite(stage.pid)).toBe(true);
    expect(stage.pid).toBeGreaterThanOrEqual(0);
    if (stage.pid > 0) expect(stage.directPidAbsent).toBe(true);
  }
}

/**
 * Retain calibration, original window and child-only2.5headroom assertions.
 * @param result - Actual hook outcome after a successful reference
 * @returns The one actual dispatched target stage
 */
function assertSelectedChild(result: HookReading): Stage {
  const reference = result.stages[0]!;
  const reading = result.reading!;
  const target = result.stages[1]!;
  expect(reference.kind).toBe("reference");
  expect(reference.status).toBe(0);
  expect(reference.signal).toBeNull();
  expect(reference.errorCode).toBeUndefined();
  expect(reference.errorMessage).toBeUndefined();
  expect(result.stages.filter(stage => stage.kind === "target")).toHaveLength(
    1
  );
  expect(result.targetDispatchCount).toBe(1);
  expect(result.stages).toHaveLength(2);
  expect(reading).toBeDefined();
  expect(reading.parentBudgetMs).toBeCloseTo(HOOK_LIMIT, 9);
  expect(reading.parentWindow.nativeStartedAtMs).toBe(
    result.invocation.startedAtMs
  );
  expect(reading.parentWindow.nativeDeadlineMs).toBe(
    result.invocation.startedAtMs + HOOK_LIMIT
  );
  expect(reading.parentWindow.clockDomain).toBe("performance");
  expect(reading.calibrationMs + reading.timeoutMs * 2.5).toBeLessThanOrEqual(
    HOOK_LIMIT - reading.parentElapsedMs
  );
  expect(reading.operationElapsedMs).toBeLessThan(
    HOOK_LIMIT - reading.parentElapsedMs
  );
  expect(target.kind).toBe("target");
  expect(target.boundMs).toBe(reading.timeoutMs);
  expect(target.pid).toBeGreaterThan(0);
  expect(target.directPidAbsent).toBe(true);
  return target;
}

describe("actual late short hook retains remaining2.5headroom", () => {
  let result: HookReading;
  beforeAll(async () => {
    result = await runHook(LATE_START, "setInterval(()=>{},1000)");
  }, HOOK_LIMIT);
  it("requires an attributable reference timeout or all dispatched-target bounds", () => {
    assertWindow(result);
    expect(
      result.beforeChild.nowMs - result.invocation.startedAtMs
    ).toBeGreaterThanOrEqual(LATE_START);
    const reference = result.stages[0]!;
    if (reference.errorCode === "ETIMEDOUT") {
      expect(reference.kind).toBe("reference");
      expect(reference.signal).toBe("SIGKILL");
      expect(reference.status).toBeNull();
      expect(result.stages).toHaveLength(1);
      expect(result.targetDispatchCount).toBe(0);
      expect(
        result.stages.filter(stage => stage.kind === "target")
      ).toHaveLength(0);
      expect(result.reading).toBeUndefined();
      expect(reference.errorMessage).toBeDefined();
      const prefix = `Child admission reference did not complete: status=null, signal=SIGKILL, error=${reference.errorMessage}; reference bound=${reference.boundMs}ms, fixed operation window=`;
      expect(result.error?.startsWith(prefix)).toBe(true);
      const allocation = result.error
        ?.slice(prefix.length)
        .match(/^(\d+)ms\.$/);
      expect(allocation).not.toBeNull();
      expect(allocation).toBeDefined();
      const operationWindow = Number(allocation![1]);
      expect(operationWindow).toBeGreaterThan(0);
      expect(operationWindow).toBeLessThanOrEqual(
        result.invocation.startedAtMs + HOOK_LIMIT - result.beforeChild.nowMs
      );
      expect(reference.boundMs).toBeLessThanOrEqual(operationWindow);
    } else {
      const target = assertSelectedChild(result);
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
    assertWindow(result);
    const target = assertSelectedChild(result);
    expect(result.error).toBeUndefined();
    expect(target.errorCode).toBeUndefined();
    expect(target.errorMessage).toBeUndefined();
    expect(target.signal).toBeNull();
    expect(target.status).toBe(0);
    expect(target.stdout).toBe("healthy-hook\n");
  });
});
