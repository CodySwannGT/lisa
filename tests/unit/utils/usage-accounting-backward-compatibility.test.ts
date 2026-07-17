import {
  createLisaUsageRollup,
  parseLisaUsageSection,
  type LisaUsageChildArtifact,
  type LisaUsageEntry,
  type LisaUsageRollup,
  upsertLisaUsageSection,
} from "../../../src/utils/usage-accounting.js";

const ARTIFACT_DOCUMENT = "# Artifact\n";
const CHILD_ARTIFACT_REF = "github:issue:child";
const PARTIAL_CHILD_ENTRY_ID = "partial-child";
const UNDEFINED_MEASURED_SUBSET = "measured_subset_tokens=undefined";
const LEGACY_FIXED_ORDER_ENTRY_PATTERN = new RegExp(
  [
    "<!-- lisa:usage-entry entry_id=\\S+ flow=\\S+ run_id=\\S+",
    "provider=\\S+ model=\\S+ source=\\S+ input_tokens=\\S+",
    "cached_input_tokens=\\S+ output_tokens=\\S+ reasoning_tokens=\\S+",
    "total_tokens=\\S+ cost=\\S+ currency=\\S+ pricing_status=\\S+",
    "pricing_source=\\S+ artifact_ref=\\S+ parent_artifact_ref=\\S* -->",
  ].join(" ")
);

/** Usage sources accepted by callers written before measured subsets existed. */
type LegacySource = "estimated" | "observed" | "unavailable";

/**
 * Reproduce a pre-2.222 TypeScript caller without the newly added field.
 *
 * @param source Legacy usage source.
 * @returns A source-compatible legacy entry.
 */
function makeLegacyEntry(source: LegacySource): LisaUsageEntry {
  const unavailable = source === "unavailable";
  return {
    artifactRef: `github:issue:1550-${source}`,
    cachedInputTokens: null,
    cost: unavailable ? null : 0.12,
    currency: unavailable ? null : "USD",
    entryId: `legacy-${source}`,
    flow: "lisa-implement",
    inputTokens: unavailable ? null : 100,
    model: "gpt-5",
    outputTokens: unavailable ? null : 20,
    parentArtifactRef: null,
    pricingSource: unavailable ? null : "catalog",
    pricingStatus: source,
    provider: "openai",
    reasoningTokens: null,
    runId: `run-${source}`,
    source,
    totalTokens: unavailable ? null : 120,
  };
}

/**
 * Create a measured-subset entry using the current public model.
 *
 * @param entryId Stable entry identifier.
 * @returns A current measured-subset entry.
 */
function makeMeasuredSubsetEntry(entryId: string): LisaUsageEntry {
  return {
    artifactRef: "github:issue:1550",
    cachedInputTokens: null,
    cost: null,
    currency: null,
    entryId,
    flow: "lisa-plan",
    inputTokens: null,
    measuredSubsetTokens: 42,
    model: "gpt-5",
    outputTokens: null,
    parentArtifactRef: null,
    pricingSource: null,
    pricingStatus: "unavailable",
    provider: "openai",
    reasoningTokens: null,
    runId: "run-subset",
    source: "measured-subset",
    totalTokens: null,
  };
}

/**
 * Create a complete observed entry for mixed-ledger rollup tests.
 *
 * @returns A complete observed entry.
 */
function makeCompleteEntry(): LisaUsageEntry {
  return {
    ...makeMeasuredSubsetEntry("complete"),
    cost: 0.12,
    currency: "USD",
    inputTokens: 100,
    measuredSubsetTokens: null,
    outputTokens: 20,
    pricingSource: "runtime",
    pricingStatus: "observed",
    source: "observed",
    totalTokens: 120,
  };
}

