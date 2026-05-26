/**
 * Regression tests for the upstream Lisa usage-accounting contract.
 *
 * Issue #727 defines the canonical usage ledger schema, source/pricing
 * semantics, machine-readable token shapes, rollup dedupe contract, and
 * deterministic rewrite rules before any writer integration lands. The rule is
 * the durable source of truth; both source and generated plugin roots must stay
 * in sync, and the token format must be parseable without reading prose.
 * @module tests/unit/strategies/usage-accounting-contract
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const RULE_ROOTS = ["plugins/src/base/rules", "plugins/lisa/rules"] as const;
const RULE_NAME = "usage-accounting.md";
const ARTIFACT_REF = "CodySwannGT/lisa#727";
const MODEL_NAME = "gpt-5";
const PROVIDER_NAME = "openai";
const SOURCE_ESTIMATED = "estimated";
const SOURCE_UNAVAILABLE = "unavailable";
const DIRECT_COST = "0.60";
const DIRECT_TOKENS = 400;
const CHILD_COST = "0.65";
const CHILD_TOKENS = 450;
const IMPLEMENT_ENTRY_ID = "implement-1";
const IMPLEMENT_FLOW = "implement";
const IMPLEMENT_RUN_ID = "run-implement-1";
const RESEARCH_ENTRY_ID = "research-1";
const RESEARCH_FLOW = "research";
const RESEARCH_RUN_ID = "run-research-1";
const TOTAL_COST = "1.25";
const TOTAL_TOKENS = 850;
const ZERO_TOKENS = 0;

/**
 *
 */
type UsageEntry = {
  readonly artifactRef: string;
  readonly cachedInputTokens: number | null;
  readonly cost: string | null;
  readonly currency: string | null;
  readonly entryId: string;
  readonly flow: string;
  readonly inputTokens: number | null;
  readonly model: string;
  readonly outputTokens: number | null;
  readonly parentArtifactRef: string | null;
  readonly pricingSource: string | null;
  readonly pricingStatus: string;
  readonly provider: string;
  readonly reasoningTokens: number | null;
  readonly runId: string;
  readonly source: string;
  readonly totalTokens: number | null;
};

/**
 *
 */
type ParsedEntry = {
  readonly entryId: string;
  readonly flow: string;
  readonly source: string;
  readonly totalTokens: string;
};

/**
 *
 */
type ParsedRollup = {
  readonly childEntryIds: string;
  readonly directEntryIds: string;
  readonly totalCost: string;
  readonly totalTokens: string;
};

const readRule = (root: string): string =>
  readFileSync(path.resolve(root, RULE_NAME), "utf8");

const renderValue = (value: number | string | null): string =>
  value === null
    ? "null"
    : typeof value === "number"
      ? String(value)
      : encodeURIComponent(value);

const renderCsv = (values: readonly string[]): string =>
  values.map(value => encodeURIComponent(value)).join(",");

const renderEntryToken = (entry: UsageEntry): string =>
  `<!-- lisa:usage-entry entry_id=${encodeURIComponent(entry.entryId)} flow=${encodeURIComponent(entry.flow)} run_id=${encodeURIComponent(entry.runId)} provider=${encodeURIComponent(entry.provider)} model=${encodeURIComponent(entry.model)} source=${encodeURIComponent(entry.source)} input_tokens=${renderValue(entry.inputTokens)} cached_input_tokens=${renderValue(entry.cachedInputTokens)} output_tokens=${renderValue(entry.outputTokens)} reasoning_tokens=${renderValue(entry.reasoningTokens)} total_tokens=${renderValue(entry.totalTokens)} cost=${renderValue(entry.cost)} currency=${renderValue(entry.currency)} pricing_status=${encodeURIComponent(entry.pricingStatus)} pricing_source=${renderValue(entry.pricingSource)} artifact_ref=${encodeURIComponent(entry.artifactRef)} parent_artifact_ref=${entry.parentArtifactRef === null ? "" : encodeURIComponent(entry.parentArtifactRef)} -->`;

