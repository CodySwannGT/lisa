/**
 * `lisa learnings-overflow` is how the gardener drains budget-dropped captures
 * (CodySwannGT/lisa#1996). It exists as a command rather than as prose in the
 * audit skill for the same reason every other learnings surface does: the skill
 * must never hand-parse or hand-edit the file, and a command is the only way to
 * give an agent the contract's lock, safety, and atomic-write machinery.
 */
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runLearningsOverflow } from "../../../src/cli/learnings-overflow-cmd.js";
import { LEARNINGS_CONTRACT } from "../../../src/core/learnings-contract.js";
import { persistLearningEntry } from "../../../src/core/learnings-writer.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

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
    await persistLearningEntry(tempDir, numberedEntry(index)).catch(
      () => undefined
    );
  }

  /**
   * Fill the ledger to its hard entry cap.
   */
  async function fillLedger(): Promise<void> {
    for (let index = 0; index < LEARNINGS_CONTRACT.maxEntries; index += 1) {
      await persistLearningEntry(tempDir, numberedEntry(index));
    }
  }

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
    expect(JSON.parse(out.join("\n")).absent).toEqual(["learner-absent"]);
  });
});
