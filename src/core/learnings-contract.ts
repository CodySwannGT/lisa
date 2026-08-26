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

/** Exact persisted fields accepted from the compatibility-window v1 schema. */
export const LEGACY_LEARNING_ENTRY_FIELDS = Object.freeze([
  "id",
  "rule",
  "why",
  "provenance",
  "first_learned",
  "last_confirmed",
  "confidence",
] as const);

/** Historical v1 byte ceiling, retained only for source-version validation. */
export const LEGACY_LEARNINGS_MAX_TOKENS = 12_000;

/**
 * Maximum UTF-8 bytes in a persisted id or fingerprint.
 *
 * Stable tokens are machine keys, not prose. Bounding them keeps comparison
 * and diagnostics cheap and, critically, closes the v1 compatibility window:
 * v1 duplicated every id into the new fingerprint field during migration.
 */
export const MAX_STABLE_TOKEN_BYTES = 128;

/** JSON bytes v2 adds around each migrated v1 id: `,"fingerprint":""`. */
const FINGERPRINT_FIELD_BYTE_OVERHEAD = 17;

/**
 * Average per-entry byte allowance used to DERIVE the whole-file byte budget
 * (`maxTokens = maxEntries * PER_ENTRY_BYTE_ALLOWANCE`), so the entry cap and
 * the byte cap can never contradict. It is the historical v1 average plus the
 * maximum bytes v2 adds when migration persists `fingerprint = id`:
 * `600 + 17 + 128 = 745`. Therefore every accepted 12,000-byte v1 document
 * with at most 20 bounded ids renders as v2 within 14,900 bytes.
 *
 * This is an AVERAGE budget, not a per-entry maximum: `maxTokens` is enforced
 * against the whole rendered document — every entry plus the ```jsonl framing
 * (~72 B observed) — and there is no aggregate per-entry byte cap (machine
 * identity tokens have their migration bound, `rule` is char-capped at
 * `maxRuleCharacters`, and `why` is bounded only by the document total). The
 * v2 allowance includes the persisted fingerprint while preserving meaningful
 * framing and variance headroom at the full 20-entry ceiling. A single
 * pathologically large `why` can
 * consume a disproportionate share; that is intended — the document total is the
 * real constraint, and the near-boundary regression test pins that behavior.
 *
 * Historically these were two independently hardcoded numbers — a 20-entry cap
 * and a flat 4000-byte cap — that bound the ledger at ~8 entries, stranding
 * valid captures far under the entry ceiling (CodySwannGT/lisa#1959). Deriving
 * the byte cap from the entry cap removes that contradiction at the source.
 */
export const PER_ENTRY_BYTE_ALLOWANCE =
  LEGACY_LEARNINGS_MAX_TOKENS / MAX_ENTRIES +
  FINGERPRINT_FIELD_BYTE_OVERHEAD +
  MAX_STABLE_TOKEN_BYTES;

export const LEARNINGS_CONTRACT = Object.freeze({
  version: 2,
  fields: Object.freeze([
    "id",
    "fingerprint",
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
  /** Content-version token used for exact supersede compare-and-swap. */
  readonly fingerprint: string;
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
