/**
 * `spawn` enforces the assign-on-take rule (CodySwannGT/lisa#5029): it needs
 * the item's read-back assignees and refuses, with exit 5 and nothing
 * launched, an item that is unassigned or held by someone other than "me"
 * (ledger control.me) or an operator. Leaving `--assignees` out is exit 2,
 * so no caller can skip the check.
 * @module tests/unit/session-manager/cli-spawn-take
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  MEMINFO,
  TAKER,
  makeSandbox,
  removeSandboxes,
  runCli,
} from "./support/cli-harness.js";
import { callsOf, readLedgerFile } from "./support/cli-fixtures.js";

afterEach(removeSandboxes);

const MEM = ["--meminfo", MEMINFO];
const REF = "DEMO-21";
const ME = "agent-account";
const FLAG = "--assignees";

/**
 * Run spawn with the given assignees.
 * @param sandbox - Project sandbox
 * @param assignees - Read-back assignees, or undefined to omit the flag
 * @returns The run result
 */
function spawnWith(
  sandbox: ReturnType<typeof makeSandbox>,
  assignees: unknown
) {
  const flag = assignees === undefined ? [] : [FLAG, JSON.stringify(assignees)];
  return runCli(sandbox, ["spawn", REF, ...flag, ...MEM]);
}

/**
 * Whether the run started a worker.
 * @param result - CLI result
 * @returns True when `claude --bg` was called
 */
const launched = (result: ReturnType<typeof runCli>) =>
  callsOf(result.calls, "claude", "--bg").length > 0;

describe("spawn and the assign-on-take rule", () => {
  it("refuses an unassigned item with exit 5, launching and recording nothing", () => {
    const sandbox = makeSandbox();
    const result = spawnWith(sandbox, []);
    expect(result.status).toBe(5);
    expect(result.json).toMatchObject({ ref: REF, reason: "unassigned" });
    expect(result.stderr).toContain("is unassigned");
    expect(launched(result)).toBe(false);
    const ledger = path.join(sandbox.root, ".lisa/session-manager/ledger.json");
    if (existsSync(ledger)) {
      expect(readLedgerFile(sandbox).items[REF]).toBeUndefined();
    }
  });

  it("refuses an item held by someone else, naming them", () => {
    const sandbox = makeSandbox();
    const result = spawnWith(sandbox, [TAKER, "someone-else"]);
    expect(result.status).toBe(5);
    expect(result.json).toMatchObject({
      reason: "foreign",
      foreign: ["someone-else"],
    });
    expect(launched(result)).toBe(false);
  });

  it("exits 2 without launching when --assignees is left out", () => {
    const sandbox = makeSandbox();
    const result = spawnWith(sandbox, undefined);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain(FLAG);
    expect(launched(result)).toBe(false);
  });

  it("exits 2 when --assignees is not a JSON array", () => {
    const sandbox = makeSandbox();
    const bad = runCli(sandbox, ["spawn", REF, FLAG, "{}", ...MEM]);
    expect(bad.status).toBe(2);
    const notJson = runCli(sandbox, ["spawn", REF, FLAG, "nope", ...MEM]);
    expect(notJson.status).toBe(2);
    expect(launched(bad) || launched(notJson)).toBe(false);
  });

  it("starts a worker for an item assigned to an operator", () => {
    const sandbox = makeSandbox();
    const result = spawnWith(sandbox, [TAKER]);
    expect(result.status).toBe(0);
    expect(launched(result)).toBe(true);
  });

  it("starts a worker for an item assigned to me, once me is recorded", () => {
    const sandbox = makeSandbox();
    expect(spawnWith(sandbox, [ME]).status).toBe(5);
    expect(runCli(sandbox, ["ledger", "control", "--me", ME]).status).toBe(0);
    const result = spawnWith(sandbox, [ME]);
    expect(result.status).toBe(0);
    expect(launched(result)).toBe(true);
  });

  it("matches a GitHub {login, id} assignee against an id: operator entry", () => {
    const sandbox = makeSandbox({
      sessionManager: {
        name: "demo-manager",
        interval: "5m",
        operatorIds: ["id:583231"],
        capacity: {
          maxWorkers: 6,
          gbPerWorker: 1,
          reserveGb: 0,
          cpuFraction: 1,
          maxLoadPerCore: 1000,
        },
        notify: { provider: "none" },
      },
    });
    const result = spawnWith(sandbox, [{ login: "octo", id: 583231 }]);
    expect(result.status).toBe(0);
  });
});
