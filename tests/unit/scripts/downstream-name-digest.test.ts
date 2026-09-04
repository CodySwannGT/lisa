/**
 * The digest helper must agree with the module it duplicates.
 *
 * `scripts/downstream-name-digest.mjs` re-declares the salt, the truncation
 * length and the minimum name length that `src/core/downstream-names.ts` owns,
 * so that adding a name needs no build step. That is a deliberate copy, and an
 * unguarded copy is how a helper starts emitting entries the matcher will never
 * match — silently, because both halves keep working on their own terms and
 * nothing compares them.
 *
 * So this compares them. The assertion is equality against `nameEntry()` for
 * the same input, which fails if either side changes its salt, its truncation,
 * or its normalization.
 *
 * The names below are fixtures, not host identities.
 * @module tests/unit/scripts/downstream-name-digest
 */
import { describe, expect, it } from "vitest";

import {
  nameEntry,
  MIN_NAME_LENGTH,
} from "../../../src/core/downstream-names.js";
import {
  entryFor,
  normalize,
} from "../../../scripts/downstream-name-digest.mjs";

/** One fixture name, written the way a person would type it first. */
const SPACED = "Not A Real Host";
/** The same name hyphenated — spelling, not identity. */
const HYPHENATED = "not-a-real-host";

/** Spellings a person might type, none of them a real host name. */
const FIXTURES = [
  "notarealhostproject",
  SPACED,
  HYPHENATED,
  "not_a_real_host.example",
  "SOMEPLACEHOLDER",
  "another.placeholder.example",
];

describe("the helper and the module compute the same entry", () => {
  it.each(FIXTURES)("agrees on %s", name => {
    expect(entryFor(name)).toBe(nameEntry(name));
  });

  it("normalizes the same way the module does", () => {
    // Different spellings of one name must reach one entry, or a list curated
    // through this helper would depend on how the curator happened to type it.
    const spellings = [SPACED, HYPHENATED, "NOT_A_REAL_HOST"];
    const entries = new Set(spellings.map(entryFor));
    expect(entries.size).toBe(1);
    expect(normalize(SPACED)).toBe("notarealhost");
  });
});

describe("it refuses names too short to be safe", () => {
  it("returns nothing below the module's minimum", () => {
    const short = "a".repeat(MIN_NAME_LENGTH - 1);
    expect(entryFor(short)).toBeUndefined();
  });

  it("accepts a name exactly at the minimum", () => {
    const exact = "a".repeat(MIN_NAME_LENGTH);
    expect(entryFor(exact)).toBe(nameEntry(exact));
  });
});
