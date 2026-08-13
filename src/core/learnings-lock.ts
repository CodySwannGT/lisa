/** Cross-process serialization for project learnings writes. */
import { randomInt } from "node:crypto";
import { link, readFile, unlink, writeFile } from "node:fs/promises";
import {
  withReclaimCapability,
  type LockGenerationIdentity,
} from "./learnings-lock-capability.js";
import {
  isProcessLive,
  removeFileIfPresent,
  statFile,
} from "./learnings-lock-fs.js";

const STALE_LOCK_MS = 30_000;
/**
 * Wall-clock budget for one acquisition. This used to be a fixed 200-attempt
 * count, which made the real waiting time a function of how fast the machine
 * could spin the retry loop: on a loaded machine every attempt costs more, so
 * the same 200 attempts bought a different amount of waiting on every run and a
 * waiter abandoned locks that were still legitimately held
 * (CodySwannGT/lisa#2474). The budget is deliberately not shorter than
 * `STALE_LOCK_MS`: a waiter that gave up sooner could expire before the stale
 * lock it is waiting on ever became reclaimable.
 */
const LOCK_ACQUIRE_TIMEOUT_MS = 30_000;
const LOCK_RETRY_DELAY_MS = 10;
/**
 * Jitter added to each retry so contenders that lost the same race do not wake
 * in lockstep and collide again on the next one.
 */
const LOCK_RETRY_JITTER_MS = 10;
/**
 * Attempts between stale-lock probes. Probing costs a stat plus a read, and a
 * lock cannot become stale between two consecutive 10ms retries, so probing on
 * every attempt only multiplies filesystem pressure under contention — which is
 * exactly when the lock is hardest to acquire. Attempt zero always probes so a
 * lock left behind by a dead writer is still reclaimed immediately.
 */
const STALE_PROBE_ATTEMPT_INTERVAL = 25;

/** Ownership metadata published atomically with each lock. */
interface LockOwner {
  readonly token: string;
  readonly pid: number;
  readonly createdAt: number;
}

/** Owner metadata plus the retained hard link proving inode ownership. */
interface LockLease {
  readonly owner: LockOwner;
  readonly ownerPath: string;
}

/**
 * Serialize same-target writers across processes with an exclusive hard link.
 * @param target - Absolute learnings target
 * @param operation - Complete read, validate, and atomic-write transaction
 * @returns Operation result
 */
export async function withLearningTargetLock<T>(
  target: string,
  operation: () => Promise<T>
): Promise<T> {
  return withFileTargetLock(target, operation);
}

/**
 * Serialize same-target file transactions across processes.
 * @param target - Absolute target whose adjacent lock is acquired
 * @param operation - Transaction performed while the caller owns the lock
 * @returns Operation result
 */
export async function withFileTargetLock<T>(
  target: string,
  operation: () => Promise<T>
): Promise<T> {
  const lockPath = `${target}.lock`;
  const owner = {
    token: crypto.randomUUID(),
    pid: process.pid,
    createdAt: Date.now(),
  } as const;
  const lease = await acquireLock(lockPath, owner);
  try {
    return await operation();
  } finally {
    await releaseLock(lockPath, lease);
  }
}

/**
 * Publish complete owner metadata atomically via a hard link.
 *
 * The owner file is written once and then re-linked on every retry. Rewriting
 * and deleting it per attempt cost two extra filesystem operations for every
 * contender on every 10ms tick, which is pure amplification precisely when the
 * filesystem is already the contended resource.
 * @param lockPath - Shared lock path
 * @param owner - Unique owner metadata
 * @returns Acquired lock lease
 */
async function acquireLock(
  lockPath: string,
  owner: LockOwner
): Promise<LockLease> {
  const ownerPath = `${lockPath}.${owner.token}.owner`;
  await writeOwnerFile(ownerPath, owner);
  try {
    return await linkOwnerBeforeDeadline(
      lockPath,
      owner,
      Date.now() + LOCK_ACQUIRE_TIMEOUT_MS,
      0
    );
  } catch (error) {
    await removeFileIfPresent(ownerPath);
    throw error;
  }
}

