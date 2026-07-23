/**
 * Reference survival across supersede-in-place (CodySwannGT/lisa#1997).
 *
 * Consolidation mints a new id for the consolidated entry, so every external
 * reference to a superseded id — a tracker comment, a cross-link from another
 * learning, a gardener ticket citing the entry — used to break silently. These
 * tests pin the alias contract that fixes it: the consolidated entry records
 * `supersedes:<old id>` in its provenance, and a reader resolves an old id to
 * the entry that now carries its content in ONE hop.
 *
 * They equally pin what the fix must NOT disturb, because #1997 sits directly on
 * top of #1995: ids still churn (that churn is the writer's accidental
 * compare-and-swap token), the losing writer's learning is still preserved, the
 * absent-supersede diagnostic still fires, and the duplicate-id throw that IS
 * the dedupe model still throws.
 */
import { readFile } from "node:fs/promises";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildSupersedesReference,
  resolveLearningReference,
  resolveLearningReferences,
} from "../../../src/core/learnings-alias.js";
import {
  parseLearningsFile,
  persistConsolidatedLearning,
  persistLearningEntry,
} from "../../../src/core/learnings-writer.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

const LEARNINGS_FILENAME = "PROJECT_LEARNINGS.md";
const ORIGINAL_ID = "learner-aaaa1111";
const SECOND_ID = "learner-bbbb2222";
const THIRD_ID = "learner-cccc3333";
const FOURTH_ID = "learner-dddd4444";
const FIRST_DATE = "2026-07-01";
const SECOND_DATE = "2026-07-02";
const THIRD_DATE = "2026-07-03";
const ORIGINAL_RULE = "Original rule.";
const SECOND_RULE = "Second rule.";
const CONSOLIDATED_RULE = "Consolidated rule.";

/**
 * Build a valid entry with caller-chosen id, date, and rule text.
 * @param id - Stable entry id
 * @param firstLearned - ISO `first_learned` (also used as `last_confirmed`)
 * @param rule - Rule text
 * @returns Valid seven-field entry
 */
function entryOf(id: string, firstLearned: string, rule: string) {
  return {
    id,
    rule,
    why: "Reason the rule exists.",
    provenance: [`issue:#${id}`],
    first_learned: firstLearned,
    last_confirmed: firstLearned,
    confidence: "high",
  } as const;
}

