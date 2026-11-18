/**
 * The published evidence and verdict schemas, the TypeScript types and the
 * reader must describe one shape (CodySwannGT/lisa#4998).
 *
 * `schemas/control-evidence.schema.json` and
 * `schemas/control-verdict.schema.json` are what an auditor's own validator
 * reads. They are written by hand, so this suite is what keeps them from
 * drifting: the samples are held to the types by the compiler, and compared
 * here with the schemas key for key and value for value.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { CRITERION_ID_SOURCE } from "../../../src/controls/catalogue.js";
import { parseEvidenceDocument } from "../../../src/controls/evidence-document.js";
import {
  EVIDENCE_EXCERPT_LIMIT,
  EVIDENCE_RESULTS,
  EVIDENCE_RUNGS,
  EVIDENCE_SCHEMA_PACKAGE_PATH,
  MAX_FRESHNESS_SECONDS,
} from "../../../src/controls/evidence-types.js";
import { PROOF_HALVES } from "../../../src/controls/proof-halves.js";
import { computeVerdict } from "../../../src/controls/verdict.js";
import {
  CRITERION_VERDICTS,
  LEVEL_RESULTS,
  VERDICT_REASONS,
  VERDICT_SCHEMA_PACKAGE_PATH,
  type CriterionVerdict,
  type Verdict,
} from "../../../src/controls/verdict-types.js";
import {
  entryServing,
  EVIDENCE,
  evidenceOf,
  findingRecord,
  HALF_RECORD,
  heldPair,
  observedRecord,
  registerOf,
  SMALL_CATALOGUE,
  SOON_AFTER,
} from "./support/evidence-samples.js";
import {
  publishedSchema,
  schemaErrors,
  sorted,
} from "./support/published-schema.js";

const API = "code-style@api";

/** The word for a requirement that does not apply. */
const NOT_APPLICABLE = "not-applicable";
const evidenceSchema = publishedSchema(EVIDENCE_SCHEMA_PACKAGE_PATH);
const verdictSchema = publishedSchema(VERDICT_SCHEMA_PACKAGE_PATH);

/** One record of each kind the schema defines by name. */
const RECORD_KINDS = [
  ["exercised_record", HALF_RECORD],
  ["observed_record", observedRecord(API)],
  ["finding_record", findingRecord("AC1.4", "held")],
] as const;

/** A verdict with every requirement word in it. */
const VERDICT: Required<Verdict> = computeVerdict({
  catalogue: SMALL_CATALOGUE,
  register: registerOf(entryServing(API)),
  evidence: evidenceOf(
    heldPair(API),
    findingRecord("AC1.4", "failed", { reason: "missing" }),
    findingRecord("AC1.1", NOT_APPLICABLE, { reason: NOT_APPLICABLE })
  ),
  now: SOON_AFTER,
});

const [CRITERION] = VERDICT.criteria as readonly Required<CriterionVerdict>[];

describe("the evidence schema and the types name the same keys", () => {
  it("at the top of the file", () => {
    expect(sorted(Object.keys(evidenceSchema.properties ?? {}))).toEqual(
      sorted(Object.keys(EVIDENCE))
    );
    expect(sorted(evidenceSchema.required ?? [])).toEqual(
      sorted(Object.keys(EVIDENCE))
    );
  });

  it.each(RECORD_KINDS)("in the %s", (name, sample) => {
    const defined = evidenceSchema.$defs?.[name];

    expect(sorted(Object.keys(defined?.properties ?? {}))).toEqual(
      sorted(Object.keys(sample))
    );
    expect(sorted(defined?.required ?? [])).toEqual(
      sorted(Object.keys(sample))
    );
  });

  it("and only an exercised record names a half", () => {
    expect(Object.keys(HALF_RECORD)).toContain("half");
    expect(Object.keys(observedRecord(API))).not.toContain("half");
    expect(Object.keys(findingRecord("AC1.4", "held"))).not.toContain("half");
  });
});

describe("the evidence schema and the types allow the same values", () => {
  const { $defs: defs = {} } = evidenceSchema;

  it("for a rung, a half and a result", () => {
    expect(
      ["finding_record", "observed_record", "exercised_record"].map(
        name => defs[name]?.properties?.rung?.const
      )
    ).toEqual(EVIDENCE_RUNGS);
    expect(defs.exercised_record?.properties?.half?.enum).toEqual(PROOF_HALVES);
    expect(defs.finding_record?.properties?.result?.enum).toEqual(
      EVIDENCE_RESULTS
    );
    expect(defs.observed_record?.properties?.result?.enum).toEqual(
      EVIDENCE_RESULTS.filter(result => result !== NOT_APPLICABLE)
    );
  });

  it("for a requirement id, a lifetime and an excerpt", () => {
    expect(defs.criterion_id?.pattern).toBe(`^(?:${CRITERION_ID_SOURCE})$`);
    expect(defs.exercised_record?.properties?.freshness_seconds?.maximum).toBe(
      MAX_FRESHNESS_SECONDS
    );
    expect(defs.exercised_record?.properties?.output_excerpt?.maxLength).toBe(
      EVIDENCE_EXCERPT_LIMIT
    );
  });
});

