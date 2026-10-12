/**
 * Integration tests for worker liveness across every CLI consumer: capacity,
 * spawn, classify and status (#4448 live-verification defect D2).
 *
 * Claude Code 2.1.296 reports an idle worker whose turn ended, but whose
 * process is still alive, as `{status:"idle", state:"done", pid}` in both
 * `claude agents --json` and `--json --all`. Live, that row was read as
 * finished: capacity counted 0 running, `spawn` started a second worker for
 * the same ref, `classify` said `dead` and `status` said `live: false`.
 * @module tests/unit/session-manager/cli-liveness
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  MEMINFO,
  makeSandbox,
  removeSandboxes,
  runCli,
  type Sandbox,
} from "./support/cli-harness.js";
import { callsOf } from "./support/cli-fixtures.js";
import {
  COMPLETED_ROW,
  IDLE_ALIVE_ROW,
  WAITING_ROW,
} from "./workers-fixtures.js";

afterEach(removeSandboxes);

const MEM = ["--meminfo", MEMINFO];
const REF = "DEMO-12";

/**
 * The idle-but-alive row, renamed to a given worker.
 * @param name - Worker session name
 * @returns Row
 */
const idleAlive = (name: string) => ({ ...IDLE_ALIVE_ROW, name });

/**
 * Spawn a worker for {@link REF} with nothing live, and return its name.
 * @param sandbox - Project sandbox
 * @returns The spawned worker's name
 */
function spawnOnce(sandbox: Sandbox): string {
  const spawned = runCli(sandbox, ["spawn", REF, ...MEM]);
  expect(spawned.status).toBe(0);
  return spawned.json.name as string;
}

describe("an idle but alive worker (state done, pid set)", () => {
  it("counts toward capacity", () => {
    const result = runCli(makeSandbox(), ["capacity", ...MEM], {
      agents: [
        IDLE_ALIVE_ROW,
        WAITING_ROW,
        COMPLETED_ROW,
        { ...COMPLETED_ROW, name: "wk-LIVE-6-1011-0800", state: "stopped" },
      ],
    });
    expect(result.status).toBe(0);
    expect(result.json.running).toBe(2);
  });

  it("makes spawn exit 4 instead of starting a duplicate worker", () => {
    const sandbox = makeSandbox();
    const name = spawnOnce(sandbox);
    const result = runCli(sandbox, ["spawn", REF, ...MEM], {
      agents: [idleAlive(name)],
    });
    expect(result.status).toBe(4);
    expect(result.json.worker).toBe(name);
    expect(callsOf(result.calls, "claude", "--bg")).toEqual([]);
  });

  it("is not classified dead", () => {
    const sandbox = makeSandbox();
    const name = spawnOnce(sandbox);
    const result = runCli(sandbox, ["classify", REF], {
      agents: [idleAlive(name)],
    });
    expect(result.status).toBe(0);
    expect(result.json).toEqual([
      expect.objectContaining({
        ref: REF,
        worker: name,
        classification: "working",
        agentStatus: "idle",
      }),
    ]);
  });

  it("is reported live by status", () => {
    const sandbox = makeSandbox();
    const name = spawnOnce(sandbox);
    const result = runCli(sandbox, ["status"], { agents: [idleAlive(name)] });
    expect(result.status).toBe(0);
    expect(result.json.workers).toEqual([
      expect.objectContaining({ ref: REF, worker: name, live: true }),
    ]);
  });
});

describe("a truly completed worker (--all, no pid or status)", () => {
  it("is classified dead and lets spawn start a replacement", () => {
    const sandbox = makeSandbox();
    const name = spawnOnce(sandbox);
    const finished = { ...COMPLETED_ROW, name };
    const classify = runCli(sandbox, ["classify", REF], {
      agents: [finished],
    });
    expect(classify.json).toEqual([
      expect.objectContaining({ classification: "dead" }),
    ]);
    const respawn = runCli(sandbox, ["spawn", REF, ...MEM], {
      agents: [finished],
    });
    expect(respawn.status).toBe(0);
    expect(respawn.json.name).not.toBe(name);
  });
});
