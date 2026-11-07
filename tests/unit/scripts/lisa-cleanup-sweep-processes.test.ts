/**
 * Unit tests for the cleanup sweep's orphaned-process half
 * (CodySwannGT/lisa#4597).
 *
 * Every case injects the process table, liveness, start-time lookup, kill and
 * sleep, so nothing here can signal a real process. The real-process proof is
 * `tests/integration/lisa-cleanup-sweep.test.ts`.
 * @module tests/unit/scripts/lisa-cleanup-sweep-processes
 */
import { describe, expect, it, vi } from "vitest";

import {
  formatOwnerMarker,
  OWNER_ENV,
  parseDarwinProcessTable,
  parseDarwinStartTimes,
  parseLinuxStat,
  parseOwnerMarker,
  selectOrphans,
  sweepOrphans,
  UNKNOWN_START,
} from "../../../all/copy-overwrite/scripts/lib/lisa-cleanup-sweep-processes.mjs";

type Row = {
  pid: number;
  ppid: number;
  owner: { pid: number; start: string } | null;
};

const SELF = 500;
const LIVE_OWNER = 600;
const DEAD_OWNER = 700;

/**
 * A process table with the sweep, its parent, and three marked processes.
 * @returns Rows as the platform listers return them
 */
function table(): Row[] {
  return [
    { pid: 1, ppid: 0, owner: null },
    { pid: 400, ppid: 1, owner: null },
    { pid: SELF, ppid: 400, owner: null },
    { pid: LIVE_OWNER, ppid: 1, owner: null },
    { pid: 601, ppid: LIVE_OWNER, owner: { pid: LIVE_OWNER, start: "111" } },
    { pid: 701, ppid: 1, owner: { pid: DEAD_OWNER, start: "222" } },
    { pid: 702, ppid: 701, owner: { pid: DEAD_OWNER, start: "222" } },
  ];
}

/**
 * Liveness from a fixed set.
 * @param alive - Pids that are alive
 * @returns An isAlive seam
 */
function aliveIn(alive: readonly number[]) {
  const set = new Set(alive);
  return (pid: number) => set.has(pid);
}

const ALIVE = [1, 400, SELF, LIVE_OWNER, 601, 701, 702];

describe("owner marker", () => {
  it("round-trips pid:start and refuses malformed values", () => {
    expect(OWNER_ENV).toBe("LISA_TEST_RUN_OWNER");
    expect(formatOwnerMarker(42, "9001")).toBe("42:9001");
    expect(formatOwnerMarker(42, undefined)).toBe(`42:${UNKNOWN_START}`);
    expect(parseOwnerMarker("42:9001")).toEqual({ pid: 42, start: "9001" });
    for (const bad of ["", "42", "x:1", "0:5", "-1:5", "42:9 001", undefined]) {
      expect(parseOwnerMarker(bad)).toBeNull();
    }
  });
});

describe("orphan selection", () => {
  it("selects only processes whose owner is dead", () => {
    const orphans = selectOrphans(table(), {
      selfPid: SELF,
      isAlive: aliveIn(ALIVE),
      startTimesOf: () => new Map([[LIVE_OWNER, "111"]]),
    });
    expect(orphans).toEqual([701, 702]);
  });

  it("treats a live owner whose start time changed as a reused pid", () => {
    const orphans = selectOrphans(table(), {
      selfPid: SELF,
      isAlive: aliveIn([...ALIVE, DEAD_OWNER]),
      startTimesOf: () =>
        new Map([
          [LIVE_OWNER, "111"],
          [DEAD_OWNER, "999"],
        ]),
    });
    expect(orphans).toEqual([701, 702]);
  });

  it("spares a live owner's children when its start time is unknown", () => {
    const rows = table().map(row =>
      row.pid === 601
        ? { ...row, owner: { pid: LIVE_OWNER, start: UNKNOWN_START } }
        : row
    );
    const unknownCurrent = selectOrphans(table(), {
      selfPid: SELF,
      isAlive: aliveIn(ALIVE),
      startTimesOf: () => new Map(),
    });
    const unknownRecorded = selectOrphans(rows, {
      selfPid: SELF,
      isAlive: aliveIn(ALIVE),
      startTimesOf: () => new Map([[LIVE_OWNER, "111"]]),
    });
    expect(unknownCurrent).toEqual([701, 702]);
    expect(unknownRecorded).toEqual([701, 702]);
  });

  it("never selects the sweep itself or any of its ancestors", () => {
    const rows: Row[] = [
      { pid: 1, ppid: 0, owner: null },
      { pid: 300, ppid: 1, owner: { pid: DEAD_OWNER, start: "1" } },
      { pid: 400, ppid: 300, owner: { pid: DEAD_OWNER, start: "1" } },
      { pid: SELF, ppid: 400, owner: { pid: DEAD_OWNER, start: "1" } },
      { pid: 800, ppid: 1, owner: { pid: DEAD_OWNER, start: "1" } },
    ];
    const orphans = selectOrphans(rows, {
      selfPid: SELF,
      isAlive: aliveIn([1, 300, 400, SELF, 800]),
      startTimesOf: () => new Map(),
    });
    expect(orphans).toEqual([800]);
  });

  it("asks for start times of live owners only", () => {
    const startTimesOf = vi.fn(() => new Map([[LIVE_OWNER, "111"]]));
    selectOrphans(table(), {
      selfPid: SELF,
      isAlive: aliveIn(ALIVE),
      startTimesOf,
    });
    expect(startTimesOf).toHaveBeenCalledWith([LIVE_OWNER]);
  });
});

