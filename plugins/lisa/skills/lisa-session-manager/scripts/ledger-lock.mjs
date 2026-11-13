/**
 * Cross-process lock serializing the ledger's read-modify-write
 * (CodySwannGT/lisa#4828).
 *
 * Several `session-manager.mjs` processes write one ledger file (the cycle,
 * worker finishes, answers, the per-cycle heartbeat). Each write reads the
 * whole file, changes it and writes it back, so without a lock the later of
 * two overlapping writers silently discarded the earlier one — a lost `finish`
 * or `set-question` meant a duplicate dispatch or an unanswered question.
 *
 * Design, mirrored from the learnings-ledger lock (`src/core/learnings-lock.ts`,
 * ported because plugin scripts ship standalone):
 * - The lock is `<ledger>.lock`, beside the ledger. A holder writes its owner
 *   record (`{token, pid, createdAt}`) in full to a private `.owner` file, then
 *   publishes it with `link(owner, lock)`. The link is atomic and fails with
 *   EEXIST while someone holds the lock, so a reader never sees half a record.
 * - Release unlinks the lock only while it is still the same inode as this
 *   holder's own owner file, so a writer never removes another's lock.
 * - Defaults: retry for up to {@link LOCK_TIMEOUT_MS} (5s) with jittered
 *   exponential backoff starting at {@link BACKOFF_START_MS} (25ms), capped at
 *   {@link BACKOFF_MAX_MS}. On timeout the command fails with a clear error and
 *   writes nothing — never a write without the lock.
 * - Staleness: a lock whose recorded pid is not alive on this host is stale.
 *   The ticket also said "or older than 30 seconds"; that is deliberately
 *   narrowed. Age ({@link STALE_UNOWNED_MS}) decides only when the owner record
 *   is unreadable, because reclaiming a LIVE holder by age would break the
 *   "a live lock is never broken" guarantee the same ticket requires.
 * - Reclaim is atomic (see `ledger-lock-reclaim.mjs`): a live lock is never
 *   deleted, even by two reclaimers racing.
 * @module ledger-lock
 */

import { randomInt, randomUUID } from "node:crypto";
import { link, writeFile } from "node:fs/promises";

import {
  isProcessLive,
  removeFileIfPresent,
  sameFile,
} from "./ledger-lock-fs.mjs";
import { readLockOwner, reclaimStaleLock } from "./ledger-lock-reclaim.mjs";

/** Total wall-clock budget for one acquisition. */
export const LOCK_TIMEOUT_MS = 5_000;

/** First retry delay; each later one doubles, plus jitter. */
const BACKOFF_START_MS = 25;

/** Ceiling on one retry delay, so a waiter keeps probing a freed lock. */
const BACKOFF_MAX_MS = 250;

/** Age after which a lock with an unreadable owner record is stale. */
const STALE_UNOWNED_MS = 30_000;

/**
 * Injectable lock seams; production uses the defaults.
 * @typedef {object} LockSeams
 * @property {number} [lockTimeoutMs] - Acquisition budget
 * @property {(ms: number) => Promise<void>} [sleep] - Retry delay
 * @property {(pid: number) => boolean} [isProcessLive] - Pid liveness probe
 */

/**
 * Wait without blocking the event loop.
 * @param {number} ms - Delay
 * @returns {Promise<void>}
 */
function defaultSleep(ms) {
  return new Promise(resolve => {
    setTimeout(resolve, ms);
  });
}

/**
 * Jittered exponential backoff for one retry: the base doubles from
 * {@link BACKOFF_START_MS} up to {@link BACKOFF_MAX_MS}, and jitter of up to
 * the base again keeps contenders that lost one race from colliding in step.
 * @param {number} attempt - Zero-based retry count
 * @returns {number} Delay in ms
 */
function backoffMs(attempt) {
  const base = Math.min(BACKOFF_START_MS * 2 ** attempt, BACKOFF_MAX_MS);
  return base + randomInt(0, base + 1);
}

