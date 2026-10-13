/**
 * Contract tests for how the session manager reads this machine's memory,
 * cores and load.
 *
 * Plain "free memory" under-reports badly on both macOS and Linux, which
 * would starve the worker queue on a machine with plenty of room. So these
 * tests pin the reclaimable-memory readings from recorded `vm_stat` and
 * `/proc/meminfo` fixtures, and the labelled `os.freemem` fallback.
 * @module tests/unit/session-manager/capacity-stats
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  parseMeminfo,
  parseVmStat,
  readMachineStats,
} from "../../../plugins/src/base/skills/lisa-session-manager/scripts/capacity.mjs";

const FIXTURES = path.join(__dirname, "../../fixtures/session-manager");
const VM_STAT = readFileSync(path.join(FIXTURES, "vm_stat.txt"), "utf8");
const MEMINFO = readFileSync(path.join(FIXTURES, "meminfo.txt"), "utf8");
const GIB = 1024 ** 3;

/**
 * Fake `os.cpus()` with `n` entries.
 * @param n - Core count
 * @returns A cpus seam
 */
function cpus(n: number) {
  return () => Array.from({ length: n }, () => ({}));
}

describe("parseVmStat", () => {
  it("sums free, inactive and speculative pages at the header page size", () => {
    expect(parseVmStat(VM_STAT)).toBe(32 * GIB);
  });

  it("returns null when the page size header is missing", () => {
    expect(parseVmStat("Pages free: 10.\n")).toBeNull();
  });

  it("returns null when a required page row is missing", () => {
    expect(
      parseVmStat("Mach Virtual Memory Statistics: (page size of 4096 bytes)\n")
    ).toBeNull();
  });
});

describe("parseMeminfo", () => {
  it("reads MemAvailable in kB as bytes", () => {
    expect(parseMeminfo(MEMINFO)).toBe(20 * GIB);
  });

  it("returns null without a MemAvailable row", () => {
    expect(parseMeminfo("MemTotal: 100 kB\n")).toBeNull();
  });
});

describe("readMachineStats", () => {
  it("uses vm_stat on darwin, with cores and load from the injected seams", async () => {
    const exec = vi.fn(async () => VM_STAT);
    const result = await readMachineStats({
      platform: "darwin",
      exec,
      readFile: vi.fn(),
      cpus: cpus(10),
      loadavg: () => [2.5, 2, 1],
      freemem: () => 0,
    });
    expect(exec).toHaveBeenCalledWith("vm_stat");
    expect(result).toEqual({
      availGb: 32,
      cores: 10,
      load1: 2.5,
      memSource: "vm_stat",
    });
  });

  it("uses /proc/meminfo MemAvailable on linux", async () => {
    const readFile = vi.fn(async () => MEMINFO);
    const result = await readMachineStats({
      platform: "linux",
      exec: vi.fn(),
      readFile,
      cpus: cpus(8),
      loadavg: () => [0.5, 0, 0],
      freemem: () => 0,
    });
    expect(readFile).toHaveBeenCalledWith("/proc/meminfo");
    expect(result).toEqual({
      availGb: 20,
      cores: 8,
      load1: 0.5,
      memSource: "/proc/meminfo",
    });
  });

  it("reads a substitute meminfo path when one is given", async () => {
    const readFile = vi.fn(async () => MEMINFO);
    await readMachineStats({
      platform: "linux",
      readFile,
      meminfoPath: "/fixtures/fake-meminfo",
      cpus: cpus(1),
      loadavg: () => [0],
      freemem: () => 0,
    });
    expect(readFile).toHaveBeenCalledWith("/fixtures/fake-meminfo");
  });

  it("falls back to os.freemem, labelled as such, on other platforms", async () => {
    const exec = vi.fn();
    const result = await readMachineStats({
      platform: "win32",
      exec,
      readFile: vi.fn(),
      cpus: cpus(4),
      loadavg: () => [0, 0, 0],
      freemem: () => 4 * GIB,
    });
    expect(exec).not.toHaveBeenCalled();
    expect(result).toEqual({
      availGb: 4,
      cores: 4,
      load1: 0,
      memSource: "os.freemem",
    });
  });

  it("falls back to os.freemem when vm_stat output cannot be parsed", async () => {
    const result = await readMachineStats({
      platform: "darwin",
      exec: async () => "garbage",
      cpus: cpus(2),
      loadavg: () => [0],
      freemem: () => 2 * GIB,
    });
    expect(result.memSource).toBe("os.freemem");
    expect(result.availGb).toBe(2);
  });

  it("refuses to run on darwin without an injected exec", async () => {
    await expect(
      readMachineStats({
        platform: "darwin",
        cpus: cpus(1),
        loadavg: () => [0],
      })
    ).rejects.toThrow(/exec/);
  });
});
