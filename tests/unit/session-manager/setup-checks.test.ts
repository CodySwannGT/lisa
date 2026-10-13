/**
 * Contract tests for the read-only checks setup runs before asking the
 * operator anything (CodySwannGT/lisa#4465): which worker directories Claude
 * Code already trusts, and whether a competing intake loop has run recently.
 * @module tests/unit/session-manager/setup-checks
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  claudeStateFile,
  coexistence,
  recentWindowMs,
  trustStatus,
} from "../../../plugins/src/base/skills/lisa-session-manager/scripts/setup-checks.mjs";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-10-13T12:00:00.000Z");
const STALL = { noOutputMinutes: 60, maxAttempts: 3 };
const CHANGE_PROVED = "change-proved";
const INTAKE_TICKETS = "intake-tickets";

let dir = "";

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "sm-checks-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("claudeStateFile", () => {
  it("is ~/.claude.json by default and follows CLAUDE_CONFIG_DIR", () => {
    expect(claudeStateFile({ homedir: "/h" })).toBe("/h/.claude.json");
    expect(
      claudeStateFile({ homedir: "/h", env: { CLAUDE_CONFIG_DIR: "/c" } })
    ).toBe("/c/.claude.json");
  });
});

describe("trustStatus", () => {
  it("reports Claude Code's own record per directory", () => {
    const api = path.join(dir, "projects", "api");
    const web = path.join(dir, "projects", "web");
    const off = path.join(dir, "projects", "off");
    writeFileSync(
      path.join(dir, ".claude.json"),
      JSON.stringify({
        projects: {
          [api]: { hasTrustDialogAccepted: true },
          [off]: { hasTrustDialogAccepted: false },
        },
      })
    );
    const report = trustStatus({ dirs: [api, web, off], homedir: dir });
    expect(report.dirs).toEqual([
      { dir: api, trusted: true },
      { dir: web, trusted: false },
      { dir: off, trusted: false },
    ]);
  });

  it.each([
    ["recorded under its realpath", "/var/work/api", "/private/var/work/api"],
    ["recorded through a symlink", "/private/var/work/api", "/var/work/api"],
  ])("matches a directory %s", (_label, workerDir, recordedKey) => {
    const realOf = (p: string) => p.replace(/^\/var\//, "/private/var/");
    const state = JSON.stringify({
      projects: {
        "/elsewhere/web": { hasTrustDialogAccepted: true },
        [recordedKey]: { hasTrustDialogAccepted: true },
      },
    });
    const report = trustStatus({
      dirs: [workerDir, "/private/var/work/web"],
      homedir: dir,
      fs: { readFileSync: () => state, realpathSync: realOf } as never,
    });
    expect(report.dirs).toEqual([
      { dir: workerDir, trusted: true },
      { dir: "/private/var/work/web", trusted: false },
    ]);
  });

  it("is unknown for every directory when the state file is unreadable", () => {
    const report = trustStatus({ dirs: ["/a", "/b"], homedir: dir });
    expect(report.dirs.map(row => row.trusted)).toEqual(["unknown", "unknown"]);
  });
});

describe("coexistence", () => {
  /**
   * Write a run log for `loop` with records at the given ages.
   * @param loop - Loop id
   * @param agesMs - How long before NOW each record ran, oldest first
   */
  function runLog(loop: string, agesMs: number[]): void {
    const runs = path.join(dir, ".lisa", "automations", "runs");
    const lines = agesMs.map(age =>
      JSON.stringify({
        ts: new Date(NOW.getTime() - age).toISOString(),
        loop_id: loop,
        outcome: CHANGE_PROVED,
      })
    );
    mkdirSync(runs, { recursive: true });
    writeFileSync(
      path.join(runs, `${loop}.jsonl`),
      `${lines.join("\n")}\ntorn {\n`
    );
  }

  it("reports a 40-day-old intake-repair run as not recent", () => {
    runLog("intake-repair", [41 * DAY_MS, 40 * DAY_MS]);
    const report = coexistence({ root: dir, now: NOW, stall: STALL });
    const repair = report.loops.find(row => row.loop === "intake-repair");
    expect(repair).toMatchObject({
      lastRun: {
        ts: new Date(NOW.getTime() - 40 * DAY_MS).toISOString(),
        outcome: CHANGE_PROVED,
      },
      recent: false,
    });
    expect(report.loops.find(row => row.loop === INTAKE_TICKETS)).toMatchObject(
      {
        lastRun: null,
        recent: false,
      }
    );
  });

  it("reports a run inside the window as recent", () => {
    runLog(INTAKE_TICKETS, [2 * 60 * 60 * 1000]);
    const report = coexistence({ root: dir, now: NOW, stall: STALL });
    expect(report.loops.find(row => row.loop === INTAKE_TICKETS)?.recent).toBe(
      true
    );
  });
});

describe("recentWindowMs", () => {
  it("is twice the manager's give-up time, and at least a day", () => {
    expect(recentWindowMs(STALL)).toBe(DAY_MS);
    expect(recentWindowMs({ noOutputMinutes: 480, maxAttempts: 3 })).toBe(
      2 * 480 * 3 * 60 * 1000
    );
  });
});
