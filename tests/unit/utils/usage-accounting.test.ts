import {
  createLisaUsageRollup,
  LISA_USAGE_HEADING,
  parseLisaUsageSection,
  type LisaUsageEntry,
  type LisaUsageRollup,
  upsertLisaUsageSection,
} from "../../../src/utils/usage-accounting.js";

const USAGE_HEADING_COUNT = 1;
const USAGE_HEADING_MATCHER = /## Lisa Usage/g;
const ARTIFACT_HEADING = "# Artifact";
const ARTIFACT_DOCUMENT = `${ARTIFACT_HEADING}\n`;
const PRICING_SOURCE = "config:openai-api-pricing@2026-05-25";
const PRICED_ENTRY_ID = "entry-priced";

/**
 * Create a deterministic direct usage entry for unit tests.
 *
 * @param overrides Test-specific field overrides.
 * @returns A complete usage entry payload.
 */
function makeEntry(
  overrides: Partial<LisaUsageEntry> & Pick<LisaUsageEntry, "entryId" | "runId">
): LisaUsageEntry {
  return {
    artifactRef: "github:issue:718",
    cachedInputTokens: null,
    cost: 0.12,
    currency: "USD",
    entryId: overrides.entryId,
    flow: "plan",
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

/**
 * Create a deterministic rollup payload for unit tests.
 *
 * @param overrides Test-specific rollup overrides.
 * @returns A complete rollup payload.
 */
function makeRollup(overrides: Partial<LisaUsageRollup> = {}): LisaUsageRollup {
  return {
    childCost: 0,
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

describe("usage-accounting utilities", () => {
  it("appends the managed Lisa Usage section when none exists", () => {
    const original = [ARTIFACT_HEADING, "", "Body content."].join("\n");
    const entry = makeEntry({ entryId: "entry-1", runId: "run-1" });

    const updated = upsertLisaUsageSection(original, {
      entries: [entry],
      rollup: createLisaUsageRollup([entry]),
    });

    expect(updated).toContain(LISA_USAGE_HEADING);
    expect(updated.match(USAGE_HEADING_MATCHER)).toHaveLength(
      USAGE_HEADING_COUNT
    );
    expect(updated).toContain("Body content.");
    expect(updated).toContain("entry_id=entry-1");
  });

  it("rewrites the existing section in place instead of duplicating it", () => {
    const firstEntry = makeEntry({ entryId: "entry-1", runId: "run-1" });
    const original = upsertLisaUsageSection(ARTIFACT_DOCUMENT, {
      entries: [firstEntry],
      rollup: createLisaUsageRollup([firstEntry]),
    });
    const secondEntry = makeEntry({ entryId: "entry-2", runId: "run-2" });

    const updated = upsertLisaUsageSection(original, {
      entries: [secondEntry],
      rollup: createLisaUsageRollup([firstEntry, secondEntry]),
    });

    expect(updated.match(USAGE_HEADING_MATCHER)).toHaveLength(
      USAGE_HEADING_COUNT
    );
    expect(updated).toContain("entry_id=entry-1");
    expect(updated).toContain("entry_id=entry-2");
  });

  it("preserves surrounding sections when replacing the usage block", () => {
    const entry = makeEntry({ entryId: "entry-1", runId: "run-1" });
    const original = [
      ARTIFACT_HEADING,
      "",
      "intro",
      "",
      "## Lisa Usage",
      "",
      "stale body",
      "",
      "## Next Section",
      "",
      "keep me",
    ].join("\n");

    const updated = upsertLisaUsageSection(original, {
      entries: [entry],
      rollup: createLisaUsageRollup([entry]),
    });

    expect(updated).toContain("## Next Section");
    expect(updated).toContain("keep me");
    expect(updated).not.toContain("stale body");
  });

  it("updates an existing entry in place by stable entry_id", () => {
    const initialEntry = makeEntry({ entryId: "entry-1", runId: "run-1" });
    const original = upsertLisaUsageSection(ARTIFACT_DOCUMENT, {
      entries: [initialEntry],
      rollup: createLisaUsageRollup([initialEntry]),
    });
    const refreshedEntry = makeEntry({
      entryId: "entry-1",
      runId: "run-1",
      totalTokens: 240,
      cost: 0.24,
    });

    const updated = upsertLisaUsageSection(original, {
      entries: [refreshedEntry],
    });
    const parsed = parseLisaUsageSection(updated);

    expect(parsed.entries).toHaveLength(1);
    expect(parsed.entries[0]?.totalTokens).toBe(240);
    expect(updated).not.toContain("total_tokens=120");
  });

  it("preserves prior entries when appending a new run", () => {
    const firstEntry = makeEntry({ entryId: "entry-1", runId: "run-1" });
    const secondEntry = makeEntry({
      entryId: "entry-2",
      runId: "run-2",
      flow: "implement",
      totalTokens: 80,
      cost: 0.08,
    });
    const original = upsertLisaUsageSection(ARTIFACT_DOCUMENT, {
      entries: [firstEntry],
      rollup: createLisaUsageRollup([firstEntry]),
    });

    const updated = upsertLisaUsageSection(original, {
      entries: [secondEntry],
    });
    const parsed = parseLisaUsageSection(updated);

    expect(parsed.entries.map(entry => entry.entryId)).toEqual([
      "entry-1",
      "entry-2",
    ]);
    expect(parsed.rollup?.directEntryIds).toEqual(["entry-1", "entry-2"]);
    expect(parsed.rollup?.directTokens).toBe(200);
    expect(parsed.rollup?.totalCost).toBeCloseTo(0.2);
  });

  it("aggregates decimal cost totals without binary floating-point artifacts", () => {
    const firstEntry = makeEntry({
      entryId: "entry-cost-a",
      runId: "run-cost-a",
      cost: 0.1,
    });
    const secondEntry = makeEntry({
      entryId: "entry-cost-b",
      runId: "run-cost-b",
      cost: 0.2,
    });

    const rollup = createLisaUsageRollup([firstEntry, secondEntry]);
    const updated = upsertLisaUsageSection(ARTIFACT_DOCUMENT, {
      entries: [firstEntry, secondEntry],
      rollup,
    });
    const parsed = parseLisaUsageSection(updated);

    expect(rollup.directCost).toBe(0.3);
    expect(rollup.totalCost).toBe(0.3);
    expect(updated).toContain("direct_cost=0.3");
    expect(updated).toContain("total_cost=0.3");
    expect(updated).not.toContain("0.30000000000000004");
    expect(parsed.rollup?.directCost).toBe(0.3);
    expect(parsed.rollup?.totalCost).toBe(0.3);
  });

  it("aggregates refreshed direct and child costs with decimal precision", () => {
    const entry = makeEntry({
      entryId: "entry-parent",
      runId: "run-parent",
      cost: 0.1,
    });
    const rollup = createLisaUsageRollup(
      [entry],
      makeRollup({ childCost: 0.2 })
    );

    expect(rollup.directCost).toBe(0.1);
    expect(rollup.childCost).toBe(0.2);
    expect(rollup.totalCost).toBe(0.3);
  });

  it("round-trips explicit unavailable usage entries with nullable fields", () => {
    const unavailableEntry = makeEntry({
      entryId: "entry-unavailable",
      runId: "run-unavailable",
      cachedInputTokens: null,
      cost: null,
      currency: null,
      inputTokens: null,
      outputTokens: null,
      pricingSource: null,
      pricingStatus: "unavailable",
      reasoningTokens: null,
      source: "unavailable",
      totalTokens: null,
    });

    const updated = upsertLisaUsageSection(ARTIFACT_DOCUMENT, {
      entries: [unavailableEntry],
      rollup: createLisaUsageRollup([unavailableEntry]),
    });
    const parsed = parseLisaUsageSection(updated);

    expect(updated).toContain("source=unavailable");
    expect(updated).toContain("pricing_status=unavailable");
    expect(updated).toContain("total_tokens=null");
    expect(updated).toContain("cost=null");
    expect(parsed.entries[0]).toMatchObject({
      cachedInputTokens: null,
      cost: null,
      currency: null,
      inputTokens: null,
      outputTokens: null,
      pricingSource: null,
      pricingStatus: "unavailable",
      reasoningTokens: null,
      source: "unavailable",
      totalTokens: null,
    });
    expect(parsed.rollup?.directTokens).toBeNull();
    expect(parsed.rollup?.totalCost).toBeNull();
  });

  it("preserves pricing metadata and prior child rollups during direct-entry refreshes", () => {
    const existingEntry = makeEntry({
      entryId: PRICED_ENTRY_ID,
      pricingSource: PRICING_SOURCE,
      pricingStatus: "estimated",
    });
    const existingSection = upsertLisaUsageSection(ARTIFACT_DOCUMENT, {
      entries: [existingEntry],
      rollup: makeRollup({
        childCost: 0.21,
        childEntryIds: ["child-a", "shared-descendant"],
        childRefs: ["github:issue:900", "github:issue:901"],
        childTokens: 210,
        currency: "USD",
        directCost: 0.12,
        directEntryIds: [PRICED_ENTRY_ID],
        directTokens: 120,
        totalCost: 0.33,
        totalTokens: 330,
      }),
    });
    const refreshedEntry = makeEntry({
      entryId: PRICED_ENTRY_ID,
      runId: "run-priced-refresh",
      cost: 0.18,
      pricingSource: PRICING_SOURCE,
      pricingStatus: "estimated",
      totalTokens: 180,
    });

    const updated = upsertLisaUsageSection(existingSection, {
      entries: [refreshedEntry],
    });
    const parsed = parseLisaUsageSection(updated);

    expect(parsed.entries).toHaveLength(1);
    expect(parsed.entries[0]).toMatchObject({
      cost: 0.18,
      entryId: PRICED_ENTRY_ID,
      pricingSource: PRICING_SOURCE,
      pricingStatus: "estimated",
      runId: "run-priced-refresh",
      totalTokens: 180,
    });
    expect(parsed.rollup).toMatchObject({
      childCost: 0.21,
      childEntryIds: ["child-a", "shared-descendant"],
      childRefs: ["github:issue:900", "github:issue:901"],
      childTokens: 210,
      directCost: 0.18,
      directEntryIds: [PRICED_ENTRY_ID],
      directTokens: 180,
      totalCost: 0.39,
      totalTokens: 390,
    });
  });
});
