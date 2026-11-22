import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { spawnSync, SpawnSyncReturns } from "node:child_process";
import type { ChildBudgetWindow } from "../../helpers/fresh-child-budget.js";

const profile = vi.hoisted(() => ({
  now: 0,
  referenceMs: 18,
  referenceError: false,
}));
vi.mock("node:child_process", async original => ({
  ...(await original<typeof import("node:child_process")>()),
  spawnSync: vi.fn(() => {
    profile.now += profile.referenceMs;
    return profile.referenceError
      ? {
          status: null,
          signal: "SIGKILL",
          error: Object.assign(new Error("reference timeout"), {
            code: "ETIMEDOUT",
          }),
        }
      : { status: 0, signal: null };
  }),
}));

let helper: typeof import("../../helpers/io-latency-budget.js");
let admission: typeof import("../../helpers/fresh-child-budget.js");
beforeEach(() => {
  vi.spyOn(performance, "now").mockImplementation(() => profile.now);
});
afterEach(() => {
  vi.restoreAllMocks();
});
beforeAll(async () => {
  const clock = vi
    .spyOn(performance, "now")
    .mockImplementation(() => profile.now);
  try {
    helper = await import("../../helpers/io-latency-budget.js");
    admission = await import("../../helpers/fresh-child-budget.js");
  } finally {
    clock.mockRestore();
  }
});

/**
 * A controlled transport result, not a simulated budget decision.
 * @param status - The child status supplied by the control
 * @returns A UTF-8 child result
 */
function completed(status = 0): SpawnSyncReturns<string> {
  return {
    pid: 0,
    output: [null, "healthy", ""],
    stdout: "healthy",
    stderr: "",
    status,
    signal: null,
  };
}

/**
 * Supply an explicit anchored clock for direct policy-only controls.
 * @param budget - Original parent budget
 * @param elapsed - Already consumed time at capture
 * @returns Immutable origin/deadline on the controlled clock
 */
function controlledWindow(budget: number, elapsed = 0): ChildBudgetWindow {
  const capturedAtMs = profile.now;
  const startedAtMs = capturedAtMs - elapsed;
  return {
    startedAtMs,
    deadlineMs: startedAtMs + budget,
    capturedAtMs,
    nativeStartedAtMs: startedAtMs,
    nativeDeadlineMs: startedAtMs + budget,
    clockDomain: "performance",
    now: () => profile.now,
  };
}