const renderRollupToken = (
  directEntryIds: readonly string[],
  childEntryIds: readonly string[],
  childRefs: readonly string[],
  totalTokens: number | null,
  totalCost: string | null
): string =>
  `<!-- lisa:usage-rollup direct_entry_ids=${renderCsv(directEntryIds)} child_entry_ids=${renderCsv(childEntryIds)} child_refs=${renderCsv(childRefs)} direct_tokens=${DIRECT_TOKENS} child_tokens=${CHILD_TOKENS} total_tokens=${renderValue(totalTokens)} direct_cost=${DIRECT_COST} child_cost=${CHILD_COST} total_cost=${renderValue(totalCost)} currency=USD -->`;

const renderSection = (entries: readonly UsageEntry[]): string => {
  const sorted = [...entries].sort((a, b) =>
    `${a.flow}:${a.runId}:${a.entryId}`.localeCompare(
      `${b.flow}:${b.runId}:${b.entryId}`
    )
  );
  const directEntryIds = sorted.map(entry => entry.entryId);
  const childEntryIds = ["verify-1", "shared-child"];
  const childRefs = ["CodySwannGT/lisa#900", "CodySwannGT/lisa#901"];
  return [
    "## Lisa Usage",
    "",
    "_Managed by Lisa. Regenerated on each usage update; do not edit by hand._",
    "",
    "### Direct Usage",
    "",
    "| Flow | Model | Source | Tokens | Cost |",
    "|---|---|---|---:|---:|",
    ...sorted.map(
      entry =>
        `| ${entry.flow} | ${entry.provider}/${entry.model} | ${entry.source} | ${renderValue(entry.totalTokens)} | ${renderValue(entry.cost)} ${renderEntryToken(entry)} |`
    ),
    "",
    "### Rollup",
    "",
    "| Scope | Tokens | Cost |",
    "|---|---:|---:|",
    `| Direct | ${DIRECT_TOKENS} | ${DIRECT_COST} |`,
    `| Child | ${CHILD_TOKENS} | ${CHILD_COST} |`,
    `| Total | ${TOTAL_TOKENS} | ${TOTAL_COST} |`,
    "",
    renderRollupToken(
      directEntryIds,
      childEntryIds,
      childRefs,
      TOTAL_TOKENS,
      TOTAL_COST
    ),
    "",
  ].join("\n");
};

const parseEntries = (section: string): readonly ParsedEntry[] => {
  const tokenPattern =
    /<!-- lisa:usage-entry entry_id=(\S+) flow=(\S+) run_id=\S+ provider=\S+ model=\S+ source=(\S+) input_tokens=\S+ cached_input_tokens=\S+ output_tokens=\S+ reasoning_tokens=\S+ total_tokens=(\S+) cost=\S+ currency=\S+ pricing_status=\S+ pricing_source=\S+ artifact_ref=\S+ parent_artifact_ref=\S* -->/g;
  const entries: ParsedEntry[] = [];
  let match = tokenPattern.exec(section);
  while (match !== null) {
    entries.push({
      entryId: decodeURIComponent(match[1] ?? ""),
      flow: decodeURIComponent(match[2] ?? ""),
      source: decodeURIComponent(match[3] ?? ""),
      totalTokens: match[4] ?? "",
    });
    match = tokenPattern.exec(section);
  }
  return entries;
};

const parseRollup = (section: string): ParsedRollup | null => {
  const match =
    /<!-- lisa:usage-rollup direct_entry_ids=(\S*) child_entry_ids=(\S*) child_refs=\S* direct_tokens=\S+ child_tokens=\S+ total_tokens=(\S+) direct_cost=\S+ child_cost=\S+ total_cost=(\S+) currency=\S+ -->/.exec(
      section
    );
  if (match === null) {
    return null;
  }
  return {
    childEntryIds: match[2] ?? "",
    directEntryIds: match[1] ?? "",
    totalCost: match[4] ?? "",
    totalTokens: match[3] ?? "",
  };
};

