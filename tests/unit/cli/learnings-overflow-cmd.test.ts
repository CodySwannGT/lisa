/**
 * `lisa learnings-overflow` is how the gardener drains budget-dropped captures
 * (CodySwannGT/lisa#1996). It exists as a command rather than as prose in the
 * audit skill for the same reason every other learnings surface does: the skill
 * must never hand-parse or hand-edit the file, and a command is the only way to
 * give an agent the contract's lock, safety, and atomic-write machinery.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runLearningsOverflow } from "../../../src/cli/learnings-overflow-cmd.js";
import { LEARNINGS_CONTRACT } from "../../../src/core/learnings-contract.js";
import {
  LearningsBudgetError,
  renderLearningsFile,
} from "../../../src/core/learnings-document.js";
import {
  preserveDroppedLearning,
  readLearningsOverflow,
} from "../../../src/core/learnings-overflow.js";
import { persistLearningEntry } from "../../../src/core/learnings-writer.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

/**
 * Build a compact valid entry with a stable numeric suffix.
 * @param index - Stable numeric suffix
 * @returns Valid eight-field entry
 */
function numberedEntry(index: number) {
  return {
    id: `learner-${index}`,
    fingerprint: `learner-fingerprint-${index}`,
    rule: `Rule ${index}.`,
    why: "Reason.",
    provenance: [`issue:#${index}`],
    first_learned: "2026-07-20",
    last_confirmed: "2026-07-20",
    confidence: "high",
  } as const;
}

