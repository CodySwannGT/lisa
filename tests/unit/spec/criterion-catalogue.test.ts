/**
 * The criterion catalogue cannot drift from the specification
 * (CodySwannGT/lisa#4975).
 *
 * `spec/tasc-criteria.json` is the specification's requirements as data: the
 * audit, the control register, the verdict and the operator questionnaire all
 * walk it. A catalogue that silently loses a criterion produces a verdict that
 * never looked at it, so this suite makes the specification the authority and
 * fails on any difference:
 *
 * - every criterion id the specification defines appears in the catalogue
 *   exactly once, and the catalogue names no id the specification lacks;
 * - the catalogue validates against its published schema (the cases the schema
 *   must reject are in `criterion-catalogue-schema.test.ts`);
 * - the scope decision agrees with the specification's own wording, so a
 *   criterion that states no requirement cannot be in scope and a criterion
 *   that states one cannot be dropped without a level-based reason;
 * - the text an operator reads is plain language, free of criterion ids and
 *   specification vocabulary.
 *
 * The ids are extracted from the specification file on every run. The count is
 * pinned once, deliberately: an extractor that finds nothing would otherwise
 * agree with an empty catalogue.
 * @module tests/unit/spec/criterion-catalogue
 */
import { describe, expect, it } from "vitest";

import {
  CATALOGUE_PATH,
  catalogueSchemaErrors,
  compareIds,
  loadCatalogue,
  mentionedCriterionIds,
  readRepositoryFile,
  SCHEMA_PATH,
  SPECIFICATION_PATH,
  specifiedCriteria,
  type ExcludedCriterion,
  type InScopeCriterion,
} from "../../helpers/criterion-catalogue.js";

/**
 * Specification vocabulary an operator should never have to decode. The words
 * are fine in the detail fields (`title`, `excluded_reason`, `level_note`),
 * which exist for readers who do know the specification.
 */
const SPECIFICATION_VOCABULARY = [
  /§/u,
  /\b(?:ADS|CHC|TASC|MUST|SHOULD|SOC ?2)\b/u,
  /\b(?:subservice|attest\w*|criteri(?:on|a)|rungs?|gates?)\b/u,
  /\b(?:Type (?:I|II|C)|Level [123]|P(?:[1-9]|1[01]))\b/u,
];

/** The longest question that still reads at a glance. */
const QUESTION_LENGTH_LIMIT = 180;

const specification = readRepositoryFile(SPECIFICATION_PATH);
const specified = specifiedCriteria(specification);
const specifiedIds = specified.map(criterion => criterion.id);

const catalogue = loadCatalogue();
const cataloguedIds = catalogue.criteria.map(criterion => criterion.id);
const inScope = catalogue.criteria.filter(
  (criterion): criterion is InScopeCriterion => criterion.in_scope
);
const excluded = catalogue.criteria.filter(
  (criterion): criterion is ExcludedCriterion => !criterion.in_scope
);

/**
 * The specification's text for one criterion.
 * @param id - Criterion id
 * @returns The criterion's text, or an empty string for an unknown id
 */
function specifiedText(id: string): string {
  return specified.find(criterion => criterion.id === id)?.text ?? "";
}

/**
 * The text of an in-scope entry that an operator is shown.
 * @param criterion - In-scope entry
 * @returns Its question and its not-applicable condition
 */
function operatorText(criterion: InScopeCriterion): string[] {
  return [criterion.question, criterion.not_applicable_when];
}

describe("criterion ids in the specification", () => {
  it("finds all 80 criteria the specification defines", () => {
    // Pinned on purpose. Every comparison below is against this list, so an
    // extractor that matched nothing would agree with an empty catalogue.
    // Update the number when the specification gains or loses a criterion.
    expect(specifiedIds).toHaveLength(80);
  });

  it("defines each criterion once", () => {
    expect(compareIds(specifiedIds, specifiedIds).duplicated).toEqual([]);
  });

  it("defines every criterion id it mentions anywhere", () => {
    // The definition pattern is the narrow one. If the specification ever
    // stated a criterion in another shape, its id would still be cited in the
    // prose, and this is what would notice the extractor had missed it.
    const undefinedMentions = mentionedCriterionIds(specification).filter(
      id => !specifiedIds.includes(id)
    );

    expect(undefinedMentions).toEqual([]);
  });
});

describe("comparing a catalogue with the specification", () => {
  const SPECIFIED = ["AC1.1", "AC1.2", "SI1"];

  it("reports nothing when the two lists agree", () => {
    expect(compareIds(SPECIFIED, ["AC1.1", "AC1.2", "SI1"])).toEqual({
      missing: [],
      duplicated: [],
      unknown: [],
    });
  });

  it("names a criterion the catalogue leaves out", () => {
    expect(compareIds(SPECIFIED, ["AC1.1", "SI1"]).missing).toEqual(["AC1.2"]);
  });

  it("names a criterion the catalogue lists more than once, once", () => {
    expect(
      compareIds(SPECIFIED, ["AC1.1", "AC1.2", "AC1.1", "SI1", "AC1.1"])
        .duplicated
    ).toEqual(["AC1.1"]);
  });

  it("names a criterion the specification does not contain", () => {
    expect(
      compareIds(SPECIFIED, ["AC1.1", "AC1.2", "SI1", "AC9.9"]).unknown
    ).toEqual(["AC9.9"]);
  });
});

