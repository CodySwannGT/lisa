import { parseEffectivenessTokens } from "./usage-effectiveness.mjs";
export const LISA_USAGE_HEADING = "## Lisa Usage";
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
/**
 * Parse a nullable numeric token field.
 *
 * @param value Serialized numeric token value.
 * @returns The parsed number or null when the token is empty.
 */
function parseNullableNumber(value) {
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
function parseReleasedMeasuredSubset(value) {
  return value === "undefined" ? null : parseNullableNumber(value);
}
/**
 * Parse a nullable string token field.
 *
 * @param value Serialized string token value.
 * @returns The parsed string or null when the token is empty.
 */
function parseNullableString(value) {
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
function decodeTokenValue(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
/**
 * Parse a comma-separated token field into stable document order.
 *
 * @param value Serialized CSV token field.
 * @returns The parsed item list.
 */
function parseCsv(value) {
  if (value.length === 0) {
    return [];
  }
  return value.split(",").map(decodeTokenValue);
}
/**
 * Locate the current managed usage-section boundaries inside an artifact body.
 *
 * @param document Artifact markdown to inspect.
 * @returns The start/end character offsets for the section, if present.
 */
function findUsageSectionRange(document) {
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
 * Parse the managed rollup and its optional token-completeness extension.
 *
 * @param section Managed usage section text.
 * @returns The parsed rollup, or null when the section has no rollup token.
 */
function parseLisaUsageRollup(section) {
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
export function parseLisaUsageSection(document) {
  const range = findUsageSectionRange(document);
  const section = range ? document.slice(range.start, range.end) : "";
  const effectiveness = parseEffectivenessTokens(section);
  const measuredSubsets = new Map(
    Array.from(section.matchAll(MEASURED_SUBSET_PATTERN), match => [
      decodeTokenValue(match[1] ?? ""),
      parseNullableNumber(match[2] ?? ""),
    ])
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
        ...(effectiveness.has(entryId)
          ? { effectiveness: effectiveness.get(entryId) }
          : {}),
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
  const entryIds = new Set(entries.map(entry => entry.entryId));
  for (const entryId of effectiveness.keys()) {
    if (!entryIds.has(entryId)) {
      throw new Error(
        `Effectiveness observation has no usage entry: ${entryId}`
      );
    }
  }
  return { entries, rollup: parseLisaUsageRollup(section), range };
}
