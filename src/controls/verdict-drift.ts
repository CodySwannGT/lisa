/**
 * Telling whether a committed verdict still says what the register and the
 * evidence produce, and where it does not.
 *
 * The verdict is computed, so the only correct content is what computing it
 * again gives. Anything else is one of three things: somebody edited the
 * verdict, somebody changed a file it was computed from, or time passed and
 * a record it rested on is no longer current. Each difference is said in
 * plain words, against the requirement it concerns where there is one, so a
 * person can see what the file misstates without comparing two files by eye.
 * @module controls/verdict-drift
 */
import { isJsonObject } from "../sync/json-path.js";
import { canonicalText, compareCodeUnits } from "./canonical-json.js";
import { EVIDENCE_PATH } from "./evidence.js";
import { CONTROL_REGISTER_PATH } from "./register-types.js";
import {
  VERDICT_PATH,
  type CriterionVerdict,
  type Verdict,
} from "./verdict-types.js";

/** The keys of the verdict compared one by one, after the ones with their own wording. */
const PLAIN_KEYS = [
  "schema_version",
  "counts",
  "evidence_as_of",
  "current_until",
] as const;

/** How many requirement ids a line names before it counts the rest. */
const NAMED_LIMIT = 10;

/** The start of every difference, naming where what is right comes from. */
const GIVES = "the register and the evidence give";

/**
 * Write a value the way it appears in the file, short enough to read.
 * @param value - Any JSON value, or `undefined` when the key is absent
 * @returns The value as text
 */
function shown(value: unknown): string {
  if (value === undefined) return "nothing";
  const text = canonicalText(value);
  return text.length > 120 ? `${text.slice(0, 117)}…` : text;
}

/**
 * Tell whether two JSON values are the same.
 * @param left - First value
 * @param right - Second value
 * @returns Whether they hold the same values
 */
function same(left: unknown, right: unknown): boolean {
  return (
    left !== undefined &&
    right !== undefined &&
    canonicalText(left) === canonicalText(right)
  );
}

/**
 * The keys two objects disagree on.
 * @param left - First value
 * @param right - Second value
 * @returns Each key present in only one, or holding different values, sorted
 */
function differingKeys(left: unknown, right: unknown): readonly string[] {
  const first = isJsonObject(left) ? left : {};
  const second = isJsonObject(right) ? right : {};
  return [...new Set([...Object.keys(first), ...Object.keys(second)])]
    .filter(key => !same(first[key], second[key]))
    .sort(compareCodeUnits);
}

/**
 * Say how the digest in a verdict differs from the digest of the files.
 * @param committed - The `digest` of the committed verdict
 * @param expected - The digest of the register and the evidence now
 * @returns One line per difference
 */
function digestDifferences(
  committed: unknown,
  expected: Verdict["digest"]
): readonly string[] {
  const written = isJsonObject(committed) ? committed : {};
  const changed = (key: "register" | "evidence"): boolean =>
    written[key] !== expected[key];
  const lines = [
    ...(changed("register")
      ? [
          `${CONTROL_REGISTER_PATH} is not the register this verdict was computed from: the verdict records the digest ${shown(written.register)} for it, and the register now gives ${shown(expected.register)}.`,
        ]
      : []),
    ...(changed("evidence")
      ? [
          `${EVIDENCE_PATH} is not the evidence this verdict was computed from: the verdict records the digest ${shown(written.evidence)} for it, and the file now gives ${shown(expected.evidence)}.`,
        ]
      : []),
  ];
  if (lines.length > 0) return lines;
  return same(committed, expected)
    ? []
    : [
        `The digest written in ${VERDICT_PATH} is not the digest of the register and the evidence: the file says ${shown(committed)}, and ${GIVES} ${shown(expected)}.`,
      ];
}

/**
 * Say how one requirement's committed verdict differs from the computed one.
 * @param committed - The committed entry, when the file has one
 * @param expected - The computed entry
 * @returns One line, or none when they agree
 */
function criterionDifference(
  committed: unknown,
  expected: CriterionVerdict
): readonly string[] {
  const id = expected.criterion;
  if (committed === undefined) {
    return [
      `${id}: ${VERDICT_PATH} has no verdict for this requirement; ${GIVES} ${expected.verdict}.`,
    ];
  }
  const written = isJsonObject(committed) ? committed.verdict : undefined;
  if (written !== expected.verdict) {
    return [
      `${id}: ${VERDICT_PATH} says ${shown(written)}; ${GIVES} ${expected.verdict}. ${expected.detail}`,
    ];
  }
  const keys = differingKeys(committed, expected);
  return keys.length === 0
    ? []
    : [
        `${id}: the verdict is ${expected.verdict} in both, but ${keys.join(", ")} ${keys.length === 1 ? "is" : "are"} not what ${GIVES}.`,
      ];
}

/**
 * Say how the committed per-requirement verdicts differ from the computed.
 * @param committed - The `criteria` of the committed verdict
 * @param expected - The computed verdicts
 * @returns One line per requirement that differs
 */
