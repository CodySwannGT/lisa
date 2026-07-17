import {
  createLisaUsageRollup,
  parseLisaUsageSection,
  type LisaUsageEntry,
  type LisaUsageRollup,
  upsertLisaUsageSection,
} from "../../../src/utils/usage-accounting.js";

const ARTIFACT_DOCUMENT = "# Artifact\n";
const COMMA_CHILD_REF = "github:issue:900,comment";

/**
 * Create a deterministic direct usage entry for token serialization tests.
 *
 * @param overrides Test-specific field overrides.
 * @returns A complete usage entry payload.
 */
function makeEntry(overrides: Partial<LisaUsageEntry> = {}): LisaUsageEntry {
  return {
    artifactRef: "github:issue:869",
    cachedInputTokens: null,
    cost: 0.12,
    currency: "USD",
    entryId: "entry-869",
    flow: "lisa-implement",
    inputTokens: 100,
    measuredSubsetTokens: null,
    model: "gpt-5",
    outputTokens: 20,
    parentArtifactRef: null,
    pricingSource: "catalog",
    pricingStatus: "estimated",
    provider: "openai",
    reasoningTokens: null,
    runId: "run-869",
    source: "prompt",
    totalTokens: 120,
    ...overrides,
  };
}

/**
 * Create a deterministic rollup payload for token serialization tests.
 *
 * @param overrides Test-specific rollup overrides.
 * @returns A complete rollup payload.
 */
function makeRollup(overrides: Partial<LisaUsageRollup> = {}): LisaUsageRollup {
  return {
    childCost: 0,
    childCurrency: "USD",
    childEntryIds: [],
    childRefs: [],
    childTokens: 0,
    currency: "USD",
    directCost: 0,
    directEntryIds: [],
    directTokens: 0,
    totalCost: 0,
    totalTokens: 0,
    ...overrides,
  };
}

describe("usage-accounting token serialization", () => {
  it("round-trips entry token fields containing whitespace and delimiters", () => {
    const entry = makeEntry({
      artifactRef: "github:issue:869, usage comment",
      entryId: "entry 869",
      flow: "build fix",
      model: "claude-3-5-sonnet (2025-04)",
      parentArtifactRef: "github:issue:868 --> child",
      pricingSource: "config:catalog, fallback",
      pricingStatus: "estimated with override",
      runId: "run 869, attempt --> 1",
    });

    const updated = upsertLisaUsageSection(ARTIFACT_DOCUMENT, {
      entries: [entry],
      rollup: createLisaUsageRollup([entry]),
    });
    const parsed = parseLisaUsageSection(updated);

    expect(parsed.entries[0]).toEqual(entry);
    expect(updated).toContain("model=claude-3-5-sonnet%20(2025-04)");
    expect(updated).not.toContain("attempt --> 1");
  });

  it("round-trips rollup list fields containing commas", () => {
    const rollup = makeRollup({
      childEntryIds: ["child,a", "child b"],
      childRefs: [COMMA_CHILD_REF, "github:issue:901"],
      directEntryIds: ["direct,a"],
    });
    const updated = upsertLisaUsageSection(ARTIFACT_DOCUMENT, {
      entries: [],
      rollup,
    });
    const parsed = parseLisaUsageSection(updated);

    expect(parsed.rollup).toEqual(rollup);
    expect(updated).toContain("child_refs=github%3Aissue%3A900%2Ccomment");
  });
});
