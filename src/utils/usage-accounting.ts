/* eslint-disable max-lines -- Usage ledger parsing, rendering, and rollup helpers share one public utility surface. */

import { collectLisaUsageChildArtifacts } from "./usage-accounting-rollup.js";
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
  measuredSubsetTokens?: number | null;
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
  childCurrency: string | null;
  childEntryIds: readonly string[];
  childRefs: readonly string[];
  childTokens: number | null;
  childTokensIncomplete?: boolean;
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
export interface LisaUsageChildArtifact {
  artifactRef: string;
  entries: readonly LisaUsageEntry[];
}

/**
 *
 */
export interface ParsedLisaUsageSection {
  entries: readonly LisaUsageEntry[];
  range: { end: number; start: number } | null;
  rollup: LisaUsageRollup | null;
}

const ENTRY_TOKEN_PATTERN = /<!-- lisa:usage-entry [^\r\n]*? -->/g;

const LEGACY_ENTRY_PATTERN =
  /^<!-- lisa:usage-entry entry_id=(\S+) flow=(\S+) run_id=(\S+) provider=(\S+) model=(\S+) source=(\S+) input_tokens=(\S+) cached_input_tokens=(\S+) output_tokens=(\S+) reasoning_tokens=(\S+) total_tokens=(\S+) cost=(\S+) currency=(\S+) pricing_status=(\S+) pricing_source=(\S+) artifact_ref=(\S+) parent_artifact_ref=(\S*) -->$/;

const RELEASED_MIDDLE_FIELD_ENTRY_PATTERN =
  /^<!-- lisa:usage-entry entry_id=(\S+) flow=(\S+) run_id=(\S+) provider=(\S+) model=(\S+) source=(\S+) input_tokens=(\S+) cached_input_tokens=(\S+) output_tokens=(\S+) reasoning_tokens=(\S+) total_tokens=(\S+) measured_subset_tokens=(\S+) cost=(\S+) currency=(\S+) pricing_status=(\S+) pricing_source=(\S+) artifact_ref=(\S+) parent_artifact_ref=(\S*) -->$/;

const MEASURED_SUBSET_PATTERN =
  /<!-- lisa:usage-entry-measured-subset entry_id=(\S+) measured_subset_tokens=(\S+) -->/g;

const ROLLUP_PATTERN =
  /<!-- lisa:usage-rollup direct_entry_ids=(\S*) child_entry_ids=(\S*) child_refs=(\S*) direct_tokens=(\S+) child_tokens=(\S+) total_tokens=(\S+) direct_cost=(\S+) child_cost=(\S+) total_cost=(\S+) currency=(\S+)(?: child_currency=(\S+))? -->/;

const ROLLUP_TOKEN_STATUS_PATTERN =
  /<!-- lisa:usage-rollup-token-status child_tokens_incomplete=true -->/;

