/**
 * The session manager's ledger: one JSON file of everything the manager
 * dispatched, plus an append-only log of session events.
 *
 * Attempts are counted here and **never** in tracker comments. A counter kept
 * in append-only comments cannot be reset when an item recovers, so a later
 * cycle re-reads the old count and blocks the item again. The cost of keeping
 * it local is stated plainly: a lost ledger resets attempts to zero.
 *
 * Every write goes through a temp file and a rename, so a crash mid-write
 * leaves the previous ledger intact rather than half a file. A corrupt ledger
 * is refused, not replaced, because replacing it would silently reset every
 * attempt count.
 *
 * File I/O and the clock are injected (`{fs, now}`) so tests can observe the
 * rename and pin timestamps. Nothing here reads `process.env` or a tracker.
 * @module ledger
 */

import { randomUUID } from "node:crypto";
import * as nodeFs from "node:fs/promises";
import { dirname, join } from "node:path";

/** Shape version, bumped only on an incompatible change. */
const LEDGER_VERSION = 1;

/** Upper bound for `control.maxWorkers`, matching the Telegram `cap N` range. */
const MAX_WORKERS_LIMIT = 32;

/** Outcomes a worker can report about itself. */
const FINISH_STATUSES = new Set(["DONE", "FAILED"]);

/**
 * @typedef {object} LedgerSeams
 * @property {Pick<typeof nodeFs, "readFile"|"writeFile"|"rename"|"mkdir"|"appendFile">} [fs] - File system
 * @property {() => Date} [now] - Clock
 */

/**
 * Directory holding all session-manager state.
 * @param {string} projectRoot - Absolute project root
 * @returns {string} State directory
 */
function stateDir(projectRoot) {
  return join(projectRoot, ".lisa", "session-manager");
}

/**
 * Path of the ledger file.
 * @param {string} projectRoot - Absolute project root
 * @returns {string} Ledger path
 */
export function ledgerPath(projectRoot) {
  return join(stateDir(projectRoot), "ledger.json");
}

/**
 * Path of the session event log.
 * @param {string} projectRoot - Absolute project root
 * @returns {string} JSONL path
 */
export function sessionsLogPath(projectRoot) {
  return join(stateDir(projectRoot), "sessions.jsonl");
}

/**
 * A ledger with nothing in it.
 * @returns {{version: number, items: Record<string, object>, control: {paused: boolean, maxWorkers: number|null, me: string|null}}} Empty ledger
 */
function emptyLedger() {
  return {
    version: LEDGER_VERSION,
    items: {},
    control: { paused: false, maxWorkers: null, me: null },
  };
}

/**
 * Resolve injected seams against the real defaults.
 * @param {LedgerSeams} [seams] - Injected seams
 * @returns {{fs: NonNullable<LedgerSeams["fs"]>, now: () => Date}} Resolved seams
 */
function resolveSeams(seams = {}) {
  return { fs: seams.fs ?? nodeFs, now: seams.now ?? (() => new Date()) };
}

/**
 * Read the ledger. A missing file is an empty ledger; a corrupt one throws.
 * @param {string} projectRoot - Absolute project root
 * @param {LedgerSeams} [seams] - Injected seams
 * @returns {Promise<ReturnType<typeof emptyLedger>>} Ledger
 */
export async function readLedger(projectRoot, seams) {
  const { fs } = resolveSeams(seams);
  const file = ledgerPath(projectRoot);
  const text = await fs.readFile(file, "utf8").catch(error => {
    if (error?.code === "ENOENT") return null;
    throw error;
  });
  if (text === null) return emptyLedger();
  const parsed = (() => {
    try {
      return JSON.parse(text);
    } catch (error) {
      throw new Error(
        `session-manager ledger at ${file} is not valid JSON (${error.message}); refusing to reset attempts — repair or remove it`
      );
    }
  })();
  const empty = emptyLedger();
  return {
    version: parsed.version ?? empty.version,
    items: parsed.items ?? {},
    control: { ...empty.control, ...parsed.control },
  };
}

/**
 * Write the whole ledger atomically (temp file, then rename).
 * @param {string} projectRoot - Absolute project root
 * @param {ReturnType<typeof emptyLedger>} ledger - Ledger to persist
 * @param {LedgerSeams} [seams] - Injected seams
 * @returns {Promise<void>}
 */
export async function writeLedger(projectRoot, ledger, seams) {
  const { fs } = resolveSeams(seams);
  const file = ledgerPath(projectRoot);
  await fs.mkdir(dirname(file), { recursive: true });
  const tempPath = `${file}.${process.pid}.${randomUUID()}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(ledger, null, 2)}\n`, "utf8");
  await fs.rename(tempPath, file);
}

