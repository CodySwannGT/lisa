/**
 * Liveness of `claude agents --json` rows, pinned to the shapes Claude Code
 * 2.1.296 printed during live verification of #4448.
 *
 * An idle worker whose turn ended stays alive but reports
 * `{status:"idle", state:"done", pid}`. Reading `state: "done"` as finished
 * undercounted capacity, let `spawn` start a second worker for a ref that
 * already had one, and made `classify` call a live worker dead. A row is alive
 * when it carries a pid or a status (the active shape), whatever its `state`;
 * only a row with neither, in a terminal state, has finished.
 * @module tests/unit/session-manager/workers-liveness
 */
import { describe, expect, it } from "vitest";

import {
  classifyWorker,
  countRunningWorkers,
  findLiveWorker,
  normalizeAgents,
} from "../../../plugins/src/base/skills/lisa-session-manager/scripts/workers.mjs";

import {
  BUSY_ROW,
  COMPLETED_ROW,
  IDLE_ALIVE_ROW,
  LIVENESS_FIXTURE,
  LIVENESS_REFS,
  NOW,
  STARTING_ROW,
  WAITING_ROW,
} from "./workers-fixtures.js";

/** A ledger row for a dispatched worker that has not reported an outcome. */
const RUNNING_ENTRY = {
  status: "running",
  startedAt: NOW.getTime(),
  attempts: 1,
};

describe("normalizeAgents liveness", () => {
  it.each([
    { label: "busy", row: BUSY_ROW, active: true },
    { label: "idle but alive (done, pid)", row: IDLE_ALIVE_ROW, active: true },
    { label: "waiting (blocked)", row: WAITING_ROW, active: true },
    { label: "just spawned (working)", row: STARTING_ROW, active: true },
    { label: "completed (--all)", row: COMPLETED_ROW, active: false },
  ])("$label -> active $active", ({ row, active }) => {
    const [normalized] = normalizeAgents([row]);
    expect(normalized?.active).toBe(active);
  });

  it("still reads a stopped row with no pid or status as finished", () => {
    const [row] = normalizeAgents([{ ...COMPLETED_ROW, state: "stopped" }]);
    expect(row?.active).toBe(false);
  });

  it("treats a status-only row in state done as alive", () => {
    const [row] = normalizeAgents([{ ...IDLE_ALIVE_ROW, pid: null }]);
    expect(row?.active).toBe(true);
  });

  it("treats a pid-only row in state done as alive", () => {
    const [row] = normalizeAgents([{ ...IDLE_ALIVE_ROW, status: null }]);
    expect(row?.active).toBe(true);
  });
});

describe("consumers of liveness", () => {
  const agents = normalizeAgents(LIVENESS_FIXTURE);

  it("counts every live wk- row toward capacity, idle ones included", () => {
    expect(countRunningWorkers(agents)).toBe(4);
  });

  it("finds the idle-but-alive worker, so spawn refuses a duplicate", () => {
    expect(findLiveWorker(agents, LIVENESS_REFS.idleAlive)?.name).toBe(
      IDLE_ALIVE_ROW.name
    );
  });

  it("finds the busy, waiting and starting workers", () => {
    expect(findLiveWorker(agents, LIVENESS_REFS.busy)?.name).toBe(
      BUSY_ROW.name
    );
    expect(findLiveWorker(agents, LIVENESS_REFS.waiting)?.name).toBe(
      WAITING_ROW.name
    );
    expect(findLiveWorker(agents, LIVENESS_REFS.starting)?.name).toBe(
      STARTING_ROW.name
    );
  });

  it("does not find the completed worker", () => {
    expect(findLiveWorker(agents, LIVENESS_REFS.completed)).toBeNull();
  });

  it("classifies an idle-but-alive worker as working, not dead", () => {
    const idle = agents.find(row => row.name === IDLE_ALIVE_ROW.name) ?? null;
    expect(
      classifyWorker({
        agent: idle,
        entry: RUNNING_ENTRY,
        logsHash: "fresh-hash",
        now: NOW,
      })
    ).toBe("working");
  });

  it("classifies a completed worker with no recorded outcome as dead", () => {
    const done = agents.find(row => row.name === COMPLETED_ROW.name) ?? null;
    expect(
      classifyWorker({
        agent: done,
        entry: RUNNING_ENTRY,
        logsHash: "fresh-hash",
        now: NOW,
      })
    ).toBe("dead");
  });
});
