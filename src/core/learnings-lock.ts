/** Cross-process serialization for project learnings writes. */
import {
  link,
  lstat,
  readFile,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";

const MAX_LOCK_ATTEMPTS = 200;
const LOCK_RETRY_DELAY_MS = 10;
const STALE_LOCK_MS = 30_000;

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
  const lease = await acquireLock(lockPath, owner, 0);
  try {
    return await operation();
  } finally {
    await releaseLock(lockPath, lease);
  }
}

/**
 * Publish complete owner metadata atomically via a hard link.
 * @param lockPath - Shared lock path
 * @param owner - Unique owner metadata
 * @param attempt - Current retry count
 * @returns Acquired lock lease
 */
async function acquireLock(
  lockPath: string,
  owner: LockOwner,
  attempt: number
): Promise<LockLease> {
  const ownerPath = `${lockPath}.${owner.token}.owner`;
  await writeFile(ownerPath, JSON.stringify(owner), {
    encoding: "utf8",
    flag: "wx",
  });
  const acquired = await publishOwnerLink(ownerPath, lockPath);
  if (acquired) {
    return { owner, ownerPath };
  }
  await removeFileIfPresent(ownerPath);
  if (attempt >= MAX_LOCK_ATTEMPTS) {
    throw new Error(`Timed out waiting for file lock: ${lockPath}`);
  }
  await reclaimStaleLock(lockPath);
  await delay(LOCK_RETRY_DELAY_MS);
  return acquireLock(lockPath, owner, attempt + 1);
}

/**
 * Try to hard-link fully written owner metadata into the lock path.
 * @param ownerPath - Fully written owner metadata file
 * @param lockPath - Destination lock path
 * @returns Whether publication acquired the lock
 */
async function publishOwnerLink(
  ownerPath: string,
  lockPath: string
): Promise<boolean> {
  try {
    await link(ownerPath, lockPath);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EEXIST" || code === "ENOENT") {
      return false;
    }
    throw error;
  }
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
 * A stale lock detached into a private name and re-verified as the exact inode
 * this observation judged reclaimable. Detaching by rename frees the shared
 * lock path atomically, so removal only ever deletes this private claim — never
 * the shared path a live acquirer may already have relinked.
 */
export interface PinnedStaleLock {
  /** Private name holding the detached, judged-stale inode. */
  readonly claim: string;
  /** Shared lock path whose dead owner sidecar is cleaned up on removal. */
  readonly lockPath: string;
  /** Snapshot that judged this lock reclaimable. */
  readonly observation: StaleLockObservation;
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
 * Reclaim only the exact inode this observation judged stale, by detaching it
 * into a private claim before deleting it so the shared path is never unlinked.
 * @param lockPath - Shared lock path
 * @param observation - Snapshot that judged this lock reclaimable
 * @returns Whether the observed lock was reclaimed
 */
export async function reclaimObservedStaleLock(
  lockPath: string,
  observation: StaleLockObservation
): Promise<boolean> {
  const pinned = await pinObservedStaleLock(lockPath, observation);
  if (pinned === null) {
    return false;
  }
  return removePinnedStaleLock(pinned);
}

/**
 * Detach the lock path into a private claim and prove the detached inode is
 * still the very inode and ownership this observation judged stale.
 *
 * A bare `unlink(lockPath)` after an identity check is a residual theft race:
 * between the check and the syscall another process can free the path and a
 * live acquirer can relink a *different* inode there, so the unlink deletes a
 * live lock. Detaching via `rename(lockPath, claim)` is atomic — exactly one
 * reclaimer moves a given entry and the shared path is freed in the same step —
 * so removal never has to unlink the shared path by name. A detached inode that
 * is not the judged-stale one belongs to a live re-acquire, so it is restored
 * to the path (or left reachable through its own sidecar) and nothing is lost.
 * @param lockPath - Shared lock path
 * @param observation - Snapshot that judged this lock reclaimable
 * @returns Pinned stale lock, or null when the path is no longer that lock
 */
export async function pinObservedStaleLock(
  lockPath: string,
  observation: StaleLockObservation
): Promise<PinnedStaleLock | null> {
  const claim = `${lockPath}.${crypto.randomUUID()}.claim`;
  if (!(await renameIfPresent(lockPath, claim))) {
    return null;
  }
  if (await claimStillStale(claim, observation)) {
    return { claim, lockPath, observation };
  }
  await linkIfAbsent(claim, lockPath);
  await removeFileIfPresent(claim);
  return null;
}

/**
 * Delete the detached, judged-stale inode. The shared lock path was freed when
 * the inode was detached, so this only removes the private claim and the dead
 * owner sidecar — it can never delete a live re-acquire sitting at the path.
 * @param pinned - Stale lock detached and re-verified for reclamation
 * @returns Whether the pinned lock was reclaimed
 */
export async function removePinnedStaleLock(
  pinned: PinnedStaleLock
): Promise<boolean> {
  const { claim, lockPath, observation } = pinned;
  await removeFileIfPresent(claim);
  if (observation.owner !== undefined) {
    await removeFileIfPresent(`${lockPath}.${observation.owner.token}.owner`);
  }
  return true;
}

/**
 * Atomically move a path to a private name, tolerating an already-gone source.
 * @param from - Source path to detach
 * @param to - Private destination that captures the detached inode
 * @returns Whether an entry was moved (false when the source was already gone)
 */
async function renameIfPresent(from: string, to: string): Promise<boolean> {
  try {
    await rename(from, to);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

/**
 * Hard-link a source to a destination only when the destination is free.
 * @param from - Existing source inode
 * @param to - Destination path to restore when absent
 */
async function linkIfAbsent(from: string, to: string): Promise<void> {
  try {
    await link(from, to);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "EEXIST" && code !== "ENOENT") {
      throw error;
    }
  }
}

/**
 * Confirm the detached inode is still the lock this observation judged stale.
 * Identity alone is not enough: a released inode can be recycled by a live
 * holder, so the detached ownership must still match the observed ownership.
 * @param claim - Private name holding the detached inode
 * @param observation - Snapshot that judged the lock reclaimable
 * @returns Whether the detached inode is still safe to delete
 */
async function claimStillStale(
  claim: string,
  observation: StaleLockObservation
): Promise<boolean> {
  const detached = await statFile(claim);
  if (
    detached === undefined ||
    !detached.isFile() ||
    Number(detached.dev) !== observation.dev ||
    Number(detached.ino) !== observation.ino
  ) {
    return false;
  }
  const owner = await readLockOwner(claim);
  if (observation.owner === undefined) {
    return (
      owner === undefined &&
      Date.now() - Number(detached.mtimeMs) > STALE_LOCK_MS
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
 * Read file metadata without treating an absent path as an error.
 * @param filePath - Filesystem path
 * @returns File metadata or undefined
 */
async function statFile(
  filePath: string
): Promise<Awaited<ReturnType<typeof lstat>> | undefined> {
  try {
    return await lstat(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

/**
 * Remove one path without recursive deletion.
 * @param filePath - Regular file or hard-link path
 */
async function removeFileIfPresent(filePath: string): Promise<void> {
  try {
    await unlink(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
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
 * Treat permission-denied PID probes as live and missing PIDs as dead.
 * @param pid - Declared owner process id
 * @returns Whether the process may still be alive
 */
function isProcessLive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
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
