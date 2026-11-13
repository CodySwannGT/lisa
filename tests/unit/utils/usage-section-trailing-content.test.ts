import {
  createLisaUsageRollup,
  parseLisaUsageSection,
  renderLisaUsageEntryToken,
  upsertLisaUsageSection,
  verifyLisaUsageSectionIntegrity,
  type LisaUsageEntry,
} from "../../../src/utils/usage-accounting.js";

const DOCUMENT = "# Owned artifact\n\nKeep this description.\n";
const EVIDENCE =
  "<details><summary>Evidence</summary>\n\n```text\nproof output line\n```\n\n</details>\n\nA closing paragraph that is not a heading.\n";
const LATER_HEADING = "## Later heading\n\nKeep this later section too.\n";

/**
 * Build a complete usage entry with a distinct id.
 * @param entryId Stable identifier for the accounting row.
 * @returns A valid usage entry.
 */
function entry(entryId: string): LisaUsageEntry {
  return {
    artifactRef: "github:example/project#1",
    cachedInputTokens: 0,
    cost: null,
    currency: null,
    entryId,
    flow: "lisa-implement",
    inputTokens: 10,
    measuredSubsetTokens: null,
    model: "model-a",
    outputTokens: 5,
    parentArtifactRef: null,
    pricingSource: null,
    pricingStatus: "unavailable",
    provider: "anthropic",
    reasoningTokens: 0,
    runId: `run-${entryId}`,
    source: "session",
    totalTokens: 15,
  };
}

/**
 * Upsert one entry through the public writer.
 * @param document Existing artifact markdown.
 * @param entryId Entry identifier to add.
 * @returns The rewritten document.
 */
function upsert(document: string, entryId: string): string {
  const input = entry(entryId);
  return upsertLisaUsageSection(document, {
    entries: [input],
    rollup: createLisaUsageRollup([input]),
  });
}

/**
 * Count managed usage headings in a document.
 * @param document Artifact markdown to inspect.
 * @returns How many `## Lisa Usage` headings it holds.
 */
function headingCount(document: string): number {
  return document.split("\n").filter(line => line === "## Lisa Usage").length;
}

describe("upsertLisaUsageSection trailing non-heading content (#4697)", () => {
  it("preserves trailing content at end of document", () => {
    const stored = `${upsert(DOCUMENT, "first")}\n${EVIDENCE}`;
    const rewritten = upsert(stored, "second");
    expect(rewritten.endsWith(`\n\n${EVIDENCE}`)).toBe(true);
    expect(rewritten.startsWith(DOCUMENT)).toBe(true);
    expect(headingCount(rewritten)).toBe(1);
    expect(
      parseLisaUsageSection(rewritten).entries.map(item => item.entryId)
    ).toStrictEqual(["first", "second"]);
    expect(verifyLisaUsageSectionIntegrity(rewritten).ok).toBe(true);
  });

  it("preserves trailing content that precedes a later heading", () => {
    const stored = `${upsert(DOCUMENT, "first")}\n${EVIDENCE}\n${LATER_HEADING}`;
    const rewritten = upsert(stored, "second");
    expect(rewritten).toContain(`\n\n${EVIDENCE}\n${LATER_HEADING}`);
    expect(rewritten.endsWith(LATER_HEADING)).toBe(true);
    expect(headingCount(rewritten)).toBe(1);
    expect(
      parseLisaUsageSection(rewritten).entries.map(item => item.entryId)
    ).toStrictEqual(["first", "second"]);
  });

  it("keeps trailing content across repeated upserts", () => {
    const stored = `${upsert(DOCUMENT, "first")}\n${EVIDENCE}`;
    const once = upsert(stored, "second");
    const twice = upsert(once, "second");
    expect(twice).toBe(once);
    expect(twice.endsWith(`\n\n${EVIDENCE}`)).toBe(true);
    expect(headingCount(twice)).toBe(1);
  });

  it("keeps usage tokens appended after the rollup but not a following table", () => {
    const base = upsert(DOCUMENT, "first");
    const appended = `${base}\n<!-- lisa:usage-entry-measured-subset entry_id=first measured_subset_tokens=7 -->\n`;
    const userTable = "| Owner | Note |\n| --- | --- |\n| ops | keep |\n";
    const rewritten = upsert(`${appended}\n${userTable}`, "second");
    expect(rewritten.endsWith(`\n\n${userTable}`)).toBe(true);
    expect(headingCount(rewritten)).toBe(1);
    const first = parseLisaUsageSection(rewritten).entries[0];
    expect(first?.measuredSubsetTokens).toBe(7);
  });

  it("does not treat a rollup token quoted inline in prose as the block end", () => {
    const prose =
      "User prose.\n\nMore prose mentioning `<!-- lisa:usage-rollup direct_entry_ids= -->` inline.\n";
    const stored = `# T\n\n## Lisa Usage\n\n| Flow | x |\n| --- | --- |\n| f | 1 | ${renderLisaUsageEntryToken(entry("old"))}\n\n${prose}`;
    const rewritten = upsert(stored, "second");
    expect(rewritten.endsWith(`\n\n${prose}`)).toBe(true);
    expect(headingCount(rewritten)).toBe(1);
    expect(
      parseLisaUsageSection(rewritten).entries.map(item => item.entryId)
    ).toStrictEqual(["old", "second"]);
  });

  it("keeps entries of the documented sub-heading legacy layout", () => {
    const stored = `## Lisa Usage\n\n_Managed by Lisa. Regenerated on each usage update; do not edit by hand._\n\n### Direct Usage\n\n| Flow | x |\n|---|---|\n| f | 1 |\n\n${renderLisaUsageEntryToken(entry("old"))}\n`;
    expect(
      parseLisaUsageSection(stored).entries.map(item => item.entryId)
    ).toStrictEqual(["old"]);
    const rewritten = upsert(stored, "second");
    expect(headingCount(rewritten)).toBe(1);
    expect(rewritten).not.toContain("### Direct Usage");
    expect(
      parseLisaUsageSection(rewritten).entries.map(item => item.entryId)
    ).toStrictEqual(["old", "second"]);
  });

  it("keeps a user table that follows a rollup-less legacy section", () => {
    const userTable = "| user | table |\n| --- | --- |\n| keep | me |\n";
    const stored = `# T\n\n## Lisa Usage\n\n_This section is managed by Lisa. x_\n\n| Flow | x |\n| --- | --- |\n| f | 1 | ${renderLisaUsageEntryToken(entry("old"))}\n\n${userTable}`;
    const rewritten = upsert(stored, "second");
    expect(rewritten.endsWith(`\n\n${userTable}`)).toBe(true);
    expect(headingCount(rewritten)).toBe(1);
    expect(
      parseLisaUsageSection(rewritten).entries.map(item => item.entryId)
    ).toStrictEqual(["old", "second"]);
  });

  it("ends a section without a rollup token at its last managed-shaped line", () => {
    const withRollup = upsert(DOCUMENT, "first");
    const legacy = withRollup.replace(/<!-- lisa:usage-rollup [^\n]*\n/, "");
    const stored = `${legacy}\n${EVIDENCE}`;
    const rewritten = upsert(stored, "second");
    expect(rewritten.endsWith(`\n\n${EVIDENCE}`)).toBe(true);
    expect(headingCount(rewritten)).toBe(1);
    expect(
      parseLisaUsageSection(rewritten).entries.map(item => item.entryId)
    ).toStrictEqual(["first", "second"]);
  });
});
