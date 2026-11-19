/**
 * The criterion catalogue, read from the package Lisa is running from.
 *
 * The control commands work in repositories where Lisa was never applied, so
 * nothing in the host repository can be the source of the requirements: there
 * is no `spec/` folder there to read. The catalogue ships in the package
 * (`spec/tasc-criteria.json` is in the package `files`) and is resolved from
 * this module's own location, which sits two folders below the package root
 * both in the source tree (`src/controls/`) and after the build
 * (`dist/controls/`).
 *
 * Only the fields the control commands depend on are checked here. The full
 * contract is the published JSON Schema beside the catalogue, and a suite holds
 * the catalogue to it; an entry may carry keys this module does not know, and
 * they are passed through untouched.
 * @module controls/catalogue
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { isJsonObject } from "../sync/json-path.js";

/** The catalogue's path inside the Lisa package. */
export const CATALOGUE_PACKAGE_PATH = path.join("spec", "tasc-criteria.json");

/**
 * Source of the pattern a criterion id matches: `AC<family>.<number>`, or
 * `SI`, `DP` or `UX` followed by a number. The same pattern the catalogue's
 * JSON Schema holds an id to.
 */
export const CRITERION_ID_SOURCE = String.raw`AC[1-9]\d*\.[1-9]\d*|(?:SI|DP|UX)[1-9]\d*`;

/**
 * Where a requirement is answered when a repository has more than one part.
 * `repository`: once, for the repository as a whole. `part`: once for each
 * part, because the honest answer can differ between two folders. The
 * catalogue decides this for every in-scope criterion so that nobody placing
 * or checking a finding has to guess.
 */
export const CRITERION_ANSWERED = ["repository", "part"] as const;

/** One of the two places a requirement is answered. */
export type CriterionAnswered = (typeof CRITERION_ANSWERED)[number];

/**
 * What a requirement's `not_applicable_when` holds when nothing makes it not
 * apply. A finding may never file such a requirement as not applicable.
 */
export const NEVER_NOT_APPLICABLE = "never";

/** A criterion the Level 1 verdict covers. */
export interface InScopeCriterion {
  /** The id exactly as the specification writes it, for example `AC5.4`. */
  readonly id: string;
  /** The specification's title for the criterion. Detail, never a headline. */
  readonly title: string;
  readonly in_scope: true;
  /** The requirement as one plain-language question. */
  readonly question: string;
  /**
   * The one condition under which the requirement does not apply, in plain
   * words, or {@link NEVER_NOT_APPLICABLE} when it always applies.
   */
  readonly not_applicable_when: string;
  /** Whether it has one answer for the repository or one for each part. */
  readonly answered: CriterionAnswered;
  /** Catalogue keys this module does not interpret. */
  readonly [key: string]: unknown;
}

/** A criterion the Level 1 verdict leaves out. */
export interface ExcludedCriterion {
  readonly id: string;
  readonly title: string;
  readonly in_scope: false;
  /** Catalogue keys this module does not interpret. */
  readonly [key: string]: unknown;
}

/** Any catalogue entry. */
export type CatalogueCriterion = InScopeCriterion | ExcludedCriterion;

/** The catalogue file. */
export interface CriterionCatalogue {
  /** One entry per criterion id, in the specification's order. */
  readonly criteria: readonly CatalogueCriterion[];
  /** Catalogue keys this module does not interpret. */
  readonly [key: string]: unknown;
}

/**
 * Every criterion id a text mentions.
 * @param text - Any text
 * @returns Each mention, in order, repeats included
 */
export function criterionIdsIn(text: string): string[] {
  return [
    ...text.matchAll(
      new RegExp(String.raw`\b(?:${CRITERION_ID_SOURCE})\b`, "gu")
    ),
  ].map(match => match[0]);
}

/**
 * Locate the catalogue inside the running Lisa package.
 * @returns Absolute path of the catalogue
 * @throws {Error} When the package does not hold one
 */
export function resolveCataloguePath(): string {
  const packageRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    ".."
  );
  const file = path.join(packageRoot, CATALOGUE_PACKAGE_PATH);
  if (!existsSync(file)) {
    throw new Error(
      `The criterion catalogue is missing from this copy of Lisa (expected ${file}). Reinstall Lisa.`
    );
  }
  return file;
}

/**
 * Tell whether a value is non-empty text.
 * @param value - Candidate
 * @returns Whether it is a string with content
 */
function isText(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

/**
 * Tell whether a value is one of the two places a requirement is answered.
 * @param value - Candidate
 * @returns Whether it is `repository` or `part`
 */
function isAnswered(value: unknown): value is CriterionAnswered {
  return CRITERION_ANSWERED.some(answered => answered === value);
}

/**
 * Tell whether a value has the fields the control commands read from an entry.
 * @param entry - Candidate catalogue entry
 * @returns Whether it can be used
 */
function isCriterion(entry: unknown): entry is CatalogueCriterion {
  if (!isJsonObject(entry) || !isText(entry.id) || !isText(entry.title)) {
    return false;
  }
  return entry.in_scope === true
    ? isText(entry.question) &&
        isText(entry.not_applicable_when) &&
        isAnswered(entry.answered)
    : entry.in_scope === false;
}

/**
 * Read the criterion catalogue.
 * @param file - Catalogue to read; the running package's own by default
 * @returns The catalogue
 * @throws {Error} When the file is not a usable criterion catalogue
 */
export function loadCriterionCatalogue(
  file: string = resolveCataloguePath()
): CriterionCatalogue {
  const document = JSON.parse(readFileSync(file, "utf8")) as unknown;
  if (
    !isJsonObject(document) ||
    !Array.isArray(document.criteria) ||
    !document.criteria.every(entry => isCriterion(entry))
  ) {
    throw new Error(
      `${file} is not a usable criterion catalogue: every entry needs an id, a title and an in_scope flag, and every in-scope entry a question, a not_applicable_when condition and an answered value of ${CRITERION_ANSWERED.join(" or ")}.`
    );
  }
  return document as CriterionCatalogue;
}

/**
 * The criteria a Level 1 report must classify.
 * @param catalogue - The catalogue
 * @returns Its in-scope entries, in catalogue order
 */
export function inScopeCriteria(
  catalogue: CriterionCatalogue
): readonly InScopeCriterion[] {
  return catalogue.criteria.filter(
    (criterion): criterion is InScopeCriterion => criterion.in_scope
  );
}
