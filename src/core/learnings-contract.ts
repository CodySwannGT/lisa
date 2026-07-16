/**
 * Executable contract shared by every project-learnings writer and checker.
 * Keeping the numeric limits here prevents documentation, writers, and CI
 * from drifting to different budgets.
 * @module learnings-contract
 */

export const LEARNING_CONFIDENCE_VALUES = ["low", "medium", "high"] as const;

/** Confidence vocabulary persisted in every learning entry. */
export type LearningConfidence = (typeof LEARNING_CONFIDENCE_VALUES)[number];

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
  maxEntries: 20,
  maxTokens: 4000,
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