const MIXED_CURRENCY = "mixed";

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
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid Lisa usage numeric token: ${value}`);
  }

  return parsed;
}

/**
 * Parse the additive field from the published 2.222.0 marker. Legacy callers
 * could serialize an omitted property as the literal `undefined`; no other
 * numeric field receives this compatibility exception.
 *
 * @param value Transitional measured-subset token value.
 * @returns The parsed subtotal, or null for the published undefined omission.
 */
function parseReleasedMeasuredSubset(value: string): number | null {
  return value === "undefined" ? null : parseNullableNumber(value);
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
 * Detect an entry whose recorded count is explicitly only part of a run.
 *
 * @param entry Usage entry to inspect.
 * @returns Whether token rollups must remain incomplete for this entry.
 */
function hasMeasuredSubset(entry: LisaUsageEntry): boolean {
  return (
    entry.source === "measured-subset" ||
    (entry.measuredSubsetTokens ?? null) !== null
  );
}

/**
 * Resolve the only currency represented by present cost values.
 *
 * @param entries Usage entries to inspect.
 * @returns The single currency, mixed sentinel, or null when no priced currency exists.
 */
function resolveDirectCostCurrency(
  entries: readonly LisaUsageEntry[]
): string | null {
  const currencies = new Set(
    entries.filter(entry => entry.cost !== null).map(entry => entry.currency)
  );

  if (currencies.size > 1) {
    return MIXED_CURRENCY;
  }

  return currencies.values().next().value ?? null;
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
 * Render the token-count cell for human readers without making a measured
 * subset look like a complete total.
 *
 * @param entry Usage entry to display.
 * @returns A deterministic display string.
 */
function formatEntryTokens(entry: LisaUsageEntry): string {
  if (entry.totalTokens !== null) {
    return formatTokens(entry.totalTokens);
  }

  return (entry.measuredSubsetTokens ?? null) === null
    ? "null"
    : `${entry.measuredSubsetTokens} measured subset`;
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
 * Resolve the child portion of a rollup, preferring fresh child artifacts and
 * falling back to whatever the previous rollup recorded.
 *
 * @param previousRollup Existing rollup token, if any.
 * @param childArtifacts Optional fresh child ledgers.
 * @param directEntryIds Direct entry IDs already represented in the rollup.
 * @returns The resolved child entry IDs, refs, tokens, currency, and cost.
 */
function resolveChildRollupParts(
  previousRollup: LisaUsageRollup | null | undefined,
  childArtifacts: readonly LisaUsageChildArtifact[] | undefined,
  directEntryIds: readonly string[]
): {
  childCost: number | null;
  childCurrency: string | null;
  childEntryIds: readonly string[];
  childRefs: readonly string[];
  childTokens: number | null;
  childTokensIncomplete: boolean;
} {
  if (childArtifacts !== undefined) {
    const collected = collectLisaUsageChildArtifacts(
      childArtifacts,
      directEntryIds
    );
    const deduped = collected.childEntries;
    const childCurrency = resolveDirectCostCurrency(deduped);
    const childTokensIncomplete = deduped.some(hasMeasuredSubset);
    const rawChildCost = sumNullableDecimals(deduped.map(entry => entry.cost));
    return {
      childEntryIds: deduped.map(entry => entry.entryId),
      childRefs: collected.childRefs,
      childTokens: childTokensIncomplete
        ? null
        : sumNullable(deduped.map(entry => entry.totalTokens)),
      childTokensIncomplete,
      childCurrency,
      childCost: childCurrency === MIXED_CURRENCY ? null : rawChildCost,
    };
  }

  const rawChildCost = previousRollup?.childCost ?? null;
  const persistedChildCurrency = previousRollup?.childCurrency ?? null;
  const aggregateCurrency =
    previousRollup?.currency === MIXED_CURRENCY
      ? null
      : (previousRollup?.currency ?? null);
  const childCurrency =
    rawChildCost === null
      ? null
      : (persistedChildCurrency ?? aggregateCurrency);
  return {
    childEntryIds: previousRollup?.childEntryIds ?? [],
    childRefs: previousRollup?.childRefs ?? [],
    childTokens: previousRollup?.childTokens ?? null,
    childTokensIncomplete: previousRollup?.childTokensIncomplete ?? false,
    childCurrency,
    childCost: childCurrency === MIXED_CURRENCY ? null : rawChildCost,
  };
}

/**
 * Resolve the combined currency for a rollup, marking it `mixed` when the
 * direct and child sides disagree about the cost currency.
 *
 * @param directCurrency Currency resolved from direct entries.
 * @param childCurrency Currency resolved from descendant entries.
 * @param directCost Direct cost total used to detect cross-side mismatches.
 * @param childCost Child cost total used to detect cross-side mismatches.
 * @returns The unified currency or the mixed sentinel.
 */
function resolveRollupCurrency(
  directCurrency: string | null,
  childCurrency: string | null,
  directCost: number | null,
  childCost: number | null
): string | null {
  const crossSideMismatch =
    directCost !== null &&
    childCost !== null &&
    directCurrency !== childCurrency;
  if (
    directCurrency === MIXED_CURRENCY ||
    childCurrency === MIXED_CURRENCY ||
    crossSideMismatch
  ) {
    return MIXED_CURRENCY;
  }

  return directCurrency ?? childCurrency ?? null;
}

/**
 * Build a default rollup token from direct entries while preserving any prior
 * child-work totals supplied by callers from later lifecycle stages.
 *
 * @param entries Direct usage entries that should appear in the section.
 * @param previousRollup Existing rollup token parsed from the artifact, if any.
 * @param childArtifacts Optional child ledgers to recompute descendant totals from current work.
 * @returns A deterministic rollup token payload for the managed section.
 */
export function createLisaUsageRollup(
  entries: readonly LisaUsageEntry[],
  previousRollup?: LisaUsageRollup | null,
  childArtifacts?: readonly LisaUsageChildArtifact[]
): LisaUsageRollup {
  const directEntryIds = entries.map(entry => entry.entryId);
  const directTokensIncomplete = entries.some(hasMeasuredSubset);
  const directTokens = directTokensIncomplete
    ? null
    : sumNullable(entries.map(entry => entry.totalTokens));
  const directCurrency = resolveDirectCostCurrency(entries);
  const directCost =
    directCurrency === MIXED_CURRENCY
      ? null
      : sumNullableDecimals(entries.map(entry => entry.cost));

  const {
    childEntryIds,
    childRefs,
    childTokens,
    childTokensIncomplete,
    childCurrency,
    childCost,
  } = resolveChildRollupParts(previousRollup, childArtifacts, directEntryIds);

  const totalTokens =
    directTokensIncomplete || childTokensIncomplete
      ? null
      : directTokens === null && childTokens === null
        ? null
        : (directTokens ?? 0) + (childTokens ?? 0);
  const currency = resolveRollupCurrency(
    directCurrency,
    childCurrency,
    directCost,
    childCost
  );
  const totalCost =
    currency === MIXED_CURRENCY || (directCost === null && childCost === null)
      ? null
      : sumNullableDecimals([directCost, childCost]);

  return {
    directEntryIds,
    childEntryIds,
    childRefs,
    directTokens,
    childTokens,
    ...(childTokensIncomplete ? { childTokensIncomplete: true } : {}),
    totalTokens,
    directCost,
    childCost,
    totalCost,
    currency,
    childCurrency,
  };
}

/**
 * Render the machine-readable token for a single direct usage row.
 *
 * @param entry Direct usage entry to serialize.
 * @returns The legacy-readable primary token plus its measured-subset extension.
 */
export function renderLisaUsageEntryToken(entry: LisaUsageEntry): string {
  const primaryToken = `<!-- lisa:usage-entry entry_id=${encodeTokenValue(entry.entryId)} flow=${encodeTokenValue(entry.flow)} run_id=${encodeTokenValue(entry.runId)} provider=${encodeTokenValue(entry.provider)} model=${encodeTokenValue(entry.model)} source=${encodeTokenValue(entry.source)} input_tokens=${renderNullable(entry.inputTokens)} cached_input_tokens=${renderNullable(entry.cachedInputTokens)} output_tokens=${renderNullable(entry.outputTokens)} reasoning_tokens=${renderNullable(entry.reasoningTokens)} total_tokens=${renderNullable(entry.totalTokens)} cost=${renderNullable(entry.cost)} currency=${renderNullable(entry.currency)} pricing_status=${encodeTokenValue(entry.pricingStatus)} pricing_source=${renderNullable(entry.pricingSource)} artifact_ref=${encodeTokenValue(entry.artifactRef)} parent_artifact_ref=${entry.parentArtifactRef === null ? "" : encodeTokenValue(entry.parentArtifactRef)} -->`;
  const measuredSubsetToken = `<!-- lisa:usage-entry-measured-subset entry_id=${encodeTokenValue(entry.entryId)} measured_subset_tokens=${renderNullable(entry.measuredSubsetTokens ?? null)} -->`;
  return `${primaryToken} ${measuredSubsetToken}`;
}

/**
 * Render the machine-readable rollup token for a managed usage section.
 *
 * @param rollup Rollup values to serialize.
 * @returns The canonical `lisa:usage-rollup` token line.
 */
export function renderLisaUsageRollupToken(rollup: LisaUsageRollup): string {
  const primaryToken = `<!-- lisa:usage-rollup direct_entry_ids=${renderCsv(rollup.directEntryIds)} child_entry_ids=${renderCsv(rollup.childEntryIds)} child_refs=${renderCsv(rollup.childRefs)} direct_tokens=${renderNullable(rollup.directTokens)} child_tokens=${renderNullable(rollup.childTokens)} total_tokens=${renderNullable(rollup.totalTokens)} direct_cost=${renderNullable(rollup.directCost)} child_cost=${renderNullable(rollup.childCost)} total_cost=${renderNullable(rollup.totalCost)} currency=${renderNullable(rollup.currency)} child_currency=${renderNullable(rollup.childCurrency)} -->`;
  return rollup.childTokensIncomplete === true
    ? `${primaryToken} <!-- lisa:usage-rollup-token-status child_tokens_incomplete=true -->`
    : primaryToken;
}

/**
 * Render the canonical `## Lisa Usage` section body from direct entries and a
 * rollup token.
 *
 * Entry tokens are rendered on their own lines BELOW the visible table, never
 * trailing a table row. Hosts that normalize markdown re-serialize a table from
 * its parsed cell model and discard anything that is not a cell — measured
 * against Linear on 2026-08-04, an HTML comment trailing a table row is
 * destroyed on write while the same comment on its own line round-trips
 * byte-identically. Trailing the row therefore produced a silently unreadable
 * ledger whose surviving rollup token named entries no reader could resolve.
 * Parsing has always been position-agnostic, so sections written in the old
 * layout still enumerate and migrate to this layout on their next rewrite.
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
  const entryRows =
    entries.length === 0
      ? ["| _No direct entries recorded_ | | | | |"]
      : entries.map(
          entry =>
            `| ${entry.flow} | ${entry.source} | ${entry.provider}/${entry.model} | ${formatEntryTokens(entry)} | ${formatCost(entry.cost, entry.currency)} |`
        );
  const entryTokenLines =
    entries.length === 0 ? [] : [...entries.map(renderLisaUsageEntryToken), ""];
  const lines = [
    LISA_USAGE_HEADING,
    "",
    "_This section is managed by Lisa. Rewrites update matching usage entries in place and preserve older rows._",
    "",
    "| Flow | Source | Model | Tokens | Cost |",
    "| --- | --- | --- | ---: | ---: |",
    ...entryRows,
    "",
    ...entryTokenLines,
    renderLisaUsageRollupToken(rollup),
  ];

  return `${lines.join("\n")}\n`;
}

