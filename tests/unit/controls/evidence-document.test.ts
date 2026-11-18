/**
 * Reading the evidence file back as exactly what the attest step writes
 * (CodySwannGT/lisa#4998).
 *
 * The verdict is computed from this file, so nothing in it is taken on
 * trust: a record with a key the writer never writes, a value outside its
 * word list, or an identifier that does not match what the record says it is
 * about is a problem, named by the record it is in.
 */
import { describe, expect, it } from "vitest";

import {
  evidenceDocumentOf,
  parseEvidenceDocument,
  serializeEvidence,
} from "../../../src/controls/evidence-document.js";
import {
  EVIDENCE_EXCERPT_LIMIT,
  MAX_FRESHNESS_SECONDS,
} from "../../../src/controls/evidence-types.js";
import { parseEvidenceRecords } from "../../../src/controls/evidence.js";
import {
  evidenceOf,
  findingRecord,
  HALF_RECORD,
  halfRecord,
  heldPair,
  locatedRecord,
  observedRecord,
} from "./support/evidence-samples.js";

const API = "code-style@api";

/**
 * The problems found in a file holding one record.
 * @param record - The record
 * @returns One line per problem
 */
function problemsWith(record: unknown): readonly string[] {
  const parsed = parseEvidenceDocument({
    schema_version: 1,
    records: [record],
  });
  return parsed.problems ?? [];
}

describe("an evidence file", () => {
  it("is read back as the records it holds", () => {
    const document = evidenceOf(
      heldPair(API),
      observedRecord(API),
      findingRecord("AC1.4", "held")
    );

    expect(parseEvidenceDocument(JSON.parse(JSON.stringify(document)))).toEqual(
      {
        problems: null,
        document,
      }
    );
  });

  it("may hold no records", () => {
    expect(parseEvidenceDocument({ schema_version: 1, records: [] })).toEqual({
      problems: null,
      document: { schema_version: 1, records: [] },
    });
  });

  it.each([
    ["is not an object", [], "is not a JSON object"],
    ["has no records", { schema_version: 1 }, '"records" is not a list'],
    [
      "has another version",
      { schema_version: 2, records: [] },
      "schema_version",
    ],
    [
      "has a key the attest step does not write",
      { schema_version: 1, records: [], verdict: "conforming" },
      '"verdict"',
    ],
  ])("is refused when it %s", (_name, document, saying) => {
    expect(parseEvidenceDocument(document).problems?.join("\n")).toContain(
      saying
    );
  });

  it("is refused when two records share an identifier", () => {
    const parsed = parseEvidenceDocument(
      evidenceOf(halfRecord(API, "clean"), halfRecord(API, "clean"))
    );

    expect(parsed.problems).toEqual([
      expect.stringContaining(
        `"${API}/commit/clean/SI7" is the id of 2 records`
      ),
    ]);
  });
});

