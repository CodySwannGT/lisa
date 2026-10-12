/**
 * Contract tests for the session manager's worker helpers.
 *
 * The failures that matter here are quiet ones. A prefix match that treats an
 * `ABC-12` worker as the live worker for `ABC-1` skips a dispatch nobody
 * notices. A worker that inherits the manager's Telegram variables starts a
 * second poller on the same bot and steals its messages. And a stall
 * classifier that never says `exhausted` retries the same broken item forever.
 * @module tests/unit/session-manager/workers
 */
import { describe, expect, it } from "vitest";

import {
  WORKER_SETTINGS,
  buildWorkerName,
  buildWorkerResume,
  buildWorkerSpawn,
  countRunningWorkers,
  findLiveWorker,
  normalizeAgents,
  parseWorkerName,
  sanitizeRefToken,
  scrubWorkerEnv,
} from "../../../plugins/src/base/skills/lisa-session-manager/scripts/workers.mjs";

import {
  ACTIVE_FIXTURE,
  ALL_FIXTURE,
  LIVE_SESSION_ID,
  LIVE_WORKER,
  NEW_WORKER,
  NOW,
  REPO_A_DIR,
} from "./workers-fixtures.js";

describe("sanitizeRefToken", () => {
  it.each([
    ["owner/repo#12", "repo-12"],
    ["owner/repo-a#7", "repo-a-7"],
    ["TEAM-123", "TEAM-123"],
    ["ENG-42", "ENG-42"],
    ["#12", "12"],
    ["weird ref!!", "weird-ref"],
  ])("maps %s to %s", (ref, token) => {
    expect(sanitizeRefToken(ref)).toBe(token);
    expect(sanitizeRefToken(ref)).toMatch(/^[A-Za-z0-9-]+$/);
  });

  it.each(["", "   ", "###", 42 as unknown as string])(
    "rejects %j because it yields no token",
    ref => {
      expect(() => sanitizeRefToken(ref)).toThrow(/ref/i);
    }
  );
});

describe("buildWorkerName", () => {
  it("stamps wk-<token>-<MMDD-HHMM>", () => {
    expect(buildWorkerName("TEAM-12", NOW)).toBe(NEW_WORKER);
    expect(buildWorkerName("owner/repo#12", NOW.getTime())).toBe(
      "wk-repo-12-1012-0905"
    );
  });

  it("appends -2 then -3 when the name is already known", () => {
    const first = buildWorkerName("TEAM-12", NOW, []);
    const second = buildWorkerName("TEAM-12", NOW, [first]);
    const third = buildWorkerName("TEAM-12", NOW, [first, second]);
    expect(second).toBe("wk-TEAM-12-1012-0905-2");
    expect(third).toBe("wk-TEAM-12-1012-0905-3");
  });

  it("zero-pads every field", () => {
    expect(buildWorkerName("A", new Date(2026, 0, 3, 4, 5))).toBe(
      "wk-A-0103-0405"
    );
  });
});

describe("parseWorkerName", () => {
  it.each([
    [NEW_WORKER, { token: "TEAM-12", suffix: null }],
    ["wk-TEAM-12-1012-0905-2", { token: "TEAM-12", suffix: 2 }],
    ["wk-repo-12-1012-0905", { token: "repo-12", suffix: null }],
  ])("parses %s", (name, expected) => {
    expect(parseWorkerName(name)).toMatchObject({
      ...expected,
      stamp: "1012-0905",
    });
  });

  it.each(["manager-session", "wk-", "wk-TEAM-12", "xwk-A-1012-0905", ""])(
    "returns null for non-worker name %j",
    name => {
      expect(parseWorkerName(name)).toBeNull();
    }
  );

  it("never lets ABC-1 match an ABC-12 worker", () => {
    expect(parseWorkerName("wk-ABC-12-1012-0905")?.token).toBe("ABC-12");
    expect(parseWorkerName("wk-ABC-12-1012-0905")?.token).not.toBe("ABC-1");
  });
});

describe("normalizeAgents", () => {
  it("accepts the active shape", () => {
    const [row] = normalizeAgents(ACTIVE_FIXTURE);
    expect(row).toEqual({
      name: LIVE_WORKER,
      sessionId: LIVE_SESSION_ID,
      id: null,
      pid: 101,
      cwd: REPO_A_DIR,
      kind: "background",
      startedAt: 1791835698878,
      status: "busy",
      state: null,
      active: true,
    });
  });

  it("accepts the --all completed shape without throwing", () => {
    const rows = normalizeAgents(ALL_FIXTURE);
    expect(rows).toHaveLength(4);
    expect(rows[2]).toMatchObject({
      id: "33333333",
      pid: null,
      status: null,
      state: "done",
      active: false,
    });
    expect(rows[3]).toMatchObject({ state: "stopped", active: false });
  });

  it("rejects a payload that is not an array", () => {
    expect(() => normalizeAgents({ agents: [] })).toThrow(/array/);
  });

  it("skips rows that are not objects", () => {
    expect(normalizeAgents([null, 3, ACTIVE_FIXTURE[0]])).toHaveLength(1);
  });
});

