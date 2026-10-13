/**
 * Shared fixtures for the worker helper tests: both `claude agents --json`
 * shapes, recorded from Claude Code 2.1.296 with every identity replaced by a
 * generic one.
 * @module tests/unit/session-manager/workers-fixtures
 */

/** 2026-10-12 09:05 local time, the clock every naming test reads. */
export const NOW = new Date(2026, 9, 12, 9, 5);

/** One minute and one hour in milliseconds. */
export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;

/** The repo directory most fixtures run in. */
export const REPO_A_DIR = "/work/repo-a";

/** The session kind `claude --bg` creates. */
export const BACKGROUND = "background";

/** The running worker's full session id. */
export const LIVE_SESSION_ID = "11111111-1111-4111-8111-111111111111";

/** The running worker's name, for ref TEAM-12. */
export const LIVE_WORKER = "wk-TEAM-12-1012-0900";

/** The name `buildWorkerName("TEAM-12", NOW)` produces. */
export const NEW_WORKER = "wk-TEAM-12-1012-0905";

/** `claude agents --json`: active sessions only. */
export const ACTIVE_FIXTURE = [
  {
    pid: 101,
    cwd: REPO_A_DIR,
    kind: BACKGROUND,
    startedAt: 1791835698878,
    sessionId: LIVE_SESSION_ID,
    name: LIVE_WORKER,
    status: "busy",
  },
  {
    pid: 102,
    cwd: "/work",
    kind: "interactive",
    startedAt: 1791835698879,
    sessionId: "22222222-2222-4222-8222-222222222222",
    name: "manager-session",
    status: "idle",
  },
];

/** `claude agents --json --all`: completed rows use `id` and `state`. */
export const ALL_FIXTURE = [
  ...ACTIVE_FIXTURE,
  {
    id: "33333333",
    cwd: REPO_A_DIR,
    kind: BACKGROUND,
    startedAt: 1791479268041,
    sessionId: "33333333-3333-4333-8333-333333333333",
    name: "wk-TEAM-1-1011-0800",
    state: "done",
  },
  {
    id: "44444444",
    cwd: "/work/repo-b",
    kind: BACKGROUND,
    startedAt: 1791479272559,
    sessionId: "44444444-4444-4444-8444-444444444444",
    name: "wk-repo-b-7-1011-0801",
    state: "stopped",
  },
];

/**
 * The row shapes Claude Code 2.1.296 printed for `wk-` sessions during live
 * verification of #4448, identities replaced. Liveness has to be read from
 * `pid`/`status`, not from `state`: an idle worker whose turn ended reports
 * `state: "done"` while its process is still alive.
 */
export const LIVENESS_REFS = {
  busy: "LIVE-1",
  idleAlive: "LIVE-2",
  waiting: "LIVE-3",
  starting: "LIVE-4",
  completed: "LIVE-5",
} as const;

/** Busy worker in `claude agents --json`: `pid` and `status`, no `state`. */
export const BUSY_ROW = {
  pid: 201,
  id: "aaaaaaaa",
  cwd: REPO_A_DIR,
  kind: BACKGROUND,
  startedAt: 1791846635975,
  sessionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  name: "wk-LIVE-1-1012-1910",
  status: "busy",
};

/** Idle but alive (turn ended, process up), in the plain and `--all` lists. */
export const IDLE_ALIVE_ROW = {
  pid: 202,
  id: "bbbbbbbb",
  cwd: REPO_A_DIR,
  kind: BACKGROUND,
  startedAt: 1791846636679,
  sessionId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  name: "wk-LIVE-2-1012-1910",
  status: "idle",
  state: "done",
};

/** Waiting on a question it asked: alive, `state: "blocked"`. */
export const WAITING_ROW = {
  pid: 203,
  id: "cccccccc",
  cwd: REPO_A_DIR,
  kind: BACKGROUND,
  startedAt: 1791846637000,
  sessionId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  name: "wk-LIVE-3-1012-1910",
  status: "idle",
  state: "blocked",
};

/** Just spawned: the daemon has not reported a pid or status yet. */
export const STARTING_ROW = {
  name: "wk-LIVE-4-1012-1910",
  pid: null,
  status: null,
  state: "working",
};

/** Truly finished, only in `--all`: `id` and `state`, no `pid` or `status`. */
export const COMPLETED_ROW = {
  id: "dddddddd",
  cwd: REPO_A_DIR,
  kind: BACKGROUND,
  startedAt: 1791479268041,
  sessionId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  name: "wk-LIVE-5-1011-0800",
  state: "done",
};

/** All five, as one `claude agents --json --all` payload. */
export const LIVENESS_FIXTURE = [
  BUSY_ROW,
  IDLE_ALIVE_ROW,
  WAITING_ROW,
  STARTING_ROW,
  COMPLETED_ROW,
];
