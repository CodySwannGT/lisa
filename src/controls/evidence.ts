/**
 * Reading attestation evidence.
 *
 * An audit finding may say a requirement is `proved` only when a record written
 * by the attest step backs it, and only while that record is within its
 * freshness lifetime. This module is the reading half of that rule: where the
 * evidence file is, which fields of a record the lookup depends on, and when a
 * record is too old to rely on.
 *
 * It reads four fields of a record, so the attest step can record whatever
 * else it needs (the command, the exit status, the commit) without this
 * module changing. Two more keys are looked at only to turn a record away,
 * because the attest step also records what did not hold:
 *
 * - `result`, when a record has one, must be `held`. A record of a violating
 *   change that was let through is evidence, and it proves nothing.
 * - `entry_id` must not be `null`. That marks a record the attest step wrote
 *   from the audit's own finding, and an audit that cited it would be citing
 *   itself.
 *
 * A missing or unreadable file, a record missing one of the four fields, and
 * a record turned away for either reason above all mean the same thing to a
 * caller: nothing there backs a claim. That is the safe direction, because
 * the only thing evidence can do here is permit `proved`.
 * @module controls/evidence
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { isJsonObject } from "../sync/json-path.js";

/** Where the attest step writes evidence, relative to the repository root. */
export const EVIDENCE_PATH = ".lisa/controls/evidence.json";

/** What a record's `result` says when what it looked at held. */
export const HELD_RESULT = "held";

/** Canonical UTC time with milliseconds, the form `Date#toISOString` writes. */
const CANONICAL_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

/**
 * The part of an evidence record a lookup depends on.
 *
 * The evidence file is `{ "records": [ … ] }`; each record carries at least
 * these four keys.
 */
export interface EvidenceRecordRef {
  /** The record's id, unique in the file. A finding cites it as `evidence_id`. */
  readonly id: string;
  /** The criterion id the record is evidence for. */
  readonly criterion: string;
  /** When the proof finished: canonical UTC, `YYYY-MM-DDTHH:mm:ss.sssZ`. */
  readonly completed_at: string;
  /** How long after `completed_at` the record may be relied on: whole seconds, at least 1. */
  readonly freshness_seconds: number;
}

/**
 * Tell whether a value is a canonical UTC time that names a real instant.
 * @param value - Candidate
 * @returns Whether it can be compared with the clock
 */
export function isCanonicalUtc(value: unknown): value is string {
  return (
    typeof value === "string" &&
    CANONICAL_UTC.test(value) &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}

/**
 * Reduce one entry of the evidence file to the fields a lookup depends on.
 * @param entry - Candidate record
 * @returns The record's four fields, or an empty list when one is unusable
 */
function recordRef(entry: unknown): readonly EvidenceRecordRef[] {
  if (!isJsonObject(entry)) return [];
  const { id, criterion, completed_at, freshness_seconds } = entry;
  const usable =
    typeof id === "string" &&
    id !== "" &&
    typeof criterion === "string" &&
    criterion !== "" &&
    isCanonicalUtc(completed_at) &&
    typeof freshness_seconds === "number" &&
    Number.isInteger(freshness_seconds) &&
    freshness_seconds >= 1;
  return usable ? [{ id, criterion, completed_at, freshness_seconds }] : [];
}

/**
 * Tell whether an entry of the evidence file carries the four fields every
 * reader of a record depends on.
 * @param entry - Candidate record
 * @returns Whether it is a record at all
 */
export function hasRecordFields(entry: unknown): boolean {
  return recordRef(entry).length === 1;
}

/**
 * Tell whether a record shows something that held, about a control.
 * @param entry - A record of the evidence file
 * @returns Whether a finding may cite it as proof
 */
function showsAControlHeld(entry: unknown): boolean {
  return (
    isJsonObject(entry) &&
    entry.entry_id !== null &&
    (entry.result === undefined || entry.result === HELD_RESULT)
  );
}

/**
 * Read the usable records out of a parsed evidence file.
 * @param document - The parsed file, of any shape
 * @returns The records that can back a claim, in file order
 */
export function parseEvidenceRecords(
  document: unknown
): readonly EvidenceRecordRef[] {
  if (!isJsonObject(document) || !Array.isArray(document.records)) return [];
  return document.records.flatMap(entry =>
    showsAControlHeld(entry) ? recordRef(entry) : []
  );
}

/**
 * Read a repository's evidence records.
 * @param repositoryRoot - Absolute path of the repository root
 * @returns The records that can back a claim; none when the file is missing or
 *   cannot be read
 */
export function readEvidenceRecords(
  repositoryRoot: string
): readonly EvidenceRecordRef[] {
  try {
    return parseEvidenceRecords(
      JSON.parse(
        readFileSync(path.join(repositoryRoot, EVIDENCE_PATH), "utf8")
      ) as unknown
    );
  } catch {
    return [];
  }
}

/**
 * When a record stops being reliable.
 * @param record - The record
 * @returns The first instant at which it is too old
 */
export function evidenceExpiry(record: EvidenceRecordRef): Date {
  return new Date(
    Date.parse(record.completed_at) + record.freshness_seconds * 1000
  );
}

/**
 * Tell whether a record is within its freshness lifetime.
 *
 * A record that completed after `now` is not fresh either: it was not produced
 * by a run that has happened.
 * @param record - The record
 * @param now - The current time
 * @returns Whether the record may be relied on
 */
export function isEvidenceFresh(record: EvidenceRecordRef, now: Date): boolean {
  const completed = Date.parse(record.completed_at);
  return (
    completed <= now.getTime() &&
    now.getTime() < evidenceExpiry(record).getTime()
  );
}