/**
 * Read, transform and write the ledger in one step.
 * @template T
 * @param {string} projectRoot - Absolute project root
 * @param {LedgerSeams | undefined} seams - Injected seams
 * @param {(ledger: ReturnType<typeof emptyLedger>, at: string) => {ledger: ReturnType<typeof emptyLedger>, result: T}} transform - Pure update
 * @returns {Promise<T>} The transform's result
 */
async function updateLedger(projectRoot, seams, transform) {
  const { now } = resolveSeams(seams);
  const current = await readLedger(projectRoot, seams);
  const { ledger, result } = transform(current, now().toISOString());
  await writeLedger(projectRoot, ledger, seams);
  return result;
}

/**
 * Replace one item in a ledger, returning the new ledger and the new item.
 * @param {ReturnType<typeof emptyLedger>} ledger - Current ledger
 * @param {string} ref - Item key
 * @param {object} entry - New item
 * @returns {{ledger: ReturnType<typeof emptyLedger>, result: object}} Update
 */
function withItem(ledger, ref, entry) {
  return {
    ledger: { ...ledger, items: { ...ledger.items, [ref]: entry } },
    result: entry,
  };
}

/**
 * Look up an item that must already exist.
 * @param {ReturnType<typeof emptyLedger>} ledger - Current ledger
 * @param {string} ref - Item key
 * @returns {object} The item
 */
function requireItem(ledger, ref) {
  const entry = ledger.items[ref];
  if (!entry)
    throw new Error(
      `session-manager ledger has no item ${JSON.stringify(ref)}`
    );
  return entry;
}

/**
 * A ledger item for a ref the manager has asked about but not dispatched.
 * @returns {object} Placeholder item
 */
function placeholderItem() {
  return {
    repo: null,
    worker: null,
    sessionId: null,
    status: "question",
    startedAt: null,
    lastProgressAt: null,
    logsHash: null,
    pendingQuestion: null,
    attempts: 0,
    history: [],
  };
}

/**
 * Record a worker spawn. Each spawn for the same ref is one more attempt.
 * @param {string} projectRoot - Absolute project root
 * @param {{ref: string, worker: string, sessionId: string|null, repo: string}} spawn - What was spawned
 * @param {LedgerSeams} [seams] - Injected seams
 * @returns {Promise<object>} The updated item
 */
export function recordSpawn(
  projectRoot,
  { ref, worker, sessionId, repo },
  seams
) {
  return updateLedger(projectRoot, seams, (ledger, at) => {
    const previous = ledger.items[ref] ?? placeholderItem();
    const attempts = (previous.attempts ?? 0) + 1;
    return withItem(ledger, ref, {
      ...previous,
      repo,
      worker,
      sessionId,
      status: "running",
      startedAt: at,
      lastProgressAt: at,
      logsHash: null,
      pendingQuestion: null,
      reason: null,
      finishedAt: null,
      attempts,
      history: [
        ...(previous.history ?? []),
        { event: "spawn", at, worker, sessionId, attempt: attempts },
      ],
    });
  });
}

/**
 * Record (or re-ping) the question an item is waiting on.
 *
 * The same text again is a re-ping: `askedAt` is kept and `lastPingAt` moves,
 * so the requestion clock restarts without forgetting how old the question
 * is. A ref with no item yet (a repo-routing question asked before dispatch)
 * gets a placeholder item with zero attempts.
 * @param {string} projectRoot - Absolute project root
 * @param {{ref: string, text: string, telegramMessageId: number|null}} question - Question
 * @param {LedgerSeams} [seams] - Injected seams
 * @returns {Promise<object>} The updated item
 */
export function setPendingQuestion(
  projectRoot,
  { ref, text, telegramMessageId },
  seams
) {
  return updateLedger(projectRoot, seams, (ledger, at) => {
    const previous = ledger.items[ref] ?? placeholderItem();
    const existing = previous.pendingQuestion;
    const askedAt = existing?.text === text ? existing.askedAt : at;
    return withItem(ledger, ref, {
      ...previous,
      pendingQuestion: {
        text,
        askedAt,
        lastPingAt: at,
        telegramMessageId: telegramMessageId ?? null,
      },
      history: [...(previous.history ?? []), { event: "question", at }],
    });
  });
}

/**
 * Clear an item's pending question, once its answer has been delivered.
 * @param {string} projectRoot - Absolute project root
 * @param {{ref: string}} target - Item
 * @param {LedgerSeams} [seams] - Injected seams
 * @returns {Promise<object>} The updated item
 */
