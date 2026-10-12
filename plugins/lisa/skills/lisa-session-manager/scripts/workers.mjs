/**
 * Worker bookkeeping for the session manager: names, live detection, spawn
 * argv and stall classification.
 *
 * A worker is a background Claude Code session (`claude --bg`) running
 * `/lisa:implement <REF> managedBy=<manager>` for one work item. The manager
 * never keeps a handle on a worker; it rediscovers every worker each cycle
 * from `claude agents --json` by name. So the name is the join key between the
 * tracker item, the ledger row and the live session, and everything here is
 * about keeping that join exact.
 *
 * Every export is pure. `session-manager.mjs` owns the real `process.env`,
 * `child_process` and clock, and passes them in.
 * @module workers
 */

/** Settings blob every worker gets, so the manager's messages reach it. */
export const WORKER_SETTINGS = JSON.stringify({
  crossSessionInbound: "accept",
});

/**
 * Stall policy used when the caller passes none. Mirrors the
 * `sessionManager.stall` defaults, so a missing config block still classifies.
 */
export const DEFAULT_STALL = Object.freeze({
  noOutputMinutes: 60,
  requestionHours: 4,
  maxAttempts: 3,
});

/** Every worker session name starts with this. Anything else is not ours. */
const WORKER_PREFIX = "wk-";

/**
 * `wk-<token>-<MMDD>-<HHMM>[-<n>]`. The token is lazy so a 4-digit collision
 * suffix is never swallowed into the stamp, and the whole name is anchored so
 * a token is compared exactly — never by `startsWith`, which would let an
 * `ABC-12` worker answer for `ABC-1`.
 */
const WORKER_NAME_PATTERN = /^wk-(.+?)-(\d{4}-\d{4})(?:-(\d+))?$/;

/** Rows in these `claude agents --json --all` states have finished running. */
const TERMINAL_AGENT_STATES = new Set(["done", "stopped"]);

/** Ledger statuses that mean the worker reported its own outcome. */
const FINISHED_STATUSES = new Set(["DONE", "FAILED"]);

/** The `managedBy=` value contract `lisa-implement` enforces. */
const MANAGER_NAME_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

/** A full session UUID, which `--resume` accepts directly. */
const SESSION_UUID_PATTERN =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;

/** The short id `claude --bg` prints and `claude agents` lists. */
const SHORT_ID_PATTERN = /\b[0-9a-f]{8}\b/i;

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

/**
 * Reduce a work-item ref to the `[A-Za-z0-9-]` token used in worker names.
 *
 * A GitHub ref `owner/repo#12` becomes `repo-12`: the owner adds nothing
 * inside one project and `/` and `#` are not safe in a session name. Jira and
 * Linear keys already fit and pass through unchanged.
 * @param {string} ref - Tracker ref as the queue reported it
 * @returns {string} Name-safe token
 */
