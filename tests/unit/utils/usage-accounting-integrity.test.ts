import {
  createLisaUsageRollup,
  LISA_USAGE_HEADING,
  renderLisaUsageEntryToken,
  upsertLisaUsageSection,
  verifyLisaUsageSectionIntegrity,
  type LisaUsageEntry,
} from "../../../src/utils/usage-accounting.js";

const ARTIFACT_DOCUMENT = "# Artifact\n";
const ENTRY_ID = "implement-tun-430";
const ROLLUP_TOKEN = `<!-- lisa:usage-rollup direct_entry_ids=${ENTRY_ID} child_entry_ids= child_refs= direct_tokens=null child_tokens=null total_tokens=null direct_cost=null child_cost=null total_cost=null currency=null child_currency=null -->`;

/**
 * Create a deterministic direct usage entry for integrity tests.
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
    entryId: ENTRY_ID,
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

describe("verifyLisaUsageSectionIntegrity", () => {
  it("reports the TUN-440 signature: a rollup naming entries that are gone", () => {
    const strippedLedger = [
      LISA_USAGE_HEADING,
      "",
      "| Flow | Source | Model | Tokens | Cost |",
      "| -- | -- | -- | -- | -- |",
      "| implement | unavailable | anthropic/claude-opus-5 | null | null |",
      "",
      ROLLUP_TOKEN,
      "",
    ].join("\n");

    const result = verifyLisaUsageSectionIntegrity(strippedLedger, {
      entryIds: [ENTRY_ID],
    });

    expect(result.ok).toBe(false);
    expect(result.issues.map(issue => issue.code)).toStrictEqual([
      "missing-entry-token",
    ]);
    expect(result.issues[0]?.entryIds).toStrictEqual([ENTRY_ID]);
    expect(result.issues[0]?.message).toContain("dropped them");
  });

  it("reports a rollup reference no entry resolves, without caller expectations", () => {
    const orphanedRollup = [
      LISA_USAGE_HEADING,
      "",
      ROLLUP_TOKEN.replace(ENTRY_ID, "ghost-entry"),
      "",
    ].join("\n");

    const result = verifyLisaUsageSectionIntegrity(orphanedRollup);

    expect(result.ok).toBe(false);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]?.code).toBe("missing-entry-token");
    expect(result.issues[0]?.entryIds).toStrictEqual(["ghost-entry"]);
  });

  it("reports a section the host dropped entirely", () => {
    const result = verifyLisaUsageSectionIntegrity(ARTIFACT_DOCUMENT, {
      entryIds: [ENTRY_ID],
    });

    expect(result.ok).toBe(false);
    expect(result.issues[0]?.code).toBe("missing-section");
    expect(result.issues[0]?.entryIds).toStrictEqual([ENTRY_ID]);
  });

  it("reports entries the rollup does not account for", () => {
    const entry = makeEntry();
    const document = upsertLisaUsageSection(ARTIFACT_DOCUMENT, {
      entries: [entry],
      rollup: createLisaUsageRollup([entry]),
    }).replace(`direct_entry_ids=${ENTRY_ID}`, "direct_entry_ids=");

    const result = verifyLisaUsageSectionIntegrity(document);

    expect(result.ok).toBe(false);
    expect(result.issues[0]?.code).toBe("unrecorded-entry");
    expect(result.issues[0]?.entryIds).toStrictEqual([ENTRY_ID]);
  });

  it("reports entries carrying no rollup token at all", () => {
    const withoutRollup = [
      LISA_USAGE_HEADING,
      "",
      renderLisaUsageEntryToken(makeEntry()),
      "",
    ].join("\n");

    const codes = verifyLisaUsageSectionIntegrity(withoutRollup).issues.map(
      issue => issue.code
    );

    expect(codes).toStrictEqual(["missing-rollup-token"]);
  });

  it("reports a missing rollup token on a section with zero direct entries", () => {
    const emptySectionWithoutRollup = [
      LISA_USAGE_HEADING,
      "",
      "| Flow | Source | Model | Tokens | Cost |",
      "| -- | -- | -- | -- | -- |",
      "| _No direct entries recorded_ | | | | |",
      "",
    ].join("\n");

    const result = verifyLisaUsageSectionIntegrity(emptySectionWithoutRollup);

    expect(result.ok).toBe(false);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]?.code).toBe("missing-rollup-token");
    expect(result.issues[0]?.entryIds).toStrictEqual([]);
  });

  it("passes a freshly serialized ledger read straight back", () => {
    const entry = makeEntry();
    const document = upsertLisaUsageSection(ARTIFACT_DOCUMENT, {
      entries: [entry],
      rollup: createLisaUsageRollup([entry]),
    });

    expect(
      verifyLisaUsageSectionIntegrity(document, { entryIds: [ENTRY_ID] })
    ).toStrictEqual({ ok: true, issues: [] });
  });

  it("passes an artifact that has no managed section and expects none", () => {
    expect(verifyLisaUsageSectionIntegrity(ARTIFACT_DOCUMENT)).toStrictEqual({
      ok: true,
      issues: [],
    });
  });
});