export function clearPendingQuestion(projectRoot, { ref }, seams) {
  return updateLedger(projectRoot, seams, (ledger, at) => {
    const previous = requireItem(ledger, ref);
    return withItem(ledger, ref, {
      ...previous,
      pendingQuestion: null,
      history: [...(previous.history ?? []), { event: "answered", at }],
    });
  });
}

/**
 * Record this cycle's hash of the worker's logs. `lastProgressAt` moves only
 * when the hash changed, which is what "no output for N minutes" measures.
 * @param {string} projectRoot - Absolute project root
 * @param {{ref: string, logsHash: string}} progress - Observed hash
 * @param {LedgerSeams} [seams] - Injected seams
 * @returns {Promise<{changed: boolean, entry: object}>} Whether it moved, and the item
 */
export function recordProgress(projectRoot, { ref, logsHash }, seams) {
  return updateLedger(projectRoot, seams, (ledger, at) => {
    const previous = requireItem(ledger, ref);
    if (previous.logsHash === logsHash) {
      return { ledger, result: { changed: false, entry: previous } };
    }
    const { ledger: next, result: entry } = withItem(ledger, ref, {
      ...previous,
      logsHash,
      lastProgressAt: at,
    });
    return { ledger: next, result: { changed: true, entry } };
  });
}

/**
 * Record the worker's own terminal report.
 * @param {string} projectRoot - Absolute project root
 * @param {{ref: string, status: "DONE"|"FAILED", reason: string}} finish - Report
 * @param {LedgerSeams} [seams] - Injected seams
 * @returns {Promise<object>} The updated item
 */
export function recordFinish(projectRoot, { ref, status, reason }, seams) {
  if (!FINISH_STATUSES.has(status)) {
    return Promise.reject(
      new Error(
        `finish status must be DONE or FAILED, got ${JSON.stringify(status)}`
      )
    );
  }
  return updateLedger(projectRoot, seams, (ledger, at) => {
    const previous = requireItem(ledger, ref);
    return withItem(ledger, ref, {
      ...previous,
      status,
      reason,
      finishedAt: at,
      pendingQuestion: null,
      history: [
        ...(previous.history ?? []),
        { event: "finish", at, status, reason },
      ],
    });
  });
}

/**
 * Check a control patch before it is written.
 * @param {{paused?: unknown, maxWorkers?: unknown, me?: unknown}} patch - Patch
 */
function assertControlPatch(patch) {
  if ("paused" in patch && typeof patch.paused !== "boolean") {
    throw new Error("control.paused must be a boolean");
  }
  if (
    "maxWorkers" in patch &&
    patch.maxWorkers !== null &&
    !(
      Number.isInteger(patch.maxWorkers) &&
      patch.maxWorkers >= 0 &&
      patch.maxWorkers <= MAX_WORKERS_LIMIT
    )
  ) {
    throw new Error(
      `control.maxWorkers must be null or an integer 0..${MAX_WORKERS_LIMIT}`
    );
  }
  if ("me" in patch && patch.me !== null && typeof patch.me !== "string") {
    throw new Error("control.me must be a string or null");
  }
}

/**
 * Merge operator controls into the ledger: `paused`, the `maxWorkers`
 * override (null clears it) and `me`, the resolved tracker identity.
 * @param {string} projectRoot - Absolute project root
 * @param {{paused?: boolean, maxWorkers?: number|null, me?: string|null}} patch - Fields to set
 * @param {LedgerSeams} [seams] - Injected seams
 * @returns {Promise<{paused: boolean, maxWorkers: number|null, me: string|null}>} New control block
 */
export async function setControl(projectRoot, patch, seams) {
  assertControlPatch(patch);
  return updateLedger(projectRoot, seams, ledger => {
    const control = { ...ledger.control, ...patch };
    return { ledger: { ...ledger, control }, result: control };
  });
}

/**
 * Append one event to `sessions.jsonl`, stamped with the time.
 * @param {string} projectRoot - Absolute project root
 * @param {Record<string, unknown>} event - Event fields
 * @param {LedgerSeams} [seams] - Injected seams
 * @returns {Promise<void>}
 */
export async function appendSessionEvent(projectRoot, event, seams) {
  const { fs, now } = resolveSeams(seams);
  const file = sessionsLogPath(projectRoot);
  await fs.mkdir(dirname(file), { recursive: true });
  await fs.appendFile(
    file,
    `${JSON.stringify({ at: now().toISOString(), ...event })}\n`,
    "utf8"
  );
}
