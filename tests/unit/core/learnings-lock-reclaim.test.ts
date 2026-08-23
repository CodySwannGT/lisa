/** Stale-lock reclaim must never delete a lock it did not judge stale. */
import { link, lstat, readdir, readFile, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  observeStaleLock,
  reclaimObservedStaleLock,
  type StaleLockObservation,
} from "../../../src/core/learnings-lock.js";
import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

/**
 * Produce a process id that is certainly no longer running.
 * @returns Reaped child process id
 */
function reapedPid(): number {
  const child = boundedSpawnSync({
    label: "node -e 0 probe process",
    command: process.execPath,
    args: ["-e", "0"],
  });
  if (child.pid === undefined) {
    throw new Error("Could not spawn a probe process");
  }
  return child.pid;
}

/**
 * Publish a lock exactly as the acquire path does: owner metadata written to a
 * token sidecar, then hard-linked into the shared lock path.
 * @param lockPath - Shared lock path
 * @param pid - Process id recorded as the lock owner
 * @param createdAt - Lock creation timestamp
 * @returns Owner token and sidecar path
 */
async function publishLock(
  lockPath: string,
  pid: number,
  createdAt: number = Date.now()
): Promise<{ readonly token: string; readonly ownerPath: string }> {
  const token = crypto.randomUUID();
  const ownerPath = `${lockPath}.${token}.owner`;
  await writeFile(ownerPath, JSON.stringify({ token, pid, createdAt }), {
    encoding: "utf8",
    flag: "wx",
  });
  await link(ownerPath, lockPath);
  return { token, ownerPath };
}

