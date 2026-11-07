/**
 * Safety refusals of the cleanup sweep's process half, added after the
 * security review of CodySwannGT/lisa#4597.
 *
 * - On macOS, `ps -E` prints a process's arguments and then its environment
 *   on one line, so a marker typed as an ARGUMENT would read as an
 *   environment marker. The sweep strips the exact arguments (from a second,
 *   `-E`-less listing) before matching, and spares a row it cannot align.
 * - On Linux, only a whole `/proc/<pid>/environ` entry counts.
 * - A pid whose start time changed during the grace is a different process
 *   and is not sent SIGKILL.
 * @module tests/unit/scripts/lisa-cleanup-sweep-processes-hardening
 */
import { describe, expect, it, vi } from "vitest";

import {
  parseDarwinProcessTable,
  parseLinuxEnviron,
  selectOrphans,
  sweepOrphans,
} from "../../../all/copy-overwrite/scripts/lib/lisa-cleanup-sweep-processes.mjs";

const NODE = "/usr/local/bin/node -e x";
const LIVE = "LISA_TEST_RUN_OWNER=600:111";
const DEAD = "LISA_TEST_RUN_OWNER=999999:0";

/**
 * Parse one marked process from both listings.
 * @param args - The process's arguments, as the `-E`-less listing shows them
 * @param environment - The environment `-E` appends after them
 * @returns The single parsed row
 */
function parseOne(args: string, environment: string) {
  const withEnv = `   10     1 ${args} ${environment}\n`;
  const argsOnly = `   10 ${args}\n`;
  return parseDarwinProcessTable(withEnv, argsOnly)[0];
}

const ALIVE = new Set([1, 10, 600]);
const seams = {
  selfPid: 500,
  isAlive: (pid: number) => ALIVE.has(pid),
  startTimesOf: () => new Map([[600, "111"]]),
};

describe("macOS argument spoofing", () => {
  it("ignores a marker that appears only in the arguments", () => {
    const row = parseOne(`${NODE} ${DEAD}`, "HOME=/h PATH=/bin");
    expect(row).toEqual({ pid: 10, ppid: 1, owner: null });
    expect(selectOrphans([row as never], seams)).toEqual([]);
  });

  it("reads the environment marker past a stale marker in the arguments", () => {
    const row = parseOne(`${NODE} ${DEAD}`, `HOME=/h ${LIVE}`);
    expect(row?.owner).toEqual({ pid: 600, start: "111" });
    expect(selectOrphans([row as never], seams)).toEqual([]);
  });

  it("still selects a genuine environment marker naming a dead owner", () => {
    const row = parseOne(NODE, `HOME=/h ${DEAD}`);
    expect(selectOrphans([row as never], seams)).toEqual([10]);
  });

  it("spares a row whose arguments no longer match, or are missing", () => {
    const changed = parseDarwinProcessTable(
      `   10     1 ${NODE} ${DEAD}\n`,
      "   10 /bin/other\n"
    );
    const missing = parseDarwinProcessTable(
      `   10     1 ${NODE} ${DEAD}\n`,
      ""
    );
    expect(changed[0]?.owner).toBeNull();
    expect(missing[0]?.owner).toBeNull();
  });

  it("spares an environment carrying two different markers", () => {
    const row = parseOne(NODE, `${LIVE} X=1 ${DEAD}`);
    expect(row?.owner).toBeNull();
  });
});

describe("Linux environ", () => {
  it("counts only a whole environ entry", () => {
    expect(parseLinuxEnviron(`A=1\0${DEAD}\0B=2\0`)).toEqual({
      pid: 999999,
      start: "0",
    });
    expect(parseLinuxEnviron(`NOTE=${DEAD}\0B=2\0`)).toBeNull();
    expect(parseLinuxEnviron("")).toBeNull();
  });
});

describe("pid reuse during the grace", () => {
  it("does not SIGKILL a pid whose start time changed after SIGTERM", async () => {
    const signals: Array<[number, string]> = [];
    const starts = new Map([
      [701, ["5000", "9999"]],
      [702, ["6000", "6000"]],
    ]);
    const startTimesOf = vi.fn((pids: number[]) => {
      const answer = new Map<number, string>();
      for (const pid of pids) {
        const seen = starts.get(pid);
        if (seen)
          answer.set(
            pid,
            seen.length > 1 ? (seen.shift() as string) : (seen[0] as string)
          );
      }
      return answer;
    });
    const result = await sweepOrphans({
      selfPid: 500,
      listProcesses: () => [
        { pid: 701, ppid: 1, owner: { pid: 700, start: "1" } },
        { pid: 702, ppid: 1, owner: { pid: 700, start: "1" } },
      ],
      isAlive: pid => pid !== 700,
      startTimesOf,
      kill: (pid, signal) => {
        signals.push([pid, signal]);
      },
      sleep: async () => {},
      graceMs: 1,
    });
    expect(result.killed).toEqual([701, 702]);
    expect(signals).toEqual([
      [701, "SIGTERM"],
      [702, "SIGTERM"],
      [702, "SIGKILL"],
    ]);
  });
});
