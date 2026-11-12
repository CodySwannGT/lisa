/**
 * The manager-side half of the duplicate-manager check
 * (CodySwannGT/lisa#4809).
 *
 * The tmux manager cannot see another session's `/loop`, so before this it
 * never heard about a second session cycling in its project; only the second
 * session's own cycle warned. Now every `cycle` records who ran it
 * (`tmux:<session>` when tmux names the caller's session, else
 * `pid:<parent pid>`), and `status` lists as `manager.otherCyclers` every
 * recent cycler that is not the manager's own tmux session. "Recent" is
 * within twice `sessionManager.interval`; older entries are pruned on write.
 * Run as a real process against the stub `tmux`, next to
 * cli-status-self.test.ts, which pins `manager.self`.
 * @module tests/unit/session-manager/cli-status-other-cyclers
 */
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  MANAGER,
  type Sandbox,
  makeSandbox,
  removeSandboxes,
  runCli,
  writeJson,
} from "./support/cli-harness.js";

afterEach(removeSandboxes);

/** A `$TMUX` value as tmux sets it inside a session: socket,pid,index. */
const TMUX_ENV = "/run/user/501/tmux-501/default,4242,0";
const PANE = "%3";

/** The env of a shell inside the manager's own tmux session. */
const IN_MANAGER = {
  STUB_TMUX_HAS_SESSION: "1",
  TMUX: TMUX_ENV,
  TMUX_PANE: PANE,
  STUB_TMUX_CURRENT_SESSION: MANAGER,
};

/** The env of a second session outside tmux while the manager runs. */
const OUTSIDE = { STUB_TMUX_HAS_SESSION: "1" };

/** The sandbox interval is 5m, so the recent window is 10 minutes. */
const MINUTE = 60_000;

/**
 * An ISO time `minutes` before now.
 * @param minutes - How long ago
 * @returns ISO timestamp
 */
const ago = (minutes: number): string =>
  new Date(Date.now() - minutes * MINUTE).toISOString();

/**
 * The sandbox's ledger file.
 * @param sandbox - Project sandbox
 * @returns Absolute path
 */
const ledgerFile = (sandbox: Sandbox): string =>
  path.join(sandbox.root, ".lisa/session-manager/ledger.json");

/**
 * Seed the ledger with a `cyclers` map.
 * @param sandbox - Project sandbox
 * @param cyclers - Identity to ISO timestamp
 */
function seedCyclers(sandbox: Sandbox, cyclers: Record<string, string>): void {
  mkdirSync(path.dirname(ledgerFile(sandbox)), { recursive: true });
  writeJson(ledgerFile(sandbox), { version: 1, items: {}, cyclers });
}

/**
 * The `cyclers` map the ledger file holds.
 * @param sandbox - Project sandbox
 * @returns Identity to ISO timestamp
 */
const cyclersOf = (sandbox: Sandbox): Record<string, string> =>
  JSON.parse(readFileSync(ledgerFile(sandbox), "utf8")).cyclers;

describe("cycle records who ran it", () => {
  it("records the tmux session name inside tmux", () => {
    const sandbox = makeSandbox();
    const result = runCli(sandbox, ["cycle"], { env: IN_MANAGER });
    expect(result.status).toBe(0);
    expect(result.json.by).toBe(`tmux:${MANAGER}`);
    expect(cyclersOf(sandbox)).toEqual({ [`tmux:${MANAGER}`]: result.json.at });
    expect(Date.parse(result.json.at)).not.toBeNaN();
  });

  it("records the parent process id outside tmux", () => {
    const sandbox = makeSandbox();
    const result = runCli(sandbox, ["cycle"], { env: OUTSIDE });
    expect(result.status).toBe(0);
    expect(result.json.by).toMatch(/^pid:\d+$/);
    expect(Object.keys(cyclersOf(sandbox))).toEqual([result.json.by]);
  });

  it("falls back to the parent process id when tmux cannot name the session", () => {
    const sandbox = makeSandbox();
    const result = runCli(sandbox, ["cycle"], {
      env: { ...OUTSIDE, TMUX: TMUX_ENV, TMUX_PANE: PANE },
    });
    expect(result.status).toBe(0);
    expect(result.json.by).toMatch(/^pid:\d+$/);
  });

  it("records no environment value or credential", () => {
    const sandbox = makeSandbox();
    runCli(sandbox, ["cycle"], { env: IN_MANAGER });
    const text = readFileSync(ledgerFile(sandbox), "utf8");
    expect(text).not.toContain("planted-value-never-forwarded");
    expect(text).not.toContain(TMUX_ENV);
    expect(text).not.toContain(PANE);
  });

  it("prunes entries older than twice the interval, and unreadable ones", () => {
    const sandbox = makeSandbox();
    seedCyclers(sandbox, {
      "pid:111": ago(11),
      "pid:222": ago(9),
      "pid:333": "not-a-time",
    });
    runCli(sandbox, ["cycle"], { env: IN_MANAGER });
    const kept = cyclersOf(sandbox);
    expect(Object.keys(kept)).toHaveLength(2);
    expect(kept).toHaveProperty("pid:222");
    expect(kept).toHaveProperty([`tmux:${MANAGER}`]);
  });
});

describe("status manager.otherCyclers", () => {
  it("lists recent cyclers other than the manager's tmux session, newest first", () => {
    const sandbox = makeSandbox();
    const newer = ago(2);
    const older = ago(3);
    seedCyclers(sandbox, {
      [`tmux:${MANAGER}`]: ago(1),
      "tmux:operator-shell": older,
      "pid:777": newer,
      "pid:888": ago(20),
    });
    const result = runCli(sandbox, ["status"], { env: IN_MANAGER });
    expect(result.status).toBe(0);
    expect(result.json.manager.otherCyclers).toEqual([
      { by: "pid:777", at: newer },
      { by: "tmux:operator-shell", at: older },
    ]);
  });

  it("is empty when only the manager cycles", () => {
    const sandbox = makeSandbox();
    runCli(sandbox, ["cycle"], { env: IN_MANAGER });
    const result = runCli(sandbox, ["status"], { env: IN_MANAGER });
    expect(result.json.manager).toMatchObject({ self: true, otherCyclers: [] });
  });

  it("is empty when the other cycler is older than twice the interval", () => {
    const sandbox = makeSandbox();
    seedCyclers(sandbox, { [`tmux:${MANAGER}`]: ago(1), "pid:888": ago(11) });
    const result = runCli(sandbox, ["status"], { env: IN_MANAGER });
    expect(result.json.manager.otherCyclers).toEqual([]);
  });

  it("is empty with no ledger at all", () => {
    const result = runCli(makeSandbox(), ["status"], { env: IN_MANAGER });
    expect(result.json.manager.otherCyclers).toEqual([]);
  });

  it("reports a second session's cycle to the tmux manager", () => {
    const sandbox = makeSandbox();
    const second = runCli(sandbox, ["cycle"], { env: OUTSIDE });
    runCli(sandbox, ["cycle"], { env: IN_MANAGER });
    const result = runCli(sandbox, ["status"], { env: IN_MANAGER });
    expect(result.json.manager.self).toBe(true);
    expect(result.json.manager.otherCyclers).toEqual([
      { by: second.json.by, at: second.json.at },
    ]);
  });
});
