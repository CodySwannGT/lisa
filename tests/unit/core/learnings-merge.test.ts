/**
 * Three-way union-by-id merge for the project-learnings ledger.
 *
 * Each learner pass runs on its own `learning/<fingerprint>` branch in its own
 * worktree, so the fs-level write lock never sees the competing writer and the
 * collision surfaces at merge time as conflict markers (CodySwannGT/lisa#1995).
 * The ledger's shape makes a real union tractable: one JSON object per line,
 * sorted by id, duplicate ids already rejected.
 *
 * The merge is deliberately THREE-way, not a naive union of the two sides. A
 * two-way union cannot distinguish "the other branch never had this entry" from
 * "the other branch deliberately superseded this entry", so it would resurrect
 * consolidated entries and silently undo the write-time consolidation the
 * writer exists to perform. Comparing each side against the merge base is what
 * makes a supersede survive.
 */
import { describe, expect, it } from "vitest";
import {
  LEARNINGS_CONTRACT,
  type LearningEntry,
} from "../../../src/core/learnings-contract.js";
import { renderLearningsFile } from "../../../src/core/learnings-document.js";
import { mergeLearningsDocuments } from "../../../src/core/learnings-merge.js";

const CAPTURED_ON = "2026-07-16";
const SHARED = "shared";
const FROM_THEIRS = "from-theirs";

/**
 * Build one valid entry.
 * @param id - Stable entry id
 * @param overrides - Field overrides
 * @returns Valid learning entry
 */
function entry(
  id: string,
  overrides: Partial<LearningEntry> = {}
): LearningEntry {
  return {
    id,
    rule: `Rule for ${id}.`,
    why: `Reason for ${id}.`,
    provenance: [`issue:#${id}`],
    first_learned: CAPTURED_ON,
    last_confirmed: CAPTURED_ON,
    confidence: "high",
    ...overrides,
  };
}

/**
 * Render a document from ids or entries.
 * @param entries - Entries to render, in any order
 * @returns Canonical document
 */
function doc(entries: readonly LearningEntry[]): string {
  return renderLearningsFile(
    [...entries].sort((left, right) => left.id.localeCompare(right.id))
  );
}

/**
 * Extract the merged entry ids, failing the test on a conflict.
 * @param result - Merge result under test
 * @returns Sorted entry ids
 */
function mergedIds(
  result: ReturnType<typeof mergeLearningsDocuments>
): readonly string[] {
  expect(result.kind).toBe("merged");
  if (result.kind !== "merged") return [];
  return result.content
    .split("\n")
    .filter(line => line.startsWith("{"))
    .map(line => (JSON.parse(line) as LearningEntry).id);
}

