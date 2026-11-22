/** Controlled reproduction using the two recorded over-limit startup samples. */
import type { spawnSync, SpawnSyncReturns } from "node:child_process";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { runBoundedChild } from "../../helpers/bounded-child-runner.js";
import {
  describeChildBudget,
  freshChildBudget,
  type ChildBudgetPolicy,
} from "../../helpers/fresh-child-budget.js";

const profile = vi.hoisted(() => ({ time: 0, samples: [] as number[] }));

vi.mock("node:child_process", async original => ({
  ...(await original<typeof import("node:child_process")>()),
  spawnSync: vi.fn(() => {
    const samplingCost = profile.samples.shift();
    if (samplingCost === undefined) throw new Error("unexpected reference");
    profile.time += samplingCost;
    return { status: 0, signal: null };
  }),
}));

/**
 * Build the unchanged flat parent window and a configurable reference allowance.
 * @param referenceDeadlineMs - Standalone cap for the reference window
 * @returns A virtual child operation policy
 */
function policy(referenceDeadlineMs = 30_000): ChildBudgetPolicy {
  return {
    baseMs: 6000,
    quietReferenceMs: 18,
    maxSlowdown: 8,
    referenceDeadlineMs,
    parentBudgetMs: 120_000,
    parentElapsedMs: 0,
    parentShare: 1 / 2.5,
    parentScope: "controlled containing window",
    parentWindow: {
      startedAtMs: 0,
      deadlineMs: 120_000,
      capturedAtMs: 0,
      nativeStartedAtMs: 0,
      nativeDeadlineMs: 120_000,
      clockDomain: "performance",
      now: () => profile.time,
    },
  };
}

const success: SpawnSyncReturns<string> = {
  pid: 0,
  output: [null, "healthy", ""],
  stdout: "healthy",
  stderr: "",
  status: 0,
  signal: null,
};

describe("bounded reference recheck", () => {
  beforeEach(() => {
    profile.time = 0;
  });

  it("charges an isolated over-limit sample and uses one fresh admissible recheck", () => {
    profile.samples = [164.5355, 18];
    const child = vi.fn(() => success);
    const complete = vi.fn<Parameters<typeof runBoundedChild>[2]>();
    const result = runBoundedChild(
      {
        label: "fresh recheck",
        command: process.execPath,
        args: [],
        spawn: child as unknown as typeof spawnSync,
      },
      policy(),
      complete
    );

    expect(result.stdout).toBe("healthy");
    expect(child).toHaveBeenCalledTimes(1);
    const reading = complete.mock.calls[0]?.[4];
    if (!reading) throw new Error("expected a measured child budget");
    expect(reading.referenceMs).toBeCloseTo(18);
    expect(reading.calibrationMs).toBeCloseTo(182.5355);
    expect(reading.rejectedReferenceMs).toBeCloseTo(164.5355);
    expect(reading.timeoutMs).toBe(6000);
    expect(describeChildBudget(reading)).toContain(
      "rejected first reference=164.54ms"
    );
  });

  it("refuses two over-limit samples without dispatch or a third reference", () => {
    profile.samples = [149.594875, 164.5355, 18];
    const child = vi.fn(() => success);

    expect(() =>
      runBoundedChild(
        {
          label: "two over-limit samples",
          command: process.execPath,
          args: [],
          spawn: child as unknown as typeof spawnSync,
        },
        policy(),
        vi.fn()
      )
    ).toThrow(/rejected first reference=149\.59ms.*no host-load cause/u);

    expect(profile.samples).toEqual([18]);
    expect(child).not.toHaveBeenCalled();
  });

  it("spends only the original reference window even when a new sample would pass", () => {
    profile.samples = [150, 18];

    expect(() => freshChildBudget(policy(150))).toThrow(/clamp=8/u);
    expect(profile.samples).toEqual([18]);
  });
});