function criteriaDifferences(
  committed: unknown,
  expected: readonly CriterionVerdict[]
): readonly string[] {
  const entries = Array.isArray(committed) ? (committed as unknown[]) : [];
  const idOf = (entry: unknown): unknown =>
    isJsonObject(entry) ? entry.criterion : undefined;
  const extra = entries
    .filter(entry => !expected.some(each => each.criterion === idOf(entry)))
    .map(
      entry =>
        `${VERDICT_PATH} has a verdict for ${shown(idOf(entry))}, which is not one of the requirements a verdict covers.`
    );
  const repeated = expected
    .filter(
      each => entries.filter(entry => idOf(entry) === each.criterion).length > 1
    )
    .map(
      each =>
        `${each.criterion}: ${VERDICT_PATH} has more than one verdict for this requirement.`
    );
  return [
    ...expected.flatMap(each =>
      criterionDifference(
        entries.find(entry => idOf(entry) === each.criterion),
        each
      )
    ),
    ...repeated,
    ...extra,
  ];
}

/**
 * Name a few requirements and count the rest.
 * @param ids - Requirement ids
 * @returns For example `AC1.1, AC1.2 and 40 more`
 */
function firstFew(ids: readonly string[]): string {
  const named = ids.slice(0, NAMED_LIMIT).join(", ");
  return ids.length > NAMED_LIMIT
    ? `${named} and ${ids.length - NAMED_LIMIT} more`
    : named;
}

/**
 * Say how the list of requirements that prevent a conforming result differs
 * from the computed one.
 * @param committed - The `prevented_by` of the committed verdict
 * @param expected - The computed list
 * @returns One line per kind of difference
 */
function preventedDifferences(
  committed: unknown,
  expected: readonly string[]
): readonly string[] {
  if (same(committed, expected)) return [];
  const listed = Array.isArray(committed)
    ? committed.filter((id): id is string => typeof id === "string")
    : [];
  const leftOut = expected.filter(id => !listed.includes(id));
  const added = listed.filter(id => !expected.includes(id));
  const lines = [
    ...(leftOut.length === 0
      ? []
      : [
          `${VERDICT_PATH} leaves ${firstFew(leftOut)} out of "prevented_by"; ${GIVES} ${leftOut.length === 1 ? "it as a requirement that prevents" : "them as requirements that prevent"} a conforming result.`,
        ]),
    ...(added.length === 0
      ? []
      : [
          `${VERDICT_PATH} lists ${firstFew(added)} in "prevented_by"; ${GIVES} no reason for ${added.length === 1 ? "it" : "them"} to be there.`,
        ]),
  ];
  return lines.length > 0
    ? lines
    : [
        `${VERDICT_PATH} says "prevented_by" is ${shown(committed)}; ${GIVES} the same requirements in the catalogue's order, once each.`,
      ];
}

/**
 * Say how the requirements a verdict names differ from this copy of Lisa's.
 * @param committed - The `requirements` of the committed verdict
 * @param expected - The catalogue this copy of Lisa ships
 * @returns One line, or none when they agree
 */
function requirementsDifference(
  committed: unknown,
  expected: Verdict["requirements"]
): readonly string[] {
  return same(committed, expected)
    ? []
    : [
        `The verdict was computed against a different list of requirements than this copy of Lisa ships: the file says ${shown(committed)}, and this copy has ${shown(expected)}.`,
      ];
}

/**
 * Compare a committed verdict with the one its inputs produce now.
 * @param committed - The committed verdict file, parsed
 * @param expected - The verdict computed from the register and the evidence
 * @returns One line per difference; empty when the file is up to date
 */
export function verdictDrift(
  committed: unknown,
  expected: Verdict
): readonly string[] {
  if (!isJsonObject(committed)) {
    return [`${VERDICT_PATH} is not a JSON object, so it is not a verdict.`];
  }
  const unknown = Object.keys(committed)
    .filter(key => !(key in expected))
    .map(
      key =>
        `${VERDICT_PATH} has the key "${key}", which the attest step does not write.`
    );
  const lines = [
    ...digestDifferences(committed.digest, expected.digest),
    ...requirementsDifference(committed.requirements, expected.requirements),
    ...(committed.result === expected.result
      ? []
      : [
          `${VERDICT_PATH} says the Level 1 result is ${shown(committed.result)}; ${GIVES} ${expected.result}.`,
        ]),
    ...criteriaDifferences(committed.criteria, expected.criteria),
    ...preventedDifferences(committed.prevented_by, expected.prevented_by),
    ...PLAIN_KEYS.filter(key => !same(committed[key], expected[key])).map(
      key =>
        `${VERDICT_PATH} says "${key}" is ${shown(committed[key])}; ${GIVES} ${shown(expected[key])}.`
    ),
    ...unknown,
  ];
  return lines.length > 0 || same(committed, expected)
    ? lines
    : [`${VERDICT_PATH} is not what ${GIVES}.`];
}
