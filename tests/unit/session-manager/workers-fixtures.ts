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
