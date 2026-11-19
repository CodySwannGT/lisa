/**
 * The overall Level 1 result of a verdict (CodySwannGT/lisa#4998).
 *
 * It is conforming only when every in-scope requirement is conforming or not
 * applicable. One requirement that is unknown is enough to prevent it, and
 * the verdict names each requirement that does.
 */
import { describe, expect, it } from "vitest";

import {
  entryServing,
  halfRecord,
  heldPair,
} from "./support/evidence-samples.js";
import {
  API,
  of,
  OTHERS_SETTLED,
  REVIEW,
  verdictOf,
} from "./support/verdict-run.js";

describe("the Level 1 result", () => {
  it("is conforming when every requirement is conforming or not applicable", () => {
    const verdict = verdictOf(
      [entryServing(API), REVIEW],
      [...heldPair(API), ...OTHERS_SETTLED]
    );

    expect(verdict.result).toBe("conforming");
    expect(verdict.prevented_by).toEqual([]);
    expect(verdict.counts).toEqual({
      conforming: 3,
      "non-conforming": 0,
      unknown: 0,
      "not-applicable": 1,
    });
  });

  it("is non-conforming, and names the requirement, when one is unknown", () => {
    const verdict = verdictOf([entryServing(API), REVIEW], OTHERS_SETTLED);

    expect(of(verdict).verdict).toBe("unknown");
    expect(verdict.result).toBe("non-conforming");
    expect(verdict.prevented_by).toEqual(["SI7"]);
  });

  it("names every requirement that prevents it, in the catalogue's order", () => {
    const verdict = verdictOf([], []);

    expect(verdict.result).toBe("non-conforming");
    expect(verdict.prevented_by).toEqual(["AC1.3", "AC1.4", "AC1.1", "SI7"]);
  });

  it("covers the in-scope requirements and no other", () => {
    expect(verdictOf([], []).criteria.map(each => each.criterion)).toEqual([
      "AC1.3",
      "AC1.4",
      "AC1.1",
      "SI7",
    ]);
  });

  it("says which requirements it was computed against", () => {
    expect(verdictOf([], []).requirements).toEqual({
      specification: "spec/sample.md",
      specification_version: "0.0.1",
      level: 1,
      sha256: expect.stringMatching(/^[0-9a-f]{64}$/u) as unknown,
    });
  });

  it("says how recent its evidence is and when it stops being current", () => {
    const verdict = verdictOf(
      [entryServing(API)],
      [
        halfRecord(API, "violation", "SI7", { freshness_seconds: 3600 }),
        halfRecord(API, "clean", "SI7", {
          completed_at: "2026-11-17T12:00:30.000Z",
        }),
      ]
    );

    expect(verdict.evidence_as_of).toBe("2026-11-17T12:00:30.000Z");
    expect(verdict.current_until).toBe("2026-11-17T13:00:00.000Z");
  });

  it("has neither time when there is no evidence", () => {
    expect(verdictOf([], [])).toMatchObject({
      evidence_as_of: null,
      current_until: null,
    });
  });
});
