import { sumNullableDecimals } from "./decimal-sum.js";

export const LISA_USAGE_HEADING = "## Lisa Usage";

/**
 *
 */
export interface LisaUsageEntry {
  artifactRef: string;
  cachedInputTokens: number | null;
  cost: number | null;
  currency: string | null;
  entryId: string;
  flow: string;
  inputTokens: number | null;
  model: string;
  outputTokens: number | null;
  parentArtifactRef: string | null;
  pricingSource: string | null;
  pricingStatus: string;
  provider: string;
  reasoningTokens: number | null;
  runId: string;
  source: string;
  totalTokens: number | null;
}

/**
 *
 */
export interface LisaUsageRollup {
  childCost: number | null;
  childEntryIds: readonly string[];
  childRefs: readonly string[];
  childTokens: number | null;
  currency: string | null;
  directCost: number | null;
  directEntryIds: readonly string[];
  directTokens: number | null;
  totalCost: number | null;
  totalTokens: number | null;
}

/**
 *
 */
export interface ParsedLisaUsageSection {
  entries: readonly LisaUsageEntry[];
  range: { end: number; start: number } | null;
  rollup: LisaUsageRollup | null;
}

const ENTRY_PATTERN =
  /<!-- lisa:usage-entry entry_id=(\S+) flow=(\S+) run_id=(\S+) provider=(\S+) model=(\S+) source=(\S+) input_tokens=(\S+) cached_input_tokens=(\S+) output_tokens=(\S+) reasoning_tokens=(\S+) total_tokens=(\S+) cost=(\S+) currency=(\S+) pricing_status=(\S+) pricing_source=(\S+) artifact_ref=(\S+) parent_artifact_ref=(\S*) -->/g;

const ROLLUP_PATTERN =
  /<!-- lisa:usage-rollup direct_entry_ids=(\S*) child_entry_ids=(\S*) child_refs=(\S*) direct_tokens=(\S+) child_tokens=(\S+) total_tokens=(\S+) direct_cost=(\S+) child_cost=(\S+) total_cost=(\S+) currency=(\S+) -->/;

/**
 * Parse a nullable numeric token field.
 *
 * @param value Serialized numeric token value.
 * @returns The parsed number or null when the token is empty.
 */
