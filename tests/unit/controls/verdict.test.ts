/**
 * What verdict a requirement gets from the controls that serve it and the
 * evidence on record (CodySwannGT/lisa#4998).
 *
 * The verdict is what an operator shows to someone else, so it is computed
 * by code from the register and the evidence alone, and it never rounds a
 * missing answer up: unknown is never conforming.
 */
import { describe, expect, it } from "vitest";

import {
  entryServing,
  EXPIRY,
  halfRecord,
  heldPair,
  observedRecord,
} from "./support/evidence-samples.js";
import { API, of, REVIEW, si7, verdictOf, WEB } from "./support/verdict-run.js";

/** The word for a requirement that is not met. */
const NON_CONFORMING = "non-conforming";

describe("a requirement served by a control", () => {
  it("is conforming when both halves of the control's proof held", () => {
    expect(si7(heldPair(API))).toMatchObject({
      criterion: "SI7",
      verdict: "conforming",
      reason: "control-proved",
      kind: "gate",
      minimum_rung: "exercised",
      rung: "exercised",
      entries: [API],
      evidence: [`${API}/commit/clean/SI7`, `${API}/commit/violation/SI7`],
      fact: null,
    });
  });

  it("is non-conforming when the violating change was let through", () => {
    const records = [
      halfRecord(API, "violation", "SI7", {
        result: "failed",
        reason: "accepted",
        detail: "The check let the violating change through.",
      }),
      halfRecord(API, "clean"),
    ];

    expect(si7(records)).toMatchObject({
      verdict: NON_CONFORMING,
      reason: "control-failed",
      rung: null,
    });
    expect(si7(records).detail).toContain(
      "The check let the violating change through."
    );
  });

  it("is non-conforming when the clean change was turned away", () => {
    expect(
      si7([
        halfRecord(API, "violation"),
        halfRecord(API, "clean", "SI7", { result: "failed" }),
      ]).verdict
    ).toBe(NON_CONFORMING);
  });

  it("is unknown when no proof of the control is on record", () => {
    expect(si7([])).toMatchObject({
      verdict: "unknown",
      reason: "no-evidence",
      evidence: [],
    });
  });

  it.each([
    ["only one half is on record", [halfRecord(API, "violation")]],
    [
      "a half gave no answer",
      [
        halfRecord(API, "violation"),
        halfRecord(API, "clean", "SI7", { result: "unknown" }),
      ],
    ],
    [
      "the two halves were run at different moments",
      [
        halfRecord(API, "violation"),
        halfRecord(API, "clean", "SI7", { moment: "push" }),
      ],
    ],
  ])("is unknown when %s", (_name, records) => {
    expect(si7(records)).toMatchObject({
      verdict: "unknown",
      reason: "proof-incomplete",
    });
  });

  it("is unknown when the only evidence is weaker than it needs", () => {
    const verdict = si7([observedRecord(API)]);

    expect(verdict).toMatchObject({
      verdict: "unknown",
      reason: "rung-too-low",
    });
    expect(verdict.detail).toContain("observed");
    expect(verdict.detail).toContain("exercised");
  });

  it("is conforming on observed evidence when that is all it needs", () => {
    const verdict = verdictOf([REVIEW], [observedRecord("review@.", "AC1.3")]);

    expect(of(verdict, "AC1.3")).toMatchObject({
      verdict: "conforming",
      rung: "observed",
    });
  });

  it("is non-conforming when the platform does not require its check, whatever a local proof showed", () => {
    expect(
      si7([...heldPair(API), observedRecord(API, "SI7", { result: "failed" })])
        .verdict
    ).toBe(NON_CONFORMING);
  });

  it("is judged on every control that serves it", () => {
    const entries = [entryServing(API), entryServing(WEB)];

    expect(of(verdictOf(entries, heldPair(API))).verdict).toBe("unknown");
    expect(
      of(verdictOf(entries, [...heldPair(API), ...heldPair(WEB)]))
    ).toMatchObject({ verdict: "conforming", entries: [API, WEB] });
  });

  it("is not helped by a record of a control the register does not hold, or for another requirement", () => {
    expect(si7(heldPair("code-style@gone")).verdict).toBe("unknown");
    expect(si7(heldPair(API, "AC1.3")).verdict).toBe("unknown");
  });
});

describe("evidence that is not current", () => {
  it("leaves the requirement conforming until its lifetime is over", () => {
    expect(si7(heldPair(API), new Date(EXPIRY.getTime() - 1)).verdict).toBe(
      "conforming"
    );
  });

  it("makes the requirement unknown once its lifetime is over", () => {
    const verdict = si7(heldPair(API), EXPIRY);

    expect(verdict).toMatchObject({
      verdict: "unknown",
      reason: "stale-evidence",
      rung: null,
    });
    expect(verdict.detail).toContain(EXPIRY.toISOString());
  });

  it("makes the requirement unknown when one record of several is too old", () => {
    const records = [
      halfRecord(API, "violation", "SI7", { freshness_seconds: 30 }),
      halfRecord(API, "clean"),
    ];

    expect(si7(records).verdict).toBe("unknown");
  });

  it("makes the requirement unknown when it is dated later than now", () => {
    expect(
      si7(heldPair(API), new Date("2026-11-17T11:00:00.000Z"))
    ).toMatchObject({ verdict: "unknown", reason: "evidence-dated-later" });
  });

  it("does not hide a failure that is still current", () => {
    const records = [
      halfRecord(API, "violation", "SI7", { result: "failed" }),
      halfRecord(API, "clean", "SI7", { freshness_seconds: 30 }),
    ];

    expect(si7(records).verdict).toBe(NON_CONFORMING);
  });

  it("no longer shows a failure once the record of it is too old", () => {
    expect(
      si7([halfRecord(API, "violation", "SI7", { result: "failed" })], EXPIRY)
        .verdict
    ).toBe("unknown");
  });
});