/**
 * Retry publication until the lock is acquired or the wall-clock budget ends.
 * @param lockPath - Shared lock path
 * @param owner - Unique owner metadata
 * @param expiresAt - Absolute wall-clock end of the acquisition budget
 * @param attempt - Current retry count, used only to pace stale probes
 * @returns Acquired lock lease
 */
async function linkOwnerBeforeDeadline(
  lockPath: string,
  owner: LockOwner,
  expiresAt: number,
  attempt: number
): Promise<LockLease> {
  const ownerPath = `${lockPath}.${owner.token}.owner`;
  const outcome = await tryPublishOwnerLink(ownerPath, lockPath);
  if (outcome === "acquired") {
    return { owner, ownerPath };
  }
  if (Date.now() >= expiresAt) {
    throw new Error(`Timed out waiting for file lock: ${lockPath}`);
  }
  if (outcome === "source-missing") {
    await writeOwnerFile(ownerPath, owner);
  }
  if (attempt % STALE_PROBE_ATTEMPT_INTERVAL === 0) {
    await reclaimStaleLock(lockPath);
  }
  await delay(LOCK_RETRY_DELAY_MS + randomInt(0, LOCK_RETRY_JITTER_MS + 1));
  return linkOwnerBeforeDeadline(lockPath, owner, expiresAt, attempt + 1);
}

/**
 * Write owner metadata exclusively so two writers can never share one file.
 * @param ownerPath - Per-call owner metadata path
 * @param owner - Unique owner metadata
 */
async function writeOwnerFile(
  ownerPath: string,
  owner: LockOwner
): Promise<void> {
  await writeFile(ownerPath, JSON.stringify(owner), {
    encoding: "utf8",
    flag: "wx",
  });
}

/** Result of one hard-link publication attempt. */
type PublishOutcome = "acquired" | "destination-held" | "source-missing";

/**
 * Try to hard-link fully written owner metadata into the lock path.
 * @param ownerPath - Fully written owner metadata file
 * @param lockPath - Destination lock path
 * @returns Why publication succeeded or failed
 */
async function tryPublishOwnerLink(
  ownerPath: string,
  lockPath: string
): Promise<PublishOutcome> {
  try {
    await link(ownerPath, lockPath);
    return "acquired";
  } catch (error) {
    const { code } = error as NodeJS.ErrnoException;
    if (code === "EEXIST") {
      return "destination-held";
    }
    if (code === "ENOENT") {
      return "source-missing";
    }
    throw error;
  }
}

/**
 * Publish owner metadata, reporting only whether the lock was taken.
 *
 * The acquisition path needs to tell "someone else holds it" apart from "my own
 * owner file went missing", so the outcome lives in
 * {@link tryPublishOwnerLink}. The reclaim path only ever asks the yes/no
 * question, and keeping this wrapper leaves that call site untouched.
 * @param ownerPath - Fully written owner metadata file
 * @param lockPath - Destination lock path
 * @returns Whether publication acquired the lock
 */
async function publishOwnerLink(
  ownerPath: string,
  lockPath: string
): Promise<boolean> {
  return (await tryPublishOwnerLink(ownerPath, lockPath)) === "acquired";
}

/**
 * Remove only the lock inode still linked to this lease's owner file.
 * @param lockPath - Shared lock path
 * @param lease - Owner lease retaining the same inode
 */
async function releaseLock(lockPath: string, lease: LockLease): Promise<void> {
  try {
    if (await sameFile(lockPath, lease.ownerPath)) {
      await unlink(lockPath);
    }
  } finally {
    await removeFileIfPresent(lease.ownerPath);
  }
}

