/**
 * Atomic reclaim of a ledger lock whose holder is gone (CodySwannGT/lisa#4828).
 *
 * Ported from the learnings-ledger lock (`src/core/learnings-lock.ts` and
 * `learnings-lock-capability.ts`); plugin scripts ship standalone, so the
 * logic is copied, not imported. The argument for why this never deletes a
 * live lock is the precedent's, restated briefly:
 *
 * Proving the lock path still holds the inode judged stale and unlinking it
 * are two syscalls, and POSIX has no "unlink only if still this inode". So the
 * RIGHT to delete one lock generation is made exclusive: a capability file
 * created with `O_EXCL`, at a path derived from the generation's identity
 * (dev, ino and the owner record, all immutable for that file's life). Two
 * reclaimers of the same generation contend for one path and only one wins.
 * While it is held, the lock path can only change if its owner releases it,
 * and the owner was just proven dead. The winner then pins the inode with a
 * hard link, re-proves identity and death, and only then unlinks.
 * @module ledger-lock-reclaim
 */

import { createHash, randomUUID } from "node:crypto";
import { link, rename, writeFile } from "node:fs/promises";

import {
  hasExactKeys,
  isPid,
  readSmallJson,
  removeFileIfPresent,
  sameFile,
  statFile,
} from "./ledger-lock-fs.mjs";

/**
 * Owner record published atomically as the lock file's content.
 * @typedef {object} LockOwner
 * @property {string} token - Unique per acquisition
 * @property {number} pid - Holder process id
 * @property {number} createdAt - Epoch ms the record was written
 */

/**
 * A lock judged reclaimable, anchoring the reclaim to that exact inode.
 * @typedef {object} StaleObservation
 * @property {LockOwner|undefined} owner - Owner when readable
 * @property {number} dev - Device of the judged inode
 * @property {number} ino - Judged inode
 */

/**
 * How staleness is judged.
 * @typedef {object} StalePolicy
 * @property {(pid: number) => boolean} isLive - Pid liveness probe
 * @property {number} staleMs - Age after which an UNOWNED lock is stale
 */

/**
 * Read the lock's owner record; anything malformed is unowned.
 * @param {string} lockPath - Lock (or pinned link) path
 * @returns {Promise<LockOwner|undefined>} Owner, or undefined
 */
export async function readLockOwner(lockPath) {
  const parsed = await readSmallJson(lockPath);
  if (!hasExactKeys(parsed, ["token", "pid", "createdAt"])) return undefined;
  const { token, pid, createdAt } = /** @type {LockOwner} */ (parsed);
  const valid =
    typeof token === "string" &&
    /^[A-Za-z0-9-]{1,128}$/u.test(token) &&
    isPid(pid) &&
    Number.isSafeInteger(createdAt);
  return valid ? { token, pid, createdAt } : undefined;
}

/**
 * Whether an observed lock (owner plus file age) may be reclaimed. A readable
 * owner is stale only when its pid is dead, however old the lock is; age
 * decides only for a lock whose owner record cannot be read.
 * @param {LockOwner|undefined} owner - Owner, when readable
 * @param {number} mtimeMs - Lock file modification time
 * @param {StalePolicy} policy - Staleness policy
 * @returns {boolean} Whether it is stale
 */
function isStale(owner, mtimeMs, policy) {
  if (owner !== undefined) return !policy.isLive(owner.pid);
  return Date.now() - mtimeMs > policy.staleMs;
}

/**
 * Observe the lock and decide whether it is reclaimable.
 * @param {string} lockPath - Lock path
 * @param {StalePolicy} policy - Staleness policy
 * @returns {Promise<StaleObservation|null>} Observation, or null when held/absent
 */
export async function observeStaleLock(lockPath, policy) {
  const before = await statFile(lockPath);
  if (before === undefined) return null;
  if (!before.isFile() || before.isSymbolicLink())
    throw new Error(`session-manager ledger lock path is unsafe: ${lockPath}`);
  const owner = await readLockOwner(lockPath);
  if (!isStale(owner, Number(before.mtimeMs), policy)) return null;
  return { owner, dev: Number(before.dev), ino: Number(before.ino) };
}

/**
 * Reclaim the lock if it is stale, deleting only the inode judged stale.
 * @param {string} lockPath - Lock path
 * @param {StalePolicy} policy - Staleness policy
 * @returns {Promise<boolean>} Whether a stale lock was removed
 */
export async function reclaimStaleLock(lockPath, policy) {
  const observation = await observeStaleLock(lockPath, policy);
  if (observation === null) return false;
  const capability = capabilityPath(lockPath, observation);
  if (!(await claimCapability(capability, policy))) return false;
  try {
    return await deleteObservedGeneration(lockPath, observation, policy);
  } finally {
    await removeFileIfPresent(capability);
  }
}

