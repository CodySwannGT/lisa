import {
  createLisaUsageRollup,
  LISA_USAGE_HEADING,
  parseLisaUsageSection,
  type LisaUsageChildArtifact,
  type LisaUsageEntry,
  upsertLisaUsageSection,
} from "../../../src/utils/usage-accounting.js";

const USAGE_HEADING_COUNT = 1;
const USAGE_HEADING_MATCHER = /## Lisa Usage/g;
const ARTIFACT_HEADING = "# Artifact";
const ARTIFACT_DOCUMENT = `${ARTIFACT_HEADING}\n`;
const CHILD_REF_ONE = "github:issue:900";
const CHILD_REF_TWO = "github:issue:901";
const CHILD_ENTRY_SHARED = "shared-child";
const CHILD_ENTRY_UNIQUE = "unique-child";

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

  it("clears stale child rollup fields when childArtifacts: [] is explicitly supplied", () => {
    const directEntry = makeEntry({ entryId: "entry-1", runId: "run-1" });
    const previousRollup: import("../../../src/utils/usage-accounting.js").LisaUsageRollup =
      {
        childCost: 0.99,
        childEntryIds: ["stale-child"],
        childRefs: ["github:issue:stale"],
        childTokens: 999,
        currency: "USD",
        directCost: 0.12,
        directEntryIds: ["entry-0"],
        directTokens: 120,
        totalCost: 1.11,
        totalTokens: 1119,
      };

    // Passing childArtifacts: [] explicitly means "no children now" —
    // stale previous rollup child totals must be cleared, not preserved.
    const rollup = createLisaUsageRollup([directEntry], previousRollup, []);

    expect(rollup.childEntryIds).toEqual([]);
    expect(rollup.childRefs).toEqual([]);
    // sumNullable([]) → null (no child data, not inherited stale value of 999)
    expect(rollup.childTokens).toBeNull();
    // sumNullable([]) → null (no child data, not inherited stale value of 0.99)
    expect(rollup.childCost).toBeNull();
  });

  it("dedupes child usage entries by stable entry id across child work", () => {
    const directEntry = makeEntry({ entryId: "entry-1", runId: "run-1" });
    const sharedChild = makeEntry({
      artifactRef: CHILD_REF_ONE,
      cost: 0.08,
      entryId: CHILD_ENTRY_SHARED,
      flow: "verify",
      runId: "run-verify-1",
      totalTokens: 80,
    });
    const uniqueChild = makeEntry({
      artifactRef: CHILD_REF_TWO,
      cost: 0.04,
      entryId: CHILD_ENTRY_UNIQUE,
      flow: "verify",
      runId: "run-verify-2",
      totalTokens: 40,
    });
    const directDuplicate = makeEntry({
      artifactRef: "github:issue:902",
      cost: 0.5,
      entryId: "entry-1",
      flow: "verify",
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
});
