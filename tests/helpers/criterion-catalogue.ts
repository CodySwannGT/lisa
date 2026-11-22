/**
 * Shared reading of the specification and its criterion catalogue for the
 * suites that keep the two in step (CodySwannGT/lisa#4975).
 *
 * The specification is the authority. Everything here reads the real files on
 * every call: nothing is cached in a fixture that could agree with a stale
 * catalogue.
 * @module tests/helpers/criterion-catalogue
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { z } from "zod";

const REPO_ROOT = path.resolve(__dirname, "..", "..");

/** The specification the catalogue describes. */
export const SPECIFICATION_PATH = "spec/tasc-0.1-draft.md";

/** The criterion catalogue. */
export const CATALOGUE_PATH = "spec/tasc-criteria.json";

/** The JSON Schema the catalogue validates against. */
export const SCHEMA_PATH = "spec/tasc-criteria.schema.json";

/** A criterion id: `AC<family>.<number>`, or `SI`, `DP` or `UX` and a number. */
const CRITERION_ID = String.raw`AC[1-9]\d*\.[1-9]\d*|(?:SI|DP|UX)[1-9]\d*`;

/**
 * The bullet that defines a criterion: a bolded id, its title, a full stop.
 * For example `- **AC1.1 Attribution.** Every action taken by an agent …`.
 */
const CRITERION_DEFINITION = new RegExp(
  String.raw`^- \*\*(?<id>${CRITERION_ID}) (?<title>[^*]+)\.\*\*`,
  "gmu"
);

/** Any mention of a criterion id, whether it defines one or only cites it. */
const CRITERION_MENTION = new RegExp(String.raw`\b(?:${CRITERION_ID})\b`, "gu");

/** Where a criterion's text stops when no other criterion follows it. */
const SECTION_BREAK = /^(?:#{1,6} |---$)/mu;

/** One criterion as the specification states it. */
export interface SpecifiedCriterion {
  readonly id: string;
  readonly title: string;
  /** The criterion's full text, from its bullet to the next one. */
  readonly text: string;
}

/** A catalogue entry the Level 1 verdict covers. */
export interface InScopeCriterion {
  readonly id: string;
  readonly title: string;
  readonly in_scope: true;
  readonly question: string;
  readonly kind: string;
  readonly minimum_rung: string;
  readonly not_applicable_when: string;
  /** `repository`: answered once. `part`: answered once for each part. */
  readonly answered: string;
  readonly level_note?: string;
  /** Kind `gate` only: the registered gates that can satisfy the entry. */
  readonly gates?: readonly string[];
  /** Kind `gate` with no gates only: why the registry has none. */
  readonly no_gate_reason?: string;
}

/** A catalogue entry the Level 1 verdict leaves out, and why. */
export interface ExcludedCriterion {
  readonly id: string;
  readonly title: string;
  readonly in_scope: false;
  readonly excluded_reason: string;
}

/** Any catalogue entry. */
type Criterion = InScopeCriterion | ExcludedCriterion;

/** The catalogue file. */
export interface Catalogue {
  readonly specification: string;
  readonly specification_version: string;
  readonly level: number;
  readonly criteria: readonly Criterion[];
}

/** How a list of catalogue ids differs from the specification's. */
export interface IdDifference {
  readonly missing: readonly string[];
  readonly duplicated: readonly string[];
  readonly unknown: readonly string[];
}

/**
 * Read a repository file as text.
 * @param file - Repository-relative path
 * @returns The file's contents
 */
export function readRepositoryFile(file: string): string {
  return readFileSync(path.join(REPO_ROOT, file), "utf8");
}

/**
 * Every criterion the specification defines, in the order it defines them.
 * @param specification - The specification's Markdown
 * @returns Id, title and full text of each criterion
 */
export function specifiedCriteria(specification: string): SpecifiedCriterion[] {
  const definitions = [...specification.matchAll(CRITERION_DEFINITION)];
  return definitions.map((definition, index) => {
    const next = definitions[index + 1]?.index ?? specification.length;
    const rest = specification.slice(definition.index, next);
    const sectionBreak = rest.search(SECTION_BREAK);
    return {
      id: definition.groups?.id ?? "",
      title: definition.groups?.title ?? "",
      text: sectionBreak === -1 ? rest : rest.slice(0, sectionBreak),
    };
  });
}

/**
 * Every criterion id a text mentions, defined there or only cited.
 * @param text - Any text
 * @returns Each distinct id, in order of first mention
 */
export function mentionedCriterionIds(text: string): string[] {
  return [
    ...new Set([...text.matchAll(CRITERION_MENTION)].map(match => match[0])),
  ];
}

/**
 * Compare a catalogue's ids with the specification's.
 * @param specified - Ids the specification defines
 * @param catalogued - Ids the catalogue lists, repeats included
 * @returns The ids that are missing, listed more than once, or not in the
 *   specification; a repeated id is reported once
 */
export function compareIds(
  specified: readonly string[],
  catalogued: readonly string[]
): IdDifference {
  return {
    missing: specified.filter(id => !catalogued.includes(id)),
    duplicated: [
      ...new Set(
        catalogued.filter((id, index) => catalogued.indexOf(id) !== index)
      ),
    ],
    unknown: catalogued.filter(id => !specified.includes(id)),
  };
}

/**
 * The criterion catalogue as it is on disk.
 * @returns The parsed catalogue
 */
export function loadCatalogue(): Catalogue {
  return JSON.parse(readRepositoryFile(CATALOGUE_PATH)) as Catalogue;
}

/**
 * Of several shapes a value failed to match, the findings for the one it came
 * closest to: the fewest findings. An entry is one of several shapes, and
 * listing what is wrong with it as each of them buries the one line that says
 * what to fix. Shapes that tie are all reported, a repeated line once.
 * @param alternatives - The findings against each shape
 * @returns The findings against the closest shape or shapes
 */
function closestAlternative(
  alternatives: readonly (readonly string[])[]
): string[] {
  const fewest = Math.min(...alternatives.map(findings => findings.length));
  return [
    ...new Set(
      alternatives.filter(findings => findings.length === fewest).flat()
    ),
  ];
}

/**
 * Turn a validator's findings into one line each, opening a failed either/or
 * so the line names the field rather than only "invalid input".
 *
 * An either/or can also fail with nothing to open: a value that matches more
 * than one shape where exactly one is allowed. That is reported as its own
 * line, so no failure ever comes back as an empty list.
 * @param issues - Findings from the validator
 * @param at - Path of the value the findings belong to
 * @returns `<path>: <message>` for every finding
 */
function describeIssues(
  issues: readonly z.core.$ZodIssue[],
  at: readonly PropertyKey[] = []
): string[] {
  return issues.flatMap(issue => {
    const where = [...at, ...issue.path];
    return issue.code === "invalid_union" && issue.errors.length > 0
      ? closestAlternative(
          issue.errors.map(branch => describeIssues(branch, where))
        )
      : [`${where.map(String).join(".")}: ${issue.message}`];
  });
}

/**
 * Validate a document against the published catalogue schema.
 *
 * The schema file is the contract; this only executes it. It is read on every
 * call so a schema edit cannot be masked by an earlier compile.
 * @param document - Candidate catalogue
 * @returns One line per finding; empty when the document is valid
 */
export function catalogueSchemaErrors(document: unknown): string[] {
  const schema = JSON.parse(readRepositoryFile(SCHEMA_PATH)) as Parameters<
    typeof z.fromJSONSchema
  >[0];
  const result = z.fromJSONSchema(schema).safeParse(document);
  return result.success ? [] : describeIssues(result.error.issues);
}
