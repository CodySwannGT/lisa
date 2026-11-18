import {
  createLisaUsageRollup,
  LISA_USAGE_HEADING,
  parseLisaUsageSection,
  renderLisaUsageEntryToken,
  type LisaUsageEntry,
  upsertLisaUsageSection,
} from "../../../src/utils/usage-accounting.js";
import {
  ARTIFACT_DOCUMENT,
  ARTIFACT_HEADING,
  makeEntry,
} from "./usage-accounting-fixtures.js";

const USAGE_HEADING_COUNT = 1;
const USAGE_HEADING_MATCHER = /## Lisa Usage/g;

describe("usage-accounting utilities", () => {
  it("round-trips effectiveness beside the unchanged legacy token", () => {
    const legacy = makeEntry({
      entryId: "observed-entry",
      runId: "observed-run",
    });
    const observed: LisaUsageEntry = {
      ...legacy,
      effectiveness: {
        schema: 1,
        lisaVersion: "4.62.3",
        workerConfigRevision: null,
        workerWallMs: null,
        feedbackMs: null,
        workerSource: null,
        attention: null,
        readyAt: null,
        acceptedAt: null,
        lifecycleSources: null,
        reworkSources: null,
      },
    };
    const legacyToken = renderLisaUsageEntryToken(legacy);
    expect(renderLisaUsageEntryToken(observed).startsWith(legacyToken)).toBe(
      true
    );
    const original = upsertLisaUsageSection(ARTIFACT_DOCUMENT, {
      entries: [observed],
      rollup: createLisaUsageRollup([observed]),
    });
    const parsed = parseLisaUsageSection(original);
    expect(parsed.entries[0]).toEqual(observed);
    const orphaned = original.replace(
      "lisa:usage-effectiveness entry_id=observed-entry",
      "lisa:usage-effectiveness entry_id=missing-entry"
    );
    expect(() => parseLisaUsageSection(orphaned)).toThrow(
      "Effectiveness observation has no usage entry: missing-entry"
    );
    expect(() =>
      upsertLisaUsageSection(orphaned, {
        entries: [legacy],
        rollup: parsed.rollup!,
      })
    ).toThrow("Effectiveness observation has no usage entry: missing-entry");
    const legacyRefresh = upsertLisaUsageSection(original, {
      entries: [{ ...legacy, cost: 0.5 }],
      rollup: parsed.rollup!,
    });
    expect(parseLisaUsageSection(legacyRefresh).entries[0]).toMatchObject({
      cost: 0.5,
      effectiveness: observed.effectiveness,
    });
    expect(
      upsertLisaUsageSection(original, {
        entries: parsed.entries,
        rollup: parsed.rollup!,
      })
    ).toBe(original);
    expect(
      parseLisaUsageSection(`${LISA_USAGE_HEADING}\n${legacyToken}`).entries[0]
    ).not.toHaveProperty("effectiveness");
    expect(() =>
      parseLisaUsageSection(
        `${original}\n<!-- lisa:usage-effectiveness entry_id=observed-entry data=broken -->`
      )
    ).toThrow();
  });

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
    // Prose under the heading is not Lisa-rendered, so the writer keeps it
    // after the managed block instead of deleting it (#4697).
    expect(updated.match(USAGE_HEADING_MATCHER)).toHaveLength(1);
    expect(updated).toMatch(
      /<!-- lisa:usage-rollup [^\n]*-->\n\nstale body\n\n## Next Section\n/
    );
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
      flow: "lisa-implement",
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
        childCurrency: "USD",
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

    // Passing childArtifacts: [] explicitly means "no children now"; stale
    // previous rollup child totals must be cleared, not preserved.
    const rollup = createLisaUsageRollup([directEntry], previousRollup, []);

    expect(rollup.childEntryIds).toEqual([]);
    expect(rollup.childRefs).toEqual([]);
    expect(rollup.childTokens).toBeNull();
    expect(rollup.childCost).toBeNull();
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
});