describe("usage-accounting contract docs", () => {
  describe.each(RULE_ROOTS)("%s/%s", root => {
    const rulePath = path.resolve(root, RULE_NAME);

    it("exists in this plugin root", () => {
      expect(existsSync(rulePath)).toBe(true);
    });

    const content = readRule(root);

    it("defines the canonical managed Lisa Usage section", () => {
      expect(content).toContain("## Lisa Usage");
      expect(content).toMatch(/rewrite it in place/i);
      expect(content).toMatch(/never append a second usage section/i);
    });

    it("documents the direct-entry schema and source semantics", () => {
      expect(content).toContain("entry_id");
      expect(content).toContain("pricing_status");
      expect(content).toContain("artifact_ref");
      expect(content).toMatch(/observed/i);
      expect(content).toMatch(/estimated/i);
      expect(content).toMatch(/unavailable/i);
      expect(content).toMatch(/missing telemetry/i);
    });

    it("documents fixed-order usage-entry and usage-rollup tokens", () => {
      expect(content).toContain("<!-- lisa:usage-entry entry_id=");
      expect(content).toContain("<!-- lisa:usage-rollup");
      expect(content).toMatch(/Field order is fixed/i);
      expect(content).toMatch(/machine-readable summary/i);
      expect(content).toMatch(/percent-encoded/i);
      expect(content).toMatch(/commas inside an item are encoded/i);
    });

    it("documents rollup dedupe by stable entry_id", () => {
      expect(content).toMatch(/Dedupe strictly by stable `entry_id`/i);
      expect(content).toMatch(/Count each `entry_id` at most once/i);
      expect(content).toMatch(/Exclude descendant entries/i);
      expect(content).toMatch(/child artifact A and child artifact B/i);
      expect(content).toMatch(
        /exclude that descendant copy from child totals/i
      );
    });

    it("documents deterministic rewrite rules with no timestamps", () => {
      expect(content).toMatch(/byte-identical output/i);
      expect(content).toMatch(/Do not include timestamps/i);
      expect(content).toMatch(/Sort direct entries deterministically/i);
    });
  });
});

describe("usage-accounting token format is parseable and idempotent", () => {
  const entries: readonly UsageEntry[] = [
    {
      artifactRef: ARTIFACT_REF,
      cachedInputTokens: null,
      cost: DIRECT_COST,
      currency: "USD",
      entryId: IMPLEMENT_ENTRY_ID,
      flow: IMPLEMENT_FLOW,
      inputTokens: 150,
      model: MODEL_NAME,
      outputTokens: 250,
      parentArtifactRef: null,
      pricingSource: "config:2026-05-25",
      pricingStatus: SOURCE_ESTIMATED,
      provider: PROVIDER_NAME,
      reasoningTokens: ZERO_TOKENS,
      runId: IMPLEMENT_RUN_ID,
      source: SOURCE_ESTIMATED,
      totalTokens: DIRECT_TOKENS,
    },
    {
      artifactRef: ARTIFACT_REF,
      cachedInputTokens: null,
      cost: null,
      currency: null,
      entryId: RESEARCH_ENTRY_ID,
      flow: RESEARCH_FLOW,
      inputTokens: null,
      model: MODEL_NAME,
      outputTokens: null,
      parentArtifactRef: null,
      pricingSource: null,
      pricingStatus: SOURCE_UNAVAILABLE,
      provider: PROVIDER_NAME,
      reasoningTokens: null,
      runId: RESEARCH_RUN_ID,
      source: SOURCE_UNAVAILABLE,
      totalTokens: null,
    },
  ];

  const section = renderSection(entries);

  it("enumerates direct entries from tokens alone", () => {
    const parsed = parseEntries(section);
    expect(parsed).toHaveLength(2);
    expect(parsed.map(entry => entry.entryId)).toEqual([
      IMPLEMENT_ENTRY_ID,
      RESEARCH_ENTRY_ID,
    ]);
    expect(parsed[0]).toMatchObject({
      entryId: IMPLEMENT_ENTRY_ID,
      flow: IMPLEMENT_FLOW,
      source: SOURCE_ESTIMATED,
      totalTokens: String(DIRECT_TOKENS),
    });
  });

  it("extracts direct and child entry ids from the rollup token", () => {
    const parsedRollup = parseRollup(section);
    expect(parsedRollup).not.toBeNull();
    expect(parsedRollup).toMatchObject({
      directEntryIds: `${IMPLEMENT_ENTRY_ID},${RESEARCH_ENTRY_ID}`,
      childEntryIds: "verify-1,shared-child",
      totalTokens: String(TOTAL_TOKENS),
      totalCost: TOTAL_COST,
    });
  });

  it("renders byte-identically for the same logical entry set", () => {
    expect(renderSection([...entries].reverse())).toBe(section);
  });
});
