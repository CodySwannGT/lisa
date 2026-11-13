/**
 * An over-cap ledger must not lock out the writers that would shrink it, and a
 * retire must exist that only ever shrinks it (CodySwannGT/lisa#4536).
 *
 * Before this, a ledger one byte over `maxTokens` made `readExistingLearnings`
 * and `parseLearningsDocument` throw a PLAIN `Error`. `persistConsolidatedLearning`
 * only routes a `LearningsBudgetError` to the overflow, so a capture against an
 * over-cap ledger was lost outright, and no supported writer could open the
 * ledger to bring it back under the cap. Supersede always appends, so it never
 * shrinks; nothing retired.
 *
 * The retire writer is deliberately fail-closed: a stale stamp or an unknown id
 * changes nothing on disk — not the ledger and not the overflow file — because a
 * gardening script that tried a retire which did not apply must be able to abort
 * without having mutated anything.
 */
import * as fs from "fs-extra";
import { readFile } from "node:fs/promises";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LEARNINGS_CONTRACT } from "../../../src/core/learnings-contract.js";
import {
  LEARNINGS_OVER_BUDGET_READ_CEILING,
  LearningsBudgetError,
  parseLearningsDocument,
  renderLearningsFile,
} from "../../../src/core/learnings-document.js";
import { readExistingLearnings } from "../../../src/core/learnings-file-safety.js";
import { retireLearningEntry } from "../../../src/core/learnings-retire.js";
import {
  persistConsolidatedLearning,
  persistLearningEntry,
} from "../../../src/core/learnings-writer.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

const FINGERPRINT_1 = "learner-fingerprint-1";
const FINGERPRINT_2 = "learner-fingerprint-2";
const STALE_FINGERPRINT = "learner-fingerprint-x";
const LEDGER = path.join(".lisa", "PROJECT_LEARNINGS.md");
const OVERFLOW = path.join(".lisa", "PROJECT_LEARNINGS.overflow.md");

/**
 * Build a valid entry, optionally padded so a few of them overflow the cap.
 * @param index - Stable numeric suffix
 * @param padding - Length of the `why` field
 * @returns Valid eight-field entry
 */
function entry(index: number, padding = 7) {
  return {
    id: `learner-${index}`,
    fingerprint: `learner-fingerprint-${index}`,
    rule: `Rule ${index}.`,
    why: "w".repeat(padding),
    provenance: [`issue:#${index}`],
    first_learned: "2026-07-20",
    last_confirmed: "2026-07-20",
    confidence: "high",
  } as const;
}

/** Padding that makes two entries fit the cap and three exceed it. */
const HALF_CAP = Math.floor(LEARNINGS_CONTRACT.maxTokens / 2.5);

/**
 * A valid, conflict-free v2 ledger that is over the `maxTokens` cap.
 * @returns Canonical over-cap document
 */
function overCapLedger(): string {
  const document = renderLearningsFile([
    entry(1, HALF_CAP),
    entry(2, HALF_CAP),
    entry(3, HALF_CAP),
  ]);
  expect(Buffer.byteLength(document)).toBeGreaterThan(
    LEARNINGS_CONTRACT.maxTokens
  );
  return document;
}

describe("over-cap ledger refusals are typed budget errors", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  it("readExistingLearnings throws LearningsBudgetError past the cap", async () => {
    const target = path.join(tempDir, LEDGER);
    await fs.outputFile(target, overCapLedger());
    const failure = await readExistingLearnings(target).catch(
      (error: unknown) => error
    );
    expect(failure).toBeInstanceOf(LearningsBudgetError);
    expect((failure as Error).message).toMatch(/maxTokens/);
  });

  it("parseLearningsDocument throws LearningsBudgetError past the cap", () => {
    expect(() => parseLearningsDocument(overCapLedger())).toThrow(
      LearningsBudgetError
    );
    expect(() => parseLearningsDocument(overCapLedger())).toThrow(/maxTokens/);
  });

  it("routes a plain capture against an over-cap ledger to the overflow", async () => {
    const target = path.join(tempDir, LEDGER);
    await fs.outputFile(target, overCapLedger());
    const before = await readFile(target, "utf8");
    await expect(persistLearningEntry(tempDir, entry(9))).rejects.toThrow(
      /was preserved/
    );
    expect(await readFile(target, "utf8")).toBe(before);
    expect(await readFile(path.join(tempDir, OVERFLOW), "utf8")).toContain(
      "learner-9"
    );
  });
});

