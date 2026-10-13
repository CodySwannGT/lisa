/**
 * Contract tests for the session manager's capacity maths.
 *
 * Capacity decides whether the manager may start one more background worker.
 * A wrong answer either starves the queue or swaps the machine to a halt, so
 * the tests pin every branch of the cap formula (machine readings live in
 * capacity-stats.test.ts), and the override order an operator relies on
 * when they send `cap N` from their phone.
 * @module tests/unit/session-manager/capacity
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import type { MachineStats } from "../../../plugins/src/base/skills/lisa-session-manager/scripts/capacity.mjs";
import {
  computeCapacity,
  resolveMaxWorkers,
} from "../../../plugins/src/base/skills/lisa-session-manager/scripts/capacity.mjs";

const MODULE_PATH = path.join(
  __dirname,
  "../../../plugins/src/base/skills/lisa-session-manager/scripts/capacity.mjs"
);

const CONFIG = {
  maxWorkers: 6,
  gbPerWorker: 3,
  reserveGb: 8,
  cpuFraction: 0.75,
  maxLoadPerCore: 1.5,
};

/**
 * Build a stats object the way readMachineStats would return it.
 * @param overrides - Fields to replace
 * @returns Machine stats
 */
function stats(overrides: Partial<MachineStats> = {}): MachineStats {
  return {
    availGb: 64,
    cores: 16,
    load1: 1,
    memSource: "vm_stat",
    ...overrides,
  };
}

describe("computeCapacity", () => {
  it("returns exactly the documented keys", () => {
    const result = computeCapacity({
      stats: stats(),
      running: 0,
      config: CONFIG,
    });
    expect(Object.keys(result).sort((a, b) => a.localeCompare(b))).toEqual([
      "avail_gb",
      "can_spawn",
      "cap",
      "cores",
      "free_slots",
      "load1",
      "mem_source",
      "overloaded",
      "paused",
      "running",
    ]);
  });

  it("is memory-bound when free memory over the reserve is the tightest limit", () => {
    const result = computeCapacity({
      stats: stats({ availGb: 14 }),
      running: 0,
      config: CONFIG,
    });
    expect(result).toMatchObject({ cap: 2, free_slots: 2, can_spawn: true });
  });

  it("counts running workers back into the memory cap", () => {
    const result = computeCapacity({
      stats: stats({ availGb: 11 }),
      running: 3,
      config: CONFIG,
    });
    expect(result).toMatchObject({ cap: 4, free_slots: 1, can_spawn: true });
  });

  it("never lets the memory cap go negative", () => {
    const result = computeCapacity({
      stats: stats({ availGb: 2 }),
      running: 1,
      config: CONFIG,
    });
    expect(result).toMatchObject({ cap: 0, free_slots: 0, can_spawn: false });
  });

  it("is CPU-bound when cores times cpuFraction is the tightest limit", () => {
    const result = computeCapacity({
      stats: stats({ cores: 4 }),
      running: 0,
      config: CONFIG,
    });
    expect(result).toMatchObject({ cap: 3, cores: 4, can_spawn: true });
  });

  it("is capped by maxWorkers when the machine has room to spare", () => {
    const result = computeCapacity({
      stats: stats(),
      running: 0,
      config: CONFIG,
    });
    expect(result).toMatchObject({ cap: 6, free_slots: 6, can_spawn: true });
  });

  it("refuses to spawn when load exceeds cores times maxLoadPerCore", () => {
    const result = computeCapacity({
      stats: stats({ load1: 24.5 }),
      running: 0,
      config: CONFIG,
    });
    expect(result).toMatchObject({ overloaded: true, can_spawn: false });
  });

  it("is not overloaded at exactly the threshold", () => {
    const result = computeCapacity({
      stats: stats({ load1: 24 }),
      running: 0,
      config: CONFIG,
    });
    expect(result).toMatchObject({ overloaded: false, can_spawn: true });
  });

  it("refuses to spawn while paused", () => {
    const result = computeCapacity({
      stats: stats(),
      running: 0,
      config: CONFIG,
      control: { paused: true, maxWorkers: null },
    });
    expect(result).toMatchObject({ paused: true, can_spawn: false, cap: 6 });
  });

  it("refuses to spawn when running already meets the cap", () => {
    const result = computeCapacity({
      stats: stats({ availGb: 8 }),
      running: 2,
      config: CONFIG,
    });
    expect(result).toMatchObject({
      running: 2,
      cap: 2,
      free_slots: 0,
      can_spawn: false,
    });
  });

  it("gives cap 0 and no spawn when maxWorkers is 0", () => {
    const result = computeCapacity({
      stats: { availGb: 32, cores: 10, load1: 1, memSource: "vm_stat" },
      running: 0,
      config: { ...CONFIG, maxWorkers: 0 },
    });
    expect(result).toMatchObject({ cap: 0, free_slots: 0, can_spawn: false });
  });

  it("rounds avail_gb and load1 for display only", () => {
    const result = computeCapacity({
      stats: stats({ availGb: 14.999_999, load1: 1.234_56 }),
      running: 0,
      config: CONFIG,
    });
    expect(result).toMatchObject({ avail_gb: 15, load1: 1.23, cap: 2 });
  });
});

describe("resolveMaxWorkers", () => {
  it("prefers the ledger control value over the flag and config", () => {
    expect(
      resolveMaxWorkers({
        control: { maxWorkers: 2 },
        flagMaxWorkers: 4,
        config: CONFIG,
      })
    ).toBe(2);
  });

  it("uses the flag when the ledger has no override", () => {
    expect(
      resolveMaxWorkers({
        control: { maxWorkers: null },
        flagMaxWorkers: 4,
        config: CONFIG,
      })
    ).toBe(4);
  });

  it("falls back to config", () => {
    expect(resolveMaxWorkers({ config: CONFIG })).toBe(6);
  });

  it("honours a ledger override of 0 in computeCapacity", () => {
    const result = computeCapacity({
      stats: stats(),
      running: 0,
      config: CONFIG,
      control: { paused: false, maxWorkers: 0 },
      flagMaxWorkers: 5,
    });
    expect(result).toMatchObject({ cap: 0, can_spawn: false });
  });
});

describe("module purity", () => {
  const source = readFileSync(MODULE_PATH, "utf8");

  it("never reads process.env", () => {
    expect(source).not.toMatch(/process\.env/);
  });

  it("never imports child_process", () => {
    expect(source).not.toMatch(/child_process/);
  });
});
