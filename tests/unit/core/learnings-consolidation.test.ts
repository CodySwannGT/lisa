/**
 * Write-time consolidation tests for the supersede-capable learnings writer
 * (SLL-4, issue #1592): a writer that finds a related existing entry must be
 * able to merge/supersede it through the API instead of hand-editing the
 * markdown or appending a near-duplicate sibling.
 */
import { readFile } from "node:fs/promises";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LEARNINGS_CONTRACT } from "../../../src/core/learnings-contract.js";
import {
  parseLearningsFile,
  persistConsolidatedLearning,
  persistLearningEntry,
} from "../../../src/core/learnings-writer.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

const LEARNINGS_FILENAME = "PROJECT_LEARNINGS.md";
const CONSOLIDATED_ID = "learning-consolidated";
const FIRST_ID = "learning-1";
const SECOND_ID = "learning-2";
const NEW_ID = "learning-new";
const MISSING_ID = "learning-missing";
const BASE_ENTRY = {
  id: "learning-base",
  rule: "Always resolve the learnings path via the executable contract.",
  why: "Hardcoded paths drift from the configured rules directory.",
  provenance: ["issue:#1592"],
  first_learned: "2026-07-19",
  last_confirmed: "2026-07-19",
  confidence: "high",
} as const;

/**
 * Build a compact valid entry with a stable numeric suffix.
 * @param index - Stable numeric suffix
 * @returns Compact valid entry
 */
function numberedEntry(index: number) {
  return {
    ...BASE_ENTRY,
    id: `learning-${index}`,
    rule: `Rule ${index}.`,
    why: "Reason.",
    provenance: [`issue:#${index}`],
  } as const;
}