describe("stale lock reclaim", () => {
  let tempDir: string;
  let lockPath: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
    lockPath = path.join(tempDir, "TARGET.md.lock");
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  it("does not judge a live owner's lock stale", async () => {
    await publishLock(lockPath, process.pid);
    expect(await observeStaleLock(lockPath)).toBeNull();
  });

  it("does not judge a freshly created unowned lock stale", async () => {
    await writeFile(lockPath, "not-json-owner-metadata", { encoding: "utf8" });
    expect(await observeStaleLock(lockPath)).toBeNull();
  });

  it("does not judge an absent lock stale", async () => {
    expect(await observeStaleLock(lockPath)).toBeNull();
  });

  it("reclaims a lock abandoned by a dead owner", async () => {
    const { ownerPath } = await publishLock(lockPath, reapedPid());
    const observation = await observeStaleLock(lockPath);
    expect(observation).not.toBeNull();

    expect(await reclaimObservedStaleLock(lockPath, observation!)).toBe(true);
    await expect(lstat(lockPath)).rejects.toThrow(/ENOENT/u);
    await expect(lstat(ownerPath)).rejects.toThrow(/ENOENT/u);
  });

  it("leaves a live holder's lock intact when the judged lock was already released", async () => {
    // A dead owner's lock is observed as stale...
    const stale = await publishLock(lockPath, reapedPid());
    const observation = await observeStaleLock(lockPath);
    expect(observation).not.toBeNull();

    // ...but before the reclaim lands, that lock is released and a LIVE holder
    // acquires the very same path. This is the cross-process race: the reclaim
    // decision is older than the lock now sitting at `lockPath`.
    await removeQuietly(lockPath);
    await removeQuietly(stale.ownerPath);
    const live = await publishLock(lockPath, process.pid);

    expect(await reclaimObservedStaleLock(lockPath, observation!)).toBe(false);

    // The live holder still owns an intact lock linked to its own sidecar.
    const [lockStat, ownerStat] = await Promise.all([
      lstat(lockPath),
      lstat(live.ownerPath),
    ]);
    expect(lockStat.ino).toBe(ownerStat.ino);
    expect(JSON.parse(await readFile(lockPath, "utf8"))).toMatchObject({
      token: live.token,
      pid: process.pid,
    });
  });

  it("leaves a live holder's lock intact when only the judged sidecar is gone", async () => {
    // The exact production interleaving: the observed owner released (removing
    // its sidecar) and exited, so its sidecar is missing while a live holder's
    // lock now occupies the path. The old fallback quarantined whatever sat at
    // `lockPath`, which deleted the live lock.
    const stale = await publishLock(lockPath, reapedPid());
    const observation = await observeStaleLock(lockPath);
    expect(observation).not.toBeNull();

    await removeQuietly(stale.ownerPath);
    await removeQuietly(lockPath);
    const live = await publishLock(lockPath, process.pid);

    expect(await reclaimObservedStaleLock(lockPath, observation!)).toBe(false);
    expect(JSON.parse(await readFile(lockPath, "utf8"))).toMatchObject({
      token: live.token,
    });
  });

  it("admits exactly one deleter when several reclaimers share one observation", async () => {
    // The CodySwannGT/lisa#2488 race: proving the lock is still the inode
    // judged stale and unlinking it are two syscalls, so every reclaimer that
    // proved it used to unlink whatever sat there afterwards — including a
    // lock a live writer had legitimately acquired in between. Exclusivity per
    // generation is what makes that impossible, so it is asserted directly:
    // more than one `true` here IS the data-loss bug.
    await publishLock(lockPath, reapedPid());
    const observation = await observeStaleLock(lockPath);
    expect(observation).not.toBeNull();

    const reclaimed = await Promise.all(
      Array.from({ length: 8 }, async () =>
        reclaimObservedStaleLock(lockPath, observation!)
      )
    );

    expect(reclaimed.filter(Boolean)).toHaveLength(1);
    await expect(lstat(lockPath)).rejects.toThrow(/ENOENT/u);
  });

  it("refuses to reclaim while another live process holds the capability", async () => {
    await publishLock(lockPath, reapedPid());
    const observation = await observeStaleLock(lockPath);
    await writeFile(
      await capabilityPathFor(lockPath, observation!),
      JSON.stringify({ pid: process.pid, createdAt: Date.now() }),
      { encoding: "utf8", flag: "wx" }
    );

    expect(await reclaimObservedStaleLock(lockPath, observation!)).toBe(false);
    await expect(lstat(lockPath)).resolves.toBeDefined();
  });

  it("recovers a capability abandoned by a crashed reclaimer", async () => {
    // A crash between taking the capability and deleting the lock must not
    // wedge the generation forever: a holder whose process is provably gone
    // executes no unlink, so displacing it cannot create a second deleter.
    await publishLock(lockPath, reapedPid());
    const observation = await observeStaleLock(lockPath);
    const capability = await capabilityPathFor(lockPath, observation!);
    await writeFile(
      capability,
      JSON.stringify({ pid: reapedPid(), createdAt: Date.now() - 60_000 }),
      { encoding: "utf8", flag: "wx" }
    );

    expect(await reclaimObservedStaleLock(lockPath, observation!)).toBe(true);
    await expect(lstat(lockPath)).rejects.toThrow(/ENOENT/u);
    await expect(lstat(capability)).rejects.toThrow(/ENOENT/u);
  });

  it("leaves no capability or quarantine litter behind after a reclaim", async () => {
    await publishLock(lockPath, reapedPid());
    const observation = await observeStaleLock(lockPath);

    expect(await reclaimObservedStaleLock(lockPath, observation!)).toBe(true);

    const leftovers = (await readdir(tempDir)).filter(
      name => name.endsWith(".reclaim") || name.endsWith(".stale")
    );
    expect(leftovers).toEqual([]);
  });
});

/**
 * Re-derive the capability path the reclaim path computes for an observation.
 * Deliberately recomputed from the public observation rather than exported, so
 * a change to the naming scheme fails these tests instead of hiding behind a
 * shared helper.
 * @param lockPath - Shared lock path
 * @param observation - Snapshot that judged the lock reclaimable
 * @returns Capability path guarding that generation
 */
async function capabilityPathFor(
  lockPath: string,
  observation: StaleLockObservation
): Promise<string> {
  const { createHash } = await import("node:crypto");
  const identity = JSON.stringify([
    observation.dev,
    observation.ino,
    observation.owner?.token ?? null,
    observation.owner?.pid ?? null,
    observation.owner?.createdAt ?? null,
  ]);
  const digest = createHash("sha256").update(identity).digest("hex");
  return `${lockPath}.${digest.slice(0, 32)}.reclaim`;
}

/**
 * Delete one path, tolerating an already-absent file.
 * @param filePath - Path to remove
 */
async function removeQuietly(filePath: string): Promise<void> {
  const { unlink } = await import("node:fs/promises");
  try {
    await unlink(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
}