describe("lisa learnings-overflow", () => {
  let tempDir: string;
  let out: string[];

  beforeEach(async () => {
    tempDir = await createTempDir();
    out = [];
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  /**
   * Fill the ledger to its cap and drop one capture into the overflow.
   * @param index - Suffix of the capture to drop
   */
  async function dropOne(index: number): Promise<void> {
    // The write is expected to reject with the budget breach that triggers
    // preservation. Asserting that specific rejection keeps a locking,
    // permission, or validation failure from masquerading as a clean drop.
    await expect(
      persistLearningEntry(tempDir, numberedEntry(index))
    ).rejects.toThrow(/was preserved/);
  }

  /**
   * Fill the ledger to its hard entry cap.
   */
  async function fillLedger(): Promise<void> {
    for (let index = 0; index < LEARNINGS_CONTRACT.maxEntries; index += 1) {
      await persistLearningEntry(tempDir, numberedEntry(index));
    }
  }

  /**
   * Seed three valid large entries so the first drain remains over budget.
   * @returns The overflow path.
   */
  async function seedSaturatedOverflow(): Promise<string> {
    const file = (await readLearningsOverflow(tempDir)).file;
    await mkdir(path.dirname(file), { recursive: true });
    const why = "x".repeat(Math.ceil(LEARNINGS_CONTRACT.maxTokens / 2));
    await writeFile(
      file,
      renderLearningsFile(
        [0, 1, 2].map(index => ({ ...numberedEntry(index), why }))
      )
    );
    return file;
  }

  it("lists every validated entry and identifies an over-budget overflow", async () => {
    await seedSaturatedOverflow();
    const code = await runLearningsOverflow(
      {},
      { cwd: tempDir, log: message => out.push(message) }
    );

    expect(code).toBe(0);
    expect(JSON.parse(out[0]!)).toMatchObject({ pending: 3, overBudget: true });
    expect(JSON.parse(out[0]!).entries).toHaveLength(3);
  });

  it("publishes a smaller partial drain, then reports when the next drain is under budget", async () => {
    const file = await seedSaturatedOverflow();
    const original = await readFile(file, "utf8");
    const dependencies = {
      cwd: tempDir,
      log: (message: string) => out.push(message),
    };

    expect(
      await runLearningsOverflow({ drain: [numberedEntry(0).id] }, dependencies)
    ).toBe(0);
    const smaller = await readFile(file, "utf8");
    expect(smaller.length).toBeLessThan(original.length);
    expect(JSON.parse(out[0]!)).toMatchObject({
      remaining: 2,
      overBudget: true,
    });

    expect(
      await runLearningsOverflow({ drain: [numberedEntry(1).id] }, dependencies)
    ).toBe(0);
    expect((await readFile(file, "utf8")).length).toBeLessThan(smaller.length);
    expect(JSON.parse(out[1]!)).toMatchObject({
      remaining: 1,
      overBudget: false,
    });
    expect(
      (await readLearningsOverflow(tempDir)).entries.map(entry => entry.id)
    ).toEqual([numberedEntry(2).id]);
  });

  it("still refuses capture into an over-budget overflow without changing its bytes", async () => {
    const file = await seedSaturatedOverflow();
    const original = await readFile(file, "utf8");

    await expect(
      preserveDroppedLearning(
        tempDir,
        numberedEntry(3),
        new LearningsBudgetError("ledger full")
      )
    ).rejects.toThrow("exceeds maxTokens");
    expect(await readFile(file, "utf8")).toBe(original);
  });

  it("reports a conflict marker ahead of an over-budget diagnosis", async () => {
    const file = await seedSaturatedOverflow();
    const content = await readFile(file, "utf8");
    await writeFile(
      file,
      content.replace("```jsonl\n", "```jsonl\n<<<<<<< HEAD\n")
    );
    const errors: string[] = [];
    const code = await runLearningsOverflow(
      {},
      { cwd: tempDir, error: message => errors.push(message) }
    );

    expect(code).toBe(1);
    expect(errors[0]).toMatch(/conflict marker/i);
    expect(errors[0]).not.toContain("exceeds maxTokens");
  });

  it("reports an empty overflow as a clean pass", async () => {
    const code = await runLearningsOverflow(
      {},
      { cwd: tempDir, log: message => out.push(message) }
    );
    expect(code).toBe(0);
    expect(JSON.parse(out.join("\n")).entries).toEqual([]);
  });

  it("lists the captures awaiting drain as machine-readable JSON", async () => {
    await fillLedger();
    await dropOne(LEARNINGS_CONTRACT.maxEntries);
    const code = await runLearningsOverflow(
      {},
      { cwd: tempDir, log: message => out.push(message) }
    );
    expect(code).toBe(0);
    const payload = JSON.parse(out.join("\n"));
    expect(payload.entries).toHaveLength(1);
    expect(payload.entries[0].id).toBe(
      `learner-${LEARNINGS_CONTRACT.maxEntries}`
    );
    expect(payload.file).toBe(
      path.join(tempDir, ".lisa", "PROJECT_LEARNINGS.overflow.md")
    );
  });

  it("drains only the ids it is given", async () => {
    await fillLedger();
    await dropOne(LEARNINGS_CONTRACT.maxEntries);
    await dropOne(LEARNINGS_CONTRACT.maxEntries + 1);
    const code = await runLearningsOverflow(
      { drain: [`learner-${LEARNINGS_CONTRACT.maxEntries}`] },
      { cwd: tempDir, log: message => out.push(message) }
    );
    expect(code).toBe(0);
    const payload = JSON.parse(out.join("\n"));
    expect(payload.drained).toEqual([
      `learner-${LEARNINGS_CONTRACT.maxEntries}`,
    ]);
    expect(payload.remaining).toBe(1);
  });

  it("reports an unknown drain id without failing the drain", async () => {
    await fillLedger();
    await dropOne(LEARNINGS_CONTRACT.maxEntries);
    const code = await runLearningsOverflow(
      { drain: ["learner-absent"] },
      { cwd: tempDir, log: message => out.push(message) }
    );
    expect(code).toBe(0);
    const result = JSON.parse(out.join("\n"));
    expect(result.absent).toEqual(["learner-absent"]);
    // An unknown id must be inert: without this, an implementation that
    // deleted the real entry while reporting the unknown one as absent
    // would still pass.
    expect(result.drained).toEqual([]);
    const remaining = await readLearningsOverflow(tempDir);
    expect(remaining.entries).toHaveLength(1);
    expect(remaining.entries[0]?.id).toBe(
      numberedEntry(LEARNINGS_CONTRACT.maxEntries).id
    );
  });
});