describe("the catalogue accounts for every criterion exactly once", () => {
  const difference = compareIds(specifiedIds, cataloguedIds);

  it("leaves no criterion out", () => {
    expect(difference.missing).toEqual([]);
  });

  it("lists no criterion twice", () => {
    expect(difference.duplicated).toEqual([]);
  });

  it("names no criterion the specification does not contain", () => {
    expect(difference.unknown).toEqual([]);
  });

  it("lists the criteria in the specification's order", () => {
    expect(cataloguedIds).toEqual(specifiedIds);
  });

  it("gives each criterion the title the specification gives it", () => {
    const titles = Object.fromEntries(
      specified.map(criterion => [criterion.id, criterion.title])
    );
    const mistitled = catalogue.criteria
      .filter(criterion => titles[criterion.id] !== criterion.title)
      .map(criterion => criterion.id);

    expect(mistitled).toEqual([]);
  });

  it("names the specification file and the version it was written against", () => {
    // A revised specification can change what a criterion requires without
    // changing its id. The catalogue's version only moves by a deliberate
    // edit, so revising the specification fails here until the entries have
    // been re-read against the new text.
    const version = /^\*\*Version:\*\* (?<version>\S+)/mu.exec(specification)
      ?.groups?.version;

    expect({
      specification: catalogue.specification,
      version: catalogue.specification_version,
    }).toEqual({ specification: SPECIFICATION_PATH, version });
  });

  it("validates against its schema", () => {
    expect(catalogueSchemaErrors(catalogue)).toEqual([]);
  });
});

describe("the scope decision follows the specification's wording", () => {
  it("puts no criterion in scope that states no requirement", () => {
    const withoutRequirement = inScope
      .filter(criterion => !/\bMUST\b/u.test(specifiedText(criterion.id)))
      .map(criterion => criterion.id);

    expect(withoutRequirement).toEqual([]);
  });

  it("leaves out only criteria with no requirement below a higher level", () => {
    // A criterion may be left out when it states no requirement at all, or
    // when the specification ties its requirement to Level 2 or Level 3.
    const droppedRequirements = excluded
      .filter(criterion => {
        const text = specifiedText(criterion.id);
        return /\bMUST\b/u.test(text) && !/\bLevel [23]\b/u.test(text);
      })
      .map(criterion => criterion.id);

    expect(droppedRequirements).toEqual([]);
  });

  it("gives every excluded criterion its own reason", () => {
    const reasons = excluded.map(criterion => criterion.excluded_reason);

    expect(new Set(reasons).size).toBe(reasons.length);
  });

  it("accepts a person's word exactly where only a person can vouch", () => {
    // A human-attested requirement is recorded at the asserted rung with a
    // named party. Anything a tool can read or exercise is held to more.
    const mismatched = inScope
      .filter(
        criterion =>
          (criterion.kind === "human-attested") !==
          (criterion.minimum_rung === "asserted")
      )
      .map(criterion => criterion.id);

    expect(mismatched).toEqual([]);
  });
});

describe("what an operator reads is plain language", () => {
  it("asks about each requirement in different words", () => {
    const questions = inScope.map(criterion => criterion.question);

    expect(new Set(questions).size).toBe(questions.length);
  });

  it("keeps every question short enough to read at a glance", () => {
    const tooLong = inScope
      .filter(criterion => criterion.question.length > QUESTION_LENGTH_LIMIT)
      .map(criterion => criterion.id);

    expect(tooLong).toEqual([]);
  });

  it("keeps criterion ids out of questions and not-applicable conditions", () => {
    const citing = inScope
      .filter(criterion =>
        operatorText(criterion).some(
          text => mentionedCriterionIds(text).length > 0
        )
      )
      .map(criterion => criterion.id);

    expect(citing).toEqual([]);
  });

  it("keeps specification vocabulary out of questions and not-applicable conditions", () => {
    const jargon = inScope
      .filter(criterion =>
        operatorText(criterion).some(text =>
          SPECIFICATION_VOCABULARY.some(term => term.test(text))
        )
      )
      .map(criterion => criterion.id);

    expect(jargon).toEqual([]);
  });
});

describe("the catalogue ships with the package", () => {
  it("lists the catalogue and its schema in the package files", () => {
    const manifest = JSON.parse(readRepositoryFile("package.json")) as {
      readonly files: readonly string[];
    };

    expect(
      [CATALOGUE_PATH, SCHEMA_PATH].filter(
        file => !manifest.files.includes(file)
      )
    ).toEqual([]);
  });
});
