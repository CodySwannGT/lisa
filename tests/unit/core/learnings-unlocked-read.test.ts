/**
 * No ledger read may happen outside the writer lock.
 *
 * PR #2008's `readSupersedeIdsPresentBeforeLock` read the ledger BEFORE
 * acquiring the lock, and both observed CI failures were that one cause:
 *
 *   1. It loses the rename race →
 *      `Unsafe project learnings path: target changed during open`
 *      (learnings-file-safety.ts). The dev/ino recheck there is correct for a
 *      LOCKED context, where the file cannot legitimately change; against a
 *      concurrent atomic rename it fires on entirely legitimate activity.
 *   2. It wins the race but reads a stale snapshot →
 *      bogus `Cannot supersede unknown learning id(s)`.
 *
 * Rather than force one filesystem-level interleaving, these tests pin the
 * INVARIANT that removes the whole class: while the lock is held by someone
 * else, a writer must touch nothing. The lock is taken first and the ledger is
 * then replaced with content that any read would choke on — so any read
 * attempted before the lock is acquired fails the test deterministically,
 * with no timing dependence.
 *
 * The companion stale-snapshot signature is covered deterministically in
 * `learnings-supersede-race.test.ts`.
 */
import * as fs from "fs-extra";
import { readFile } from "node:fs/promises";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { withLearningTargetLock } from "../../../src/core/learnings-lock.js";
import {
  parseLearningsFile,
  persistConsolidatedLearning,
} from "../../../src/core/learnings-writer.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

const LEDGER = path.join(".lisa", "PROJECT_LEARNINGS.md");
const BASE_ID = "learning-base";
const ARRIVING_ID = "learning-arriving";
/** Content that throws on ANY parse, standing in for a mid-rename observation. */
const UNREADABLE = "not a ledger at all";

/**
 * Build a compact valid entry.
 * @param id - Stable entry id
 * @returns Valid learning entry
 */
function entry(id: string) {
  return {
    id,
    rule: `Rule ${id}.`,
    why: `Why ${id}.`,
    provenance: [`issue:#${id}`],
    first_learned: "2026-07-16",
    last_confirmed: "2026-07-16",
    confidence: "high",
  } as const;
}

describe("writer reads nothing outside the lock", () => {
  let projectRoot: string;
  let target: string;
  let validLedger: string;

  beforeEach(async () => {
    projectRoot = await createTempDir();
    await persistConsolidatedLearning(projectRoot, entry(BASE_ID));
    target = path.join(projectRoot, LEDGER);
    validLedger = await readFile(target, "utf8");
  });

  afterEach(async () => {
    await cleanupTempDir(projectRoot);
  });

  /**
   * Run one writer while the lock is held and the ledger is unreadable,
   * restoring a valid ledger before the lock is released.
   * @param supersede - Supersede ids the writer requests
   * @returns The writer's promise, already settled
   */
  async function writeWhileLockHeld(
    supersede: readonly string[]
  ): Promise<string> {
    let release = (): void => {};
    const held = new Promise<void>(resolve => {
      release = resolve;
    });
    const lockOwner = withLearningTargetLock(target, async () => {
      // The ledger is mid-replacement from this writer's point of view: any
      // read of it right now is exactly the unlocked read being forbidden.
      await fs.writeFile(target, UNREADABLE);
      await held;
      await fs.writeFile(target, validLedger);
    });
    // Let the lock owner take the lock and corrupt the file first.
    await new Promise(resolve => setTimeout(resolve, 25));
    const writer = persistConsolidatedLearning(
      projectRoot,
      entry(ARRIVING_ID),
      supersede.length === 0 ? {} : { supersede }
    );
    // Give the writer ample opportunity to perform a pre-lock read.
    await new Promise(resolve => setTimeout(resolve, 75));
    release();
    await lockOwner;
    return writer;
  }

  it("does not read the ledger before acquiring the lock (supersede path)", async () => {
    // The supersede path is where the pre-lock read lived.
    await expect(writeWhileLockHeld([BASE_ID])).resolves.toBe(target);
  });

  it("does not read the ledger before acquiring the lock (append path)", async () => {
    await expect(writeWhileLockHeld([])).resolves.toBe(target);
  });

  it("still consolidates correctly once the lock is released", async () => {
    // Also covers the rename-race diagnostic: `target changed during open` is
    // correct inside the lock and wrong outside it, so a legitimate concurrent
    // write must complete rather than surface it.
    await writeWhileLockHeld([BASE_ID]);
    const persisted = parseLearningsFile(await readFile(target, "utf8"));
    expect(persisted.map(current => current.id)).toEqual([ARRIVING_ID]);
  });

  it("observes the post-lock ledger, not the pre-lock one", async () => {
    // Proves the read is genuinely deferred: the writer must see the ledger
    // restored by the lock owner, not the corrupted intermediate state.
    await writeWhileLockHeld([]);
    const persisted = parseLearningsFile(await readFile(target, "utf8"));
    expect(
      persisted
        .map(current => current.id)
        .sort((left, right) => left.localeCompare(right))
    ).toEqual([ARRIVING_ID, BASE_ID]);
  });
});
