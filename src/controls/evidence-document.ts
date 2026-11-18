/**
 * Reading and writing the evidence file as exactly what the attest step
 * writes.
 *
 * `./evidence.ts` and `./proof-halves.ts` read a few fields of a record and
 * ignore the rest, because all they decide is whether a claim is backed.
 * The verdict is computed from the whole record, so here nothing is ignored:
 * every object is closed, every value is held to its word list, and a
 * record's identifier must be the one its own fields give. A file that fails
 * is not half-read; every problem comes back, named by the record it is in.
 *
 * The file's text is one fixed arrangement of its values: records ordered by
 * identifier, keys in code-unit order at every depth, two-space indent, one
 * trailing newline. The same records always give the same bytes.
 * @module controls/evidence-document
 */
import { isJsonObject } from "../sync/json-path.js";
import { canonicalize, compareCodeUnits } from "./canonical-json.js";
import { CRITERION_ID_SOURCE } from "./catalogue.js";
import { EVIDENCE_PATH, isCanonicalUtc } from "./evidence.js";
import {
  EVIDENCE_EXCERPT_LIMIT,
  EVIDENCE_RESULTS,
  EVIDENCE_RUNGS,
  EVIDENCE_SCHEMA_VERSION,
  evidenceRecordId,
  findingRecordId,
  MAX_FRESHNESS_SECONDS,
  type EvidenceDocument,
  type EvidenceRecord,
} from "./evidence-types.js";
import { PROOF_HALVES } from "./proof-halves.js";

/** An evidence file read back, or one line per reason it could not be. */
export type EvidenceDocumentParse =
  | { readonly problems: null; readonly document: EvidenceDocument }
  | { readonly problems: readonly string[] };

/** A whole requirement id. */
const CRITERION_ID = new RegExp(`^(?:${CRITERION_ID_SOURCE})$`, "u");

/** A git commit hash, in either of git's two lengths. */
const COMMIT_HASH = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;

/** The keys of the file itself. */
const DOCUMENT_KEYS = ["records", "schema_version"] as const;

/**
 * Tell whether a value is text with something in it.
 * @param value - Candidate
 * @returns Whether it is a non-empty string
 */
function isText(value: unknown): value is string {
  return typeof value === "string" && value !== "";
}

/**
 * Tell whether a value is one of a list of words.
 * @param words - The list
 * @returns A test for membership
 */
function oneOf(words: readonly string[]): (value: unknown) => boolean {
  return value => words.some(word => word === value);
}

/**
 * Tell whether a value is `null` or passes a test.
 * @param test - The test for a value that is there
 * @returns A test that also accepts `null`
 */
function orNull(
  test: (value: unknown) => boolean
): (value: unknown) => boolean {
  return value => value === null || test(value);
}

/** Each key of a record: whether it must be there, and what it must hold. */
const RECORD_FIELDS: Readonly<
  Record<
    keyof EvidenceRecord,
    {
      readonly optional?: true;
      readonly test: (value: unknown) => boolean;
      readonly holds: string;
    }
  >