/**
 * Parse the managed rollup and its optional token-completeness extension.
 *
 * @param section Managed usage section text.
 * @returns The parsed rollup, or null when the section has no rollup token.
 */
function parseLisaUsageRollup(section: string): LisaUsageRollup | null {
  const match = ROLLUP_PATTERN.exec(section);
  if (match === null) {
    return null;
  }

  return {
    directEntryIds: parseCsv(match[1] ?? ""),
    childEntryIds: parseCsv(match[2] ?? ""),
    childRefs: parseCsv(match[3] ?? ""),
    directTokens: parseNullableNumber(match[4] ?? ""),
    childTokens: parseNullableNumber(match[5] ?? ""),
    ...(ROLLUP_TOKEN_STATUS_PATTERN.test(section)
      ? { childTokensIncomplete: true }
      : {}),
    totalTokens: parseNullableNumber(match[6] ?? ""),
    directCost: parseNullableNumber(match[7] ?? ""),
    childCost: parseNullableNumber(match[8] ?? ""),
    totalCost: parseNullableNumber(match[9] ?? ""),
    currency: parseNullableString(match[10] ?? ""),
    childCurrency: parseNullableString(match[11] ?? ""),
  };
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
  const measuredSubsets = new Map(
    Array.from(
      section.matchAll(MEASURED_SUBSET_PATTERN),
      match =>
        [
          decodeTokenValue(match[1] ?? ""),
          parseNullableNumber(match[2] ?? ""),
        ] as const
    )
  );
  const entries = Array.from(
    section.matchAll(ENTRY_TOKEN_PATTERN),
    tokenMatch => {
      const token = tokenMatch[0];
      const releasedMatch = RELEASED_MIDDLE_FIELD_ENTRY_PATTERN.exec(token);
      const match = releasedMatch ?? LEGACY_ENTRY_PATTERN.exec(token);
      if (match === null) {
        throw new Error(`Invalid Lisa usage entry token: ${token}`);
      }

      const releasedFieldOffset = releasedMatch === null ? 0 : 1;
      const entryId = decodeTokenValue(match[1] ?? "");
      const embeddedMeasuredSubset =
        releasedMatch === null
          ? null
          : parseReleasedMeasuredSubset(match[12] ?? "");
      return {
        entryId,
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
        measuredSubsetTokens: measuredSubsets.has(entryId)
          ? (measuredSubsets.get(entryId) ?? null)
          : embeddedMeasuredSubset,
        cost: parseNullableNumber(match[12 + releasedFieldOffset] ?? ""),
        currency: parseNullableString(match[13 + releasedFieldOffset] ?? ""),
        pricingStatus: decodeTokenValue(match[14 + releasedFieldOffset] ?? ""),
        pricingSource: parseNullableString(
          match[15 + releasedFieldOffset] ?? ""
        ),
        artifactRef: decodeTokenValue(match[16 + releasedFieldOffset] ?? ""),
        parentArtifactRef: parseNullableString(
          match[17 + releasedFieldOffset] ?? ""
        ),
      };
    }
  );

  return { entries, rollup: parseLisaUsageRollup(section), range };
}