/**
 * The capability path for one lock generation: a pure function of its
 * identity, so every observer of the same lock contends for the same path.
 * @param {string} lockPath - Lock path
 * @param {StaleObservation} observation - Judged generation
 * @returns {string} Capability path
 */
function capabilityPath(lockPath, { dev, ino, owner }) {
  const identity = [dev, ino, owner?.token, owner?.pid, owner?.createdAt];
  const serialized = JSON.stringify(identity.map(part => part ?? null));
  const digest = createHash("sha256").update(serialized).digest("hex");
  return `${lockPath}.${digest.slice(0, 32)}.reclaim`;
}

/**
 * Take the capability, displacing it only from a provably dead holder.
 * @param {string} capability - Capability path
 * @param {StalePolicy} policy - Staleness policy
 * @returns {Promise<boolean>} Whether this process holds it
 */
async function claimCapability(capability, policy) {
  if (await createCapability(capability)) return true;
  if (!(await breakDeadCapability(capability, policy))) return false;
  return createCapability(capability);
}

/**
 * Publish this process as capability holder with an exclusive create.
 * @param {string} capability - Capability path
 * @returns {Promise<boolean>} Whether the create won
 */
async function createCapability(capability) {
  const holder = JSON.stringify({ pid: process.pid, createdAt: Date.now() });
  try {
    await writeFile(capability, holder, { encoding: "utf8", flag: "wx" });
    return true;
  } catch (error) {
    if (error?.code === "EEXIST") return false;
    throw error;
  }
}

/**
 * Free a capability abandoned by a reclaimer that died mid-reclaim. Only a
 * dead holder is displaced (a dead process unlinks nothing), and the
 * displacement is one atomic rename, so concurrent breakers cannot both win.
 * @param {string} capability - Capability path
 * @param {StalePolicy} policy - Staleness policy
 * @returns {Promise<boolean>} Whether it was freed
 */
async function breakDeadCapability(capability, policy) {
  const holder = await readSmallJson(capability);
  const pid = hasExactKeys(holder, ["pid", "createdAt"])
    ? /** @type {{pid: unknown}} */ (holder).pid
    : undefined;
  if (!isPid(pid) || policy.isLive(/** @type {number} */ (pid))) return false;
  const discarded = `${capability}.${randomUUID()}.broken`;
  try {
    await rename(capability, discarded);
  } catch (error) {
    if (error?.code === "ENOENT") return true;
    throw error;
  }
  await removeFileIfPresent(discarded);
  return true;
}

/**
 * Hard-link the current lock to a quarantine path; false if it is gone.
 * @param {string} lockPath - Lock path
 * @param {string} quarantine - Quarantine path
 * @returns {Promise<boolean>} Whether the pin was made
 */
async function pin(lockPath, quarantine) {
  try {
    await link(lockPath, quarantine);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "EEXIST") return false;
    throw error;
  }
}

/**
 * With the capability held, pin the inode now at the lock path, prove it is
 * still the generation judged stale, and only then unlink it.
 * @param {string} lockPath - Lock path
 * @param {StaleObservation} observation - Judged generation
 * @param {StalePolicy} policy - Staleness policy
 * @returns {Promise<boolean>} Whether it was removed
 */
async function deleteObservedGeneration(lockPath, observation, policy) {
  const quarantine = `${lockPath}.${randomUUID()}.stale`;
  if (!(await pin(lockPath, quarantine))) return false;
  try {
    if (!(await stillStale(lockPath, quarantine, observation, policy)))
      return false;
    await removeFileIfPresent(lockPath);
    if (observation.owner !== undefined)
      await removeFileIfPresent(`${lockPath}.${observation.owner.token}.owner`);
    return true;
  } finally {
    await removeFileIfPresent(quarantine);
  }
}

/**
 * Whether the pinned inode is still the judged generation and still stale.
 * Identity alone is not enough: a released inode can be recycled by a live
 * holder, so the owner record must match the observed one exactly.
 * @param {string} lockPath - Lock path
 * @param {string} quarantine - Pin of the inode now at the lock path
 * @param {StaleObservation} observation - Judged generation
 * @param {StalePolicy} policy - Staleness policy
 * @returns {Promise<boolean>} Whether it is safe to delete
 */
async function stillStale(lockPath, quarantine, observation, policy) {
  const pinned = await statFile(quarantine);
  const sameInode =
    pinned?.isFile() === true &&
    Number(pinned.dev) === observation.dev &&
    Number(pinned.ino) === observation.ino &&
    (await sameFile(lockPath, quarantine));
  if (!sameInode) return false;
  const owner = await readLockOwner(quarantine);
  const expected = observation.owner;
  const sameOwner =
    owner?.token === expected?.token &&
    owner?.pid === expected?.pid &&
    owner?.createdAt === expected?.createdAt;
  return sameOwner && isStale(owner, Number(pinned.mtimeMs), policy);
}
