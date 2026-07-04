import {
  createLisaUsageRollup,
  parseLisaUsageSection,
  type LisaUsageEntry,
  upsertLisaUsageSection,
} from "../../../src/utils/usage-accounting.js";

const ARTIFACT_DOCUMENT = "# Artifact\n";
const EXISTING_ENTRY_ID = "entry-existing";
const NEW_ENTRY_ID = "entry-new";

/**
 * Create a deterministic direct usage entry for rollup merge tests.
 *
 * @param overrides Test-specific field overrides.
 * @returns A complete usage entry payload.
 */
function makeEntry(
  overrides: Partial<LisaUsageEntry> & Pick<LisaUsageEntry, "entryId" | "runId">
): LisaUsageEntry {
  return {
    artifactRef: "github:issue:871",
    cachedInputTokens: null,
    cost: 0.12,
    currency: "USD",
    entryId: overrides.entryId,
    flow: "lisa-plan",
    inputTokens: 100,
    model: "gpt-5",
    outputTokens: 20,
    parentArtifactRef: null,
    pricingSource: "catalog",
    pricingStatus: "estimated",
    provider: "openai",
    reasoningTokens: null,
    runId: overrides.runId,
    source: "prompt",
    totalTokens: 120,
    ...overrides,
  };
}

describe("usage-accounting rollup merging", () => {
  it("recomputes explicit direct rollups after merging prior entries", () => {
    const firstEntry = makeEntry({
      entryId: EXISTING_ENTRY_ID,
      runId: "run-existing",
      totalTokens: 100,
      cost: 0.1,
    });
    const secondEntry = makeEntry({
      entryId: NEW_ENTRY_ID,
      runId: "run-new",
      totalTokens: 80,
      cost: 0.08,
    });
    const original = upsertLisaUsageSection(ARTIFACT_DOCUMENT, {
      entries: [firstEntry],
      rollup: createLisaUsageRollup([firstEntry]),
    });

    const updated = upsertLisaUsageSection(original, {
      entries: [secondEntry],
      rollup: createLisaUsageRollup([secondEntry]),
    });
    const parsed = parseLisaUsageSection(updated);

    expect(parsed.entries.map(entry => entry.entryId)).toEqual([
      EXISTING_ENTRY_ID,
      NEW_ENTRY_ID,
    ]);
    expect(parsed.rollup).toMatchObject({
      directCost: 0.18,
      directEntryIds: [EXISTING_ENTRY_ID, NEW_ENTRY_ID],
      directTokens: 180,
      totalCost: 0.18,
      totalTokens: 180,
    });
  });
});
