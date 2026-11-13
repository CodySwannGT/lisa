/**
 * Recovery-path tests for the ledger lock (CodySwannGT/lisa#4828): which
 * leftover locks a writer may clear, which it must leave alone, and that a
 * failed release never hides what the write itself did.
 *
 * The rule under test is "a live holder is never broken". A lock is cleared
 * only when nothing alive can own it: its pid is dead, it was created before
 * this boot (so its pid may since have been reused by an unrelated process),
 * or its owner record is unreadable and the file has not changed for 30s.
 * @module tests/unit/session-manager/ledger-lock-recovery
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ledgerPath,
  readLedger,
  updateLedger,
} from "../../../plugins/src/base/skills/lisa-session-manager/scripts/ledger.mjs";

/** A short acquisition budget for tests that expect a timeout. */
const SHORT_MS = 150;

/**
 * Transform that records one key in `cyclers`.
 * @param key - Key to add
 * @returns Pure ledger update
 */
function addKey(key: string) {
  return (ledger: Awaited<ReturnType<typeof readLedger>>, at: string) => ({
    ledger: { ...ledger, cyclers: { ...ledger.cyclers, [key]: at } },
    result: key,
  });
}

/**
 * A pid that belonged to a process which has already exited.
 * @returns Dead pid
 */
function deadPid(): number {
  return spawnSync(process.execPath, ["-e", ""]).pid;
}

/**
 * Write raw content at the ledger's lock path, optionally backdating it.
 * @param root - Project root
 * @param content - Lock file content
 * @param ageMs - How long ago the file was last modified
 * @returns Lock path
 */
function plantRawLock(root: string, content: string, ageMs = 0): string {
  const lock = `${ledgerPath(root)}.lock`;
  const when = new Date(Date.now() - ageMs);
  mkdirSync(path.dirname(lock), { recursive: true });
  writeFileSync(lock, content);
  utimesSync(lock, when, when);
  return lock;
}

describe("ledger lock recovery", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "lisa-ledger-lock-recovery-"));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(root, { recursive: true, force: true });
  });

  it("reclaims an unreadable lock untouched for over 30s", async () => {
    const lock = plantRawLock(root, "not json", 31_000);

    await expect(updateLedger(root, undefined, addKey("k"))).resolves.toBe("k");
    expect(existsSync(lock)).toBe(false);
  });

  it("keeps a fresh unreadable lock and times out", async () => {
    const lock = plantRawLock(root, "not json");

    await expect(
      updateLedger(root, { lockTimeoutMs: SHORT_MS }, addKey("k"))
    ).rejects.toThrow(/lock timed out .*\(holder unknown\)/);
    expect(existsSync(lock)).toBe(true);
    expect(existsSync(ledgerPath(root))).toBe(false);
  });

  it("breaks a reclaim capability left by a dead reclaimer", async () => {
    const owner = { token: "dead-owner", pid: deadPid(), createdAt: 1 };
    const lock = plantRawLock(root, JSON.stringify(owner));
    const { dev, ino } = statSync(lock);
    const identity = JSON.stringify([
      dev,
      ino,
      owner.token,
      owner.pid,
      owner.createdAt,
    ]);
    const digest = createHash("sha256").update(identity).digest("hex");
    const capability = `${lock}.${digest.slice(0, 32)}.reclaim`;
    writeFileSync(capability, JSON.stringify({ pid: deadPid(), createdAt: 1 }));

    await expect(
      updateLedger(root, { lockTimeoutMs: 1_000 }, addKey("k"))
    ).resolves.toBe("k");
    expect(existsSync(capability)).toBe(false);
    expect(existsSync(lock)).toBe(false);
  });

  it("reclaims a lock created before this boot even when its pid is live", async () => {
    const bootTimeMs = () => Date.now() - 60_000;
    const lock = plantRawLock(
      root,
      JSON.stringify({
        token: "pre-boot",
        pid: process.pid,
        createdAt: Date.now() - 120_000,
      })
    );

    await expect(
      updateLedger(root, { lockTimeoutMs: 1_000, bootTimeMs }, addKey("k"))
    ).resolves.toBe("k");
    expect(existsSync(lock)).toBe(false);
  });

  it("keeps a live lock created within the boot-time safety margin", async () => {
    const createdAt = Date.now() - 120_000;
    const bootTimeMs = () => createdAt + 500;
    plantRawLock(
      root,
      JSON.stringify({ token: "skewed", pid: process.pid, createdAt })
    );

    await expect(
      updateLedger(root, { lockTimeoutMs: SHORT_MS, bootTimeMs }, addKey("k"))
    ).rejects.toThrow(/lock timed out/);
  });

  /**
   * Make this writer's own owner file impossible to remove, so release fails.
   * @returns Path of the sabotaged owner file
   */
  function sabotageOwnerFile(): string {
    const dir = path.dirname(ledgerPath(root));
    const name = readdirSync(dir).find(entry => entry.endsWith(".owner"));
    const ownerPath = path.join(dir, String(name));
    rmSync(ownerPath);
    mkdirSync(ownerPath);
    writeFileSync(path.join(ownerPath, "keep"), "");
    return ownerPath;
  }

  it("keeps the write's result when release fails, warning on stderr", async () => {
    const stderr = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);

    const result = await updateLedger(root, undefined, (ledger, at) => {
      sabotageOwnerFile();
      return addKey("kept")(ledger, at);
    });

    expect(result).toBe("kept");
    expect(Object.keys((await readLedger(root)).cyclers)).toEqual(["kept"]);
    expect(stderr).toHaveBeenCalledWith(
      expect.stringMatching(/session-manager ledger lock release failed/)
    );
  });

  it("keeps the write's own error when release also fails", async () => {
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    await expect(
      updateLedger(root, undefined, () => {
        sabotageOwnerFile();
        throw new Error("transform failed");
      })
    ).rejects.toThrow("transform failed");
  });
});
