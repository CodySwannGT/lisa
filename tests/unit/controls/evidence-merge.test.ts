/**
 * What the evidence file holds after an attest run
 * (CodySwannGT/lisa#4998).
 *
 * The latest run always wins, including when it has nothing to put in an
 * earlier record's place: evidence says what the last run showed, never what
 * an earlier one did.
 */
import { describe, expect, it } from "vitest";

import { compareCodeUnits } from "../../../src/controls/canonical-json.js";
import {
  DEFAULT_FRESHNESS_SECONDS,
  MAX_FRESHNESS_SECONDS,
  type EvidenceBatch,
  type EvidenceRecord,
} from "../../../src/controls/evidence-types.js";
import { mergedEvidence } from "../../../src/controls/evidence-write.js";
import {
  entryServing,
  findingRecord,
  heldPair,
  observedRecord,
  registerOf,
} from "./support/evidence-samples.js";

const API = "code-style@api";

describe("the evidence file after a run", () => {
  const register = registerOf(entryServing(API));
  const local: EvidenceBatch = {
    entries: [API],
    moments: ["commit", "push"],
    results: [],
  };
  const after = (
    earlier: readonly EvidenceRecord[],
    records: readonly EvidenceRecord[] = [],
    batches: readonly EvidenceBatch[] = [local]
  ): readonly string[] =>
    mergedEvidence({ earlier, register, batches, records })
      .map(record => record.id)
      .sort(compareCodeUnits);

  it("holds the run's records in place of the earlier ones for the same entry and moment", () => {
    const newer = heldPair(API, "SI7", {
      completed_at: "2026-12-01T00:00:00.000Z",
    });

    expect(
      mergedEvidence({
        earlier: heldPair(API),
        register,
        batches: [local],
        records: newer,
      })
    ).toEqual(newer);
  });

  it("drops an earlier proof the run could not repeat, rather than keep an old pass", () => {
    expect(after(heldPair(API))).toEqual([]);
  });

  it("keeps a record for a moment the run did not speak for, when the entry is enforced at that moment", () => {
    const entry = entryServing(API);
    const onPullRequests = registerOf({
      ...entry,
      enforcement_points: [
        ...entry.enforcement_points,
        {
          moment: "pull-request",
          level: "required",
          location: "hosting-platform",
        },
      ],
    });

    expect(
      mergedEvidence({
        earlier: [observedRecord(API)],
        register: onPullRequests,
        batches: [local],
        records: [],
      }).map(record => record.id)
    ).toEqual([`${API}/pull-request/observed/SI7`]);
  });

  it("drops a record for a moment the entry is not enforced at", () => {
    expect(after([observedRecord(API)])).toEqual([]);
  });

  it("drops a record of an entry the register no longer holds", () => {
    expect(after(heldPair("code-style@gone"), [], [])).toEqual([]);
  });

  it("drops a record for a requirement its entry no longer serves", () => {
    expect(after(heldPair(API, "AC5.4"), [], [])).toEqual([]);
  });

  it("replaces every record of an audit finding with the run's own", () => {
    expect(
      after(
        [findingRecord("AC1.4", "held"), findingRecord("AC1.5", "held")],
        [findingRecord("AC1.4", "failed")]
      )
    ).toEqual(["audit-finding/AC1.4@."]);
  });
});

describe("the freshness lifetime a record is given", () => {
  it("is thirty days unless the caller says otherwise, and never more than twelve months", () => {
    expect(DEFAULT_FRESHNESS_SECONDS).toBe(2_592_000);
    expect(MAX_FRESHNESS_SECONDS).toBe(31_536_000);
    expect(DEFAULT_FRESHNESS_SECONDS).toBeLessThan(MAX_FRESHNESS_SECONDS);
  });
});
