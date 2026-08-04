import {
  createLisaUsageRollup,
  LISA_USAGE_HEADING,
  parseLisaUsageSection,
  renderLisaUsageEntryToken,
  renderLisaUsageSection,
  upsertLisaUsageSection,
  verifyLisaUsageSectionIntegrity,
  type LisaUsageEntry,
} from "../../../src/utils/usage-accounting.js";

const ARTIFACT_HEADING = "# Artifact";
const ARTIFACT_DOCUMENT = `${ARTIFACT_HEADING}\n`;
const PRIMARY_ENTRY_ID = "implement-tun-430";
const LEGACY_ENTRY_ID = "legacy-entry";
const ENTRY_TOKEN_MATCHER = /<!-- lisa:usage-entry [^\r\n]*? -->/g;
const EXPECTED_ENTRY_COUNT = 2;
const ORPHANED_ROLLUP_TOKEN =
  "<!-- lisa:usage-rollup direct_entry_ids=implement-tun-430 child_entry_ids= child_refs= direct_tokens=null child_tokens=null total_tokens=null direct_cost=null child_cost=null total_cost=null currency=null child_currency=null -->";

/**
 * Create a deterministic direct usage entry for layout tests.
 *
 * @param overrides Test-specific field overrides.
 * @returns A complete usage entry payload.
 */
function makeEntry(overrides: Partial<LisaUsageEntry> = {}): LisaUsageEntry {
  return {
    artifactRef: "linear:tunnlai/TUN-430",
    cachedInputTokens: null,
    cost: null,
    currency: null,
    entryId: PRIMARY_ENTRY_ID,
    flow: "implement",
    inputTokens: null,
    measuredSubsetTokens: null,
    model: "claude-opus-5",
    outputTokens: null,
    parentArtifactRef: null,
    pricingSource: null,
    pricingStatus: "unavailable",
    provider: "anthropic",
    reasoningTokens: null,
    runId: "run-430",
    source: "unavailable",
    totalTokens: null,
    ...overrides,
  };
}

/**
 * Reproduce the destructive half of a table-normalizing markdown host.
 *
 * Measured against a live Linear issue on 2026-08-04 (TUN-440): a table is
 * re-serialized from its parsed cell model, so the alignment row collapses to
 * `--` and every trailing cell beyond the header arity — including an HTML
 * comment — is discarded. Comments on their own line, several on consecutive
 * lines, two sharing one line, and one trailing an ordinary paragraph all
 * round-trip byte-identically, so the table row is the only hostile position.
 *
 * @param document Markdown as sent to the host.
 * @returns Markdown as the host would store it.
 */
function normalizeLikeLinear(document: string): string {
  return document
    .split("\n")
    .map(line => {
      if (!line.startsWith("|")) {
        return line;
      }

      const cells = line.split("|").slice(1, -1);
      const rendered = cells.map(cell =>
        /^\s*:?-{2,}:?\s*$/.test(cell) ? " -- " : cell
      );
      return `|${rendered.join("|")}|`;
    })
    .join("\n");
}

/**
 * Render the pre-TUN-440 layout, which trailed the entry tokens off a table row.
 *
 * @param entry Usage entry to render.
 * @returns A managed section in the historical layout.
 */
function renderRowTrailingSection(entry: LisaUsageEntry): string {
  return [
    LISA_USAGE_HEADING,
    "",
    "| Flow | Source | Model | Tokens | Cost |",
    "| --- | --- | --- | ---: | ---: |",
    `| implement | unavailable | anthropic/claude-opus-5 | null | null | ${renderLisaUsageEntryToken(entry)}`,
    "",
    ORPHANED_ROLLUP_TOKEN.replace(PRIMARY_ENTRY_ID, entry.entryId),
    "",
  ].join("\n");
}

describe("usage-accounting table normalization (TUN-440)", () => {
  it("keeps every entry token off the visible table rows", () => {
    const entries = [makeEntry(), makeEntry({ entryId: "verify-tun-430" })];
    const section = renderLisaUsageSection({
      entries,
      rollup: createLisaUsageRollup(entries),
    });

    const tokenBearingTableRows = section
      .split("\n")
      .filter(line => line.startsWith("|") && line.includes("<!-- lisa:"));

    expect(tokenBearingTableRows).toStrictEqual([]);
    expect(section.match(ENTRY_TOKEN_MATCHER)).toHaveLength(
      EXPECTED_ENTRY_COUNT
    );
  });

  it("survives a table-normalizing host and stays enumerable", () => {
    const entry = makeEntry();
    const sent = upsertLisaUsageSection(ARTIFACT_DOCUMENT, {
      entries: [entry],
      rollup: createLisaUsageRollup([entry]),
    });

    const stored = normalizeLikeLinear(sent);
    const parsed = parseLisaUsageSection(stored);

    expect(parsed.entries).toHaveLength(1);
    expect(parsed.entries[0]?.entryId).toBe(PRIMARY_ENTRY_ID);
    expect(parsed.rollup?.directEntryIds).toStrictEqual([PRIMARY_ENTRY_ID]);
    expect(
      verifyLisaUsageSectionIntegrity(stored, {
        entryIds: [PRIMARY_ENTRY_ID],
      })
    ).toStrictEqual({ ok: true, issues: [] });
  });

  it("proves the simulated host is destructive, not inert", () => {
    const stored = normalizeLikeLinear(renderRowTrailingSection(makeEntry()));
    const parsed = parseLisaUsageSection(stored);

    expect(parsed.entries).toStrictEqual([]);
    expect(parsed.rollup?.directEntryIds).toStrictEqual([PRIMARY_ENTRY_ID]);
  });

  it("migrates a legacy row-trailing section to the new layout in one rewrite", () => {
    const legacyDocument = [
      ARTIFACT_HEADING,
      "",
      renderRowTrailingSection(makeEntry({ entryId: LEGACY_ENTRY_ID })),
    ].join("\n");
    const nextEntry = makeEntry({ entryId: "next-entry" });

    const migrated = upsertLisaUsageSection(legacyDocument, {
      entries: [nextEntry],
      rollup: null,
    });

    expect(
      migrated
        .split("\n")
        .filter(line => line.startsWith("|") && line.includes("<!-- lisa:"))
    ).toStrictEqual([]);
    expect(
      parseLisaUsageSection(migrated).entries.map(item => item.entryId)
    ).toStrictEqual([LEGACY_ENTRY_ID, "next-entry"]);
    expect(
      upsertLisaUsageSection(migrated, { entries: [nextEntry], rollup: null })
    ).toBe(migrated);
  });

  it("still enumerates a legacy row-trailing section that was never rewritten", () => {
    const legacyDocument = renderRowTrailingSection(
      makeEntry({ entryId: LEGACY_ENTRY_ID })
    );

    expect(
      parseLisaUsageSection(legacyDocument).entries.map(item => item.entryId)
    ).toStrictEqual([LEGACY_ENTRY_ID]);
  });
});
