/**
 * What verdict a requirement gets where no control in the register covers
 * it: the audit's own finding decides, at the strength an audit can give
 * (CodySwannGT/lisa#4998).
 *
 * An audit reads; it does not run anything. So its word is asserted
 * evidence, and it makes a requirement conforming only when asserted
 * evidence is all that requirement needs.
 */
import { describe, expect, it } from "vitest";

import {
  entryServing,
  EXPIRY,
  findingRecord,
  heldPair,
} from "./support/evidence-samples.js";
import { API, of, verdictOf } from "./support/verdict-run.js";

/** The word for a requirement that does not apply. */
const NOT_APPLICABLE = "not-applicable";

describe("a requirement no control serves", () => {
  it("is unknown when there is no audit finding about it either", () => {
    expect(of(verdictOf([], []), "AC1.4")).toMatchObject({
      verdict: "unknown",
      reason: "no-evidence",
      entries: [],
    });
  });

  it("is conforming on the audit's word when asserted evidence is all it needs", () => {
    expect(
      of(verdictOf([], [findingRecord("AC1.4", "held")]), "AC1.4")
    ).toMatchObject({
      verdict: "conforming",
      reason: "audit-recorded",
      rung: "asserted",
      evidence: ["audit-finding/AC1.4@."],
    });
  });

  it("is unknown on the audit's word when it needs stronger evidence", () => {
    expect(
      of(verdictOf([], [findingRecord("AC1.1", "held")]), "AC1.1")
    ).toMatchObject({ verdict: "unknown", reason: "rung-too-low" });
  });

  it("is non-conforming when the audit found nothing that does it", () => {
    expect(
      of(
        verdictOf(
          [],
          [findingRecord("AC1.4", "failed", { reason: "missing" })]
        ),
        "AC1.4"
      )
    ).toMatchObject({ verdict: "non-conforming", reason: "nothing-found" });
  });

  it("is unknown when the audit could not establish it", () => {
    expect(
      of(
        verdictOf(
          [],
          [findingRecord("AC1.4", "unknown", { reason: "question" })]
        ),
        "AC1.4"
      )
    ).toMatchObject({ verdict: "unknown", reason: "audit-unknown" });
  });

  it("is not applicable only with the fact the audit gave", () => {
    const fact = "No agent acts in this repository.";
    const verdict = of(
      verdictOf(
        [],
        [
          findingRecord("AC1.1", NOT_APPLICABLE, {
            reason: NOT_APPLICABLE,
            detail: fact,
          }),
        ]
      ),
      "AC1.1"
    );

    expect(verdict).toMatchObject({
      verdict: NOT_APPLICABLE,
      reason: NOT_APPLICABLE,
      fact,
      rung: null,
    });
  });

  it("is unknown once the audit finding is too old", () => {
    expect(
      of(verdictOf([], [findingRecord("AC1.4", "held")], EXPIRY), "AC1.4")
    ).toMatchObject({ verdict: "unknown", reason: "stale-evidence" });
  });
});

describe("a requirement answered folder by folder", () => {
  const api = entryServing(API);

  it("sets the audit's finding aside for a folder a control covers", () => {
    const records = [
      ...heldPair(API),
      findingRecord("SI7", "failed", { scope: "api", reason: "missing" }),
    ];

    expect(of(verdictOf([api], records))).toMatchObject({
      verdict: "conforming",
      evidence: [`${API}/commit/clean/SI7`, `${API}/commit/violation/SI7`],
    });
  });

  it("sets the audit's finding for the whole repository aside when a control serves the requirement", () => {
    const records = [
      ...heldPair(API),
      findingRecord("SI7", "failed", { reason: "missing" }),
    ];

    expect(of(verdictOf([api], records)).verdict).toBe("conforming");
  });

  it("counts the audit's finding for a folder no control covers", () => {
    const records = [
      ...heldPair(API),
      findingRecord("SI7", "failed", { scope: "web", reason: "missing" }),
    ];

    expect(of(verdictOf([api], records))).toMatchObject({
      verdict: "non-conforming",
      reason: "nothing-found",
    });
  });

  it("lets a control for the whole repository cover every folder", () => {
    const records = [
      ...heldPair("code-style@."),
      findingRecord("SI7", "failed", { scope: "web", reason: "missing" }),
    ];

    expect(of(verdictOf([entryServing("code-style@.")], records)).verdict).toBe(
      "conforming"
    );
  });

  it("is conforming when it holds in one folder and does not apply in the other", () => {
    const records = [
      ...heldPair(API),
      findingRecord("SI7", NOT_APPLICABLE, {
        scope: "web",
        reason: NOT_APPLICABLE,
        detail: "The folder holds no code.",
      }),
    ];

    expect(of(verdictOf([api], records))).toMatchObject({
      verdict: "conforming",
      fact: null,
    });
  });

  it("is not applicable when it applies in no folder, citing each fact", () => {
    const records = ["api", "web"].map(scope =>
      findingRecord("SI7", NOT_APPLICABLE, {
        scope,
        reason: NOT_APPLICABLE,
        detail: `Nothing to check in ${scope}.`,
      })
    );

    expect(of(verdictOf([], records))).toMatchObject({
      verdict: NOT_APPLICABLE,
      fact: "In api: Nothing to check in api. In web: Nothing to check in web.",
    });
  });
});
