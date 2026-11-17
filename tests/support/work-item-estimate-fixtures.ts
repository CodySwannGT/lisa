/**
 * Item bodies carrying a `## Lisa Estimate` section and a `## Lisa Usage`
 * ledger, for the work-item estimate tests (CodySwannGT/lisa#4955).
 * @module tests/support/work-item-estimate-fixtures
 */
import { resolveEstimateConfig } from "../../all/copy-overwrite/scripts/lib/work-item-estimate-config.mjs";
import {
  buildEstimate,
  renderEstimateSection,
  upsertEstimateSection,
} from "../../all/copy-overwrite/scripts/lib/work-item-estimate.mjs";
import {
  upsertLisaUsageSection,
  type LisaUsageEntry,
} from "../../src/utils/usage-accounting.js";

/** Settings with the requirement on and the shipped defaults. */
export const ESTIMATE_ON = resolveEstimateConfig({});

/** A body with no estimate and no ledger. */
export const PLAIN_BODY = "## Context\n\nFix the thing.\n";

/**
 * A usage entry for one run.
 * @param id - Stable entry id.
 * @param totalTokens - Complete token total, or null when unknown.
 * @param cost - Run cost in dollars, or null when unknown.
 * @returns The entry.
 */
export function usageEntry(
  id: string,
  totalTokens: number | null,
  cost: number | null = null
): LisaUsageEntry {
  const known = totalTokens !== null;
  return {
    artifactRef: "github:acme/code#42",
    cachedInputTokens: null,
    cost,
    currency: cost === null ? null : "USD",
    entryId: id,
    flow: "implement",
    inputTokens: null,
    model: "claude-opus-5-5",
    outputTokens: null,
    parentArtifactRef: null,
    pricingSource: cost === null ? null : "runtime",
    pricingStatus: cost === null ? "unavailable" : "observed",
    provider: "anthropic",
    reasoningTokens: null,
    runId: `run-${id}`,
    source: known ? "observed" : "unavailable",
    totalTokens,
  };
}

/**
 * A finished item: an estimate section plus a usage ledger.
 * @param tokensLow - Estimate low end.
 * @param tokensHigh - Estimate high end.
 * @param entries - Usage entries; none means no ledger at all.
 * @returns Item body.
 */
export function finishedItem(
  tokensLow: number,
  tokensHigh: number,
  entries: readonly LisaUsageEntry[]
): string {
  const estimated = upsertEstimateSection(
    PLAIN_BODY,
    renderEstimateSection(
      buildEstimate({ tokensLow, tokensHigh, model: "opus" }, ESTIMATE_ON)
    )
  );
  return entries.length === 0
    ? estimated
    : upsertLisaUsageSection(estimated, { entries });
}