/**
 * Snapshot of one lock observed to be reclaimable. The reclaim is anchored to
 * this snapshot: a lock is only ever deleted while it still *is* the exact
 * inode and ownership this observation judged stale.
 */
export interface StaleLockObservation {
  /** Owner metadata when the lock was parseable; undefined when unowned. */
  readonly owner: LockOwner | undefined;
  /** Device of the inode that was judged stale. */
  readonly dev: number;
  /** Inode that was judged stale. */
  readonly ino: number;
}

/**
 * Reclaim an expired lock only when its declared process is no longer live.
 * @param lockPath - Shared lock path
 */
async function reclaimStaleLock(lockPath: string): Promise<void> {
  const observation = await observeStaleLock(lockPath);
  if (observation === null) {
    return;
  }
  await reclaimObservedStaleLock(lockPath, observation);
}

/**
 * Determine whether a regular lock is reclaimable and retain its owner path.
 * @param lockPath - Shared lock path
 * @returns Observation of a reclaimable lock, or null when it is still held
 */
export async function observeStaleLock(
  lockPath: string
): Promise<StaleLockObservation | null> {
  const before = await statFile(lockPath);
  if (before === undefined) {
    return null;
  }
  if (!before.isFile() || before.isSymbolicLink()) {
    throw new Error(`Unsafe file lock path: ${lockPath}`);
  }
  const owner = await readLockOwner(lockPath);
  const timestamp = owner?.createdAt ?? Number(before.mtimeMs);
  if (owner !== undefined && isProcessLive(owner.pid)) {
    return null;
  }
  if (owner === undefined && Date.now() - timestamp <= STALE_LOCK_MS) {
    return null;
  }
  return { owner, dev: Number(before.dev), ino: Number(before.ino) };
}

/**
 * Reclaim only the same lock inode retained in a safe quarantine link.
 *
 * Proving the lock is still the inode judged stale and unlinking it are two
 * syscalls, and POSIX has no "unlink only if still this inode". Every reclaimer
 * that passed the proof therefore used to unlink whatever sat at the path
 * afterwards — including a lock a live writer had legitimately acquired in
 * between, which left two writers holding one "exclusive" lock and silently
 * dropped a learning (CodySwannGT/lisa#2488). That gap is closed by holding the
 * generation's exclusive reclaim capability across both syscalls; see
 * `learnings-lock-capability.ts` for why this cannot interleave rather than
 * merely interleaving rarely.
 * @param lockPath - Shared lock path
 * @param observation - Snapshot that judged this lock reclaimable
 * @returns Whether the observed lock was reclaimed
 */
export async function reclaimObservedStaleLock(
  lockPath: string,
  observation: StaleLockObservation
): Promise<boolean> {
  return withReclaimCapability(
    lockPath,
    observedGenerationIdentity(observation),
    false,
    async () => deleteObservedGeneration(lockPath, observation)
  );
}

/**
 * Describe the observed generation for the capability that guards it.
 * @param observation - Snapshot that judged the lock reclaimable
 * @returns Identity of the generation this reclaim may delete
 */
function observedGenerationIdentity(
  observation: StaleLockObservation
): LockGenerationIdentity {
  return {
    dev: observation.dev,
    ino: observation.ino,
    token: observation.owner?.token,
    pid: observation.owner?.pid,
    createdAt: observation.owner?.createdAt,
  };
}

/**
 * Delete the observed lock generation while its reclaim capability is held.
 * @param lockPath - Shared lock path
 * @param observation - Snapshot that judged this lock reclaimable
 * @returns Whether the observed lock was reclaimed
 */