describe("countRunningWorkers and findLiveWorker", () => {
  const agents = normalizeAgents(ALL_FIXTURE);

  it("counts only active wk- rows", () => {
    expect(countRunningWorkers(agents)).toBe(1);
    expect(countRunningWorkers([])).toBe(0);
  });

  it("finds the active worker for its exact ref", () => {
    expect(findLiveWorker(agents, "TEAM-12")?.name).toBe(LIVE_WORKER);
  });

  it("does not treat a prefix ref as live", () => {
    expect(findLiveWorker(agents, "TEAM-1")).toBeNull();
  });

  it("ignores completed rows for the same ref", () => {
    expect(findLiveWorker(agents, "owner/repo-b#7")).toBeNull();
  });
});

describe("scrubWorkerEnv", () => {
  it("removes every TELEGRAM_* key and keeps the rest", () => {
    const env = {
      PATH: "/bin",
      HOME: "/home/op",
      TELEGRAM_STATE_DIR: "/state",
      TELEGRAM_BOT_TOKEN: "123:abc",
      TELEGRAM_OTHER: "x",
      NOT_TELEGRAM_KEY: "kept",
    };
    const scrubbed = scrubWorkerEnv(env);
    expect(scrubbed).toEqual({
      PATH: "/bin",
      HOME: "/home/op",
      NOT_TELEGRAM_KEY: "kept",
    });
    expect(scrubbed).not.toHaveProperty("TELEGRAM_STATE_DIR");
    expect(scrubbed).not.toHaveProperty("TELEGRAM_BOT_TOKEN");
    expect(env).toHaveProperty("TELEGRAM_BOT_TOKEN");
  });
});

describe("buildWorkerSpawn", () => {
  it("builds the exact claude --bg argv", () => {
    const spawn = buildWorkerSpawn({
      ref: "TEAM-12",
      name: NEW_WORKER,
      manager: "lisa-sm-repo-a",
      repoDir: REPO_A_DIR,
      env: { PATH: "/bin", TELEGRAM_BOT_TOKEN: "t", TELEGRAM_STATE_DIR: "s" },
    });
    expect(spawn).toEqual({
      command: "claude",
      args: [
        "--bg",
        "-n",
        NEW_WORKER,
        "--dangerously-skip-permissions",
        "--settings",
        '{"crossSessionInbound":"accept"}',
        "/lisa:implement TEAM-12 managedBy=lisa-sm-repo-a",
      ],
      cwd: REPO_A_DIR,
      env: { PATH: "/bin" },
    });
    expect(WORKER_SETTINGS).toBe('{"crossSessionInbound":"accept"}');
  });

  it.each([
    [{ manager: "bad name" }, /manager/],
    [{ manager: "" }, /manager/],
    [{ ref: "TEAM-12 and more" }, /ref/],
    [{ ref: "" }, /ref/],
    [{ name: "not-a-worker" }, /name/],
    [{ repoDir: "" }, /repoDir/],
  ])("rejects %j", (override, message) => {
    expect(() =>
      buildWorkerSpawn({
        ref: "TEAM-12",
        name: NEW_WORKER,
        manager: "lisa-sm",
        repoDir: REPO_A_DIR,
        env: {},
        ...override,
      })
    ).toThrow(message);
  });
});

describe("buildWorkerResume", () => {
  it("resumes with the same cwd and scrub", () => {
    expect(
      buildWorkerResume({
        sessionId: LIVE_SESSION_ID,
        text: "Paul's answer: 2",
        repoDir: REPO_A_DIR,
        env: { PATH: "/bin", TELEGRAM_BOT_TOKEN: "t" },
      })
    ).toEqual({
      command: "claude",
      args: ["--bg", "--resume", LIVE_SESSION_ID, "Paul's answer: 2"],
      cwd: REPO_A_DIR,
      env: { PATH: "/bin" },
    });
  });

  it.each([
    [{ sessionId: "" }, /sessionId/],
    [{ sessionId: "--settings" }, /sessionId/],
    [{ text: "" }, /text/],
  ])("rejects %j", (override, message) => {
    expect(() =>
      buildWorkerResume({
        sessionId: "abc",
        text: "hi",
        repoDir: "/work",
        env: {},
        ...override,
      })
    ).toThrow(message);
  });
});
