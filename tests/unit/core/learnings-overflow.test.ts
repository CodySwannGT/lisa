/**
 * Durable preservation of budget-forced drops (CodySwannGT/lisa#1996).
 *
 * When the ledger is full, a judged-durable capture used to be dropped with its
 * CONTENT surviving only in ephemeral capture-report text — so once the report
 * scrolled away the learning was gone, and the gardener had nothing to drain.
 * CodySwannGT/lisa#1959 raised the byte budget and added the `[lisa-ledger-saturated]`
 * signal; the signal says "saturated", and this overflow file holds "here is
 * what was dropped".
 *
 * The overflow reuses the ledger's own document format, safety machinery, lock
 * discipline, and atomic write, so it inherits the conflict-marker guard and the
 * union merge driver instead of growing a parallel set.
 */
import * as fse from "fs-extra";
import { readFile, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LEARNINGS_CONTRACT } from "../../../src/core/learnings-contract.js";
import { CONFLICT_MARKER_DIAGNOSIS } from "../../../src/core/learnings-document.js";
import { withFileTargetLock } from "../../../src/core/learnings-lock.js";
import {
  drainLearningsOverflow,
  readLearningsOverflow,
  resolveLearningsOverflowFile,
} from "../../../src/core/learnings-overflow.js";
import {
  persistLearningEntry,
  renderLearningsFile,
} from "../../../src/core/learnings-writer.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

const OVERFLOW_FILENAME = "PROJECT_LEARNINGS.overflow.md";
const LEDGER_FILENAME = "PROJECT_LEARNINGS.md";

/**
 * Build a compact valid entry with a stable numeric suffix.
 * @param index - Stable numeric suffix
 * @returns Valid seven-field entry
 */
function numberedEntry(index: number) {
  return {
    id: `learner-${index}`,
    rule: `Rule ${index}.`,
    why: "Reason.",
    provenance: [`issue:#${index}`],
    first_learned: "2026-07-20",
    last_confirmed: "2026-07-20",
    confidence: "high",
  } as const;
}