describe("mergeLearningsDocuments", () => {
  it("unions two branches that each captured a different learning", () => {
    const base = doc([entry(SHARED)]);
    const ours = doc([entry(SHARED), entry("from-ours")]);
    const theirs = doc([entry(SHARED), entry(FROM_THEIRS)]);
    expect(mergedIds(mergeLearningsDocuments(base, ours, theirs))).toEqual([
      "from-ours",
      FROM_THEIRS,
      SHARED,
    ]);
  });

  it("unions two branches that both started from an empty ledger", () => {
    const ours = doc([entry("from-ours")]);
    const theirs = doc([entry(FROM_THEIRS)]);
    expect(mergedIds(mergeLearningsDocuments(undefined, ours, theirs))).toEqual(
      ["from-ours", FROM_THEIRS]
    );
  });

  it("does not resurrect an entry our branch superseded", () => {
    // The consolidation case: our branch merged `stale` into `consolidated`.
    // Their branch simply never saw the removal. A naive two-way union would
    // bring `stale` back and silently undo the consolidation.
    const base = doc([entry("keep"), entry("stale")]);
    const ours = doc([entry("keep"), entry("consolidated")]);
    const theirs = doc([entry("keep"), entry("stale"), entry(FROM_THEIRS)]);
    expect(mergedIds(mergeLearningsDocuments(base, ours, theirs))).toEqual([
      "consolidated",
      FROM_THEIRS,
      "keep",
    ]);
  });

  it("does not resurrect an entry their branch superseded", () => {
    const base = doc([entry("keep"), entry("stale")]);
    const ours = doc([entry("keep"), entry("stale"), entry("from-ours")]);
    const theirs = doc([entry("keep"), entry("consolidated")]);
    expect(mergedIds(mergeLearningsDocuments(base, ours, theirs))).toEqual([
      "consolidated",
      "from-ours",
      "keep",
    ]);
  });

  it("keeps an entry both branches superseded removed", () => {
    const base = doc([entry("keep"), entry("stale")]);
    const ours = doc([entry("keep")]);
    const theirs = doc([entry("keep")]);
    expect(mergedIds(mergeLearningsDocuments(base, ours, theirs))).toEqual([
      "keep",
    ]);
  });

  it("takes the later confirmation when both branches only re-confirmed", () => {
    const base = doc([entry(SHARED, { last_confirmed: CAPTURED_ON })]);
    const ours = doc([entry(SHARED, { last_confirmed: "2026-07-18" })]);
    const theirs = doc([entry(SHARED, { last_confirmed: "2026-07-20" })]);
    const result = mergeLearningsDocuments(base, ours, theirs);
    expect(result.kind).toBe("merged");
    if (result.kind !== "merged") return;
    expect(result.content).toContain('"last_confirmed":"2026-07-20"');
    expect(result.content).not.toContain('"last_confirmed":"2026-07-18"');
  });

  it("accepts an identical edit made on both branches", () => {
    const base = doc([entry(SHARED)]);
    const edited = doc([entry(SHARED, { rule: "Rewritten rule." })]);
    const result = mergeLearningsDocuments(base, edited, edited);
    expect(mergedIds(result)).toEqual([SHARED]);
    expect(result.kind === "merged" && result.content).toContain(
      "Rewritten rule."
    );
  });

  it("refuses to pick a winner when both branches rewrote the same entry", () => {
    const base = doc([entry(SHARED)]);
    const ours = doc([entry(SHARED, { rule: "Our rewrite." })]);
    const theirs = doc([entry(SHARED, { rule: "Their rewrite." })]);
    const result = mergeLearningsDocuments(base, ours, theirs);
    expect(result.kind).toBe("conflict");
    expect(result.kind === "conflict" && result.reason).toMatch(/shared/);
  });

  it("refuses to let a re-confirmation quietly discard a rewrite", () => {
    // Preferring the later `last_confirmed` unconditionally would drop their
    // rewritten rule on the floor. A confirmation bump only wins when it is
    // the ONLY difference.
    const base = doc([entry(SHARED)]);
    const ours = doc([entry(SHARED, { last_confirmed: "2026-07-20" })]);
    const theirs = doc([entry(SHARED, { rule: "Their rewrite." })]);
    expect(mergeLearningsDocuments(base, ours, theirs).kind).toBe("conflict");
  });

  it("emits a canonical document the parser and budget gate accept", () => {
    const base = doc([entry(SHARED)]);
    const ours = doc([entry(SHARED), entry("from-ours")]);
    const theirs = doc([entry(SHARED), entry(FROM_THEIRS)]);
    const result = mergeLearningsDocuments(base, ours, theirs);
    expect(result.kind).toBe("merged");
    if (result.kind !== "merged") return;
    expect(result.content).toBe(
      doc([entry("from-ours"), entry(FROM_THEIRS), entry(SHARED)])
    );
  });

  it("fails loudly rather than emitting an over-entry-count ledger", () => {
    const half = Math.ceil((LEARNINGS_CONTRACT.maxEntries + 2) / 2);
    const ours = doc(
      Array.from({ length: half }, (_unused, index) => entry(`ours-${index}`))
    );
    const theirs = doc(
      Array.from({ length: half }, (_unused, index) => entry(`theirs-${index}`))
    );
    const result = mergeLearningsDocuments(undefined, ours, theirs);
    expect(result.kind).toBe("conflict");
    expect(result.kind === "conflict" && result.reason).toMatch(
      /maxEntries|maxTokens/
    );
  });

  it("fails loudly rather than emitting an over-byte-budget ledger", () => {
    const fat = "x".repeat(Math.floor(LEARNINGS_CONTRACT.maxTokens / 2));
    const ours = doc([entry("ours", { why: fat })]);
    const theirs = doc([entry("theirs", { why: fat })]);
    const result = mergeLearningsDocuments(undefined, ours, theirs);
    expect(result.kind).toBe("conflict");
    expect(result.kind === "conflict" && result.reason).toMatch(/maxTokens/);
  });

  it("refuses to consume a side that already carries conflict markers", () => {
    const base = doc([entry(SHARED)]);
    const ours = doc([entry(SHARED)]).replace(
      "```jsonl\n",
      "```jsonl\n<<<<<<< HEAD\n"
    );
    const theirs = doc([entry(SHARED), entry(FROM_THEIRS)]);
    const result = mergeLearningsDocuments(base, ours, theirs);
    expect(result.kind).toBe("conflict");
    expect(result.kind === "conflict" && result.reason).toMatch(
      /conflict marker/i
    );
  });

  it("refuses to consume a side that is not a canonical ledger", () => {
    const result = mergeLearningsDocuments(
      undefined,
      "not a ledger at all",
      doc([entry("theirs")])
    );
    expect(result.kind).toBe("conflict");
  });
});
