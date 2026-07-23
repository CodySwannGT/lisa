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
 * Average per-entry byte allowance used to DERIVE the whole-file byte budget
 * (`maxTokens = maxEntries * PER_ENTRY_BYTE_ALLOWANCE`), so the entry cap and
 * the byte cap can never contradict.
 *
 * This is an AVERAGE budget, not a per-entry maximum: `maxTokens` is enforced
 * against the whole rendered document — every entry plus the ```jsonl framing
 * (~72 B observed) — and there is NO per-entry byte cap (`rule` is char-capped
 * at `maxRuleCharacters`; `why` is bounded only by the document total). At 600
 * against a ~490 B observed average, each entry carries ~110 B of headroom, so
 * a full 20-entry ledger budgets 12000 B while real content lands near 9800 B —
 * the ~2.2 KB slack absorbs the document framing many times over and leaves room
 * for larger-than-average entries. A single pathologically large `why` can
 * consume a disproportionate share; that is intended — the document total is the
 * real constraint, and the near-boundary regression test pins that behavior.
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