const RELEASED_2_222_DOCUMENT = [
  ARTIFACT_DOCUMENT.trimEnd(),
  "",
  "## Lisa Usage",
  "",
  "| Flow | Source | Model | Tokens | Cost |",
  "| --- | --- | --- | ---: | ---: |",
  "| lisa-plan | measured-subset | openai/gpt-5 | 42 measured subset | null | <!-- lisa:usage-entry entry_id=released-middle flow=lisa-plan run_id=run-subset provider=openai model=gpt-5 source=measured-subset input_tokens=null cached_input_tokens=null output_tokens=null reasoning_tokens=null total_tokens=null measured_subset_tokens=42 cost=null currency=null pricing_status=unavailable pricing_source=null artifact_ref=github%3Aissue%3A1550 parent_artifact_ref= -->",
  "",
  "<!-- lisa:usage-rollup direct_entry_ids=released-middle child_entry_ids= child_refs= direct_tokens=null child_tokens=null total_tokens=null direct_cost=null child_cost=null total_cost=null currency=null child_currency=null -->",
  "",
].join("\n");

const RELEASED_2_222_UNDEFINED_DOCUMENT = RELEASED_2_222_DOCUMENT.replace(
  "measured_subset_tokens=42",
  UNDEFINED_MEASURED_SUBSET
);

