/**
 * What the criterion catalogue's schema must refuse (CodySwannGT/lisa#4975).
 *
 * `criterion-catalogue.test.ts` proves the catalogue is valid. A schema that
 * accepted everything would pass that test too, so this suite takes the real
 * catalogue, breaks one entry at a time, and requires the schema to object.
 * The four fields an in-scope entry must carry — question, kind, minimum rung
 * and not-applicable condition — are each removed in turn, and the finding has
 * to name the entry and the field.
 *
 * Every case starts from the catalogue on disk rather than a hand-built
 * document, so the schema is always exercised against the shape it governs.
 * @module tests/unit/spec/criterion-catalogue-schema
 */
import { describe, expect, it } from "vitest";

import {
  catalogueSchemaErrors,
  loadCatalogue,
} from "../../helpers/criterion-catalogue.js";

/** The four fields requirement R2 puts on every in-scope entry. */
const IN_SCOPE_FIELDS = [
  "question",
  "kind",
  "minimum_rung",
  "not_applicable_when",
] as const;

/** Case title shared by every "a required field was removed" table. */
const REJECTED_WITHOUT = "is rejected with no %s";

const catalogue = loadCatalogue();
const inScopeIndex = catalogue.criteria.findIndex(
  criterion => criterion.in_scope
);
const excludedIndex = catalogue.criteria.findIndex(
  criterion => !criterion.in_scope
);
const inScopeEntry = catalogue.criteria[inScopeIndex] ?? {};
const excludedEntry = catalogue.criteria[excludedIndex] ?? {};

/**
 * The schema's findings for the catalogue with one entry replaced.
 * @param index - Position of the entry
 * @param replacement - The entry to put there
 * @returns One line per finding; empty when the result is still valid
 */
function errorsWithEntry(index: number, replacement: object): string[] {
  return catalogueSchemaErrors({
    ...catalogue,
    criteria: catalogue.criteria.map((criterion, position) =>
      position === index ? replacement : criterion
    ),
  });
}

/**
 * An entry with one field removed.
 * @param entry - Catalogue entry
 * @param field - Field to drop
 * @returns A copy without the field
 */
function without(entry: object, field: string): object {
  return Object.fromEntries(
    Object.entries(entry).filter(([key]) => key !== field)
  );
}

describe("the catalogue under test", () => {
  it("has an in-scope entry and an excluded entry to break", () => {
    expect({
      inScope: inScopeIndex >= 0,
      excluded: excludedIndex >= 0,
    }).toEqual({ inScope: true, excluded: true });
  });

  it("is valid before anything is broken", () => {
    expect(catalogueSchemaErrors(catalogue)).toEqual([]);
  });
});

describe("an in-scope entry", () => {
  it.each(IN_SCOPE_FIELDS)(REJECTED_WITHOUT, field => {
    const errors = errorsWithEntry(inScopeIndex, without(inScopeEntry, field));

    expect(
      errors.filter(error =>
        error.startsWith(`criteria.${inScopeIndex}.${field}:`)
      )
    ).toHaveLength(1);
  });

  it.each(IN_SCOPE_FIELDS)("is rejected with an empty %s", field => {
    expect(
      errorsWithEntry(inScopeIndex, { ...inScopeEntry, [field]: "" })
    ).not.toEqual([]);
  });

  it("is rejected with a kind outside gate, artifact and human-attested", () => {
    expect(
      errorsWithEntry(inScopeIndex, { ...inScopeEntry, kind: "policy" })
    ).not.toEqual([]);
  });

  it("is rejected with a minimum rung outside asserted, observed and exercised", () => {
    expect(
      errorsWithEntry(inScopeIndex, { ...inScopeEntry, minimum_rung: "proved" })
    ).not.toEqual([]);
  });

  it("is rejected when its question is two questions", () => {
    expect(
      errorsWithEntry(inScopeIndex, {
        ...inScopeEntry,
        question: "Is it written down? Is it reviewed?",
      })
    ).not.toEqual([]);
  });

  it("is rejected when its question is a statement", () => {
    expect(
      errorsWithEntry(inScopeIndex, {
        ...inScopeEntry,
        question: "It is written down.",
      })
    ).not.toEqual([]);
  });

  it("is rejected when it also carries an exclusion reason", () => {
    expect(
      errorsWithEntry(inScopeIndex, {
        ...inScopeEntry,
        excluded_reason: "Left out for a reason specific to this entry.",
      })
    ).not.toEqual([]);
  });

  it("is rejected with a field the schema does not define", () => {
    expect(
      errorsWithEntry(inScopeIndex, { ...inScopeEntry, unknown_field: true })
    ).not.toEqual([]);
  });
});

describe("an excluded entry", () => {
  it("is rejected with no reason", () => {
    const errors = errorsWithEntry(
      excludedIndex,
      without(excludedEntry, "excluded_reason")
    );

    expect(
      errors.filter(error =>
        error.startsWith(`criteria.${excludedIndex}.excluded_reason:`)
      )
    ).toHaveLength(1);
  });

  it("is rejected with an empty reason", () => {
    expect(
      errorsWithEntry(excludedIndex, { ...excludedEntry, excluded_reason: "" })
    ).not.toEqual([]);
  });

  it("is rejected when it also carries a question", () => {
    expect(
      errorsWithEntry(excludedIndex, {
        ...excludedEntry,
        question: "Is it written down?",
      })
    ).not.toEqual([]);
  });
});

describe("any entry", () => {
  it("is rejected when it does not say whether it is in scope", () => {
    expect(
      errorsWithEntry(inScopeIndex, without(inScopeEntry, "in_scope"))
    ).not.toEqual([]);
  });

  it.each(["id", "title"])(REJECTED_WITHOUT, field => {
    expect(
      errorsWithEntry(excludedIndex, without(excludedEntry, field))
    ).not.toEqual([]);
  });

  it.each(["AC1", "AC1.0", "SI0", "ac1.1", "AC1.1 ", "XX1"])(
    "is rejected with the id %j, which is not shaped like a criterion id",
    id => {
      expect(
        errorsWithEntry(excludedIndex, { ...excludedEntry, id })
      ).not.toEqual([]);
    }
  );
});

describe("the catalogue as a whole", () => {
  it("is rejected with no criteria", () => {
    expect(catalogueSchemaErrors({ ...catalogue, criteria: [] })).not.toEqual(
      []
    );
  });

  it.each(["specification", "specification_version", "level", "criteria"])(
    REJECTED_WITHOUT,
    field => {
      expect(catalogueSchemaErrors(without(catalogue, field))).not.toEqual([]);
    }
  );

  it("is rejected when it claims a level other than 1", () => {
    expect(catalogueSchemaErrors({ ...catalogue, level: 2 })).not.toEqual([]);
  });

  it("is rejected with a top-level field the schema does not define", () => {
    expect(catalogueSchemaErrors({ ...catalogue, gates: {} })).not.toEqual([]);
  });
});