describe("bounded over-budget read for shrink-only writers", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  it("opens an over-cap ledger only when asked to", async () => {
    const target = path.join(tempDir, LEDGER);
    const document = overCapLedger();
    await fs.outputFile(target, document);
    expect(await readExistingLearnings(target, { allowOverBudget: true })).toBe(
      document
    );
    const parsed = parseLearningsDocument(document, { allowOverBudget: true });
    expect(parsed.entries.map(current => current.id)).toEqual([
      "learner-1",
      "learner-2",
      "learner-3",
    ]);
  });

  it("still refuses past the hard ceiling", async () => {
    const huge = renderLearningsFile([
      entry(1, LEARNINGS_OVER_BUDGET_READ_CEILING),
    ]);
    const target = path.join(tempDir, LEDGER);
    await fs.outputFile(target, huge);
    await expect(
      readExistingLearnings(target, { allowOverBudget: true })
    ).rejects.toBeInstanceOf(LearningsBudgetError);
    expect(() =>
      parseLearningsDocument(huge, { allowOverBudget: true })
    ).toThrow(LearningsBudgetError);
  });

  it("still diagnoses conflict markers and schema problems", () => {
    const conflicted = overCapLedger().replace(
      "```jsonl\n",
      "```jsonl\n<<<<<<< HEAD\n"
    );
    expect(() =>
      parseLearningsDocument(conflicted, { allowOverBudget: true })
    ).toThrow(/conflict marker/i);
    const duplicated = overCapLedger().split(FINGERPRINT_2).join(FINGERPRINT_1);
    expect(() =>
      parseLearningsDocument(duplicated, { allowOverBudget: true })
    ).toThrow(/duplicate fingerprints/);
  });
});

describe("over-cap supersede", () => {
  let tempDir: string;
  let target: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
    target = path.join(tempDir, LEDGER);
    await fs.outputFile(target, overCapLedger());
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  it("permits a supersede that shrinks an over-cap ledger", async () => {
    const before = await readFile(target, "utf8");
    await persistConsolidatedLearning(tempDir, entry(7), {
      supersede: [
        { id: "learner-2", fingerprint: FINGERPRINT_2 },
        { id: "learner-3", fingerprint: "learner-fingerprint-3" },
      ],
    });
    const after = await readFile(target, "utf8");
    expect(Buffer.byteLength(after)).toBeLessThan(Buffer.byteLength(before));
    const ids = parseLearningsDocument(after).entries.map(e => e.id);
    expect(ids).toEqual(["learner-1", "learner-2"]);
  });

  it("refuses a stale supersede on an over-cap ledger without appending", async () => {
    const before = await readFile(target, "utf8");
    const stale: unknown[] = [];
    await expect(
      persistConsolidatedLearning(tempDir, entry(7), {
        supersede: [{ id: "learner-2", fingerprint: STALE_FINGERPRINT }],
        onStaleSupersede: targets => stale.push(...targets),
      })
    ).rejects.toThrow(LearningsBudgetError);
    expect(await readFile(target, "utf8")).toBe(before);
  });
});