describe("usage-accounting backward compatibility", () => {
  it.each(["observed", "estimated", "unavailable"] as const)(
    "null-normalizes the additive field for a legacy %s caller",
    source => {
      const entry = makeLegacyEntry(source);
      const serialized = upsertLisaUsageSection(ARTIFACT_DOCUMENT, {
        entries: [entry],
      });

      expect(serialized).toContain("measured_subset_tokens=null");
      expect(serialized).not.toContain(UNDEFINED_MEASURED_SUBSET);
      expect(parseLisaUsageSection(serialized).entries[0]).toMatchObject({
        entryId: `legacy-${source}`,
        measuredSubsetTokens: null,
      });
      expect(upsertLisaUsageSection(serialized, { entries: [] })).toBe(
        serialized
      );
    }
  );

  it("keeps the canonical primary marker legacy-readable", () => {
    const entry = makeMeasuredSubsetEntry("canonical-subset");
    const serialized = upsertLisaUsageSection(ARTIFACT_DOCUMENT, {
      entries: [entry],
    });

    expect(serialized).toMatch(LEGACY_FIXED_ORDER_ENTRY_PATTERN);
    expect(serialized).toContain(
      "<!-- lisa:usage-entry-measured-subset entry_id=canonical-subset measured_subset_tokens=42 -->"
    );
    expect(parseLisaUsageSection(serialized).entries[0]).toEqual(entry);
  });

  it("migrates released 2.222.0 middle-field markers idempotently", () => {
    const parsedReleased = parseLisaUsageSection(RELEASED_2_222_DOCUMENT);

    expect(parsedReleased.entries[0]?.measuredSubsetTokens).toBe(42);

    const migrated = upsertLisaUsageSection(RELEASED_2_222_DOCUMENT, {
      entries: [],
    });

    expect(migrated).toMatch(LEGACY_FIXED_ORDER_ENTRY_PATTERN);
    expect(migrated).not.toContain(
      "total_tokens=null measured_subset_tokens=42 cost=null"
    );
    expect(
      parseLisaUsageSection(migrated).entries[0]?.measuredSubsetTokens
    ).toBe(42);
    expect(upsertLisaUsageSection(migrated, { entries: [] })).toBe(migrated);
  });

  it("null-normalizes only the omitted 2.222.0 additive field during migration", () => {
    const parsedReleased = parseLisaUsageSection(
      RELEASED_2_222_UNDEFINED_DOCUMENT
    );

    expect(parsedReleased.entries[0]?.measuredSubsetTokens).toBeNull();

    const migrated = upsertLisaUsageSection(RELEASED_2_222_UNDEFINED_DOCUMENT, {
      entries: [],
    });

    expect(migrated).toContain("measured_subset_tokens=null");
    expect(migrated).not.toContain(UNDEFINED_MEASURED_SUBSET);
    expect(upsertLisaUsageSection(migrated, { entries: [] })).toBe(migrated);
  });

  it("keeps established 2.222.0 numeric fields strict", () => {
    const corrupted = RELEASED_2_222_DOCUMENT.replace(
      "cost=null",
      "cost=undefined"
    );

    expect(() => parseLisaUsageSection(corrupted)).toThrow(
      "Invalid Lisa usage numeric token: undefined"
    );
  });

  it("keeps direct and artifact totals unknown for a mixed direct ledger", () => {
    const rollup = createLisaUsageRollup([
      makeCompleteEntry(),
      makeMeasuredSubsetEntry("partial-direct"),
    ]);

    expect(rollup).toMatchObject({
      childTokens: null,
      directCost: 0.12,
      directTokens: null,
      totalCost: 0.12,
      totalTokens: null,
    });
  });

  it("keeps artifact totals unknown when child work is only a subset", () => {
    const childArtifacts: readonly LisaUsageChildArtifact[] = [
      {
        artifactRef: CHILD_ARTIFACT_REF,
        entries: [makeMeasuredSubsetEntry(PARTIAL_CHILD_ENTRY_ID)],
      },
    ];
    const rollup = createLisaUsageRollup(
      [makeCompleteEntry()],
      null,
      childArtifacts
    );

    expect(rollup).toMatchObject({
      childCost: null,
      childTokens: null,
      directCost: 0.12,
      directTokens: 120,
      totalCost: 0.12,
      totalTokens: null,
    });
  });

  it("preserves measured-child incompleteness across ordinary rewrites", () => {
    const childArtifacts: readonly LisaUsageChildArtifact[] = [
      {
        artifactRef: CHILD_ARTIFACT_REF,
        entries: [makeMeasuredSubsetEntry(PARTIAL_CHILD_ENTRY_ID)],
      },
    ];
    const firstWrite = upsertLisaUsageSection(ARTIFACT_DOCUMENT, {
      entries: [makeCompleteEntry()],
      childArtifacts,
    });

    expect(firstWrite).toContain(
      "<!-- lisa:usage-rollup-token-status child_tokens_incomplete=true -->"
    );
    expect(parseLisaUsageSection(firstWrite).rollup).toMatchObject({
      childTokens: null,
      childTokensIncomplete: true,
      directTokens: 120,
      totalCost: 0.12,
      totalTokens: null,
    });
    expect(upsertLisaUsageSection(firstWrite, { entries: [] })).toBe(
      firstWrite
    );
  });

  it("preserves measured-child state when an explicit legacy rollup omits it", () => {
    const childArtifacts: readonly LisaUsageChildArtifact[] = [
      {
        artifactRef: CHILD_ARTIFACT_REF,
        entries: [makeMeasuredSubsetEntry(PARTIAL_CHILD_ENTRY_ID)],
      },
    ];
    const directEntry = makeCompleteEntry();
    const firstWrite = upsertLisaUsageSection(ARTIFACT_DOCUMENT, {
      entries: [directEntry],
      childArtifacts,
    });
    const parsedRollup = parseLisaUsageSection(firstWrite).rollup;
    if (parsedRollup === null) {
      throw new Error("Expected the first write to contain a rollup");
    }
    const legacyRollup: LisaUsageRollup = { ...parsedRollup };
    delete legacyRollup.childTokensIncomplete;

    const rewritten = upsertLisaUsageSection(firstWrite, {
      entries: [directEntry],
      rollup: legacyRollup,
    });

    expect(rewritten).toBe(firstWrite);
    expect(parseLisaUsageSection(rewritten).rollup).toMatchObject({
      childTokens: null,
      childTokensIncomplete: true,
      totalCost: 0.12,
      totalTokens: null,
    });

    const explicitlyComplete = upsertLisaUsageSection(firstWrite, {
      entries: [directEntry],
      rollup: { ...legacyRollup, childTokensIncomplete: false },
    });
    expect(explicitlyComplete).not.toContain("lisa:usage-rollup-token-status");
    expect(parseLisaUsageSection(explicitlyComplete).rollup?.totalTokens).toBe(
      120
    );
  });
});
