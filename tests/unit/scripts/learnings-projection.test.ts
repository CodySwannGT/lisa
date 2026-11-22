/**
 * The learnings read path: flows load the ledger's bounded projection at the
 * start of work instead of never reading it back.
 * @module tests/unit/scripts/learnings-projection
 */
import { describe, expect, it } from "vitest";

import { projectLearnings } from "../../../src/core/learnings-projection.js";
import {
  buildProjection,
  parseMatch,
} from "../../../plugins/src/base/scripts/learnings-projection.mjs";

const entry = (id: string, rule: string) => ({
  id,
  fingerprint: `fp-${id}`,
  rule,
  why: `why ${id}`,
  provenance: ["#1"],
  first_learned: "2026-01-01",
  last_confirmed: "2026-01-01",
  confidence: "high",
});

describe("learnings-projection", () => {
  it("returns no filter when --match is absent", () => {
    expect(parseMatch([])).toBeNull();
  });

  it("refuses --match with no expression", () => {
    expect(() => parseMatch(["--match"])).toThrow(/--match/);
  });

  it("serves id, rule, why and confidence for every kept entry", () => {
    const parsed = [
      entry("a", "Use pnpm."),
      entry("b", "Planning (prd): name the env."),
    ];
    const result = buildProjection({ projectLearnings }, parsed, null);
    expect(result.omitted).toEqual([]);
    expect(result.entries.map(e => (e as { id: string }).id)).toEqual(
      expect.arrayContaining(["a", "b"])
    );
    expect(result.entries[0]).toEqual({
      id: expect.any(String),
      rule: expect.any(String),
      why: expect.any(String),
      confidence: "high",
    });
  });

  it("projects over the matched subset only", () => {
    const parsed = [
      entry("a", "Use pnpm."),
      entry("b", "Planning (prd): name the env."),
    ];
    const result = buildProjection(
      { projectLearnings },
      parsed,
      parseMatch(["--match", "^Planning \\("])
    );
    expect(result.entries.map(e => (e as { id: string }).id)).toEqual(["b"]);
    expect(result.omitted).toEqual([]);
  });
});