describe("retireLearningEntry", () => {
  let tempDir: string;
  let target: string;
  let overflow: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
    target = path.join(tempDir, LEDGER);
    overflow = path.join(tempDir, OVERFLOW);
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  it("removes exactly the stamped entry and reports the shrink", async () => {
    await persistLearningEntry(tempDir, entry(1));
    await persistLearningEntry(tempDir, entry(2));
    const before = await readFile(target, "utf8");
    const result = await retireLearningEntry(
      tempDir,
      { id: "learner-1", fingerprint: FINGERPRINT_1 },
      "promoted to a lint rule"
    );
    const after = await readFile(target, "utf8");
    expect(result).toMatchObject({
      status: "retired",
      id: "learner-1",
      file: target,
      reason: "promoted to a lint rule",
      bytesBefore: Buffer.byteLength(before),
      bytesAfter: Buffer.byteLength(after),
      withinBudget: true,
    });
    expect(result.status === "retired" && result.retired.id).toBe("learner-1");
    expect(parseLearningsDocument(after).entries).toEqual([
      parseLearningsDocument(before).entries[1],
    ]);
  });

  it("brings an over-cap ledger back under the cap", async () => {
    await fs.outputFile(target, overCapLedger());
    const result = await retireLearningEntry(
      tempDir,
      { id: "learner-3", fingerprint: "learner-fingerprint-3" },
      "obsolete"
    );
    expect(result).toMatchObject({ status: "retired", withinBudget: true });
    expect(
      parseLearningsDocument(await readFile(target, "utf8")).entries
    ).toHaveLength(2);
  });

  it("reports a shrink that is still over the cap", async () => {
    await fs.outputFile(
      target,
      renderLearningsFile([
        entry(1, HALF_CAP),
        entry(2, HALF_CAP),
        entry(3, HALF_CAP),
        entry(4, 7),
      ])
    );
    const result = await retireLearningEntry(
      tempDir,
      { id: "learner-4", fingerprint: "learner-fingerprint-4" },
      "obsolete"
    );
    expect(result).toMatchObject({ status: "retired", withinBudget: false });
  });

  it("refuses a stale stamp without touching the ledger or the overflow", async () => {
    await fs.outputFile(target, overCapLedger());
    const before = await readFile(target, "utf8");
    const result = await retireLearningEntry(
      tempDir,
      { id: "learner-2", fingerprint: STALE_FINGERPRINT },
      "obsolete"
    );
    expect(result).toEqual({
      status: "stale",
      id: "learner-2",
      file: target,
      expectedFingerprint: STALE_FINGERPRINT,
      actualFingerprint: FINGERPRINT_2,
    });
    expect(await readFile(target, "utf8")).toBe(before);
    expect(await fs.pathExists(overflow)).toBe(false);
  });

  it("reports an unknown id without writing", async () => {
    await persistLearningEntry(tempDir, entry(1));
    const before = await readFile(target, "utf8");
    const result = await retireLearningEntry(
      tempDir,
      { id: "learner-5", fingerprint: "learner-fingerprint-5" },
      "obsolete"
    );
    expect(result).toEqual({
      status: "not-found",
      id: "learner-5",
      file: target,
    });
    expect(await readFile(target, "utf8")).toBe(before);
    expect(await fs.pathExists(overflow)).toBe(false);
  });

  it("reports a missing ledger without creating anything", async () => {
    const result = await retireLearningEntry(
      tempDir,
      { id: "learner-5", fingerprint: "learner-fingerprint-5" },
      "obsolete"
    );
    expect(result).toEqual({ status: "not-found", id: "learner-5" });
    expect(await fs.pathExists(path.join(tempDir, ".lisa"))).toBe(false);
  });

  it("rejects a malformed stamp or an empty reason before any read", async () => {
    await expect(
      retireLearningEntry(
        tempDir,
        { id: "Not A Token", fingerprint: "x" },
        "obsolete"
      )
    ).rejects.toThrow(/stamp/);
    await expect(
      retireLearningEntry(
        tempDir,
        { id: "learner-1", fingerprint: FINGERPRINT_1 },
        "   "
      )
    ).rejects.toThrow(/reason/);
  });
});
