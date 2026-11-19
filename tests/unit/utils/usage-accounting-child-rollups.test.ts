import {
  createLisaUsageRollup,
  parseLisaUsageSection,
  type LisaUsageChildArtifact,
  type LisaUsageRollup,
  upsertLisaUsageSection,
} from "../../../src/utils/usage-accounting.js";
import { ARTIFACT_DOCUMENT, makeEntry } from "./usage-accounting-fixtures.js";

const CHILD_REF_ONE = "github:issue:900";
const CHILD_REF_TWO = "github:issue:901";
const CHILD_ENTRY_SHARED = "shared-child";
const CHILD_ENTRY_UNIQUE = "unique-child";
const PRICING_SOURCE = "config:openai-api-pricing@2026-05-25";
const PRICED_ENTRY_ID = "entry-priced";
const FLOW_VERIFY = "lisa-verify";

/**
 * Create a deterministic rollup payload for unit tests.
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

describe("usage-accounting child rollups", () => {
  it("dedupes child usage entries by stable entry id across child work", () => {
    const directEntry = makeEntry({ entryId: "entry-1", runId: "run-1" });
    const sharedChild = makeEntry({
      artifactRef: CHILD_REF_ONE,
      cost: 0.08,
      entryId: CHILD_ENTRY_SHARED,
      flow: FLOW_VERIFY,
      runId: "run-verify-1",
      totalTokens: 80,
    });
    const uniqueChild = makeEntry({
      artifactRef: CHILD_REF_TWO,
      cost: 0.04,
      entryId: CHILD_ENTRY_UNIQUE,
      flow: FLOW_VERIFY,
      runId: "run-verify-2",
      totalTokens: 40,
    });
    const directDuplicate = makeEntry({
      artifactRef: "github:issue:902",
      cost: 0.5,
      entryId: "entry-1",
      flow: FLOW_VERIFY,
      runId: "run-verify-duplicate",
      totalTokens: 500,
    });
    const childArtifacts: readonly LisaUsageChildArtifact[] = [
      {
        artifactRef: CHILD_REF_ONE,
        entries: [sharedChild, uniqueChild],
      },
      {
        artifactRef: CHILD_REF_TWO,
        entries: [sharedChild, directDuplicate],
      },
    ];

    const rollup = createLisaUsageRollup([directEntry], null, childArtifacts);
    const updated = upsertLisaUsageSection(ARTIFACT_DOCUMENT, {
      entries: [directEntry],
      childArtifacts,
    });
    const parsed = parseLisaUsageSection(updated);

    expect(rollup.childEntryIds).toEqual([
      CHILD_ENTRY_SHARED,
      CHILD_ENTRY_UNIQUE,
    ]);
    expect(rollup.childRefs).toEqual([CHILD_REF_ONE, CHILD_REF_TWO]);
    expect(parsed.rollup?.childEntryIds).toEqual([
      CHILD_ENTRY_SHARED,
      CHILD_ENTRY_UNIQUE,
    ]);
    expect(parsed.rollup?.childRefs).toEqual([CHILD_REF_ONE, CHILD_REF_TWO]);
    expect(parsed.rollup?.childTokens).toBe(120);
    expect(parsed.rollup?.childCost).toBeCloseTo(0.12);
    expect(parsed.rollup?.totalTokens).toBe(240);
    expect(parsed.rollup?.totalCost).toBeCloseTo(0.24);
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
      measuredSubsetTokens: null,
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
      measuredSubsetTokens: null,
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

  it("preserves measured subsets without rolling them up as complete totals", () => {
    const partialEntry = makeEntry({
      cost: null,
      currency: null,
      entryId: "entry-measured-subset",
      inputTokens: null,
      measuredSubsetTokens: 1_023_299,
      outputTokens: null,
      pricingSource: null,
      pricingStatus: "unavailable",
      reasoningTokens: null,
      runId: "run-measured-subset",
      source: "measured-subset",
      totalTokens: null,
    });

    const updated = upsertLisaUsageSection(ARTIFACT_DOCUMENT, {
      entries: [partialEntry],
      rollup: createLisaUsageRollup([partialEntry]),
    });
    const parsed = parseLisaUsageSection(updated);

    expect(updated).toContain("source=measured-subset");
    expect(updated).toContain("measured_subset_tokens=1023299");
    expect(updated).toContain("1023299 measured subset");
    expect(parsed.entries[0]).toMatchObject({
      measuredSubsetTokens: 1_023_299,
      source: "measured-subset",
      totalTokens: null,
    });
    expect(parsed.rollup?.directTokens).toBeNull();
    expect(parsed.rollup?.totalTokens).toBeNull();
  });

  it("rejects corrupted numeric tokens instead of rewriting them as null", () => {
    const existingSection = upsertLisaUsageSection(ARTIFACT_DOCUMENT, {
      entries: [makeEntry({ entryId: "entry-corrupt", runId: "run-corrupt" })],
    }).replace("cost=0.12", "cost=bad");

    expect(() =>
      upsertLisaUsageSection(existingSection, {
        entries: [makeEntry({ entryId: "entry-next", runId: "run-next" })],
      })
    ).toThrow("Invalid Lisa usage numeric token: bad");
    expect(existingSection).toContain("cost=bad");
  });

  it("preserves pricing metadata and prior child rollups during direct-entry refreshes", () => {
    const existingEntry = makeEntry({
      entryId: PRICED_ENTRY_ID,
      runId: "run-priced",
      pricingSource: PRICING_SOURCE,
      pricingStatus: "estimated",
    });
    const existingSection = upsertLisaUsageSection(ARTIFACT_DOCUMENT, {
      entries: [existingEntry],
      rollup: makeRollup({
        childCost: 0.21,
        childEntryIds: ["child-a", "shared-descendant"],
        childRefs: [CHILD_REF_ONE, CHILD_REF_TWO],
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
      childRefs: [CHILD_REF_ONE, CHILD_REF_TWO],
      childTokens: 210,
      directCost: 0.18,
      directEntryIds: [PRICED_ENTRY_ID],
      directTokens: 180,
      totalCost: 0.39,
      totalTokens: 390,
    });
  });

  // Test hardened to kill mutant M001 (Risk Factor: Data security / compliance)
  it("surfaces currency mismatches instead of summing costs", () => {
    const directMixed = createLisaUsageRollup([
      makeEntry({ entryId: "entry-usd", runId: "run-usd", currency: "USD" }),
      makeEntry({ entryId: "entry-eur", runId: "run-eur", currency: "EUR" }),
    ]);
    const childMixed = createLisaUsageRollup(
      [makeEntry({ entryId: "entry-usd", runId: "run-usd", currency: "USD" })],
      makeRollup({
        childCost: 0.21,
        childCurrency: "EUR",
        childTokens: 210,
        currency: "EUR",
      })
    );

    expect(directMixed.currency).toBe("mixed");
    expect(directMixed.directCost).toBeNull();
    expect(directMixed.totalCost).toBeNull();
    expect(childMixed.currency).toBe("mixed");
    expect(childMixed.directCost).toBeCloseTo(0.12);
    expect(childMixed.childCost).toBeCloseTo(0.21);
    expect(childMixed.directTokens).toBe(120);
    expect(childMixed.childTokens).toBe(210);
    expect(childMixed.totalCost).toBeNull();
  });

  it("recovers from a sticky mixed state when subsequent entries align", () => {
    const stickyRollup = makeRollup({
      childCost: 0.21,
      childCurrency: "EUR",
      childTokens: 210,
      currency: "mixed",
    });
    const reconciled = createLisaUsageRollup(
      [makeEntry({ entryId: "entry-eur", runId: "run-eur", currency: "EUR" })],
      stickyRollup
    );

    expect(reconciled.currency).toBe("EUR");
    expect(reconciled.childCurrency).toBe("EUR");
    expect(reconciled.directCost).toBeCloseTo(0.12);
    expect(reconciled.childCost).toBeCloseTo(0.21);
    expect(reconciled.totalCost).toBeCloseTo(0.33);
  });
});