/**
 * Describe one way a stored managed usage section fails to be a readable ledger.
 */
export interface LisaUsageSectionIntegrityIssue {
  code:
    | "missing-entry-token"
    | "missing-rollup-token"
    | "missing-section"
    | "unrecorded-entry";
  entryIds: readonly string[];
  message: string;
}

/**
 *
 */
export interface LisaUsageSectionIntegrityResult {
  issues: readonly LisaUsageSectionIntegrityIssue[];
  ok: boolean;
}

/**
 * Sort ids so an integrity report is deterministic regardless of document order.
 *
 * @param ids Entry ids to normalize.
 * @returns The ids in stable sorted order.
 */
function sortedIds(ids: Iterable<string>): readonly string[] {
  return [...ids].sort((left, right) =>
    left > right ? 1 : left < right ? -1 : 0
  );
}

/**
 * Emit an issue only when it actually names something, so callers can compose
 * checks by concatenation instead of conditional accumulation.
 *
 * @param code Stable issue code.
 * @param entryIds Entry ids the issue is about.
 * @param message Operator-readable description.
 * @returns A zero- or one-element issue list.
 */
function reportIssue(
  code: LisaUsageSectionIntegrityIssue["code"],
  entryIds: readonly string[],
  message: string
): readonly LisaUsageSectionIntegrityIssue[] {
  return entryIds.length === 0 ? [] : [{ code, entryIds, message }];
}

