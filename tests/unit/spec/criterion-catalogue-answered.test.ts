/**
 * Every in-scope requirement says where it is answered
 * (CodySwannGT/lisa#5007).
 *
 * An audit reports its findings part by part. Some requirements have one
 * answer for the whole repository (who answers for what the agents do) and
 * some have one answer for each part (is this folder's code tested). When the
 * catalogue did not say which, the agent running the audit had to guess, two
 * audits of one repository disagreed, and most of a folder's findings were
 * filler pointing at the repository-wide answer.
 *
 * `answered` is that decision as data: `repository` or `part`. The test for
 * each requirement is whether the honest answer can differ between two folders
 * of one repository. Code, tests, coverage, style, outside packages, their
 * licences and screens can. People, policy, the hosting platform, the tracker,
 * agent identity, incident handling and the system as a whole cannot. A
 * requirement that is genuinely both is `repository`.
 *
 * The per-part list is pinned once, deliberately. Moving a requirement from
 * one value to the other changes the shape of every audit report, so it has to
 * be a decision someone made by reading the criterion, never a side effect.
 * @module tests/unit/spec/criterion-catalogue-answered
 */
import { describe, expect, it } from "vitest";

import {
  CATALOGUE_PATH,
  catalogueSchemaErrors,
  readRepositoryFile,
} from "../../helpers/criterion-catalogue.js";

/** The only two values the key may take. */
const ANSWERED_VALUES = ["repository", "part"];

/**
 * The requirements whose answer can differ between two folders of one
 * repository, in catalogue order. Every other in-scope requirement is answered
 * once for the repository. Change this list only together with the catalogue,
 * after reading the criterion's text in the specification.
 */
const ANSWERED_PER_PART = [
  "AC9.2",
  "AC9.3",
  "SI1",
  "SI2",
  "SI3",
  "SI4",
  "SI7",
  "SI8",
  "SI9",
  "UX1",
  "UX2",
  "UX4",
  "UX5",
];

/** A catalogue entry read without assuming which keys it has. */
type Entry = Readonly<Record<string, unknown>>;

/**
 * The catalogue as it is on disk, read as plain JSON: this suite is about
 * which keys an entry carries, so it must not start from a type that already
 * says.
 */
const catalogue = JSON.parse(readRepositoryFile(CATALOGUE_PATH)) as {
  readonly criteria: readonly Entry[];
};
const entries = catalogue.criteria;
const inScope = entries.filter(entry => entry.in_scope === true);
const excluded = entries.filter(entry => entry.in_scope !== true);

/**
 * The first in-scope entry of each shape the schema allows: met without a
 * gate, met by registered gates, and of kind gate with no registered gate.
 */
const ONE_OF_EACH_SHAPE = [
  { shape: "met without a gate", entry: inScope.find(e => e.kind !== "gate") },
  {
    shape: "with registered gates",
    entry: inScope.find(e => Array.isArray(e.gates) && e.gates.length > 0),
  },
  {
    shape: "with no registered gate",
    entry: inScope.find(e => typeof e.no_gate_reason === "string"),
  },
];

/**
 * The schema's findings for the catalogue with one entry replaced.
 * @param id - Id of the entry to replace
 * @param replacement - The entry to put there
 * @returns One line per finding; empty when the result is still valid
 */
function errorsWithEntry(id: unknown, replacement: Entry): string[] {
  return catalogueSchemaErrors({
    ...catalogue,
    criteria: entries.map(entry => (entry.id === id ? replacement : entry)),
  });
}

/**
 * An entry without its `answered` key.
 * @param entry - Catalogue entry
 * @returns A copy without the key
 */
function withoutAnswered(entry: Entry): Entry {
  return Object.fromEntries(
    Object.entries(entry).filter(([key]) => key !== "answered")
  );
}

describe("where each in-scope requirement is answered", () => {
  it("is stated on every in-scope entry as repository or part", () => {
    const unstated = inScope
      .filter(entry => !ANSWERED_VALUES.includes(String(entry.answered)))
      .map(entry => entry.id);

    expect(inScope).toHaveLength(77);
    expect(unstated).toEqual([]);
  });

  it("is not stated on an entry the level leaves out", () => {
    expect(
      excluded.filter(entry => "answered" in entry).map(entry => entry.id)
    ).toEqual([]);
  });

  it("is per part for exactly the requirements whose answer can differ between folders", () => {
    expect(
      inScope.filter(entry => entry.answered === "part").map(entry => entry.id)
    ).toEqual(ANSWERED_PER_PART);
  });

  it("is once for the repository for every other in-scope requirement", () => {
    expect(
      inScope.filter(entry => entry.answered === "repository")
    ).toHaveLength(77 - ANSWERED_PER_PART.length);
  });

  it("sits directly after the not-applicable condition, with no other key moved", () => {
    const misplaced = inScope
      .filter(entry => {
        const keys = Object.keys(entry);
        return (
          keys[keys.indexOf("answered") - 1] !== "not_applicable_when" ||
          keys.slice(0, 7).join() !==
            "id,title,in_scope,question,kind,minimum_rung,not_applicable_when"
        );
      })
      .map(entry => entry.id);

    expect(misplaced).toEqual([]);
  });
});

describe("the schema holds every in-scope shape to it", () => {
  it("has an entry of each shape to break", () => {
    expect(
      ONE_OF_EACH_SHAPE.filter(({ entry }) => entry === undefined).map(
        ({ shape }) => shape
      )
    ).toEqual([]);
  });

  it.each(ONE_OF_EACH_SHAPE)(
    "rejects an entry $shape that does not say where it is answered",
    ({ entry }) => {
      const errors = errorsWithEntry(entry?.id, withoutAnswered(entry ?? {}));
      const index = entries.findIndex(candidate => candidate.id === entry?.id);

      expect(
        errors.filter(error => error.startsWith(`criteria.${index}.answered:`))
      ).toHaveLength(1);
    }
  );

  it.each(ONE_OF_EACH_SHAPE)(
    "rejects an entry $shape answered somewhere other than repository or part",
    ({ entry }) => {
      expect(
        errorsWithEntry(entry?.id, { ...entry, answered: "folder" })
      ).not.toEqual([]);
      expect(
        errorsWithEntry(entry?.id, { ...entry, answered: "" })
      ).not.toEqual([]);
    }
  );

  it("rejects an excluded entry that says where it is answered", () => {
    const [entry] = excluded;

    expect(entry).toBeDefined();
    expect(
      errorsWithEntry(entry?.id, { ...entry, answered: "repository" })
    ).not.toEqual([]);
  });
});
