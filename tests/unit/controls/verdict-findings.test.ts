/**
 * What verdict a requirement gets where no control in the register covers
 * it: the audit's own finding decides, at the strength an audit can give
 * (CodySwannGT/lisa#4998).
 *
 * What a finding is worth depends on what kind of thing answers the
 * requirement. A record that exists counts when the attest step found it
 * where the audit pointed; something a person vouches for counts only on a
 * person's answer; a check never counts without a control.
 */
import { describe, expect, it } from "vitest";

import { computeVerdict } from "../../../src/controls/verdict.js";
import {
  attestedRecord,
  entryServing,
  evidenceOf,
  EXPIRY,
  findingRecord,
  heldPair,
  locatedRecord,
  registerOf,
  requirement,
  SMALL_CATALOGUE,
  SOON_AFTER,
} from "./support/evidence-samples.js";
import { API, of, verdictOf } from "./support/verdict-run.js";

/** The word for a requirement that does not apply. */
const NOT_APPLICABLE = "not-applicable";
const RUNG_TOO_LOW = "rung-too-low";
const NO_ATTESTATION = "no-attestation";
const NON_CONFORMING = "non-conforming";

describe("a requirement no control serves", () => {
  it("is unknown when there is no audit finding about it either", () => {
    expect(of(verdictOf([], []), "AC1.4")).toMatchObject({
      verdict: "unknown",
      reason: "no-evidence",
      entries: [],
    });
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
    ).toMatchObject({ verdict: NON_CONFORMING, reason: "nothing-found" });
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
      of(verdictOf([], [attestedRecord("AC1.4")], EXPIRY), "AC1.4")
    ).toMatchObject({ verdict: "unknown", reason: "stale-evidence" });
  });
});

describe("a requirement a person vouches for", () => {
  it("is conforming when a person's answer is on record, and says it rests on that", () => {
    const verdict = of(verdictOf([], [attestedRecord("AC1.4")]), "AC1.4");

    expect(verdict).toMatchObject({
      verdict: "conforming",
      reason: "person-attested",
      kind: "human-attested",
      rung: "asserted",
      evidence: ["audit-finding/AC1.4@."],
    });
    expect(verdict.detail).toContain("A person vouched for it");
  });

  it("is unknown on an agent's finding alone, however well written down it is", () => {
    const verdict = of(
      verdictOf([], [findingRecord("AC1.4", "held")]),
      "AC1.4"
    );

    expect(verdict).toMatchObject({
      verdict: "unknown",
      reason: NO_ATTESTATION,
      rung: null,
    });
    expect(verdict.detail).toContain("Only a person can vouch");
  });

  it("is unknown, in the record's own words, when the attest step found no answer on record", () => {
    const detail = "No person's answer is on record.";

    expect(
      of(
        verdictOf(
          [],
          [
            findingRecord("AC1.4", "unknown", {
              reason: NO_ATTESTATION,
              detail,
            }),
          ]
        ),
        "AC1.4"
      )
    ).toMatchObject({ verdict: "unknown", reason: NO_ATTESTATION, detail });
  });
});

describe("a requirement answered by a record that exists", () => {
  it("is conforming at the observed rung when the attest step found the record where the audit pointed", () => {
    const verdict = of(verdictOf([], [locatedRecord("AC1.1")]), "AC1.1");

    expect(verdict).toMatchObject({
      verdict: "conforming",
      reason: "artifact-located",
      kind: "artifact",
      rung: "observed",
    });
    expect(verdict.detail).toContain(
      "That shows the record exists, not that it says what the requirement asks."
    );
  });

  it("is unknown when the finding was never confirmed", () => {
    expect(
      of(verdictOf([], [findingRecord("AC1.1", "held")]), "AC1.1")
    ).toMatchObject({ verdict: "unknown", reason: RUNG_TOO_LOW });
  });

  it("is unknown, in the record's own words, when the record was not where the audit pointed", () => {
    const detail = "Nothing is at docs/access.md line 40.";

    expect(
      of(
        verdictOf(
          [],
          [
            findingRecord("AC1.1", "unknown", {
              reason: "artifact-not-found",
              detail,
            }),
          ]
        ),
        "AC1.1"
      )
    ).toMatchObject({
      verdict: "unknown",
      reason: "artifact-not-found",
      detail,
    });
  });

  it("stays unknown on a located record when it needs exercised evidence", () => {
    const verdict = computeVerdict({
      catalogue: {
        ...SMALL_CATALOGUE,
        criteria: [requirement("AC5.5", "artifact", "exercised")],
      },
      register: registerOf(),
      evidence: evidenceOf(locatedRecord("AC5.5")),
      now: SOON_AFTER,
    });

    expect(of(verdict, "AC5.5")).toMatchObject({
      verdict: "unknown",
      reason: RUNG_TOO_LOW,
      minimum_rung: "exercised",
    });
    expect(verdict.result).toBe(NON_CONFORMING);
  });
});

describe("a requirement answered by a check, with no control in the register", () => {
  it.each([
    ["an asserted finding", findingRecord("AC1.3", "held")],
    ["a finding written as if it had been located", locatedRecord("AC1.3")],
    [
      "a finding written as if a person had vouched for it",
      attestedRecord("AC1.3"),
    ],
  ])("is never conforming on %s", (_name, record) => {
    const verdict = of(verdictOf([], [record]), "AC1.3");

    expect(verdict).toMatchObject({
      verdict: "unknown",
      reason: RUNG_TOO_LOW,
      kind: "gate",
    });
    expect(verdict.detail).toContain("Declare a control");
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
      verdict: NON_CONFORMING,
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
