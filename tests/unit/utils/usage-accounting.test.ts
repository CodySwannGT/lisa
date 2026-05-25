import {
  createLisaUsageRollup,
  LISA_USAGE_HEADING,
  parseLisaUsageSection,
  type LisaUsageEntry,
  upsertLisaUsageSection,
} from "../../../src/utils/usage-accounting.js";

const USAGE_HEADING_COUNT = 1;
const USAGE_HEADING_MATCHER = /## Lisa Usage/g;
const ARTIFACT_HEADING = "# Artifact";
const ARTIFACT_DOCUMENT = `${ARTIFACT_HEADING}\n`;

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
});
