/**
 * Acquisition must wait on a wall-clock budget rather than a fixed number of
 * retries. A count-based budget makes the real wait time a function of how fast
 * the machine can spin the retry loop: on a loaded machine every attempt costs
 * more, so the same 200 attempts buy a different amount of waiting each run and
 * a waiter can abandon a lock that is still legitimately held
 * (CodySwannGT/lisa#2474).
 */
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { withFileTargetLock } from "../../../src/core/learnings-lock.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

/** Hold longer than the retired 200-attempt budget ever bought (~2.6s). */
const HOLD_MS = 4_000;
const HANDOFF_TIMEOUT_MS = 30_000;

/**
 * Sleep without blocking the event loop.
 * @param ms - Milliseconds to wait
 * @returns Promise resolved after the delay
 */
async function delay(ms: number): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, ms);
  });
}

describe("file target lock acquisition", () => {
  let tempDir: string;
  let target: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
    target = path.join(tempDir, "TARGET.md");
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  it(
    "waits for a holder that keeps the lock longer than the retry cadence",
    async () => {
      const observed: string[] = [];
      const holder = withFileTargetLock(target, async () => {
        await delay(HOLD_MS);
        observed.push("holder-released");
      });
      await delay(100);
      await withFileTargetLock(target, async () => {
        observed.push("waiter-acquired");
      });
      await holder;

      expect(observed).toEqual(["holder-released", "waiter-acquired"]);
    },
    HANDOFF_TIMEOUT_MS
  );
});