describe("learnings reference survival across supersede", () => {
  let tempDir: string;
  let learningsPath: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
    learningsPath = path.join(tempDir, ".lisa", LEARNINGS_FILENAME);
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  /**
   * Read and parse the persisted ledger.
   * @returns Parsed entries
   */
  async function readEntries() {
    return parseLearningsFile(await readFile(learningsPath, "utf8"));
  }

  it("records the superseded id as a provenance alias on the consolidated entry", async () => {
    await persistLearningEntry(
      tempDir,
      entryOf(ORIGINAL_ID, FIRST_DATE, ORIGINAL_RULE)
    );
    await persistConsolidatedLearning(
      tempDir,
      entryOf(SECOND_ID, SECOND_DATE, CONSOLIDATED_RULE),
      { supersede: [ORIGINAL_ID] }
    );
    const entries = await readEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.id).toBe(SECOND_ID);
    expect(entries[0]?.provenance).toContain(
      buildSupersedesReference(ORIGINAL_ID)
    );
  });

  it("resolves a superseded id to the entry that now carries its content", async () => {
    await persistLearningEntry(
      tempDir,
      entryOf(ORIGINAL_ID, FIRST_DATE, ORIGINAL_RULE)
    );
    await persistConsolidatedLearning(
      tempDir,
      entryOf(SECOND_ID, SECOND_DATE, CONSOLIDATED_RULE),
      { supersede: [ORIGINAL_ID] }
    );
    const resolved = resolveLearningReference(await readEntries(), ORIGINAL_ID);
    expect(resolved?.id).toBe(SECOND_ID);
    expect(resolved?.rule).toBe(CONSOLIDATED_RULE);
  });

  it("resolves the oldest id in ONE hop after a chain of consolidations", async () => {
    await persistLearningEntry(
      tempDir,
      entryOf(ORIGINAL_ID, FIRST_DATE, "First rule.")
    );
    await persistConsolidatedLearning(
      tempDir,
      entryOf(SECOND_ID, SECOND_DATE, SECOND_RULE),
      { supersede: [ORIGINAL_ID] }
    );
    await persistConsolidatedLearning(
      tempDir,
      entryOf(THIRD_ID, THIRD_DATE, "Third rule."),
      { supersede: [SECOND_ID] }
    );
    const entries = await readEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.id).toBe(THIRD_ID);
    // Both ancestors resolve directly — no transitive walk, so no cycle or
    // depth limit for a reader to get wrong.
    expect(resolveLearningReference(entries, ORIGINAL_ID)?.id).toBe(THIRD_ID);
    expect(resolveLearningReference(entries, SECOND_ID)?.id).toBe(THIRD_ID);
  });

  it("records aliases for every target it actually removed", async () => {
    await persistLearningEntry(
      tempDir,
      entryOf(SECOND_ID, SECOND_DATE, "Rule b.")
    );
    await persistLearningEntry(
      tempDir,
      entryOf(THIRD_ID, THIRD_DATE, "Rule c.")
    );
    await persistConsolidatedLearning(
      tempDir,
      entryOf(FOURTH_ID, "2026-07-09", "Merged rule."),
      { supersede: [SECOND_ID, THIRD_ID] }
    );
    const entries = await readEntries();
    expect(resolveLearningReference(entries, SECOND_ID)?.id).toBe(FOURTH_ID);
    expect(resolveLearningReference(entries, THIRD_ID)?.id).toBe(FOURTH_ID);
  });

  it("claims no alias for an absent target, so the losing writer never hijacks it", async () => {
    // The #1995 race: only the writer that ACTUALLY removed the target may own
    // its reference. Otherwise every later writer would claim the same id and
    // the reference would resolve ambiguously.
    await persistLearningEntry(
      tempDir,
      entryOf(ORIGINAL_ID, FIRST_DATE, ORIGINAL_RULE)
    );
    await persistConsolidatedLearning(
      tempDir,
      entryOf(SECOND_ID, SECOND_DATE, "First winner."),
      { supersede: [ORIGINAL_ID] }
    );
    await persistConsolidatedLearning(
      tempDir,
      entryOf(THIRD_ID, THIRD_DATE, "Losing writer."),
      { supersede: [ORIGINAL_ID] }
    );
    const entries = await readEntries();
    expect(
      entries
        .map(entry => entry.id)
        .sort((left, right) => left.localeCompare(right))
    ).toEqual([SECOND_ID, THIRD_ID]);
    expect(
      resolveLearningReferences(entries, ORIGINAL_ID).map(e => e.id)
    ).toEqual([SECOND_ID]);
  });

  it("prefers a live id over any alias claiming it", async () => {
    await persistLearningEntry(
      tempDir,
      entryOf(ORIGINAL_ID, FIRST_DATE, "Live rule.")
    );
    await persistLearningEntry(
      tempDir,
      entryOf(SECOND_ID, SECOND_DATE, "Other rule.")
    );
    const entries = await readEntries();
    expect(resolveLearningReference(entries, ORIGINAL_ID)?.rule).toBe(
      "Live rule."
    );
  });

  it("adds no self-pointing alias when an entry supersedes its own id", async () => {
    // An in-place edit is not a rename, so it earns no alias. Without the
    // self-filter the entry would list itself as its own predecessor and burn
    // a provenance slot forever on a reference that resolves to itself.
    await persistLearningEntry(
      tempDir,
      entryOf(ORIGINAL_ID, FIRST_DATE, ORIGINAL_RULE)
    );
    await persistConsolidatedLearning(
      tempDir,
      entryOf(SECOND_ID, SECOND_DATE, SECOND_RULE),
      { supersede: [ORIGINAL_ID] }
    );
    await persistConsolidatedLearning(
      tempDir,
      entryOf(SECOND_ID, SECOND_DATE, "Sharper in-place rewrite."),
      { supersede: [SECOND_ID] }
    );

    const entries = await readEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.rule).toBe("Sharper in-place rewrite.");
    expect(entries[0]?.provenance).not.toContain(
      buildSupersedesReference(SECOND_ID)
    );
    // The inherited ancestor still carries, so the in-place edit does not drop
    // the lineage that already resolves through it.
    expect(entries[0]?.provenance).toContain(
      buildSupersedesReference(ORIGINAL_ID)
    );
    expect(resolveLearningReference(entries, ORIGINAL_ID)?.id).toBe(SECOND_ID);
  });

  it("keeps ids churning so the losing writer's learning still survives", async () => {
    // Guards the #1995 contract directly: carrying a superseded id forward
    // instead of aliasing it collapsed nine preserved learnings into one.
    await persistLearningEntry(
      tempDir,
      entryOf(ORIGINAL_ID, FIRST_DATE, ORIGINAL_RULE)
    );
    for (const index of [1, 2, 3, 4, 5]) {
      await persistConsolidatedLearning(
        tempDir,
        entryOf(`learner-writer${index}`, SECOND_DATE, `Rule ${index}.`),
        { supersede: [ORIGINAL_ID] }
      );
    }
    const entries = await readEntries();
    expect(entries).toHaveLength(5);
    expect(entries.map(entry => entry.id)).not.toContain(ORIGINAL_ID);
  });

  it("still rejects a duplicate id so aliasing cannot weaken dedupe", async () => {
    await persistLearningEntry(
      tempDir,
      entryOf(ORIGINAL_ID, FIRST_DATE, ORIGINAL_RULE)
    );
    await expect(
      persistLearningEntry(
        tempDir,
        entryOf(ORIGINAL_ID, "2026-07-04", "Colliding rule.")
      )
    ).rejects.toThrow(`Duplicate learning id: ${ORIGINAL_ID}`);
  });

  it("adds no alias on the append-only path", async () => {
    await persistLearningEntry(
      tempDir,
      entryOf(ORIGINAL_ID, FIRST_DATE, "First rule.")
    );
    const entries = await readEntries();
    expect(entries[0]?.provenance).toEqual([`issue:#${ORIGINAL_ID}`]);
  });
});