describe("learnings overflow preservation", () => {
  let tempDir: string;
  let overflowPath: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
    overflowPath = path.join(tempDir, ".lisa", OVERFLOW_FILENAME);
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  /**
   * Fill the ledger to its hard entry cap.
   */
  async function fillLedger(): Promise<void> {
    for (let index = 0; index < LEARNINGS_CONTRACT.maxEntries; index += 1) {
      await persistLearningEntry(tempDir, numberedEntry(index));
    }
  }

  it("derives the overflow path as a sibling of the configured ledger", () => {
    expect(resolveLearningsOverflowFile(".lisa/PROJECT_LEARNINGS.md")).toBe(
      ".lisa/PROJECT_LEARNINGS.overflow.md"
    );
    expect(resolveLearningsOverflowFile("docs/LEARNINGS.md")).toBe(
      "docs/LEARNINGS.overflow.md"
    );
  });

  it("preserves a budget-dropped entry in the overflow file", async () => {
    await fillLedger();
    const dropped = numberedEntry(LEARNINGS_CONTRACT.maxEntries);
    await expect(persistLearningEntry(tempDir, dropped)).rejects.toThrow(
      /maxEntries/i
    );
    const overflow = await readLearningsOverflow(tempDir);
    expect(overflow.entries.map(entry => entry.id)).toEqual([dropped.id]);
    expect(overflow.entries[0]?.rule).toBe(dropped.rule);
  });

  it("names the overflow file in the drop error so the loss is never silent", async () => {
    await fillLedger();
    await expect(
      persistLearningEntry(
        tempDir,
        numberedEntry(LEARNINGS_CONTRACT.maxEntries)
      )
    ).rejects.toThrow(/PROJECT_LEARNINGS\.overflow\.md/);
  });

  it("still reports the underlying budget breach in the drop error", async () => {
    await fillLedger();
    await expect(
      persistLearningEntry(
        tempDir,
        numberedEntry(LEARNINGS_CONTRACT.maxEntries)
      )
    ).rejects.toThrow(/exceeds maxEntries/);
  });

  it("leaves the ledger untouched when a capture overflows", async () => {
    await fillLedger();
    const before = await readFile(
      path.join(tempDir, ".lisa", LEDGER_FILENAME),
      "utf8"
    );
    await expect(
      persistLearningEntry(
        tempDir,
        numberedEntry(LEARNINGS_CONTRACT.maxEntries)
      )
    ).rejects.toThrow();
    const after = await readFile(
      path.join(tempDir, ".lisa", LEDGER_FILENAME),
      "utf8"
    );
    expect(after).toBe(before);
  });

  it("is idempotent — re-dropping the same capture does not duplicate it", async () => {
    await fillLedger();
    const dropped = numberedEntry(LEARNINGS_CONTRACT.maxEntries);
    await expect(persistLearningEntry(tempDir, dropped)).rejects.toThrow();
    await expect(persistLearningEntry(tempDir, dropped)).rejects.toThrow();
    const overflow = await readLearningsOverflow(tempDir);
    expect(overflow.entries).toHaveLength(1);
  });

  it("holds no lock once the drop has been preserved", async () => {
    await fillLedger();
    await expect(
      persistLearningEntry(
        tempDir,
        numberedEntry(LEARNINGS_CONTRACT.maxEntries)
      )
    ).rejects.toThrow();
    // The ledger lock is always released before the overflow lock is taken —
    // the two are never held at once, so the pair cannot deadlock.
    const lisaDir = path.join(tempDir, ".lisa");
    const { readdir } = await import("node:fs/promises");
    const remaining = (await readdir(lisaDir)).filter(name =>
      name.endsWith(".lock")
    );
    expect(remaining).toEqual([]);
  });

  it("has already released the ledger lock when it takes the overflow lock", async () => {
    // The non-nesting claim has to be observed DURING the drop. Asserting that
    // no locks survive afterwards proves nothing: `withFileTargetLock` releases
    // in a `finally`, so a nested implementation cleans up just as tidily and
    // passes. The cost of nesting is not corruption — it is every other ledger
    // writer blocking for the duration of the overflow write, plus up to the
    // full 2s lock timeout, under exactly the contention this machinery exists
    // to survive.
    //
    // So: hold the overflow lock from here, then force a budget drop. The
    // writer must fail the ledger transaction, RELEASE the ledger lock, and
    // then block waiting on the overflow lock we are holding. While it is
    // blocked, the ledger lock must already be gone.
    await fillLedger();
    const ledgerLock = path.join(tempDir, ".lisa", `${LEDGER_FILENAME}.lock`);
    let ledgerLockedDuringOverflow = true;
    const dropped = numberedEntry(LEARNINGS_CONTRACT.maxEntries);

    const overflowTarget = path.join(tempDir, ".lisa", OVERFLOW_FILENAME);
    // The in-flight drop is held OUTSIDE the callback's return value on
    // purpose: `withFileTargetLock` awaits whatever the callback returns, so
    // returning the drop would keep the overflow lock held until the drop
    // finished — while the drop waits for that same lock. The test would
    // deadlock until the lock timeout and prove nothing.
    let pending: Promise<unknown> = Promise.resolve(undefined);
    await withFileTargetLock(overflowTarget, async () => {
      // Capture the rejection immediately so the pending drop can never
      // surface as an unhandled rejection while we hold the lock.
      pending = persistLearningEntry(tempDir, dropped).catch(
        (error: unknown) => error
      );
      await new Promise<void>(resolve => setTimeout(resolve, 200));
      ledgerLockedDuringOverflow = await fse.pathExists(ledgerLock);
    });

    expect(ledgerLockedDuringOverflow).toBe(false);
    const error = await pending;
    expect((error as Error).message).toMatch(/was preserved in/);
    const overflow = await readLearningsOverflow(tempDir);
    expect(overflow.entries.map(entry => entry.id)).toEqual([dropped.id]);
  });

  it("drains only the requested ids and leaves the rest", async () => {
    await fillLedger();
    const first = numberedEntry(LEARNINGS_CONTRACT.maxEntries);
    const second = numberedEntry(LEARNINGS_CONTRACT.maxEntries + 1);
    await expect(persistLearningEntry(tempDir, first)).rejects.toThrow();
    await expect(persistLearningEntry(tempDir, second)).rejects.toThrow();
    const result = await drainLearningsOverflow(tempDir, [first.id]);
    expect(result.drained).toEqual([first.id]);
    const overflow = await readLearningsOverflow(tempDir);
    expect(overflow.entries.map(entry => entry.id)).toEqual([second.id]);
  });

  it("reports an unknown drain id instead of failing the drain", async () => {
    await fillLedger();
    const first = numberedEntry(LEARNINGS_CONTRACT.maxEntries);
    await expect(persistLearningEntry(tempDir, first)).rejects.toThrow();
    const result = await drainLearningsOverflow(tempDir, [
      first.id,
      "learner-absent",
    ]);
    expect(result.drained).toEqual([first.id]);
    expect(result.absent).toEqual(["learner-absent"]);
  });

  it("reads an absent overflow file as empty rather than throwing", async () => {
    const overflow = await readLearningsOverflow(tempDir);
    expect(overflow.entries).toEqual([]);
    expect(overflow.file).toBe(overflowPath);
  });

  it("diagnoses a conflict-marked overflow file with the shared remediation", async () => {
    const { mkdir } = await import("node:fs/promises");
    await mkdir(path.join(tempDir, ".lisa"), { recursive: true });
    const clean = renderLearningsFile([]);
    await writeFile(
      overflowPath,
      clean.replace("```jsonl\n", "```jsonl\n<<<<<<< HEAD\n"),
      "utf8"
    );
    await expect(readLearningsOverflow(tempDir)).rejects.toThrow(
      CONFLICT_MARKER_DIAGNOSIS
    );
  });

  it("rethrows the ledger budget breach when the overflow is also full", async () => {
    await fillLedger();
    for (let index = 0; index < LEARNINGS_CONTRACT.maxEntries; index += 1) {
      await expect(
        persistLearningEntry(tempDir, numberedEntry(100 + index))
      ).rejects.toThrow();
    }
    const overflow = await readLearningsOverflow(tempDir);
    expect(overflow.entries).toHaveLength(LEARNINGS_CONTRACT.maxEntries);
    // Nothing is silently evicted from a full overflow, and the capture still
    // fails loudly with a breach that names both surfaces.
    //
    // Assert the DISTINGUISHING phrase, not merely `/overflow/i`: that word
    // appears in the success message too ("preserved in …overflow.md"), so
    // matching it alone cannot tell a rescued capture from a lost one — a
    // writer that always claimed success would satisfy it. The negative
    // assertion is the other half of the same guard.
    await expect(
      persistLearningEntry(tempDir, numberedEntry(999))
    ).rejects.toThrow(/is full too/);
    await expect(
      persistLearningEntry(tempDir, numberedEntry(998))
    ).rejects.not.toThrow(/was preserved/);
  });

  it("does not report preservation for a capture the full overflow refused", async () => {
    await fillLedger();
    for (let index = 0; index < LEARNINGS_CONTRACT.maxEntries; index += 1) {
      await expect(
        persistLearningEntry(tempDir, numberedEntry(100 + index))
      ).rejects.toThrow();
    }
    // The lost capture must not be in the overflow either — "reported as lost"
    // and "actually absent" have to agree, or the message is decoration.
    await expect(
      persistLearningEntry(tempDir, numberedEntry(999))
    ).rejects.toThrow();
    const overflow = await readLearningsOverflow(tempDir);
    expect(overflow.entries.map(entry => entry.id)).not.toContain(
      "learner-999"
    );
    expect(overflow.entries).toHaveLength(LEARNINGS_CONTRACT.maxEntries);
  });
});