/**
 * Report entries the caller just wrote that the stored surface cannot produce.
 *
 * @param expectedEntryIds Entry ids the caller believes it persisted.
 * @param parsedEntryIds Entry ids actually parseable from the stored section.
 * @returns Zero or one `missing-entry-token` issue.
 */
function findDroppedExpectedEntries(
  expectedEntryIds: readonly string[],
  parsedEntryIds: ReadonlySet<string>
): readonly LisaUsageSectionIntegrityIssue[] {
  const missing = sortedIds(
    expectedEntryIds.filter(entryId => !parsedEntryIds.has(entryId))
  );
  return reportIssue(
    "missing-entry-token",
    missing,
    `Stored section does not contain a parseable lisa:usage-entry token for: ${missing.join(", ")}. The write surface dropped them.`
  );
}

/**
 * Report rollup references that resolve to no direct entry in the same section.
 *
 * @param rollupEntryIds Entry ids named by the stored rollup token.
 * @param parsedEntryIds Entry ids actually parseable from the stored section.
 * @param alreadyReported Ids already reported as dropped caller expectations.
 * @returns Zero or one `missing-entry-token` issue.
 */
function findUnresolvableRollupReferences(
  rollupEntryIds: readonly string[],
  parsedEntryIds: ReadonlySet<string>,
  alreadyReported: readonly string[]
): readonly LisaUsageSectionIntegrityIssue[] {
  const unresolvable = sortedIds(
    rollupEntryIds.filter(
      entryId =>
        !parsedEntryIds.has(entryId) && !alreadyReported.includes(entryId)
    )
  );
  return reportIssue(
    "missing-entry-token",
    unresolvable,
    `Rollup direct_entry_ids names entries that cannot be parsed from the same section: ${unresolvable.join(", ")}.`
  );
}

/**
 * Report direct entries the stored rollup token fails to account for.
 *
 * @param rollup Stored rollup token, or null when the section carries none.
 * @param parsedEntryIds Entry ids actually parseable from the stored section.
 * @returns Zero or one issue describing the disagreement.
 */