describe("orphan termination", () => {
  /**
   * Build injected seams around a mutable alive set.
   * @param alive - Initially live pids
   * @param ignoresTerm - Pids that survive SIGTERM
   * @returns Seams plus the recorded signals
   */
  function seams(alive: number[], ignoresTerm: number[] = []) {
    const live = new Set(alive);
    const signals: Array<[number, string]> = [];
    const kill = (pid: number, signal: string) => {
      signals.push([pid, signal]);
      if (signal === "SIGKILL" || !ignoresTerm.includes(pid)) live.delete(pid);
    };
    return {
      signals,
      options: {
        selfPid: SELF,
        listProcesses: table,
        isAlive: (pid: number) => live.has(pid),
        startTimesOf: () => new Map([[LIVE_OWNER, "111"]]),
        kill,
        sleep: vi.fn(async () => {}),
        graceMs: 5,
      },
    };
  }

  it("sends SIGTERM, waits the grace, then SIGKILLs survivors", async () => {
    const { signals, options } = seams(ALIVE, [702]);
    const result = await sweepOrphans(options);
    expect(result).toEqual({ killed: [701, 702], errors: [] });
    expect(signals).toEqual([
      [701, "SIGTERM"],
      [702, "SIGTERM"],
      [702, "SIGKILL"],
    ]);
    expect(options.sleep).toHaveBeenCalledWith(5);
  });

  it("signals nothing in a dry run but reports the selection", async () => {
    const { signals, options } = seams(ALIVE);
    const result = await sweepOrphans({ ...options, dryRun: true });
    expect(result.killed).toEqual([701, 702]);
    expect(signals).toEqual([]);
  });

  it("does not count a process that was already gone, and reports EPERM", async () => {
    const { options } = seams(ALIVE);
    const kill = (pid: number) => {
      const code = pid === 701 ? "ESRCH" : "EPERM";
      throw Object.assign(new Error(code), { code });
    };
    const result = await sweepOrphans({ ...options, kill });
    expect(result.killed).toEqual([]);
    expect(result.errors).toEqual([expect.stringMatching(/702.*EPERM/u)]);
  });

  it("reports a failed process listing as an error, not a throw", async () => {
    const { options } = seams(ALIVE);
    const listProcesses = () => {
      throw new Error("ps unavailable");
    };
    const result = await sweepOrphans({ ...options, listProcesses });
    expect(result).toEqual({
      killed: [],
      errors: [expect.stringMatching(/ps unavailable/u)],
    });
  });
});

describe("platform parsers", () => {
  it("reads pid, ppid and the marker from ps -E output without keeping the rest", () => {
    const stdout = [
      "  10     1 /bin/sleep 600 HOME=/h LISA_TEST_RUN_OWNER=999999:0 SECRET=s3cr3t",
      "  11    10 node x.js LISA_TEST_RUN_OWNER=600:1794063600",
      "  12     1 /usr/sbin/cfprefsd agent",
      "garbage",
    ].join("\n");
    const argsOnly = [
      "  10 /bin/sleep 600",
      "  11 node x.js",
      "  12 /usr/sbin/cfprefsd agent",
    ].join("\n");
    expect(parseDarwinProcessTable(stdout, argsOnly)).toEqual([
      { pid: 10, ppid: 1, owner: { pid: 999999, start: "0" } },
      { pid: 11, ppid: 10, owner: { pid: 600, start: "1794063600" } },
      { pid: 12, ppid: 1, owner: null },
    ]);
    expect(
      JSON.stringify(parseDarwinProcessTable(stdout, argsOnly))
    ).not.toContain("s3cr3t");
  });

  it("converts ps lstart rows into whole epoch seconds", () => {
    const stdout =
      "32692 Sat Nov  7 13:36:04 2026\n  7 Sat Nov  7 10:00:00 2026\nbad\n";
    const times = parseDarwinStartTimes(stdout);
    expect(times.get(7)).toBe(
      String(Date.parse("Sat Nov 7 10:00:00 2026") / 1000)
    );
    expect(times.size).toBe(2);
  });

  it("reads ppid and start ticks from /proc stat past a hostile comm", () => {
    const stat =
      "123 (evil) 1 2 (x) S 77 123 123 0 -1 0 0 0 0 0 0 0 0 0 20 0 1 0 98765 0 0";
    expect(parseLinuxStat(stat)).toEqual({ ppid: 77, start: "98765" });
    expect(parseLinuxStat("nonsense")).toBeNull();
  });
});