> = {
  id: { test: isText, holds: "text" },
  criterion: {
    test: value => typeof value === "string" && CRITERION_ID.test(value),
    holds: "a requirement id such as AC5.4 or SI7",
  },
  entry_id: { test: orNull(isText), holds: "a register entry's id, or null" },
  scope: { test: isText, holds: "a folder, or . for the whole repository" },
  rung: {
    test: oneOf(EVIDENCE_RUNGS),
    holds: `one of ${EVIDENCE_RUNGS.join(", ")}`,
  },
  half: {
    optional: true,
    test: oneOf(PROOF_HALVES),
    holds: `one of ${PROOF_HALVES.join(", ")}`,
  },
  moment: { test: orNull(isText), holds: "a moment, or null" },
  result: {
    test: oneOf(EVIDENCE_RESULTS),
    holds: `one of ${EVIDENCE_RESULTS.join(", ")}`,
  },
  reason: { test: isText, holds: "text" },
  detail: { test: isText, holds: "text" },
  commit: {
    test: orNull(value => typeof value === "string" && COMMIT_HASH.test(value)),
    holds: "a full commit hash, or null",
  },
  command: {
    test: orNull(
      value =>
        Array.isArray(value) &&
        value.length > 0 &&
        value.every(item => typeof item === "string")
    ),
    holds: "a list of arguments, or null",
  },
  exit_status: {
    test: orNull(value => Number.isInteger(value)),
    holds: "a whole number, or null",
  },
  started_at: { test: isCanonicalUtc, holds: "a UTC time" },
  completed_at: { test: isCanonicalUtc, holds: "a UTC time" },
  freshness_seconds: {
    test: value =>
      typeof value === "number" &&
      Number.isInteger(value) &&
      value >= 1 &&
      value <= MAX_FRESHNESS_SECONDS,
    holds: `a whole number of seconds from 1 to ${MAX_FRESHNESS_SECONDS}`,
  },
  output_excerpt: {
    test: value =>
      typeof value === "string" && value.length <= EVIDENCE_EXCERPT_LIMIT,
    holds: `text of at most ${EVIDENCE_EXCERPT_LIMIT} characters`,
  },
  output_truncated: {
    test: value => typeof value === "boolean",
    holds: "true or false",
  },
};

/** The keys of a record, as plain names. */
const RECORD_KEYS = Object.keys(
  RECORD_FIELDS
) as readonly (keyof EvidenceRecord)[];

/**
 * What is wrong with a record's keys and the values they hold.
 * @param record - The record, an object
 * @returns One phrase per problem
 */
function fieldProblems(record: Readonly<Record<string, unknown>>): string[] {
  const unknown = Object.keys(record)
    .filter(key => !RECORD_KEYS.some(known => known === key))
    .map(key => `"${key}" is not a key the attest step writes`);
  const wrong = RECORD_KEYS.flatMap(key => {
    const field = RECORD_FIELDS[key];
    const value = record[key];
    if (value === undefined) {
      return field.optional === true ? [] : [`"${key}" is missing`];
    }
    return field.test(value) ? [] : [`"${key}" must be ${field.holds}`];
  });
  return [...unknown, ...wrong];
}

/**
 * What is wrong with a record of an audit finding, whose fields are each
 * well formed.
 * @param record - The record
 * @returns One phrase per problem
 */
function findingProblems(record: EvidenceRecord): string[] {
  return [
    ...(record.rung === "asserted"
      ? []
      : ['"rung" must be asserted on a record of an audit finding']),
    ...(record.moment === null
      ? []
      : ['"moment" must be null on a record of an audit finding']),
    ...(record.id === findingRecordId(record.criterion, record.scope)
      ? []
      : [
          `"id" must be "${findingRecordId(record.criterion, record.scope)}", which is what the record says it is about`,
        ]),
  ];
}

/**
 * What is wrong with a record about a register entry, whose fields are each
 * well formed.
 * @param record - The record
 * @param entryId - The entry it names
 * @returns One phrase per problem
 */
function entryProblems(record: EvidenceRecord, entryId: string): string[] {
  if (record.moment === null) {
    return ['"moment" must name a moment on a record about a control'];
  }
  const expected = evidenceRecordId({
    entry_id: entryId,
    moment: record.moment,
    rung: record.rung,
    criterion: record.criterion,
    ...(record.half === undefined ? {} : { half: record.half }),
  });
  return [
    ...(record.rung === "asserted"
      ? ['"rung" must be observed or exercised on a record about a control']
      : []),
    ...(record.result === "not-applicable"
      ? ["only a record of an audit finding may say not-applicable"]
      : []),
    ...(record.id === expected
      ? []
      : [
          `"id" must be "${expected}", which is what the record says it is about`,
        ]),
  ];
}

/**
 * What is wrong with how a record's fields fit together.
 * @param record - A record whose fields are each well formed
 * @returns One phrase per problem
 */
