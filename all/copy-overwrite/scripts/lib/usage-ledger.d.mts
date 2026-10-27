import type { EffectivenessObservation } from "./usage-effectiveness.mjs";

/**
 *
 */
export interface LisaUsageEntry {
  artifactRef: string;
  cachedInputTokens: number | null;
  cost: number | null;
  currency: string | null;
  entryId: string;
  effectiveness?: EffectivenessObservation;
  flow: string;
  inputTokens: number | null;
  measuredSubsetTokens?: number | null;
  model: string;
  outputTokens: number | null;
  parentArtifactRef: string | null;
  pricingSource: string | null;
  pricingStatus: string;
  provider: string;
  reasoningTokens: number | null;
  runId: string;
  source: string;
  totalTokens: number | null;
}

/**
 *
 */
export interface LisaUsageRollup {
  childCost: number | null;
  childCurrency: string | null;
  childEntryIds: readonly string[];
  childRefs: readonly string[];
  childTokens: number | null;
  childTokensIncomplete?: boolean;
  currency: string | null;
  directCost: number | null;
  directEntryIds: readonly string[];
  directTokens: number | null;
  totalCost: number | null;
  totalTokens: number | null;
}

/**
 *
 */
export interface LisaUsageChildArtifact {
  artifactRef: string;
  entries: readonly LisaUsageEntry[];
}

/**
 *
 */
export interface ParsedLisaUsageSection {
  entries: readonly LisaUsageEntry[];
  range: { end: number; start: number } | null;
  rollup: LisaUsageRollup | null;
}

/**
 * Describe one way a stored managed usage section fails to be a readable ledger.
 */
export interface LisaUsageSectionIntegrityIssue {
  code:
    | "missing-entry-token"
    | "missing-rollup-token"
    | "missing-section"
    | "unrecorded-entry";
  entryIds: readonly string[];
  message: string;
}

/**
 *
 */
export interface LisaUsageSectionIntegrityResult {
  issues: readonly LisaUsageSectionIntegrityIssue[];
  ok: boolean;
}
export declare const LISA_USAGE_HEADING: "## Lisa Usage";
export declare function parseLisaUsageSection(
  document: string
): ParsedLisaUsageSection;
