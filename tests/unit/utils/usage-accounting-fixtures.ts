import type { LisaUsageEntry } from "../../../src/utils/usage-accounting.js";

export const ARTIFACT_HEADING = "# Artifact";
export const ARTIFACT_DOCUMENT = `${ARTIFACT_HEADING}\n`;

/**
 * Create a deterministic direct usage entry for unit tests.
 *
 * @param overrides Test-specific field overrides.
 * @returns A complete usage entry payload.
 */
export function makeEntry(
  overrides: Partial<LisaUsageEntry> & Pick<LisaUsageEntry, "entryId" | "runId">
): LisaUsageEntry {
  return {
    artifactRef: "github:issue:718",
    cachedInputTokens: null,
    cost: 0.12,
    currency: "USD",
    flow: "lisa-plan",
    inputTokens: 100,
    measuredSubsetTokens: null,
    model: "gpt-5",
    outputTokens: 20,
    parentArtifactRef: null,
    pricingSource: "catalog",
    pricingStatus: "estimated",
    provider: "openai",
    reasoningTokens: null,
    source: "prompt",
    totalTokens: 120,
    ...overrides,
  };
}
