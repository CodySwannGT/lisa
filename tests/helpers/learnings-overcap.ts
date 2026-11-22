/**
 * Shared over-cap ledger fixtures for the CodySwannGT/lisa#4536 tests.
 * @module tests/helpers/learnings-overcap
 */
import * as path from "node:path";
import { LEARNINGS_CONTRACT } from "../../src/core/learnings-contract.js";
import { renderLearningsFile } from "../../src/core/learnings-document.js";

export const FINGERPRINT_1 = "learner-fingerprint-1";
export const FINGERPRINT_2 = "learner-fingerprint-2";
export const STALE_FINGERPRINT = "learner-fingerprint-x";
export const LEDGER = path.join(".lisa", "PROJECT_LEARNINGS.md");
export const OVERFLOW = path.join(".lisa", "PROJECT_LEARNINGS.overflow.md");

/**
 * Build a valid entry, optionally padded so a few of them overflow the cap.
 * @param index - Stable numeric suffix
 * @param padding - Length of the `why` field
 * @returns Valid eight-field entry
 */
export function entry(index: number, padding = 7) {
  return {
    id: `learner-${index}`,
    fingerprint: `learner-fingerprint-${index}`,
    rule: `Rule ${index}.`,
    why: "w".repeat(padding),
    provenance: [`issue:#${index}`],
    first_learned: "2026-07-20",
    last_confirmed: "2026-07-20",
    confidence: "high",
  } as const;
}

/** Padding that makes two entries fit the cap and three exceed it. */
export const HALF_CAP = Math.floor(LEARNINGS_CONTRACT.maxTokens / 2.5);

/**
 * A valid, conflict-free v2 ledger that is over the `maxTokens` cap.
 * @returns Canonical over-cap document
 */
export function overCapLedger(): string {
  const document = renderLearningsFile([
    entry(1, HALF_CAP),
    entry(2, HALF_CAP),
    entry(3, HALF_CAP),
  ]);
  if (Buffer.byteLength(document) <= LEARNINGS_CONTRACT.maxTokens) {
    throw new Error("over-cap fixture is not over the cap");
  }
  return document;
}