describe("fresh bounded child admission", () => {
  it("the fixed18-to72ms profile admits the same healthy work after initialization", () => {
    const readings: import("../../helpers/fresh-child-budget.js").ChildBudgetObservation[] =
      [];
    profile.referenceMs = 18;
    const quiet = vi.fn((_command, _args, options) => {
      expect(options.timeout).toBe(6000);
      profile.now += 3000;
      return completed();
    });
    expect(
      helper.boundedSpawnSync({
        label: "quiet",
        command: process.execPath,
        args: [],
        spawn: quiet as unknown as typeof spawnSync,
        observeBudget: r => readings.push(r),
      }).status
    ).toBe(0);
    profile.referenceMs = 72;
    const changed = vi.fn((_command, _args, options) => {
      expect(options.timeout).toBe(24000);
      profile.now += 12000;
      return completed();
    });
    expect(
      helper.boundedSpawnSync({
        label: "changed",
        command: process.execPath,
        args: [],
        spawn: changed as unknown as typeof spawnSync,
        observeBudget: r => readings.push(r),
      }).status
    ).toBe(0);
    expect(helper.workerSpawnSlowdown()).toBe(1);
    expect(readings.map(r => [r.referenceMs, r.slowdown, r.timeoutMs])).toEqual(
      [
        [18, 1, 6000],
        [72, 4, 24000],
      ]
    );
    expect(readings[1]!.calibrationMs).toBe(72);
    expect(readings[1]!.referenceAgeAtCompletionMs).toBe(12000);
    expect(readings[1]!.operationElapsedMs).toBe(12072);
    expect(
      readings[1]!.calibrationMs + readings[1]!.timeoutMs
    ).toBeLessThanOrEqual(readings[1]!.operationLimitMs);
  });

  it("charges calibration to the observed containing window with full precision", () => {
    profile.referenceMs = 18;
    const policy = {
      baseMs: 6000,
      quietReferenceMs: 18,
      maxSlowdown: 8,
      referenceDeadlineMs: 30000,
      parentBudgetMs: 100,
      parentElapsedMs: 0,
      parentShare: 1 / 2.5,
      parentScope: "controlled containing window",
      parentWindow: controlledWindow(100),
    };
    const flat = admission.freshChildBudget(policy);
    expect(flat.operationLimitMs).toBe(100);
    expect(flat.calibrationMs).toBe(18);
    expect(flat.timeoutMs).toBe(32);
    expect(flat.calibrationMs + flat.timeoutMs * 2.5).toBeLessThanOrEqual(100);

    profile.referenceMs = 18.125;
    const parentBudgetMs = 60_000.5;
    const scaled = admission.freshChildBudget({
      ...policy,
      baseMs: 30_000,
      parentBudgetMs,
      parentShare: 0.5,
      parentTotalMargin: true,
      parentWindow: controlledWindow(parentBudgetMs),
    });
    expect(scaled.operationLimitMs).toBe(30_000.25);
    expect(scaled.timeoutMs).toBe(29_982);
    expect(scaled.calibrationMs + scaled.timeoutMs).toBeLessThanOrEqual(
      scaled.operationLimitMs
    );
  });

  it("expired or unbounded containing windows refuse before child dispatch", () => {
    const policy = {
      baseMs: 6000,
      quietReferenceMs: 18,
      maxSlowdown: 8,
      referenceDeadlineMs: 30000,
      parentBudgetMs: 120000,
      parentElapsedMs: 120000,
      parentShare: 1 / 2.5,
      parentScope: "expired case",
      parentWindow: controlledWindow(120000, 120000),
    };
    expect(() => admission.freshChildBudget(policy)).toThrow(
      "no finite containing headroom"
    );
    expect(() =>
      admission.freshChildBudget({
        ...policy,
        baseMs: Infinity,
        parentBudgetMs: Infinity,
        parentElapsedMs: 0,
      })
    ).toThrow("no finite containing headroom");
  });

  it("keeps the opt-in scaled total margin distinct from flat child-only caps", () => {
    profile.referenceMs = 18;
    const policy = {
      baseMs: 6000,
      quietReferenceMs: 18,
      maxSlowdown: 8,
      referenceDeadlineMs: 30000,
      parentBudgetMs: 60000,
      parentElapsedMs: 29000,
      parentShare: 0.5,
      parentTotalMargin: true,
      parentScope: "controlled scaled total margin",
      parentWindow: controlledWindow(60000, 29000),
    };
    const reading = admission.freshChildBudget(policy);
    expect(reading.operationLimitMs).toBe(1000);
    expect(reading.calibrationMs).toBe(18);
    expect(reading.timeoutMs).toBe(982);
    expect(reading.calibrationMs + reading.timeoutMs).toBeLessThanOrEqual(1000);
    expect(() =>
      admission.freshChildBudget({
        ...policy,
        parentElapsedMs: 30000,
        parentWindow: controlledWindow(60000, 30000),
      })
    ).toThrow("headroom");
  });

  it("noncompleting and past-clamp references refuse truthfully", () => {
    const child = vi.fn(() => completed());
    profile.referenceError = true;
    try {
      expect(() =>
        helper.boundedSpawnSync({
          label: "bad-reference",
          command: process.execPath,
          args: [],
          spawn: child as unknown as typeof spawnSync,
        })
      ).toThrow("reference did not complete");
    } finally {
      profile.referenceError = false;
    }
    profile.referenceMs = 180;
    try {
      expect(() =>
        helper.boundedSpawnSync({
          label: "past-clamp",
          command: process.execPath,
          args: [],
          spawn: child as unknown as typeof spawnSync,
        })
      ).toThrow("no host-load cause is established");
    } finally {
      profile.referenceMs = 18;
    }
    expect(child).not.toHaveBeenCalled();
  });

  it("retains ordinary nonzero,127 and narrowly declared EPIPE outcomes", () => {
    for (const status of [7, 127]) {
      const result = helper.boundedSpawnSync({
        label: "nonzero",
        command: process.execPath,
        args: [],
        spawn: (() => completed(status)) as unknown as typeof spawnSync,
      });
      expect(result.status).toBe(status);
    }
    const pipe = (status: number) => () => ({
      ...completed(status),
      error: Object.assign(new Error("write EPIPE"), { code: "EPIPE" }),
    });
    expect(() =>
      helper.boundedSpawnSync({
        label: "undeclared",
        command: process.execPath,
        args: [],
        spawn: pipe(0) as unknown as typeof spawnSync,
      })
    ).toThrow("EPIPE");
    expect(
      helper.boundedSpawnSync({
        label: "declared",
        command: process.execPath,
        args: [],
        spawn: pipe(0) as unknown as typeof spawnSync,
        childMayExitBeforeReading: true,
      }).status
    ).toBe(0);
    expect(() =>
      helper.boundedSpawnSync({
        label: "absent",
        command: process.execPath,
        args: [],
        spawn: pipe(127) as unknown as typeof spawnSync,
        childMayExitBeforeReading: true,
      })
    ).toThrow("EPIPE");
  });

  it("a real timeout result remains refusal and names the measurement actually used", () => {
    profile.referenceMs = 72;
    const killed = () => ({
      ...completed(),
      status: null,
      signal: "SIGKILL" as const,
      error: Object.assign(new Error("ETIMEDOUT"), { code: "ETIMEDOUT" }),
    });
    expect(() =>
      helper.boundedSpawnSync({
        label: "noncompletion",
        command: process.execPath,
        args: [],
        spawn: killed as unknown as typeof spawnSync,
      })
    ).toThrow(/factor=4\.00x.*child bound=24000ms/);
    expect(() =>
      helper.assertChildCompleted({ signal: "SIGKILL" }, "legacy")
    ).toThrow("Initialization-only");
    profile.referenceMs = 18;
  });
});