/**
 * Try to publish the owner record as the lock.
 * @param {string} ownerPath - Fully written owner file
 * @param {string} lockPath - Lock path
 * @returns {Promise<"acquired"|"held"|"owner-missing">} Outcome
 */
async function tryPublish(ownerPath, lockPath) {
  try {
    await link(ownerPath, lockPath);
    return "acquired";
  } catch (error) {
    if (error?.code === "EEXIST") return "held";
    if (error?.code === "ENOENT") return "owner-missing";
    throw error;
  }
}

/**
 * Write the owner record exclusively, so two acquisitions never share one.
 * @param {string} ownerPath - Owner file path
 * @param {string} record - Serialized owner record
 * @returns {Promise<void>}
 */
function writeOwner(ownerPath, record) {
  return writeFile(ownerPath, record, { encoding: "utf8", flag: "wx" });
}

/**
 * The error a writer fails with when the lock stays held past its budget.
 * @param {string} lockPath - Lock path
 * @param {number} timeoutMs - Budget that ran out
 * @returns {Promise<Error>} Error naming the holder's pid when readable
 */
async function timeoutError(lockPath, timeoutMs) {
  const holder = await readLockOwner(lockPath);
  const by = holder ? `held by pid ${holder.pid}` : "holder unknown";
  return new Error(
    `session-manager ledger lock timed out after ${timeoutMs}ms: ${lockPath} (${by}); no ledger change was written`
  );
}

/**
 * Retry publication until acquired or the budget ends.
 * @param {{lockPath: string, ownerPath: string, record: string}} lease - Lease
 * @param {Required<LockSeams>} seams - Resolved seams
 * @returns {Promise<void>}
 */
async function acquire(lease, seams) {
  const { lockPath, ownerPath, record } = lease;
  const policy = { isLive: seams.isProcessLive, staleMs: STALE_UNOWNED_MS };
  const deadline = Date.now() + seams.lockTimeoutMs;
  for (let attempt = 0; ; attempt += 1) {
    const outcome = await tryPublish(ownerPath, lockPath);
    if (outcome === "acquired") return;
    if (outcome === "owner-missing") await writeOwner(ownerPath, record);
    else if (await reclaimStaleLock(lockPath, policy)) continue;
    if (Date.now() >= deadline)
      throw await timeoutError(lockPath, seams.lockTimeoutMs);
    await seams.sleep(backoffMs(attempt));
  }
}

/**
 * Remove the lock only while it is still this holder's inode.
 * @param {string} lockPath - Lock path
 * @param {string} ownerPath - This holder's owner file
 * @returns {Promise<void>}
 */
async function release(lockPath, ownerPath) {
  try {
    if (await sameFile(lockPath, ownerPath))
      await removeFileIfPresent(lockPath);
  } finally {
    await removeFileIfPresent(ownerPath);
  }
}

/**
 * Run `operation` while holding the cross-process lock beside `target`.
 * @template T
 * @param {string} target - File the lock guards (the ledger)
 * @param {LockSeams | undefined} seams - Injected seams
 * @param {() => Promise<T>} operation - Whole read-modify-write
 * @returns {Promise<T>} The operation's result
 */
export async function withLedgerLock(target, seams, operation) {
  const resolved = {
    lockTimeoutMs: seams?.lockTimeoutMs ?? LOCK_TIMEOUT_MS,
    sleep: seams?.sleep ?? defaultSleep,
    isProcessLive: seams?.isProcessLive ?? isProcessLive,
  };
  const lockPath = `${target}.lock`;
  const token = randomUUID();
  const ownerPath = `${lockPath}.${token}.owner`;
  const record = JSON.stringify({
    token,
    pid: process.pid,
    createdAt: Date.now(),
  });
  await writeOwner(ownerPath, record);
  try {
    await acquire({ lockPath, ownerPath, record }, resolved);
  } catch (error) {
    await removeFileIfPresent(ownerPath);
    throw error;
  }
  try {
    return await operation();
  } finally {
    await release(lockPath, ownerPath);
  }
}