describe("a record in an evidence file", () => {
  it.each([
    ["is not an object", "record", "is not a JSON object"],
    [
      "lacks a key",
      { ...HALF_RECORD, commit: undefined },
      '"commit" is missing',
    ],
    [
      "has a key the attest step does not write",
      { ...HALF_RECORD, note: "x" },
      '"note"',
    ],
    [
      "names a requirement no specification has",
      { ...HALF_RECORD, criterion: "X1" },
      '"criterion"',
    ],
    [
      "has a rung outside the three",
      { ...HALF_RECORD, rung: "proved" },
      '"rung"',
    ],
    [
      "has a result outside the four",
      { ...HALF_RECORD, result: "passed" },
      '"result"',
    ],
    ["has a half that is neither", { ...HALF_RECORD, half: "both" }, '"half"'],
    [
      "has a commit that is not a hash",
      { ...HALF_RECORD, commit: "HEAD" },
      '"commit"',
    ],
    [
      "has a command that is one string",
      { ...HALF_RECORD, command: "ruff check" },
      '"command"',
    ],
    [
      "has an exit status that is not a whole number",
      { ...HALF_RECORD, exit_status: 1.5 },
      '"exit_status"',
    ],
    [
      "has a time in another form",
      { ...HALF_RECORD, completed_at: "2026-11-17" },
      '"completed_at"',
    ],
    [
      "has no lifetime",
      { ...HALF_RECORD, freshness_seconds: 0 },
      '"freshness_seconds"',
    ],
    [
      "has a lifetime longer than twelve months",
      { ...HALF_RECORD, freshness_seconds: MAX_FRESHNESS_SECONDS + 1 },
      '"freshness_seconds"',
    ],
    [
      "keeps more output than a record may",
      {
        ...HALF_RECORD,
        output_excerpt: "x".repeat(EVIDENCE_EXCERPT_LIMIT + 1),
      },
      '"output_excerpt"',
    ],
    [
      "has an identifier that does not say what it is about",
      { ...HALF_RECORD, id: "ev-1" },
      '"id"',
    ],
  ])("is refused when it %s", (_name, record, saying) => {
    expect(problemsWith(record).join("\n")).toContain(saying);
  });

  it("is refused when it is exercised and names no half", () => {
    const { half: _half, ...record } = HALF_RECORD;

    expect(problemsWith(record).join("\n")).toContain('"half"');
  });

  it("is refused when it is observed and names a half", () => {
    expect(
      problemsWith({ ...observedRecord(API), half: "clean" }).join("\n")
    ).toContain("only an exercised record names a half");
  });

  it("is refused when it is about a control and is only asserted", () => {
    expect(
      problemsWith({ ...observedRecord(API), rung: "asserted" }).join("\n")
    ).toContain('"rung"');
  });

  it("is refused when it is about a control and says not applicable", () => {
    expect(
      problemsWith(
        observedRecord(API, "SI7", { result: "not-applicable" })
      ).join("\n")
    ).toContain("only a record of an audit finding");
  });

  it("is refused when it is of an audit finding and claims to be exercised", () => {
    expect(
      problemsWith({
        ...findingRecord("AC1.4", "held"),
        rung: "exercised",
        half: "clean",
      }).join("\n")
    ).toContain('"rung" must be asserted or observed');
  });

  it("may be of an audit finding at the observed rung: a record found where the audit pointed", () => {
    expect(problemsWith(locatedRecord("AC1.1"))).toEqual([]);
  });

  it("is named by its place and its identifier", () => {
    expect(problemsWith({ ...HALF_RECORD, result: "passed" })).toEqual([
      expect.stringMatching(
        /^Record 1 \("code-style@api\/commit\/violation\/SI7"\): /u
      ),
    ]);
  });
});

describe("the text of an evidence file", () => {
  const records = [
    findingRecord("AC1.4", "held"),
    ...heldPair(API),
    observedRecord(API),
  ];

  it("orders the records by identifier, whatever order they came in", () => {
    const ids = evidenceDocumentOf(records).records.map(record => record.id);

    expect(ids).toEqual([
      "audit-finding/AC1.4@.",
      `${API}/commit/clean/SI7`,
      `${API}/commit/violation/SI7`,
      `${API}/pull-request/observed/SI7`,
    ]);
    expect(evidenceDocumentOf([...records].reverse())).toEqual(
      evidenceDocumentOf(records)
    );
  });

  it("is the same bytes for the same records", () => {
    const text = serializeEvidence(evidenceDocumentOf(records));

    expect(serializeEvidence(evidenceDocumentOf([...records].reverse()))).toBe(
      text
    );
    expect(text.endsWith("}\n")).toBe(true);
    expect(text).toContain('\n  "records": [\n');
  });

  it("is read back as what was written", () => {
    const document = evidenceDocumentOf(records);

    expect(
      parseEvidenceDocument(JSON.parse(serializeEvidence(document)))
    ).toEqual({ problems: null, document });
  });

  it("holds what the report check and the register read a record by", () => {
    const document = JSON.parse(
      serializeEvidence(evidenceDocumentOf(records))
    ) as unknown;

    expect(parseEvidenceRecords(document).map(record => record.id)).toEqual([
      `${API}/commit/clean/SI7`,
      `${API}/commit/violation/SI7`,
      `${API}/pull-request/observed/SI7`,
    ]);
  });
});