describe("learnings consolidation writer", () => {
  let tempDir: string;
  let learningsPath: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
    learningsPath = path.join(tempDir, ".lisa", LEARNINGS_FILENAME);
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  it("supersedes one existing entry while retaining unrelated entries", async () => {
    await persistLearningEntry(tempDir, numberedEntry(1));
    await persistLearningEntry(tempDir, numberedEntry(2));
    const consolidated = {
      ...BASE_ENTRY,
      id: CONSOLIDATED_ID,
      rule: "Consolidated rule replacing rule 1.",
    };
    await persistConsolidatedLearning(tempDir, consolidated, {
      supersede: [FIRST_ID],
    });
    const persisted = parseLearningsFile(await readFile(learningsPath, "utf8"));
    expect(persisted.map(entry => entry.id)).toEqual([
      SECOND_ID,
      CONSOLIDATED_ID,
    ]);
  });

  it("replaces an entry in place when superseding its own id", async () => {
    await persistLearningEntry(tempDir, BASE_ENTRY);
    const replacement = { ...BASE_ENTRY, rule: "Sharper replacement rule." };
    await persistConsolidatedLearning(tempDir, replacement, {
      supersede: [BASE_ENTRY.id],
    });
    const persisted = parseLearningsFile(await readFile(learningsPath, "utf8"));
    expect(persisted).toEqual([replacement]);
  });

  it("merges multiple related entries into one consolidated entry", async () => {
    await persistLearningEntry(tempDir, numberedEntry(1));
    await persistLearningEntry(tempDir, numberedEntry(2));
    await persistLearningEntry(tempDir, numberedEntry(3));
    const merged = {
      ...BASE_ENTRY,
      id: "learning-merged",
      rule: "One rule covering what rules 1 and 2 each half-covered.",
    };
    await persistConsolidatedLearning(tempDir, merged, {
      supersede: [FIRST_ID, SECOND_ID],
    });
    const persisted = parseLearningsFile(await readFile(learningsPath, "utf8"));
    expect(persisted.map(entry => entry.id)).toEqual([
      "learning-3",
      "learning-merged",
    ]);
  });

  it("appends when no supersede is requested, preserving existing entries", async () => {
    await persistLearningEntry(tempDir, numberedEntry(1));
    await persistConsolidatedLearning(tempDir, numberedEntry(2));
    const persisted = parseLearningsFile(await readFile(learningsPath, "utf8"));
    expect(persisted.map(entry => entry.id)).toEqual([FIRST_ID, SECOND_ID]);
  });

  it("treats an explicit empty supersede array exactly like an append", async () => {
    await persistLearningEntry(tempDir, numberedEntry(1));
    await persistConsolidatedLearning(tempDir, numberedEntry(2), {
      supersede: [],
    });
    const persisted = parseLearningsFile(await readFile(learningsPath, "utf8"));
    expect(persisted.map(entry => entry.id)).toEqual([FIRST_ID, SECOND_ID]);
    await expect(
      persistConsolidatedLearning(
        tempDir,
        { ...numberedEntry(2), rule: "Different rule." },
        { supersede: [] }
      )
    ).rejects.toThrow(/duplicate.*id/i);
  });

  it("still throws on a duplicate id when no supersede is requested", async () => {
    await persistLearningEntry(tempDir, BASE_ENTRY);
    const before = await readFile(learningsPath, "utf8");
    await expect(
      persistConsolidatedLearning(tempDir, {
        ...BASE_ENTRY,
        rule: "Different rule.",
      })
    ).rejects.toThrow(/duplicate.*id/i);
    expect(await readFile(learningsPath, "utf8")).toBe(before);
  });

  it("persists the learning even when the supersede target is absent", async () => {
    // Semantics changed deliberately (CodySwannGT/lisa#1995): this previously
    // threw `Cannot supersede unknown learning id(s)`. Under concurrency an
    // already-consolidated target is indistinguishable from a bogus one, and
    // throwing discarded the writer's ENTIRE learning — the data loss this
    // issue is about. "Replace X with Y" is satisfied when X is already gone,
    // so the write proceeds and the absence is reported instead.
    await persistLearningEntry(tempDir, BASE_ENTRY);
    const absent: string[][] = [];
    await persistConsolidatedLearning(
      tempDir,
      { ...BASE_ENTRY, id: NEW_ID },
      {
        supersede: [MISSING_ID],
        onAbsentSupersede: ids => absent.push([...ids]),
      }
    );
    const persisted = parseLearningsFile(
      await readFile(learningsPath, "utf8")
    ).map(entry => entry.id);
    expect(persisted).toEqual(
      [BASE_ENTRY.id, NEW_ID].sort((left, right) => left.localeCompare(right))
    );
    expect(absent).toEqual([[MISSING_ID]]);
  });

  it("leaves unrelated entries untouched when the supersede target is absent", async () => {
    await persistLearningEntry(tempDir, BASE_ENTRY);
    await persistConsolidatedLearning(
      tempDir,
      { ...BASE_ENTRY, id: NEW_ID },
      { supersede: [MISSING_ID] }
    );
    const persisted = parseLearningsFile(await readFile(learningsPath, "utf8"));
    expect(persisted.find(entry => entry.id === BASE_ENTRY.id)?.rule).toBe(
      BASE_ENTRY.rule
    );
  });

  it("frees entry-budget room by superseding at maxEntries", async () => {
    for (let index = 0; index < LEARNINGS_CONTRACT.maxEntries; index += 1) {
      await persistLearningEntry(tempDir, numberedEntry(index));
    }
    await persistConsolidatedLearning(
      tempDir,
      { ...BASE_ENTRY, id: CONSOLIDATED_ID, rule: "Merged rule." },
      { supersede: ["learning-0"] }
    );
    const persisted = parseLearningsFile(await readFile(learningsPath, "utf8"));
    expect(persisted).toHaveLength(LEARNINGS_CONTRACT.maxEntries);
    expect(persisted.some(entry => entry.id === "learning-0")).toBe(false);
  });

  it("re-asserts the entry budget when appending at maxEntries", async () => {
    for (let index = 0; index < LEARNINGS_CONTRACT.maxEntries; index += 1) {
      await persistLearningEntry(tempDir, numberedEntry(index));
    }
    const before = await readFile(learningsPath, "utf8");
    await expect(
      persistConsolidatedLearning(
        tempDir,
        numberedEntry(LEARNINGS_CONTRACT.maxEntries)
      )
    ).rejects.toThrow(/maxEntries/i);
    expect(await readFile(learningsPath, "utf8")).toBe(before);
  });

  it("re-asserts the token budget even when superseding", async () => {
    await persistLearningEntry(tempDir, BASE_ENTRY);
    const before = await readFile(learningsPath, "utf8");
    await expect(
      persistConsolidatedLearning(
        tempDir,
        {
          ...BASE_ENTRY,
          id: "learning-over-token-budget",
          why: "x".repeat(LEARNINGS_CONTRACT.maxTokens + 1),
        },
        { supersede: [BASE_ENTRY.id] }
      )
    ).rejects.toThrow(/maxTokens/i);
    expect(await readFile(learningsPath, "utf8")).toBe(before);
  });

  it("rejects a malformed supersede list before touching the file", async () => {
    await persistLearningEntry(tempDir, BASE_ENTRY);
    const before = await readFile(learningsPath, "utf8");
    await expect(
      persistConsolidatedLearning(
        tempDir,
        { ...BASE_ENTRY, id: NEW_ID },
        { supersede: ["", BASE_ENTRY.id] }
      )
    ).rejects.toThrow(/supersede/i);
    expect(await readFile(learningsPath, "utf8")).toBe(before);
  });

  it("validates the candidate through the shared entry contract", async () => {
    await expect(
      persistConsolidatedLearning(tempDir, {
        ...BASE_ENTRY,
        confidence: "certain",
      })
    ).rejects.toThrow(/confidence/i);
  });
});