describe("the evidence schema and the reader accept and refuse the same files", () => {
  const good = evidenceOf(
    heldPair(API),
    observedRecord(API),
    findingRecord("AC1.4", NOT_APPLICABLE)
  );

  it("accept one record of each kind", () => {
    expect(schemaErrors(EVIDENCE_SCHEMA_PACKAGE_PATH, good)).toEqual([]);
    expect(parseEvidenceDocument(good).problems).toBeNull();
  });

  it.each([
    ["a key the attest step does not write", { ...HALF_RECORD, note: "x" }],
    ["a result outside the list", { ...HALF_RECORD, result: "passed" }],
    [
      "an observed record that names a half",
      { ...observedRecord(API), half: "clean" },
    ],
    [
      "a control's record that is only asserted",
      { ...observedRecord(API), rung: "asserted" },
    ],
    [
      "a control's record that says not applicable",
      { ...HALF_RECORD, result: NOT_APPLICABLE },
    ],
    [
      "a finding's record that claims to be observed",
      { ...findingRecord("AC1.4", "held"), rung: "observed" },
    ],
    ["a time in another form", { ...HALF_RECORD, completed_at: "2026-11-17" }],
    [
      "a lifetime of more than twelve months",
      { ...HALF_RECORD, freshness_seconds: MAX_FRESHNESS_SECONDS + 1 },
    ],
  ])("refuse %s", (_name, record) => {
    const document = { schema_version: 1, records: [record] };

    expect(schemaErrors(EVIDENCE_SCHEMA_PACKAGE_PATH, document)).not.toEqual(
      []
    );
    expect(parseEvidenceDocument(document).problems).not.toBeNull();
  });
});

describe("the verdict schema and the types", () => {
  const { $defs: defs = {} } = verdictSchema;

  it("name the same keys at the top of the file", () => {
    expect(sorted(Object.keys(verdictSchema.properties ?? {}))).toEqual(
      sorted(Object.keys(VERDICT))
    );
    expect(sorted(verdictSchema.required ?? [])).toEqual(
      sorted(Object.keys(VERDICT))
    );
  });

  it.each([
    ["criterion", CRITERION ?? {}],
    ["requirements", VERDICT.requirements],
    ["digest", VERDICT.digest],
    ["counts", VERDICT.counts],
  ])("name the same keys in %s", (name, sample) => {
    expect(sorted(Object.keys(defs[name]?.properties ?? {}))).toEqual(
      sorted(Object.keys(sample))
    );
    expect(sorted(defs[name]?.required ?? [])).toEqual(
      sorted(Object.keys(sample))
    );
  });

  it("allow the same words", () => {
    expect(defs.criterion?.properties?.verdict?.enum).toEqual(
      CRITERION_VERDICTS
    );
    expect(defs.criterion?.properties?.reason?.enum).toEqual(VERDICT_REASONS);
    expect(verdictSchema.properties?.result?.enum).toEqual(LEVEL_RESULTS);
    expect(defs.rung?.enum).toEqual(EVIDENCE_RUNGS);
    expect(sorted(Object.keys(defs.counts?.properties ?? {}))).toEqual(
      sorted(CRITERION_VERDICTS)
    );
  });

  it("accept a computed verdict and refuse an edited one", () => {
    expect(schemaErrors(VERDICT_SCHEMA_PACKAGE_PATH, VERDICT)).toEqual([]);
    expect(
      schemaErrors(VERDICT_SCHEMA_PACKAGE_PATH, {
        ...VERDICT,
        result: "mostly conforming",
      })
    ).not.toEqual([]);
    expect(
      schemaErrors(VERDICT_SCHEMA_PACKAGE_PATH, { ...VERDICT, signed: true })
    ).not.toEqual([]);
  });
});

describe("the published schemas", () => {
  it("ship in the package, so a repository Lisa never touched can be held to them", () => {
    const manifest = JSON.parse(
      readFileSync(path.resolve(__dirname, "../../../package.json"), "utf8")
    ) as { readonly files: readonly string[] };

    expect(manifest.files).toEqual(
      expect.arrayContaining([
        EVIDENCE_SCHEMA_PACKAGE_PATH,
        VERDICT_SCHEMA_PACKAGE_PATH,
      ])
    );
  });
});
