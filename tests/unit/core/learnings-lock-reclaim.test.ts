/** Stale-lock reclaim must never delete a lock it did not judge stale. */
import { spawnSync } from "node:child_process";
import { link, lstat, readFile, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  observeStaleLock,
  reclaimObservedStaleLock,
} from "../../../src/core/learnings-lock.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

/**
 * Produce a process id that is certainly no longer running.
 * @returns Reaped child process id
 */
function reapedPid(): number {
  const child = spawnSync(process.execPath, ["-e", "0"]);
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
});

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
