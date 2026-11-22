/**
 * Reading which halves of an entry's paired proof are on record.
 *
 * A register entry is proved by two planted changes: one that breaks the rule
 * and must be refused, and one that does not and must be accepted. The attest
 * step runs them and writes one evidence record per half. This module is the
 * reading side of that for the control register, which asks one question:
 * does the evidence file hold a record of both halves for this entry, each
 * of which held?
 *
 * ## The fields a record is read by
 *
 * A record counts as one half of an entry's proof when all of these hold:
 *
 * - it is a record {@link parseEvidenceRecords} accepts, so it has an `id`, a
 *   `criterion`, a `completed_at` and a `freshness_seconds`;
 * - `entry_id` is the register entry's identifier, for example
 *   `code-style@api`;
 * - `half` is `violation` or `clean`;
 * - `result` is `held`: the violating change was turned away as declared, or
 *   the clean change was let through. A record with any other result, or
 *   with none, is a record that the half was run and not that it held, and a
 *   control that let its violating change through is not proved by having
 *   been tried;
 * - `moment`, when the record has one, is the moment asked about. A record
 *   that names no moment is a record of the entry's proof wherever it is
 *   enforced; one that names another moment says nothing about this one.
 *
 * Every other key is ignored, so the attest step can record whatever else it
 * needs without this module changing. A record that is not exercised (a
 * setting read from the hosting platform, an audit finding) names no half,
 * so it is never one.
 *
 * ## What is deliberately not read
 *
 * Not the clock. A record's age decides whether a verdict may rely on it, and
 * the verdict is where that is judged. The register is compared byte for byte
 * with what generating it again would write, so nothing in it may change
 * because time passed.
 *
 * A missing or unreadable file, a file reached through a link, and a record
 * missing one of the fields above all mean the same thing: no record. That is
 * the safe direction, because the only thing a record can do here is stop an
 * entry reading as unproved.
 * @module controls/proof-halves
 */
import { lstatSync, readFileSync } from "node:fs";
import path from "node:path";

import { isJsonObject } from "../sync/json-path.js";
import { EVIDENCE_PATH, hasRecordFields, HELD_RESULT } from "./evidence.js";

/** The two halves of a paired proof, as a proof declares them. */
export const PROOF_HALVES = ["violation", "clean"] as const;

/** One half of a paired proof. */
export type ProofHalf = (typeof PROOF_HALVES)[number];

/** The part of an evidence record that says which proof half it is. */
export interface ProofHalfRecord {
  /** The identifier of the register entry the proof is of. */
  readonly entry_id: string;
  /** Which half was run. */
  readonly half: ProofHalf;
  /** The moment the half was run at, or `null` when the record names none. */
  readonly moment: string | null;
  /** Whether the half did what it was planted to show. */
  readonly held: boolean;
}

/**
 * Tell whether a value names a proof half.
 * @param value - Candidate
 * @returns Whether it is `violation` or `clean`
 */
function isProofHalf(value: unknown): value is ProofHalf {
  return PROOF_HALVES.some(half => half === value);
}

/**
 * Reduce one entry of the evidence file to what says which half it is.
 * @param entry - Candidate record
 * @returns The record's fields, or an empty list when it is not a usable
 *   record of a proof half
 */
function proofHalfRecord(entry: unknown): readonly ProofHalfRecord[] {
  if (!isJsonObject(entry)) return [];
  const { entry_id, half, moment, result } = entry;
  const usable =
    hasRecordFields(entry) &&
    typeof entry_id === "string" &&
    entry_id !== "" &&
    isProofHalf(half) &&
    (moment === undefined || typeof moment === "string");
  return usable
    ? [
        {
          entry_id,
          half,
          moment: typeof moment === "string" ? moment : null,
          held: result === HELD_RESULT,
        },
      ]
    : [];
}

/**
 * Read the records of proof halves out of a parsed evidence file.
 * @param document - The parsed file, of any shape
 * @returns The records that say which half of which entry's proof they are,
 *   in file order
 */
export function parseProofHalfRecords(
  document: unknown
): readonly ProofHalfRecord[] {
  if (!isJsonObject(document) || !Array.isArray(document.records)) return [];
  return document.records.flatMap(entry => proofHalfRecord(entry));
}

/**
 * Tell whether both halves of an entry's proof are on record for a moment,
 * and each of them held.
 * @param records - The proof-half records of the evidence file
 * @param entryId - The register entry's identifier
 * @param moment - The moment the proof must speak for
 * @returns Whether each half has a record that speaks for that moment and
 *   says the half held
 */
export function hasBothProofHalves(
  records: readonly ProofHalfRecord[],
  entryId: string,
  moment: string
): boolean {
  return PROOF_HALVES.every(half =>
    records.some(
      record =>
        record.entry_id === entryId &&
        record.half === half &&
        record.held &&
        (record.moment === null || record.moment === moment)
    )
  );
}

/**
 * Tell whether every step on the way to the evidence file is an ordinary
 * folder and the file itself an ordinary file.
 * @param root - Real path of the repository
 * @returns Whether the file can be read without following a link
 */
function reachedWithoutALink(root: string): boolean {
  const segments = EVIDENCE_PATH.split("/");
  return segments.every((_, index) => {
    const stat = lstatSync(path.join(root, ...segments.slice(0, index + 1)));
    return index === segments.length - 1 ? stat.isFile() : stat.isDirectory();
  });
}

/**
 * Read and parse a repository's evidence file.
 * @param root - Real path of the repository
 * @returns The parsed file, or `null` when it is missing, is not JSON, or is
 *   reached through a link
 */
export function readEvidenceDocument(root: string): unknown {
  try {
    return reachedWithoutALink(root)
      ? (JSON.parse(
          readFileSync(path.join(root, EVIDENCE_PATH), "utf8")
        ) as unknown)
      : null;
  } catch {
    return null;
  }
}
