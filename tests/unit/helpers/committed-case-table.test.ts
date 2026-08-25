/**
 * The drift guard's own bite, pinned rather than assumed.
 *
 * @remarks
 * `committed-case-table.ts` exists because a control can report success while
 * proving nothing. A guard whose failure path nothing exercises is that same
 * defect one level down, so every branch of the comparison is asserted here —
 * including the one that matters most and is easiest to get wrong: two empty
 * sets are CLEAN, because an empty table is a legitimate end state
 * (CodySwannGT/lisa#3043).
 * @module tests/unit/helpers/committed-case-table
 */
import { describe, expect, it } from "vitest";

import {
  caseTableDrift,
  committedCaseTable,
} from "../../helpers/committed-case-table.js";

describe("caseTableDrift", () => {
  it("reports no drift when the live keys match what is committed", () => {
    expect(caseTableDrift("exemption", ["a", "b"], ["a", "b"])).toBeNull();
  });

  it("reports no drift when both sides are empty", () => {
    // The state `UNGATED_QUALITY_JOBS` is in today, and the reason this guard
    // commits a key set instead of asserting non-emptiness: reaching zero is
    // the goal, so zero must not be a failure.
    expect(caseTableDrift("exemption", [], [])).toBeNull();
  });

  it("ignores ordering, since neither side is an ordered list", () => {
    expect(caseTableDrift("exemption", ["b", "a"], ["a", "b"])).toBeNull();
  });

  it("names a key that disappeared, and says its assertions stopped running", () => {
    const message = caseTableDrift("exemption", [], ["zap_baseline"]);

    expect(message).toContain("DISAPPEARED");
    expect(message).toContain("zap_baseline");
    expect(message).toContain("their assertions no longer run");
    expect(message).not.toContain("APPEARED (never reviewed)");
  });

  it("names a key that appeared, so a new case cannot arrive unreviewed", () => {
    const message = caseTableDrift("exemption", ["snyk"], []);

    expect(message).toContain("APPEARED");
    expect(message).toContain("snyk");
    expect(message).not.toContain("DISAPPEARED");
  });

  it("names both directions when a key is swapped for another", () => {
    const message = caseTableDrift("exemption", ["new_job"], ["old_job"]);

    expect(message).toContain("DISAPPEARED");
    expect(message).toContain("old_job");
    expect(message).toContain("APPEARED");
    expect(message).toContain("new_job");
  });

  it("names the subject, so a failure says which table drifted", () => {
    expect(caseTableDrift("dual-control", ["x"], [])).toContain(
      "The dual-control case table"
    );
  });

  it("tells the reader the empty-table failure mode by name", () => {
    // The message is the whole point: someone reading a red tick has to learn
    // that cases can vanish silently, not just that two arrays differ.
    expect(caseTableDrift("exemption", [], ["gone"])).toContain(
      "registers ZERO cases and the file still reports green"
    );
  });
});

describe("committedCaseTable", () => {
  const TABLE = Object.freeze({ alpha: 1, beta: 2 });

  // Registers the guard for TABLE alongside the assertions below, which is
  // also the only way to exercise the registration path from a test.
  const entries = committedCaseTable("fixture", TABLE, ["alpha", "beta"]);

  it("returns the table's entries, ready for .each", () => {
    expect(entries).toEqual([
      ["alpha", 1],
      ["beta", 2],
    ]);
  });

  it.each(entries)("registers a case for %s", (key, value) => {
    expect(TABLE[key as keyof typeof TABLE]).toBe(value);
  });
});
