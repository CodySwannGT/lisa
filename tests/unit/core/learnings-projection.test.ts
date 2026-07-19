/**
 * Unit tests for the bounded learnings projection — the serving slice the
 * contract exposes so agents consume only the top-priority, budget-bounded
 * entries instead of the raw ledger. The projection is pure: it never touches
 * disk and never mutates its input.
 * @module tests/unit/core/learnings-projection
 */
import { describe, expect, it } from "vitest";
import {
  LEARNINGS_CONTRACT,
  estimateLearningTokens,
  type LearningConfidence,
  type LearningEntry,
} from "../../../src/core/learnings-contract.js";
import { projectLearnings } from "../../../src/core/learnings-projection.js";

/** Shared baseline ISO date used wherever the fixture value is irrelevant. */
const BASE_DATE = "2026-01-01";

/**
 * Build one structurally valid entry with overridable ordering fields.
 * @param id - Stable identifier
 * @param overrides - Fields replaced for a specific ordering fixture
 * @returns A learning entry
 */
function makeEntry(
  id: string,
  overrides: Partial<LearningEntry> = {}
): LearningEntry {
  return {
    id,
    rule: "r",
    why: "w",
    provenance: ["p"],
    first_learned: BASE_DATE,
    last_confirmed: BASE_DATE,
    confidence: "low",
    ...overrides,
  };
}

describe("projectLearnings", () => {
  it("returns every entry with omittedCount 0 when well within budget", () => {
    const entries = [makeEntry("a"), makeEntry("b"), makeEntry("c")];

    const projection = projectLearnings(entries);

    expect(projection.omittedCount).toBe(0);
    expect(projection.entries).toHaveLength(3);
  });

  it("orders by confidence desc, then last_confirmed desc, then id asc", () => {
    const entries = [
      makeEntry("low-recent", {
        confidence: "low",
        last_confirmed: "2026-05-01",
      }),
      makeEntry("high-old", {
        confidence: "high",
        last_confirmed: BASE_DATE,
      }),
      makeEntry("high-new-b", {
        confidence: "high",
        last_confirmed: "2026-06-01",
      }),
      makeEntry("high-new-a", {
        confidence: "high",
        last_confirmed: "2026-06-01",
      }),
      makeEntry("medium", {
        confidence: "medium",
        last_confirmed: "2026-09-01",
      }),
    ];

    const projection = projectLearnings(entries);

    expect(projection.entries.map(entry => entry.id)).toEqual([
      // high confidence first; within high, newest last_confirmed first;
      // tie on (high, 2026-06-01) broken by id ascending
      "high-new-a",
      "high-new-b",
      "high-old",
      "medium",
      "low-recent",
    ]);
  });

  it("keeps the highest-priority prefix and reports omittedCount when maxEntries is exceeded", () => {
    const entries = Array.from(
      { length: LEARNINGS_CONTRACT.maxEntries + 3 },
      (_unused, index) =>
        makeEntry(`id-${String(index).padStart(3, "0")}`, {
          confidence: "high",
          last_confirmed: BASE_DATE,
        })
    );

    const projection = projectLearnings(entries);

    expect(projection.entries).toHaveLength(LEARNINGS_CONTRACT.maxEntries);
    expect(projection.omittedCount).toBe(3);
    // id ascending is the final tiebreak, so the retained prefix is id-000..
    expect(projection.entries[0]?.id).toBe("id-000");
  });

  it("stops accumulating once the next entry would exceed maxTokens", () => {
    // Each big entry's rendered JSON is a large, deterministic byte count.
    const bigRule = "x".repeat(200);
    const perEntryTokens = estimateLearningTokens(
      JSON.stringify(makeEntry("id-00", { rule: bigRule, confidence: "high" }))
    );
    // Choose a count whose cumulative rendered size overshoots the token budget.
    const count = Math.ceil(LEARNINGS_CONTRACT.maxTokens / perEntryTokens) + 2;
    const entries = Array.from({ length: count }, (_unused, index) =>
      makeEntry(`id-${String(index).padStart(2, "0")}`, {
        rule: bigRule,
        confidence: "high",
      })
    );

    const projection = projectLearnings(entries);

    const renderedTokens = projection.entries.reduce(
      (sum, entry) => sum + estimateLearningTokens(JSON.stringify(entry)),
      0
    );
    expect(renderedTokens).toBeLessThanOrEqual(LEARNINGS_CONTRACT.maxTokens);
    expect(projection.entries.length).toBeLessThan(count);
    expect(projection.omittedCount).toBe(count - projection.entries.length);
  });

  it("is pure — it neither mutates nor reorders the caller's array", () => {
    const entries: readonly LearningEntry[] = [
      makeEntry("z", { confidence: "low" }),
      makeEntry("a", { confidence: "high" }),
    ];
    const snapshot = entries.map(entry => entry.id);

    projectLearnings(entries);

    expect(entries.map(entry => entry.id)).toEqual(snapshot);
  });

  it("returns an empty projection for no entries", () => {
    const projection = projectLearnings([]);

    expect(projection.entries).toEqual([]);
    expect(projection.omittedCount).toBe(0);
  });

  it("ranks every confidence level correctly", () => {
    const levels: readonly LearningConfidence[] = ["low", "medium", "high"];
    const entries = levels.map(level =>
      makeEntry(level, { confidence: level })
    );

    const projection = projectLearnings(entries);

    expect(projection.entries.map(entry => entry.confidence)).toEqual([
      "high",
      "medium",
      "low",
    ]);
  });
});
