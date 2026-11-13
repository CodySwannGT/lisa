/**
 * Supersede on an over-cap ledger (CodySwannGT/lisa#4536).
 *
 * Only a supersede can shrink the ledger, so only a supersede may open an
 * over-cap one — and only a write that both removes an entry and leaves the
 * ledger smaller is allowed past the cap. A stale stamp removes nothing, so it
 * keeps the budget refusal; its caller guard runs before any overflow write.
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
import { persistConsolidatedLearning } from "../../../src/core/learnings-writer.js";
import {
  FINGERPRINT_2,
  LEDGER,
  OVERFLOW,
  STALE_FINGERPRINT,
  entry,
  overCapLedger,
} from "../../helpers/learnings-overcap.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

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
    expect(stale).toEqual([
      {
        expected: { id: "learner-2", fingerprint: STALE_FINGERPRINT },
        actualFingerprint: FINGERPRINT_2,
        reason: "fingerprint-mismatch",
      },
    ]);
    expect(await readFile(target, "utf8")).toBe(before);
    // Without a caller guard the refused capture is preserved, as for any
    // other budget refusal.
    expect(await readFile(path.join(tempDir, OVERFLOW), "utf8")).toContain(
      "learner-7"
    );
  });

  it("runs a throwing stale guard before any overflow write", async () => {
    const before = await readFile(target, "utf8");
    await expect(
      persistConsolidatedLearning(tempDir, entry(7), {
        supersede: [{ id: "learner-2", fingerprint: STALE_FINGERPRINT }],
        onStaleSupersede: () => {
          throw new Error("gardener guard: stale stamp");
        },
      })
    ).rejects.toThrow(/gardener guard/);
    expect(await readFile(target, "utf8")).toBe(before);
    expect(await fs.pathExists(path.join(tempDir, OVERFLOW))).toBe(false);
  });

  it("refuses a stale supersede that would grow a non-canonical over-cap ledger", async () => {
    // Padded JSONL lines parse fine but re-render far smaller, so a stale
    // supersede that removes nothing and appends one entry still yields fewer
    // bytes. Fewer bytes alone must not authorize writing past the cap.
    const padded = overCapLedger()
      .split('{"id"')
      .join(`{${" ".repeat(2000)}"id"`);
    await fs.outputFile(target, padded);
    await expect(
      persistConsolidatedLearning(tempDir, entry(7), {
        supersede: [{ id: "learner-2", fingerprint: STALE_FINGERPRINT }],
      })
    ).rejects.toThrow(LearningsBudgetError);
    expect(await readFile(target, "utf8")).toBe(padded);
  });

  it("permits a supersede that shrinks a ledger over maxEntries but under the byte cap", async () => {
    // Over budget by entry COUNT only: the same "over budget" definition the
    // retire writer uses must let a count-shrinking supersede through.
    const overCount = LEARNINGS_CONTRACT.maxEntries + 2;
    const document = renderLearningsFile(
      Array.from({ length: overCount }, (_unused, index) => entry(index + 10))
    );
    expect(Buffer.byteLength(document)).toBeLessThan(
      LEARNINGS_CONTRACT.maxTokens
    );
    await fs.outputFile(target, document);
    await persistConsolidatedLearning(tempDir, entry(7), {
      supersede: [
        { id: "learner-10", fingerprint: "learner-fingerprint-10" },
        { id: "learner-11", fingerprint: "learner-fingerprint-11" },
      ],
    });
    const after = parseLearningsDocument(await readFile(target, "utf8"), {
      allowOverBudget: true,
    });
    expect(after.entries).toHaveLength(overCount - 1);
  });

  it("refuses a count-shrinking supersede that would grow the ledger past the read ceiling", async () => {
    // Over budget on count AND bytes, just under the tolerant read ceiling. A
    // supersede that drops the count but adds a large entry must not push the
    // ledger past the ceiling, or no shrink-only writer could open it again.
    const overCount = LEARNINGS_CONTRACT.maxEntries + 1;
    const document = renderLearningsFile(
      Array.from({ length: overCount }, (_unused, index) =>
        entry(index + 10, 2600)
      )
    );
    const documentBytes = Buffer.byteLength(document);
    expect(documentBytes).toBeLessThan(LEARNINGS_OVER_BUDGET_READ_CEILING);
    expect(documentBytes + 9000 - 2 * 2600).toBeGreaterThan(
      LEARNINGS_OVER_BUDGET_READ_CEILING
    );
    await fs.outputFile(target, document);
    await expect(
      persistConsolidatedLearning(tempDir, entry(7, 9000), {
        supersede: [
          { id: "learner-10", fingerprint: "learner-fingerprint-10" },
          { id: "learner-11", fingerprint: "learner-fingerprint-11" },
        ],
      })
    ).rejects.toThrow(LearningsBudgetError);
    expect(await readFile(target, "utf8")).toBe(document);
  });
});