function findRollupCoverageGaps(
  rollup: LisaUsageRollup | null,
  parsedEntryIds: ReadonlySet<string>
): readonly LisaUsageSectionIntegrityIssue[] {
  const entryIds = sortedIds(parsedEntryIds);
  if (rollup === null) {
    // Every section Lisa writes carries a rollup token, even a child-only or
    // fully empty ledger, so a missing token is always corruption -- report
    // it unconditionally rather than routing through reportIssue(), which
    // suppresses issues that name zero entries.
    return [
      {
        code: "missing-rollup-token",
        entryIds,
        message: `Stored section has ${entryIds.length} direct entr${entryIds.length === 1 ? "y" : "ies"} but no lisa:usage-rollup token.`,
      },
    ];
  }

  const recorded = new Set(rollup.directEntryIds);
  const unrecorded = entryIds.filter(entryId => !recorded.has(entryId));
  return reportIssue(
    "unrecorded-entry",
    unrecorded,
    `Stored section contains direct entries absent from rollup direct_entry_ids: ${unrecorded.join(", ")}.`
  );
}

/**
 * Verify that a STORED managed usage section is still a readable ledger.
 *
 * This exists because a write surface can accept a section, report success, and
 * silently destroy part of it. Callers must run this against the bytes read back
 * from the host, never against the payload they sent and never against the
 * mutation's return value — trusting the mutation result is precisely what let a
 * Linear description strip every entry token while reporting `success: true`.
 *
 * @param storedDocument Artifact body or comment body as read back from the host.
 * @param expected Optional expectations from the write that was just performed.
 * @param expected.entryIds Entry ids the caller believes it just persisted.
 * @returns Whether the stored ledger is enumerable, plus every issue found.
 */
export function verifyLisaUsageSectionIntegrity(
  storedDocument: string,
  expected?: { entryIds?: readonly string[] }
): LisaUsageSectionIntegrityResult {
  const parsed = parseLisaUsageSection(storedDocument);
  const expectedEntryIds = expected?.entryIds ?? [];

  if (parsed.range === null) {
    const missing = sortedIds(expectedEntryIds);
    const issues = reportIssue(
      "missing-section",
      missing,
      `Stored artifact has no ${LISA_USAGE_HEADING} section, but ${missing.length} usage entr${missing.length === 1 ? "y was" : "ies were"} written to it.`
    );
    return { ok: issues.length === 0, issues };
  }

  const parsedEntryIds = new Set(parsed.entries.map(entry => entry.entryId));
  const droppedExpected = findDroppedExpectedEntries(
    expectedEntryIds,
    parsedEntryIds
  );
  const issues = [
    ...droppedExpected,
    ...findUnresolvableRollupReferences(
      parsed.rollup?.directEntryIds ?? [],
      parsedEntryIds,
      droppedExpected.flatMap(issue => issue.entryIds)
    ),
    ...findRollupCoverageGaps(parsed.rollup, parsedEntryIds),
  ];

  return { ok: issues.length === 0, issues };
}

/**
 * Append or replace the canonical `## Lisa Usage` section in a markdown
 * artifact while preserving prior entries that are not being refreshed.
 *
 * @param document Existing artifact markdown or comment body.
 * @param input New usage content to merge into the managed section.
 * @param input.childArtifacts Optional child ledgers to recompute descendant totals from current work.
 * @param input.entries Newly observed direct usage entries.
 * @param input.rollup Optional explicit rollup payload to serialize.
 * @returns The updated artifact markdown with exactly one managed usage block.
 */
export function upsertLisaUsageSection(
  document: string,
  input: {
    childArtifacts?: readonly LisaUsageChildArtifact[];
    entries: readonly LisaUsageEntry[];
    rollup?: LisaUsageRollup | null;
  }
): string {
  const parsed = parseLisaUsageSection(document);
  const mergedEntries = mergeLisaUsageEntries(parsed.entries, input.entries);
  const previousRollup =
    input.childArtifacts === undefined &&
    input.rollup !== null &&
    input.rollup !== undefined &&
    input.rollup.childTokensIncomplete === undefined &&
    parsed.rollup?.childTokensIncomplete === true
      ? { ...input.rollup, childTokensIncomplete: true }
      : (input.rollup ?? parsed.rollup);
  const rollup =
    mergedEntries.length === 0 && input.rollup
      ? (previousRollup ?? input.rollup)
      : createLisaUsageRollup(
          mergedEntries,
          previousRollup,
          input.childArtifacts
        );
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

/* eslint-enable max-lines -- End usage accounting public utility surface. */
