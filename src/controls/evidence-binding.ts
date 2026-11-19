/**
 * Reading the part of the evidence file that says what defined the checks.
 *
 * The file's `checks` holds one digest and the list of everything it covers
 * (`./checks-binding.ts`). Here that part is held to its shape, exactly as
 * the rest of the file is in `./evidence-document.ts`: closed objects, every
 * digest a digest, the list in the file's one order.
 *
 * ## A file with no `checks`
 *
 * An evidence file of this format version that holds a list of records and
 * no `checks` was written before evidence was bound to what defines the
 * checks. Its records say what happened and not which checks it happened
 * to, so none of it is read as evidence: the attest step writes it again,
 * and `lisa controls attest --check` says the evidence predates the binding
 * instead of calling it current. Anything else with no `checks` is simply
 * not what the attest step writes.
 *
 * Whether the digest is the digest of the list is not asked here. That is a
 * question about whether the file is authentic, and `lisa controls attest
 * --check` asks it with the others of its kind.
 * @module controls/evidence-binding
 */
import { isJsonObject } from "../sync/json-path.js";
import { compareCodeUnits } from "./canonical-json.js";
import { EVIDENCE_PATH } from "./evidence.js";
import { EVIDENCE_SCHEMA_VERSION } from "./evidence-types.js";

/** A SHA-256 digest, in lower-case hexadecimal. */
const SHA256 = /^[0-9a-f]{64}$/u;

/** The key of the evidence file that holds the binding. */
const CHECKS_KEY = "checks";

/** The keys of the binding. */
const BINDING_KEYS = ["covered", "digest"];

/** The keys of one covered file. */
const COVERED_KEYS = ["path", "sha256"];

/** What is said of a file written before the binding existed. */
export const EVIDENCE_PREDATES_BINDING = `${EVIDENCE_PATH} was written before evidence was bound to what defines the checks: it has no "${CHECKS_KEY}", so nothing in it says which checks its records are about. Run "lisa controls attest" to prove the controls again and write it anew.`;

/**
 * Tell whether a value is a SHA-256 digest in lower-case hexadecimal.
 * @param value - Candidate
 * @returns Whether it is
 */
export function isSha256(value: unknown): value is string {
  return typeof value === "string" && SHA256.test(value);
}

/**
 * Tell whether a parsed evidence file was written before evidence was bound
 * to what defines the checks.
 * @param document - The parsed file, of any shape
 * @returns Whether it is an evidence file of this format version, with its
 *   list of records, and no `checks`
 */
export function evidencePredatesBinding(document: unknown): boolean {
  return (
    isJsonObject(document) &&
    document[CHECKS_KEY] === undefined &&
    document.schema_version === EVIDENCE_SCHEMA_VERSION &&
    Array.isArray(document.records)
  );
}

/**
 * Name the keys an object holds that it should not, and the ones it lacks.
 * @param value - The object
 * @param keys - The keys it must hold, and no others
 * @param what - What the object is, to start each line
 * @returns One line per problem
 */
function keyProblems(
  value: Readonly<Record<string, unknown>>,
  keys: readonly string[],
  what: string
): readonly string[] {
  return [
    ...Object.keys(value)
      .filter(key => !keys.includes(key))
      .map(key => `${what}: "${key}" is not a key the attest step writes.`),
    ...keys
      .filter(key => value[key] === undefined)
      .map(key => `${what}: "${key}" is missing.`),
  ];
}

/**
 * What is wrong with one entry of the covered list.
 * @param entry - The candidate
 * @param position - Its place in the list, counted from one
 * @returns One line per problem
 */
function coveredProblems(entry: unknown, position: number): readonly string[] {
  const what = `"${CHECKS_KEY}.covered" entry ${String(position)}`;
  if (!isJsonObject(entry)) return [`${what}: is not a JSON object.`];
  return [
    ...keyProblems(entry, COVERED_KEYS, what),
    ...(entry.path === undefined ||
    (typeof entry.path === "string" && entry.path !== "")
      ? []
      : [`${what}: "path" must be a file, from the repository root.`]),
    ...(entry.sha256 === undefined || isSha256(entry.sha256)
      ? []
      : [
          `${what}: "sha256" must be a SHA-256 digest in lower-case hexadecimal.`,
        ]),
  ];
}

/**
 * What is wrong with the order of the covered list.
 * @param covered - The list, each entry of any shape
 * @returns One line when the paths are not each once, in order
 */
function orderProblems(covered: readonly unknown[]): readonly string[] {
  const paths = covered.flatMap(entry =>
    isJsonObject(entry) && typeof entry.path === "string" ? [entry.path] : []
  );
  const ordered = paths.every(
    (file, index) =>
      index === 0 || compareCodeUnits(paths[index - 1] ?? "", file) < 0
  );
  return ordered
    ? []
    : [`"${CHECKS_KEY}.covered" must list each file once, ordered by path.`];
}

/**
 * What is wrong with the evidence file's account of what defined the checks.
 * @param document - The parsed evidence file, a JSON object
 * @returns One line per problem; none when it is what the attest step writes
 */
export function bindingProblems(
  document: Readonly<Record<string, unknown>>
): readonly string[] {
  const checks = document[CHECKS_KEY];
  if (checks === undefined) {
    return [
      evidencePredatesBinding(document)
        ? EVIDENCE_PREDATES_BINDING
        : `"${CHECKS_KEY}" is missing.`,
    ];
  }
  if (!isJsonObject(checks)) {
    return [`"${CHECKS_KEY}" is not a JSON object.`];
  }
  const { covered, digest } = checks;
  return [
    ...keyProblems(checks, BINDING_KEYS, `"${CHECKS_KEY}"`),
    ...(digest === undefined || isSha256(digest)
      ? []
      : [
          `"${CHECKS_KEY}.digest" must be a SHA-256 digest in lower-case hexadecimal.`,
        ]),
    ...(covered === undefined || Array.isArray(covered)
      ? []
      : [`"${CHECKS_KEY}.covered" is not a list.`]),
    ...(Array.isArray(covered)
      ? [
          ...(covered as readonly unknown[]).flatMap((entry, index) =>
            coveredProblems(entry, index + 1)
          ),
          ...orderProblems(covered as readonly unknown[]),
        ]
      : []),
  ];
}