async function deleteObservedGeneration(
  lockPath: string,
  observation: StaleLockObservation
): Promise<boolean> {
  // Pin whatever currently sits at the lock path so its inode cannot be
  // recycled underneath the checks below, then prove it is still the very
  // inode and ownership this observation judged stale before deleting it.
  const quarantine = `${lockPath}.${crypto.randomUUID()}.stale`;
  if (!(await publishOwnerLink(lockPath, quarantine))) {
    return false;
  }
  try {
    if (!(await pinnedLockStillStale(lockPath, quarantine, observation))) {
      return false;
    }
    await removeFileIfPresent(lockPath);
    if (observation.owner !== undefined) {
      await removeFileIfPresent(`${lockPath}.${observation.owner.token}.owner`);
    }
    return true;
  } finally {
    await removeFileIfPresent(quarantine);
  }
}

/**
 * Confirm the pinned inode is still the lock this observation judged stale.
 * Identity alone is not enough: a released inode can be recycled by a live
 * holder, so the pinned ownership must still match the observed ownership.
 * @param lockPath - Shared lock path
 * @param quarantine - Hard link pinning the inode currently at the lock path
 * @param observation - Snapshot that judged the lock reclaimable
 * @returns Whether the pinned lock is still safe to delete
 */
async function pinnedLockStillStale(
  lockPath: string,
  quarantine: string,
  observation: StaleLockObservation
): Promise<boolean> {
  const pinned = await statFile(quarantine);
  if (
    pinned === undefined ||
    !pinned.isFile() ||
    Number(pinned.dev) !== observation.dev ||
    Number(pinned.ino) !== observation.ino ||
    !(await sameFile(lockPath, quarantine))
  ) {
    return false;
  }
  const owner = await readLockOwner(quarantine);
  if (observation.owner === undefined) {
    return (
      owner === undefined && Date.now() - Number(pinned.mtimeMs) > STALE_LOCK_MS
    );
  }
  return (
    owner !== undefined &&
    owner.token === observation.owner.token &&
    owner.pid === observation.owner.pid &&
    owner.createdAt === observation.owner.createdAt &&
    !isProcessLive(owner.pid)
  );
}

/**
 * Read bounded owner metadata; partial or special lock files are unowned.
 * @param lockPath - Shared lock path
 * @returns Parsed owner or undefined
 */
async function readLockOwner(lockPath: string): Promise<LockOwner | undefined> {
  const metadata = await statFile(lockPath);
  if (metadata === undefined || !metadata.isFile() || metadata.size > 512) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(await readFile(lockPath, "utf8")) as unknown;
    return isLockOwner(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Compare two regular-file paths by device and inode.
 * @param left - First file path
 * @param right - Second file path
 * @returns Whether both paths retain the same regular-file inode
 */
async function sameFile(left: string, right: string): Promise<boolean> {
  const [leftStat, rightStat] = await Promise.all([
    statFile(left),
    statFile(right),
  ]);
  return (
    leftStat !== undefined &&
    rightStat !== undefined &&
    leftStat.isFile() &&
    rightStat.isFile() &&
    leftStat.dev === rightStat.dev &&
    leftStat.ino === rightStat.ino
  );
}

/**
 * Narrow parsed lock metadata to the exact ownership shape.
 * @param value - Parsed metadata
 * @returns Whether the metadata is a lock owner
 */
function isLockOwner(value: unknown): value is LockOwner {
  if (
    value === null ||
    typeof value !== "object" ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    return false;
  }
  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== 3 ||
    keys.some(
      key =>
        typeof key !== "string" || !["token", "pid", "createdAt"].includes(key)
    )
  ) {
    return false;
  }
  const owner = value as Partial<LockOwner>;
  return (
    typeof owner.token === "string" &&
    /^[A-Za-z0-9-]{1,128}$/u.test(owner.token) &&
    typeof owner.pid === "number" &&
    Number.isSafeInteger(owner.pid) &&
    owner.pid > 0 &&
    typeof owner.createdAt === "number" &&
    Number.isSafeInteger(owner.createdAt)
  );
}

/**
 * Await a short retry delay without blocking the event loop.
 * @param milliseconds - Delay duration
 */
async function delay(milliseconds: number): Promise<void> {
  await new Promise<void>(resolve => {
    setTimeout(resolve, milliseconds);
  });
}
