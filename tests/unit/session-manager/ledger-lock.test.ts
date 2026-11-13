/**
 * Contract tests for the cross-process lock around the ledger's
 * read-modify-write (CodySwannGT/lisa#4828).
 *
 * Several `session-manager.mjs` processes write one ledger file: the manager's
 * cycle, worker finishes, answers and the per-cycle heartbeat. Each write reads
 * the whole file, changes it and writes it back, so two overlapping writers
 * used to lose the earlier write silently. These tests pin the fix from the
 * outside: real separate processes lose nothing, a lock left by a dead process
 * is recovered, a live holder is never broken, and a writer only ever removes
 * its own lock.
 * @module tests/unit/session-manager/ledger-lock
 */
import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  ledgerPath,
  readLedger,
  updateLedger,
  writeLedger,
} from "../../../plugins/src/base/skills/lisa-session-manager/scripts/ledger.mjs";

const LEDGER_MODULE = path.resolve(
  import.meta.dirname,
  "../../../plugins/src/base/skills/lisa-session-manager/scripts/ledger.mjs"
);

/** Separate writer processes in the concurrency test. */
const WRITERS = 24;

/** Updates each writer process performs, to widen the overlap window. */
const UPDATES_PER_WRITER = 3;

/**
 * A driver run as its own `node` process: it waits for a shared start time so
 * every writer overlaps, then adds its own keys through `updateLedger`.
 */
const DRIVER = `
const [moduleUrl, root, id, startAt, count] = process.argv.slice(1);
const { updateLedger } = await import(moduleUrl);
while (Date.now() < Number(startAt)) await new Promise(r => setTimeout(r, 1));
for (let i = 0; i < Number(count); i += 1) {
  await updateLedger(root, undefined, (ledger, at) => ({
    ledger: { ...ledger, cyclers: { ...ledger.cyclers, [id + "-" + i]: at } },
    result: null,
  }));
}
`;

/**
 * Run one driver process to completion.
 * @param root - Project root
 * @param id - Writer identity, used as its key prefix
 * @param startAt - Epoch ms every writer waits for
 * @returns Exit code and stderr
 */
function runWriter(
  root: string,
  id: string,
  startAt: number
): Promise<{ code: number | null; stderr: string }> {
  return new Promise(resolve => {
    const child = spawn(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        DRIVER,
        pathToFileURL(LEDGER_MODULE).href,
        root,
        id,
        String(startAt),
        String(UPDATES_PER_WRITER),
      ],
      { stdio: ["ignore", "ignore", "pipe"] }
    );
    const chunks: Buffer[] = [];
    child.stderr.on("data", chunk => chunks.push(chunk));
    child.on("close", code =>
      resolve({ code, stderr: Buffer.concat(chunks).toString("utf8") })
    );
  });
}

/**
 * A pid that belonged to a process which has already exited.
 * @returns Dead pid
 */
function deadPid(): number {
  const result = spawnSync(process.execPath, ["-e", ""]);
  return result.pid;
}

/**
 * Plant a lock file at the ledger's lock path, as a holder would publish it.
 * @param root - Project root
 * @param pid - Pid the owner record names
 * @returns Lock path
 */
function plantLock(root: string, pid: number): string {
  const lock = `${ledgerPath(root)}.lock`;
  mkdirSync(path.dirname(lock), { recursive: true });
  writeFileSync(
    lock,
    JSON.stringify({ token: "planted-token", pid, createdAt: Date.now() })
  );
  return lock;
}

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

describe("ledger lock", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "lisa-ledger-lock-"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("loses no update when many separate processes write at once", async () => {
    const startAt = Date.now() + 1500;
    const ids = Array.from({ length: WRITERS }, (_, i) => `w${i}`);
    const results = await Promise.all(
      ids.map(id => runWriter(root, id, startAt))
    );

    expect(results.filter(r => r.code !== 0)).toEqual([]);
    const ledger = await readLedger(root);
    const expected = ids.flatMap(id =>
      Array.from({ length: UPDATES_PER_WRITER }, (_, i) => `${id}-${i}`)
    );
    const written = Object.keys(ledger.cyclers);
    expect(written).toHaveLength(expected.length);
    expect(written).toEqual(expect.arrayContaining(expected));
    expect(existsSync(`${ledgerPath(root)}.lock`)).toBe(false);
  }, 60_000);

  it("recovers a lock left by a dead process and completes the write", async () => {
    const lock = plantLock(root, deadPid());

    const key = "after-stale";
    await expect(updateLedger(root, undefined, addKey(key))).resolves.toBe(key);

    expect(Object.keys((await readLedger(root)).cyclers)).toEqual([key]);
    expect(existsSync(lock)).toBe(false);
    const leftovers = readdirSync(path.dirname(lock)).filter(name =>
      name.startsWith("ledger.json.lock")
    );
    expect(leftovers).toEqual([]);
  });

  it("never breaks a live holder: times out with a clear error and writes nothing", async () => {
    await writeLedger(root, {
      ...(await readLedger(root)),
      cyclers: { before: "2026-11-12T00:00:00.000Z" },
    });
    const before = readFileSync(ledgerPath(root), "utf8");
    const lock = plantLock(root, process.pid);

    await expect(
      updateLedger(root, { lockTimeoutMs: 200 }, addKey("blocked"))
    ).rejects.toThrow(
      new RegExp(
        `session-manager ledger lock timed out after 200ms: .*ledger\\.json\\.lock \\(held by pid ${process.pid}\\)`
      )
    );

    expect(readFileSync(ledgerPath(root), "utf8")).toBe(before);
    expect(existsSync(lock)).toBe(true);
  });

  it("never reclaims a live holder by age, even when the lock is old", async () => {
    const lock = `${ledgerPath(root)}.lock`;
    mkdirSync(path.dirname(lock), { recursive: true });
    writeFileSync(
      lock,
      JSON.stringify({
        token: "old-token",
        pid: process.pid,
        createdAt: Date.now() - 10 * 60_000,
      })
    );

    await expect(
      updateLedger(root, { lockTimeoutMs: 100 }, addKey("blocked"))
    ).rejects.toThrow(/lock timed out/);
    expect(existsSync(lock)).toBe(true);
  });

  it("treats a dead pid as stale through the injected liveness probe", async () => {
    plantLock(root, process.pid);

    await expect(
      updateLedger(
        root,
        { lockTimeoutMs: 500, isProcessLive: () => false },
        addKey("probe")
      )
    ).resolves.toBe("probe");
  });

  it("releases only its own lock, leaving one another writer took", async () => {
    const lock = `${ledgerPath(root)}.lock`;
    const usurper = JSON.stringify({
      token: "usurper",
      pid: process.pid,
      createdAt: Date.now(),
    });

    await updateLedger(root, undefined, (ledger, at) => {
      // Simulate the lock being swapped for another holder's while ours runs.
      rmSync(lock);
      writeFileSync(lock, usurper);
      return addKey("mine")(ledger, at);
    });

    expect(readFileSync(lock, "utf8")).toBe(usurper);
    expect(Object.keys((await readLedger(root)).cyclers)).toEqual(["mine"]);
  });

  it("releases the lock when the transform throws", async () => {
    await expect(
      updateLedger(root, undefined, () => {
        throw new Error("boom");
      })
    ).rejects.toThrow("boom");

    expect(existsSync(`${ledgerPath(root)}.lock`)).toBe(false);
  });
});