function parseNullableNumber(value: string): number | null {
  if (value === "null" || value.length === 0) {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Parse a nullable string token field.
 *
 * @param value Serialized string token value.
 * @returns The parsed string or null when the token is empty.
 */
function parseNullableString(value: string): string | null {
  if (value === "null" || value.length === 0) {
    return null;
  }

  return decodeTokenValue(value);
}

/**
 * Decode a percent-encoded token field.
 *
 * @param value Serialized token field.
 * @returns The decoded token value, or the original value for legacy tokens.
 */
function decodeTokenValue(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Serialize a token field so whitespace, delimiters, and HTML comment endings
 * cannot corrupt the machine-readable comment on the next parse.
 *
 * @param value String token value to render.
 * @returns The percent-encoded token value.
 */
function encodeTokenValue(value: string): string {
  return encodeURIComponent(value);
}

/**
 * Serialize a nullable token field.
 *
 * @param value Primitive token value to render.
 * @returns The canonical string form used inside usage tokens.
 */
function renderNullable(value: number | string | null): string {
  if (value === null) {
    return "null";
  }

  return typeof value === "number" ? String(value) : encodeTokenValue(value);
}

/**
 * Parse a comma-separated token field into stable document order.
 *
 * @param value Serialized CSV token field.
 * @returns The parsed item list.
 */
function parseCsv(value: string): readonly string[] {
  if (value.length === 0) {
    return [];
  }

  return value.split(",").map(decodeTokenValue);
}

/**
 * Serialize a list as a comma-delimited token field with each item encoded
 * independently, so commas inside item values are preserved.
 *
 * @param values String values to serialize.
 * @returns Encoded comma-delimited list.
 */
function renderCsv(values: readonly string[]): string {
  return values.map(encodeTokenValue).join(",");
}

/**
 * Sum nullable numeric values while preserving null when nothing was recorded.
 *
 * @param values Numeric values to aggregate.
 * @returns The sum of present values, or null when all are missing.
 */
function sumNullable(values: readonly (number | null)[]): number | null {
  const present = values.filter((value): value is number => value !== null);
  if (present.length === 0) {
    return null;
  }

  return present.reduce((total, value) => total + value, 0);
}

/**
 * Locate the current managed usage-section boundaries inside an artifact body.
 *
 * @param document Artifact markdown to inspect.
 * @returns The start/end character offsets for the section, if present.
 */
function findUsageSectionRange(
  document: string
): { end: number; start: number } | null {
  const heading = `${LISA_USAGE_HEADING}\n`;
  const start = document.indexOf(heading);
  if (start === -1) {
    if (!document.endsWith(LISA_USAGE_HEADING)) {
      return null;
    }

    return {
      start: document.length - LISA_USAGE_HEADING.length,
      end: document.length,
    };
  }

  const afterHeading = start + heading.length;
  const nextHeadingOffset = document.slice(afterHeading).search(/^##\s+/m);
  const end =
    nextHeadingOffset === -1
      ? document.length
      : afterHeading + nextHeadingOffset;
  return { start, end };
}

/**
 * Split an artifact body around the managed usage section.
 *
 * @param document Artifact markdown to split.
 * @param range Located managed-section boundaries, if present.
 * @returns The trimmed content before and after the managed section.
 */
function splitDocumentAroundRange(
  document: string,
  range: { end: number; start: number } | null
): { after: string; before: string } {
  if (!range) {
    const before = document.trimEnd();
    return { before, after: "" };
  }

  const before = document.slice(0, range.start).trimEnd();
  const after = document.slice(range.end).trimStart();
  return { before, after };
}

/**
 * Render a token-count value for the human-readable table.
 *
 * @param value Token count to format.
 * @returns A deterministic display string.
 */
function formatTokens(value: number | null): string {
  return value === null ? "null" : String(value);
}

/**
 * Render a cost value for the human-readable table.
 *
 * @param value Cost amount to format.
 * @param currency Currency code paired with the cost, when known.
 * @returns A deterministic display string.
 */
function formatCost(value: number | null, currency: string | null): string {
  if (value === null) {
    return "null";
  }

  return currency ? `${value} ${currency}` : String(value);
}

/**
 * Merge new usage entries into an existing ledger while keeping stable order for
 * previously recorded entries and replacing matching `entry_id` rows in place.
 *
 * @param existingEntries Previously recorded direct usage entries.
 * @param nextEntries Newly observed direct usage entries to apply.
 * @returns The merged direct-entry set in deterministic document order.
 */
export function mergeLisaUsageEntries(
  existingEntries: readonly LisaUsageEntry[],
  nextEntries: readonly LisaUsageEntry[]
): readonly LisaUsageEntry[] {
  const incoming = new Map(
    nextEntries.map(entry => [entry.entryId, entry] as const)
  );
  const mergedExisting = existingEntries.map(
    entry => incoming.get(entry.entryId) ?? entry
  );
  const appended = nextEntries.filter(
    entry =>
      !existingEntries.some(existing => existing.entryId === entry.entryId)
  );

  return [...mergedExisting, ...appended];
}

/**
 * Build a default rollup token from direct entries while preserving any prior
 * child-work totals supplied by callers from later lifecycle stages.
 *
 * @param entries Direct usage entries that should appear in the section.
 * @param previousRollup Existing rollup token parsed from the artifact, if any.
 * @returns A deterministic rollup token payload for the managed section.
 */
export function createLisaUsageRollup(
  entries: readonly LisaUsageEntry[],
  previousRollup?: LisaUsageRollup | null
): LisaUsageRollup {
  const directEntryIds = entries.map(entry => entry.entryId);
  const directTokens = sumNullable(entries.map(entry => entry.totalTokens));
  const directCost = sumNullableDecimals(entries.map(entry => entry.cost));
  const childEntryIds = previousRollup?.childEntryIds ?? [];
  const childRefs = previousRollup?.childRefs ?? [];
  const childTokens = previousRollup ? previousRollup.childTokens : null;
  const childCost = previousRollup ? previousRollup.childCost : null;
  const totalTokens =
    directTokens === null && childTokens === null
      ? null
      : (directTokens ?? 0) + (childTokens ?? 0);
  const totalCost =
    directCost === null && childCost === null
      ? null
      : sumNullableDecimals([directCost, childCost]);
  const currency =
    entries.find(entry => entry.currency !== null)?.currency ??
    previousRollup?.currency ??
    null;

  return {
    directEntryIds,
    childEntryIds,
    childRefs,
    directTokens,
    childTokens,
    totalTokens,
    directCost,
    childCost,
    totalCost,
    currency,
  };
}

/**
 * Render the machine-readable token for a single direct usage row.
 *
 * @param entry Direct usage entry to serialize.
 * @returns The canonical `lisa:usage-entry` token line.
 */
export function renderLisaUsageEntryToken(entry: LisaUsageEntry): string {
  return `<!-- lisa:usage-entry entry_id=${encodeTokenValue(entry.entryId)} flow=${encodeTokenValue(entry.flow)} run_id=${encodeTokenValue(entry.runId)} provider=${encodeTokenValue(entry.provider)} model=${encodeTokenValue(entry.model)} source=${encodeTokenValue(entry.source)} input_tokens=${renderNullable(entry.inputTokens)} cached_input_tokens=${renderNullable(entry.cachedInputTokens)} output_tokens=${renderNullable(entry.outputTokens)} reasoning_tokens=${renderNullable(entry.reasoningTokens)} total_tokens=${renderNullable(entry.totalTokens)} cost=${renderNullable(entry.cost)} currency=${renderNullable(entry.currency)} pricing_status=${encodeTokenValue(entry.pricingStatus)} pricing_source=${renderNullable(entry.pricingSource)} artifact_ref=${encodeTokenValue(entry.artifactRef)} parent_artifact_ref=${entry.parentArtifactRef === null ? "" : encodeTokenValue(entry.parentArtifactRef)} -->`;
}

/**
 * Render the machine-readable rollup token for a managed usage section.
 *
 * @param rollup Rollup values to serialize.
 * @returns The canonical `lisa:usage-rollup` token line.
 */
export function renderLisaUsageRollupToken(rollup: LisaUsageRollup): string {
  return `<!-- lisa:usage-rollup direct_entry_ids=${renderCsv(rollup.directEntryIds)} child_entry_ids=${renderCsv(rollup.childEntryIds)} child_refs=${renderCsv(rollup.childRefs)} direct_tokens=${renderNullable(rollup.directTokens)} child_tokens=${renderNullable(rollup.childTokens)} total_tokens=${renderNullable(rollup.totalTokens)} direct_cost=${renderNullable(rollup.directCost)} child_cost=${renderNullable(rollup.childCost)} total_cost=${renderNullable(rollup.totalCost)} currency=${renderNullable(rollup.currency)} -->`;
}

/**
 * Render the canonical `## Lisa Usage` section body from direct entries and a
 * rollup token.
 *
 * @param input Section payload containing direct entries and rollup totals.
 * @param input.entries Direct entries to render in document order.
 * @param input.rollup Rollup token to end the section with.
 * @returns The managed section text, terminated with a trailing newline.
 */
export function renderLisaUsageSection(input: {
  entries: readonly LisaUsageEntry[];
  rollup: LisaUsageRollup;
}): string {
  const { entries, rollup } = input;
  const entryLines =
    entries.length === 0
      ? ["| _No direct entries recorded_ | | | | |"]
      : entries.map(
          entry =>
            `| ${entry.flow} | ${entry.source} | ${entry.provider}/${entry.model} | ${formatTokens(entry.totalTokens)} | ${formatCost(entry.cost, entry.currency)} | ${renderLisaUsageEntryToken(entry)}`
        );
  const lines = [
    LISA_USAGE_HEADING,
    "",
    "_This section is managed by Lisa. Rewrites update matching usage entries in place and preserve older rows._",
    "",
    "| Flow | Source | Model | Tokens | Cost |",
    "| --- | --- | --- | ---: | ---: |",
    ...entryLines,
    "",
    renderLisaUsageRollupToken(rollup),
  ];

  return `${lines.join("\n")}\n`;
}

/**
 * Parse the managed usage section out of an artifact body or comment.
 *
 * @param document Artifact markdown to inspect.
 * @returns Parsed direct entries, rollup token, and the located section range.
 */
export function parseLisaUsageSection(
  document: string
): ParsedLisaUsageSection {
  const range = findUsageSectionRange(document);
  const section = range ? document.slice(range.start, range.end) : "";
  const entries = Array.from(section.matchAll(ENTRY_PATTERN), match => ({
    entryId: decodeTokenValue(match[1] ?? ""),
    flow: decodeTokenValue(match[2] ?? ""),
    runId: decodeTokenValue(match[3] ?? ""),
    provider: decodeTokenValue(match[4] ?? ""),
    model: decodeTokenValue(match[5] ?? ""),
    source: decodeTokenValue(match[6] ?? ""),
    inputTokens: parseNullableNumber(match[7] ?? ""),
    cachedInputTokens: parseNullableNumber(match[8] ?? ""),
    outputTokens: parseNullableNumber(match[9] ?? ""),
    reasoningTokens: parseNullableNumber(match[10] ?? ""),
    totalTokens: parseNullableNumber(match[11] ?? ""),
    cost: parseNullableNumber(match[12] ?? ""),
    currency: parseNullableString(match[13] ?? ""),
    pricingStatus: decodeTokenValue(match[14] ?? ""),
    pricingSource: parseNullableString(match[15] ?? ""),
    artifactRef: decodeTokenValue(match[16] ?? ""),
    parentArtifactRef: parseNullableString(match[17] ?? ""),
  }));

  const rollupMatch = ROLLUP_PATTERN.exec(section);
  const rollup = rollupMatch
    ? {
        directEntryIds: parseCsv(rollupMatch[1] ?? ""),
        childEntryIds: parseCsv(rollupMatch[2] ?? ""),
        childRefs: parseCsv(rollupMatch[3] ?? ""),
        directTokens: parseNullableNumber(rollupMatch[4] ?? ""),
        childTokens: parseNullableNumber(rollupMatch[5] ?? ""),
        totalTokens: parseNullableNumber(rollupMatch[6] ?? ""),
        directCost: parseNullableNumber(rollupMatch[7] ?? ""),
        childCost: parseNullableNumber(rollupMatch[8] ?? ""),
        totalCost: parseNullableNumber(rollupMatch[9] ?? ""),
        currency: parseNullableString(rollupMatch[10] ?? ""),
      }
    : null;

  return { entries, rollup, range };
}

/**
 * Append or replace the canonical `## Lisa Usage` section in a markdown
 * artifact while preserving prior entries that are not being refreshed.
 *
 * @param document Existing artifact markdown or comment body.
 * @param input New usage content to merge into the managed section.
 * @param input.entries Newly observed direct usage entries.
 * @param input.rollup Optional explicit rollup payload to serialize.
 * @returns The updated artifact markdown with exactly one managed usage block.
 */
export function upsertLisaUsageSection(
  document: string,
  input: {
    entries: readonly LisaUsageEntry[];
    rollup?: LisaUsageRollup | null;
  }
): string {
  const parsed = parseLisaUsageSection(document);
  const mergedEntries = mergeLisaUsageEntries(parsed.entries, input.entries);
  const rollup =
    input.rollup ?? createLisaUsageRollup(mergedEntries, parsed.rollup);
  const usageSection = renderLisaUsageSection({
    entries: mergedEntries,
    rollup,
  }).trimEnd();
  const { before, after } = splitDocumentAroundRange(document, parsed.range);

  if (!before) {
    return after ? `${usageSection}\n\n${after}\n` : `${usageSection}\n`;
  }

  if (!after) {
    return `${before}\n\n${usageSection}\n`;
  }

  return `${before}\n\n${usageSection}\n\n${after}\n`;
}
