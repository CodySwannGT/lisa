/**
 * The exclusive right to delete one stale lock generation.
 *
 * Deleting a stale lock is a two-syscall sequence — prove the path still holds
 * the inode judged stale, then unlink it — and POSIX offers no "unlink only if
 * still this inode". Narrowing that window is not a fix
 * (CodySwannGT/lisa#2488): a second reclaimer whose proof predated the first
 * one's unlink deleted whichever lock had *since* been acquired at the path, so
 * two writers held the same "exclusive" lock, both read the ledger, and one
 * learning vanished with no error at all.
 *
 * The window is closed by making the RIGHT to delete a generation exclusive
 * rather than by shrinking the window. This module publishes that right as a
 * capability file created with `O_CREAT|O_EXCL`, at a path that is a pure
 * function of the generation's identity.
 * @module core/learnings-lock-capability
 */
import { createHash } from "node:crypto";
import { readFile, rename, writeFile } from "node:fs/promises";
import {
  isProcessLive,
  removeFileIfPresent,
  statFile,
} from "./learnings-lock-fs.js";

/** Identity of one lock generation, as observed by a would-be reclaimer. */
export interface LockGenerationIdentity {
  /** Device of the inode judged stale. */
  readonly dev: number;
  /** Inode judged stale. */
  readonly ino: number;
  /** Owner token when the lock was parseable; undefined when unowned. */
  readonly token: string | undefined;
  /** Owner pid when the lock was parseable. */
  readonly pid: number | undefined;
  /** Owner creation timestamp when the lock was parseable. */
  readonly createdAt: number | undefined;
}

/** Recorded holder of one generation's reclaim capability. */
interface ReclaimHolder {
  readonly pid: number;
  readonly createdAt: number;
}

/**
 * Run an operation while holding the sole right to delete one lock generation.
 *
 * The capability is what makes the caller's verify-then-unlink safe, and the
 * argument is not probabilistic:
 *
 * 1. Two reclaimers that observed the same lock derive the same capability
 *    path — dev, ino, and the owner triple are immutable for a lock file's
 *    lifetime, since owner metadata is written in full *before* it is linked
 *    into place and never rewritten — and the exclusive create admits exactly
 *    one of them. The loser deletes nothing at all.
 * 2. The lock path can therefore only change while the capability is held if
 *    its own owner released it, and the caller has already proven that owner's
 *    process is gone. A dead process performs no unlink.
 * 3. An acquisition cannot intervene either: acquiring requires the lock path
 *    to be free, and freeing it requires one of the two deletions ruled out
 *    above.
 *
 * So between the caller's proof and its unlink, the lock path still holds
 * exactly the generation that was proven stale. This cannot interleave.
 *
 * Never spins: a live contender means someone else is already reclaiming this
 * very generation, so `whenContended` is returned immediately and the caller's
 * own acquire loop — which owns the wall-clock budget — does the waiting.
 * @param lockPath - Shared lock path
 * @param identity - Identity of the generation to be deleted
 * @param whenContended - Result to return when another live holder has it
 * @param operation - Work performed while the capability is held
 * @returns The operation's result, or `whenContended`
 */
export async function withReclaimCapability<T>(
  lockPath: string,
  identity: LockGenerationIdentity,
  whenContended: T,
  operation: () => Promise<T>
): Promise<T> {
  const capability = reclaimCapabilityPath(lockPath, identity);
  if (!(await claimReclaimCapability(capability))) {
    return whenContended;
  }
  try {
    return await operation();
  } finally {
    await removeFileIfPresent(capability);
  }
}

/**
 * Derive the capability path guarding one lock generation.
 *
 * The name is a pure function of the observed identity, so every observer of
 * the same lock contends for the same path and no observer of a *different*
 * lock is ever excluded by it. A hash collision would only serialize more
 * reclaimers, never fewer, so it would cost liveness and never safety.
 * @param lockPath - Shared lock path
 * @param identity - Identity of the generation to be deleted
 * @returns Capability path for that generation
 */