export function sanitizeRefToken(ref) {
  if (typeof ref !== "string") {
    throw new TypeError(`ref must be a string, got ${typeof ref}`);
  }
  const github = /^(?:[^/\s]+\/)?([^/#\s]*)#(\d+)$/.exec(ref.trim());
  const raw = github ? [github[1], github[2]].filter(Boolean).join("-") : ref;
  const token = raw
    .replace(/[^A-Za-z0-9-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "");
  if (token === "") {
    throw new Error(`ref ${JSON.stringify(ref)} yields an empty worker token`);
  }
  return token;
}

/**
 * Format a clock reading as local `MMDD-HHMM`.
 * @param {Date | number} now - Clock reading
 * @returns {string} Stamp
 */
function formatStamp(now) {
  const date = now instanceof Date ? now : new Date(now);
  const pad = value => String(value).padStart(2, "0");
  return `${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
}

/**
 * Name a new worker for `ref`, unique against every name already known.
 *
 * A retry in the same minute would otherwise reuse the name of the worker it
 * replaces, and `claude agents` could no longer tell them apart, so a
 * collision gets `-2`, `-3`, ….
 * @param {string} ref - Tracker ref
 * @param {Date | number} now - Clock reading
 * @param {Iterable<string>} [existingNames] - Every session name in use or on record
 * @returns {string} Worker session name
 */
export function buildWorkerName(ref, now, existingNames = []) {
  const known = new Set(existingNames);
  const base = `${WORKER_PREFIX}${sanitizeRefToken(ref)}-${formatStamp(now)}`;
  if (!known.has(base)) return base;
  const suffix = Array.from(
    { length: known.size + 1 },
    (_, index) => index + 2
  ).find(candidate => !known.has(`${base}-${candidate}`));
  return `${base}-${suffix}`;
}

/**
 * Split a worker session name into its parts.
 * @param {string} name - Session name
 * @returns {{token: string, stamp: string, suffix: number | null} | null} Parts, or null when the name is not a worker's
 */
export function parseWorkerName(name) {
  const match =
    typeof name === "string" ? WORKER_NAME_PATTERN.exec(name) : null;
  if (!match) return null;
  return {
    token: match[1],
    stamp: match[2],
    suffix: match[3] === undefined ? null : Number(match[3]),
  };
}

/**
 * Read a value only when it is a string.
 * @param {unknown} value - Candidate
 * @returns {string | null} The string, or null
 */
function stringOrNull(value) {
  return typeof value === "string" ? value : null;
}

/**
 * Normalize `claude agents --json` output (with or without `--all`).
 *
 * The two shapes differ: an active row carries `{pid,status}`; a completed row
 * from `--all` carries `{id,state}` with `state` of `done` or `stopped` and no
 * `pid`. Every row comes back with all fields present (null when absent) and
 * an `active` flag, so callers never branch on shape.
 * @param {unknown} parsed - `JSON.parse` of the command's stdout
 * @returns {Array<{name: string|null, sessionId: string|null, id: string|null, pid: number|null, cwd: string|null, kind: string|null, startedAt: number|null, status: string|null, state: string|null, active: boolean}>} Rows
 */
export function normalizeAgents(parsed) {
  if (!Array.isArray(parsed)) {
    throw new TypeError("claude agents --json must return an array");
  }
  return parsed
    .filter(row => row !== null && typeof row === "object")
    .map(row => {
      const state = stringOrNull(row.state);
      return {
        name: stringOrNull(row.name),
        sessionId: stringOrNull(row.sessionId),
        id: stringOrNull(row.id),
        pid: typeof row.pid === "number" ? row.pid : null,
        cwd: stringOrNull(row.cwd),
        kind: stringOrNull(row.kind),
        startedAt: typeof row.startedAt === "number" ? row.startedAt : null,
        status: stringOrNull(row.status),
        state,
        active: state === null || !TERMINAL_AGENT_STATES.has(state),
      };
    });
}

/**
 * Whether a normalized row is a running worker.
 * @param {{active: boolean, name: string|null}} agent - Normalized row
 * @returns {boolean} True for an active `wk-` session
 */
function isRunningWorker(agent) {
  return agent.active && parseWorkerName(agent.name) !== null;
}

/**
 * Count running workers, the `running` input to capacity.
 * @param {ReturnType<typeof normalizeAgents>} agents - Normalized rows
 * @returns {number} Active `wk-` sessions
 */
export function countRunningWorkers(agents) {
  return agents.filter(isRunningWorker).length;
}

/**
 * Find the running worker for `ref`, by exact token.
 * @param {ReturnType<typeof normalizeAgents>} agents - Normalized rows
 * @param {string} ref - Tracker ref
 * @returns {ReturnType<typeof normalizeAgents>[number] | null} The row, or null
 */
export function findLiveWorker(agents, ref) {
  const token = sanitizeRefToken(ref);
  return (
    agents.find(
      agent =>
        isRunningWorker(agent) && parseWorkerName(agent.name)?.token === token
    ) ?? null
  );
}

/**
 * Copy an environment without any `TELEGRAM_*` key.
 *
 * The manager runs with `TELEGRAM_STATE_DIR` (and possibly
 * `TELEGRAM_BOT_TOKEN`) set. A worker that inherited either could start a
 * second poller on the same bot and take the manager's messages, so every
 * `TELEGRAM_*` key goes — a superset of the two that matter today.
 * @param {Record<string, string | undefined>} env - Source environment
 * @returns {Record<string, string | undefined>} New environment
 */
export function scrubWorkerEnv(env) {
  return Object.fromEntries(
    Object.entries(env).filter(([key]) => !key.startsWith("TELEGRAM_"))
  );
}

/**
 * Throw unless `value` is a non-empty string.
 * @param {string} label - Field name for the message
 * @param {unknown} value - Candidate
 */
function requireText(label, value) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} must be a non-empty string`);
  }
}

/**
 * Build the spawn for a new worker. Passed as argv to `spawnSync`, never a
 * shell string, so no ref or name is ever interpreted by a shell.
 *
 * The prompt is exactly `/lisa:implement <REF> managedBy=<manager>`: any
 * trailing prose would make `lisa-track` classify the arguments as free text.
 * @param {{ref: string, name: string, manager: string, repoDir: string, env: Record<string, string | undefined>}} input - Spawn inputs
 * @returns {{command: string, args: string[], cwd: string, env: Record<string, string | undefined>}} Spawn spec
 */
export function buildWorkerSpawn({ ref, name, manager, repoDir, env }) {
  requireText("ref", ref);
  if (/\s/.test(ref)) {
    throw new Error(`ref ${JSON.stringify(ref)} must not contain whitespace`);
  }
  if (typeof manager !== "string" || !MANAGER_NAME_PATTERN.test(manager)) {
    throw new Error(
      `manager ${JSON.stringify(manager)} must match ${MANAGER_NAME_PATTERN}`
    );
  }
  if (parseWorkerName(name) === null) {
    throw new Error(`name ${JSON.stringify(name)} is not a worker name`);
  }
  requireText("repoDir", repoDir);
  return {
    command: "claude",
    args: [
      "--bg",
      "-n",
      name,
      "--dangerously-skip-permissions",
      "--settings",
      WORKER_SETTINGS,
      `/lisa:implement ${ref} managedBy=${manager}`,
    ],
    cwd: repoDir,
    env: scrubWorkerEnv(env),
  };
}

/**
 * Build the spawn that resumes a worker with one message (an answer, or a
 * nudge after a stall), with the same cwd and environment scrub as a spawn.
 * @param {{sessionId: string, text: string, repoDir: string, env: Record<string, string | undefined>}} input - Resume inputs
 * @returns {{command: string, args: string[], cwd: string, env: Record<string, string | undefined>}} Spawn spec
 */
export function buildWorkerResume({ sessionId, text, repoDir, env }) {
  requireText("sessionId", sessionId);
  if (sessionId.startsWith("-")) {
    throw new Error(
      `sessionId ${JSON.stringify(sessionId)} must not look like a flag`
    );
  }
  requireText("text", text);
  requireText("repoDir", repoDir);
  return {
    command: "claude",
    // `--` ends option parsing: an answer that starts with `--` (claude
    // 2.1.296 reads `--x` there as an unknown option) stays message text.
    args: ["--bg", "--resume", sessionId, "--", text],
    cwd: repoDir,
    env: scrubWorkerEnv(env),
  };
}

/**
 * Pull the session id out of `claude --bg` stdout. A full UUID wins; else the
 * short id `claude --bg` prints. The manager can always map either back to
 * the full `sessionId` through `claude agents --json` by worker name.
 * @param {string} stdout - Command output
 * @returns {string | null} Session id, or null
 */
export function parseSessionId(stdout) {
  const text = typeof stdout === "string" ? stdout : "";
  return (
    SESSION_UUID_PATTERN.exec(text)?.[0] ??
    SHORT_ID_PATTERN.exec(text)?.[0] ??
    null
  );
}

/**
 * Read a timestamp that may be an ISO string, epoch milliseconds or a Date.
 * @param {unknown} value - Candidate
 * @returns {number | null} Epoch milliseconds, or null
 */
function toMillis(value) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

/**
 * Classify one dispatched item for this cycle.
 *
 * Order matters: a recorded DONE/FAILED wins; a pending question means the
 * worker ended its turn on purpose, so it is `waiting` even when its row
 * reads `done`; only then is liveness judged. `stalled` and `dead` become
 * `exhausted` at `maxAttempts`, which is the manager's cue to move the item to
 * Blocked instead of retrying it again.
 * @param {{agent: ReturnType<typeof normalizeAgents>[number] | null, entry: {status?: string, startedAt?: string|number, lastProgressAt?: string|number|null, logsHash?: string|null, pendingQuestion?: {askedAt?: string|number, lastPingAt?: string|number|null} | null, attempts?: number}, logsHash?: string | null | undefined, now: Date | number, stall?: {noOutputMinutes: number, requestionHours: number, maxAttempts: number}}} input - Classification inputs
 * @returns {"finished"|"waiting"|"requestion"|"working"|"stalled"|"dead"|"exhausted"} Classification
 */
export function classifyWorker({
  agent,
  entry,
  logsHash,
  now,
  stall = DEFAULT_STALL,
}) {
  if (FINISHED_STATUSES.has(entry.status ?? "")) return "finished";
  const nowMs = toMillis(now) ?? 0;
  const question = entry.pendingQuestion;
  if (question) {
    const lastPing =
      toMillis(question.lastPingAt) ?? toMillis(question.askedAt) ?? nowMs;
    return nowMs - lastPing > stall.requestionHours * HOUR_MS
      ? "requestion"
      : "waiting";
  }
  const outcome = agent?.active
    ? judgeActive(entry, logsHash, nowMs, stall)
    : "dead";
  if (outcome !== "working" && (entry.attempts ?? 0) >= stall.maxAttempts) {
    return "exhausted";
  }
  return outcome;
}

/**
 * Decide whether an active worker is making progress.
 * @param {{logsHash?: string|null, lastProgressAt?: string|number|null, startedAt?: string|number}} entry - Ledger row
 * @param {string | null | undefined} logsHash - This cycle's hash of `claude logs <name>`
 * @param {number} nowMs - Clock reading
 * @param {{noOutputMinutes: number}} stall - Stall policy
 * @returns {"working"|"stalled"} Classification
 */
function judgeActive(entry, logsHash, nowMs, stall) {
  if (typeof logsHash === "string" && logsHash !== entry.logsHash)
    return "working";
  const lastProgress =
    toMillis(entry.lastProgressAt) ?? toMillis(entry.startedAt) ?? nowMs;
  return nowMs - lastProgress <= stall.noOutputMinutes * MINUTE_MS
    ? "working"
    : "stalled";
}
