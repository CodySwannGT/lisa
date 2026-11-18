/**
 * What the evidence file holds after an attest run, and what the audit
 * report contributes to it (CodySwannGT/lisa#4998).
 *
 * The latest run always wins, including when it has nothing to put in an
 * earlier record's place: evidence says what the last run showed, never what
 * an earlier one did.
 */
import { describe, expect, it } from "vitest";

import { compareCodeUnits } from "../../../src/controls/canonical-json.js";
import { parseEvidenceDocument } from "../../../src/controls/evidence-document.js";
import { findingRecords } from "../../../src/controls/evidence-findings.js";
import {
  DEFAULT_FRESHNESS_SECONDS,
  MAX_FRESHNESS_SECONDS,
  type EvidenceBatch,
  type EvidenceRecord,
} from "../../../src/controls/evidence-types.js";
import {
  mergedEvidence,
  type EvidenceStamp,
} from "../../../src/controls/evidence-write.js";
import {
  entryServing,
  evidenceOf,
  findingRecord,
  heldPair,
  observedRecord,
  RECORDED_AT,
  registerOf,
  SAMPLE_COMMIT,
} from "./support/evidence-samples.js";

const API = "code-style@api";
const STAMP: EvidenceStamp = {
  commit: SAMPLE_COMMIT,
  freshnessSeconds: DEFAULT_FRESHNESS_SECONDS,
};

describe("the records of an audit report's findings", () => {
  const finding = (
    state: string,
    scope = "."
  ): Parameters<typeof findingRecords>[0][number] =>
    ({
      criterion: "AC1.4",
      scope,
      state,
      what: `What was found (${state}).`,
      why: "Why it matters.",
      next: "What to do next.",
      mechanisms: [],
    }) as Parameters<typeof findingRecords>[0][number];
  const READ_AT = new Date(RECORDED_AT);

  it.each([
    ["exists-not-enforced", "held"],
    ["missing", "failed"],
    ["unknown", "unknown"],
    ["question", "unknown"],
    ["not-applicable", "not-applicable"],
  ])(
    "say a finding in the state %s shows %s, at the asserted rung",
    (state, result) => {
      const records = findingRecords([finding(state, "api")], STAMP, READ_AT);

      expect(records).toEqual([
        {
          id: "audit-finding/AC1.4@api",
          criterion: "AC1.4",
          entry_id: null,
          scope: "api",
          rung: "asserted",
          moment: null,
          result,
          reason: state,
          detail: `What was found (${state}).`,
          commit: SAMPLE_COMMIT,
          command: null,
          exit_status: null,
          started_at: RECORDED_AT,
          completed_at: RECORDED_AT,
          freshness_seconds: DEFAULT_FRESHNESS_SECONDS,
          output_excerpt: "",
          output_truncated: false,
        },
      ]);
      expect(parseEvidenceDocument(evidenceOf(records)).problems).toBeNull();
    }
  );

  it("leave out a finding that only repeats a record already on file", () => {
    expect(findingRecords([finding("proved")], STAMP, READ_AT)).toEqual([]);
  });
});

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

  it("keeps a record for a moment the run did not speak for", () => {
    expect(after([observedRecord(API)])).toEqual([
      `${API}/pull-request/observed/SI7`,
    ]);
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