function shapeProblems(record: EvidenceRecord): string[] {
  const halves =
    record.rung === "exercised"
      ? record.half === undefined
        ? ['"half" is missing: an exercised record is one half of a pair']
        : []
      : record.half === undefined
        ? []
        : ['"half" must be left out: only an exercised record names a half'];
  return [
    ...halves,
    ...(record.entry_id === null
      ? findingProblems(record)
      : entryProblems(record, record.entry_id)),
  ];
}

/**
 * Read one record.
 * @param entry - The candidate
 * @param position - Its place in the file, counted from one
 * @returns The record, or one line per problem
 */
function parseRecord(
  entry: unknown,
  position: number
):
  | { readonly problems: null; readonly record: EvidenceRecord }
  | { readonly problems: readonly string[] } {
  if (!isJsonObject(entry)) {
    return { problems: [`Record ${position}: is not a JSON object.`] };
  }
  const named = isText(entry.id) ? ` ("${entry.id}")` : "";
  const fields = fieldProblems(entry);
  const problems =
    fields.length > 0
      ? fields
      : shapeProblems(entry as unknown as EvidenceRecord);
  return problems.length > 0
    ? {
        problems: problems.map(
          problem => `Record ${position}${named}: ${problem}.`
        ),
      }
    : { problems: null, record: entry as unknown as EvidenceRecord };
}

/**
 * Report identifiers more than one record carries.
 * @param records - The records
 * @returns One line per shared identifier
 */
function sharedIds(records: readonly EvidenceRecord[]): string[] {
  const ids = records.map(record => record.id);
  return [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))].map(
    id =>
      `"${id}" is the id of ${ids.filter(each => each === id).length} records. Each record has its own.`
  );
}

/**
 * What is wrong with the file apart from its records.
 * @param document - The parsed file, an object
 * @returns One line per problem
 */
function documentProblems(
  document: Readonly<Record<string, unknown>>
): string[] {
  return [
    ...Object.keys(document)
      .filter(key => !DOCUMENT_KEYS.some(known => known === key))
      .map(key => `"${key}" is not a key the attest step writes.`),
    ...(document.schema_version === EVIDENCE_SCHEMA_VERSION
      ? []
      : [`"schema_version" must be ${EVIDENCE_SCHEMA_VERSION}.`]),
    ...(Array.isArray(document.records) ? [] : ['"records" is not a list.']),
  ];
}

/**
 * Read a parsed evidence file as exactly what the attest step writes.
 * @param document - The parsed file, of any shape
 * @returns The file, or one line per problem
 */
export function parseEvidenceDocument(
  document: unknown
): EvidenceDocumentParse {
  if (!isJsonObject(document)) {
    return { problems: [`${EVIDENCE_PATH} is not a JSON object.`] };
  }
  const top = documentProblems(document);
  const parsed = (
    Array.isArray(document.records) ? (document.records as unknown[]) : []
  ).map((entry, index) => parseRecord(entry, index + 1));
  const records = parsed.flatMap(each =>
    each.problems === null ? [each.record] : []
  );
  const problems = [
    ...top,
    ...parsed.flatMap(each => each.problems ?? []),
    ...sharedIds(records),
  ];
  return problems.length > 0
    ? { problems }
    : {
        problems: null,
        document: { schema_version: EVIDENCE_SCHEMA_VERSION, records },
      };
}

/**
 * An evidence file holding some records, in the file's one order.
 * @param records - The records, in any order
 * @returns The file
 */
export function evidenceDocumentOf(
  records: readonly EvidenceRecord[]
): EvidenceDocument {
  return {
    schema_version: EVIDENCE_SCHEMA_VERSION,
    records: [...records].sort((left, right) =>
      compareCodeUnits(left.id, right.id)
    ),
  };
}

/**
 * Write an evidence file as the text of its file.
 * @param document - The file
 * @returns The file content
 */
export function serializeEvidence(document: EvidenceDocument): string {
  return `${JSON.stringify(canonicalize(document), null, 2)}\n`;
}
