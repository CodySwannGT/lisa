/**
 * Executable contract shared by every project-learnings writer and checker.
 * Keeping the numeric limits here prevents documentation, writers, and CI
 * from drifting to different budgets.
 * @module learnings-contract
 */

export const LEARNING_CONFIDENCE_VALUES = ["low", "medium", "high"] as const;

/** Confidence vocabulary persisted in every learning entry. */
export type LearningConfidence = (typeof LEARNING_CONFIDENCE_VALUES)[number];

/** Maximum number of durable entries the ledger retains. */
const MAX_ENTRIES = 20;

/**
 * Byte allowance provisioned per durable entry. The whole-file byte budget
 * (`maxTokens`) is DERIVED from this times `maxEntries`, so the entry cap and
 * the byte cap can never contradict: a ledger of exactly `maxEntries` real
 * entries (~490 B average observed) always fits under `maxTokens`. This value
 * covers the observed worst case (max ~606 B/entry) with headroom.
 *
 * Historically these were two independently hardcoded numbers — a 20-entry cap
 * and a flat 4000-byte cap — that bound the ledger at ~8 entries, stranding
 * valid captures far under the entry ceiling (CodySwannGT/lisa#1959). Deriving
 * the byte cap from the entry cap removes that contradiction at the source.
 */
export const PER_ENTRY_BYTE_ALLOWANCE = 600;

export const LEARNINGS_CONTRACT = Object.freeze({
  version: 1,
  fields: Object.freeze([
    "id",
    "rule",
    "why",
    "provenance",
    "first_learned",
    "last_confirmed",
    "confidence",
  ] as const),
  maxRuleCharacters: 240,
  maxRuleLines: 2,
  maxProvenanceReferences: 20,
  maxEntries: MAX_ENTRIES,
  maxTokens: MAX_ENTRIES * PER_ENTRY_BYTE_ALLOWANCE,
  measurement: "utf8-bytes-upper-bound",
} as const);

/** Complete persisted schema for one project learning. */
export interface LearningEntry {
  readonly id: string;
  readonly rule: string;
  readonly why: string;
  readonly provenance: readonly string[];
  readonly first_learned: string;
  readonly last_confirmed: string;
  readonly confidence: LearningConfidence;
}

/**
 * Estimate tokens deterministically without coupling the persisted contract to
 * a model-specific tokenizer. A byte count is a conservative upper bound for
 * byte-level tokenizers and is reproducible in both the writer and CI.
 * @param content - Canonical full Markdown document
 * @returns Reproducible estimated token count
 */
export function estimateLearningTokens(content: string): number {
  return Buffer.byteLength(content, "utf8");
}