function reclaimCapabilityPath(
  lockPath: string,
  identity: LockGenerationIdentity
): string {
  const serialized = JSON.stringify([
    identity.dev,
    identity.ino,
    identity.token ?? null,
    identity.pid ?? null,
    identity.createdAt ?? null,
  ]);
  const digest = createHash("sha256").update(serialized).digest("hex");
  return `${lockPath}.${digest.slice(0, 32)}.reclaim`;
}

/**
 * Take the capability, recovering it only from a provably dead holder.
 * @param capability - Generation-scoped capability path
 * @returns Whether this process now holds the capability
 */
async function claimReclaimCapability(capability: string): Promise<boolean> {
  if (await createReclaimCapability(capability)) {
    return true;
  }
  if (!(await breakDeadReclaimCapability(capability))) {
    return false;
  }
  return createReclaimCapability(capability);
}

/**
 * Publish this process as the capability holder with an exclusive create.
 * @param capability - Generation-scoped capability path
 * @returns Whether the exclusive create succeeded
 */
async function createReclaimCapability(capability: string): Promise<boolean> {
  const holder = { pid: process.pid, createdAt: Date.now() } as const;
  try {
    await writeFile(capability, JSON.stringify(holder), {
      encoding: "utf8",
      flag: "wx",
    });
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      return false;
    }
    throw error;
  }
}

/**
 * Release a capability abandoned by a reclaimer that crashed mid-reclaim.
 *
 * Only an `ESRCH`-dead holder is ever displaced, because a dead process
 * executes no unlink — so displacing it cannot produce a second live deleter,
 * which is the entire property this capability exists to guarantee. A holder
 * that is alive, unreadable, or merely old is left alone: the lock then stays
 * unreclaimable and writers fail loudly against their acquire budget, which is
 * strictly better than the silent lost write being guarded against.
 *
 * The displacement itself is a single rename — atomic, and conditional on the
 * source still existing — so concurrent breakers cannot both win. The freed
 * capability is then re-taken by whoever wins the exclusive create, which is
 * not necessarily this process.
 * @param capability - Generation-scoped capability path
 * @returns Whether the capability was freed and may be re-taken
 */
async function breakDeadReclaimCapability(
  capability: string
): Promise<boolean> {
  const holder = await readReclaimHolder(capability);
  if (holder === undefined || isProcessLive(holder.pid)) {
    return false;
  }
  const discarded = `${capability}.${crypto.randomUUID()}.broken`;
  try {
    await rename(capability, discarded);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return true;
    }
    throw error;
  }
  await removeFileIfPresent(discarded);
  return true;
}

/**
 * Read bounded capability-holder metadata; anything else is unreadable.
 * @param capability - Generation-scoped capability path
 * @returns Parsed holder, or undefined when it cannot be trusted
 */
async function readReclaimHolder(
  capability: string
): Promise<ReclaimHolder | undefined> {
  const metadata = await statFile(capability);
  if (metadata === undefined || !metadata.isFile() || metadata.size > 512) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(await readFile(capability, "utf8")) as unknown;
    return isReclaimHolder(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Narrow parsed capability metadata to the exact holder shape.
 * @param value - Parsed metadata
 * @returns Whether the metadata is a reclaim holder
 */
function isReclaimHolder(value: unknown): value is ReclaimHolder {
  if (
    value === null ||
    typeof value !== "object" ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    return false;
  }
  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== 2 ||
    keys.some(
      key => typeof key !== "string" || !["pid", "createdAt"].includes(key)
    )
  ) {
    return false;
  }
  const holder = value as Partial<ReclaimHolder>;
  return (
    typeof holder.pid === "number" &&
    Number.isSafeInteger(holder.pid) &&
    holder.pid > 0 &&
    typeof holder.createdAt === "number" &&
    Number.isSafeInteger(holder.createdAt)
  );
}
