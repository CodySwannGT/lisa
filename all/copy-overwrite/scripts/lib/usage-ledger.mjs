// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

import { parseEffectivenessTokens } from "./usage-effectiveness.mjs";
export const LISA_USAGE_HEADING = "## Lisa Usage";
const ENTRY_TOKEN_PATTERN = /<!-- lisa:usage-entry [^\r\n]*? -->/g;
const LEGACY_ENTRY_PATTERN =
  /^<!-- lisa:usage-entry entry_id=(\S+) flow=(\S+) run_id=(\S*) provider=(\S+) model=(\S+) source=(\S+) input_tokens=(\S+) cached_input_tokens=(\S+) output_tokens=(\S+) reasoning_tokens=(\S+) total_tokens=(\S+) cost=(\S+) currency=(\S+) pricing_status=(\S+) pricing_source=(\S+) artifact_ref=(\S+) parent_artifact_ref=(\S*) -->$/;
const RELEASED_MIDDLE_FIELD_ENTRY_PATTERN =
  /^<!-- lisa:usage-entry entry_id=(\S+) flow=(\S+) run_id=(\S*) provider=(\S+) model=(\S+) source=(\S+) input_tokens=(\S+) cached_input_tokens=(\S+) output_tokens=(\S+) reasoning_tokens=(\S+) total_tokens=(\S+) measured_subset_tokens=(\S+) cost=(\S+) currency=(\S+) pricing_status=(\S+) pricing_source=(\S+) artifact_ref=(\S+) parent_artifact_ref=(\S*) -->$/;
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
  const windowEnd =
    nextHeadingOffset === -1
      ? document.length
      : afterHeading + nextHeadingOffset;
  const window = document.slice(afterHeading, windowEnd);
  return { start, end: afterHeading + findManagedBlockLength(window) };
}
const ROLLUP_LINE_START_PATTERN = /^[ \t]*<!-- lisa:usage-rollup\s/m;
const MANAGED_NOTE_PREFIX = "_This section is managed by Lisa";
/**
 * Measure how much of the heading-bounded window Lisa's rendered block owns.
 *
 * The next `##` heading alone is not the block's end: anything a host or a
 * person appended after the block without a heading (an Evidence `<details>`
 * block, a paragraph) would otherwise be owned by the section and deleted on
 * every upsert (#4697). Lisa always renders the rollup token last, on a line of
 * its own, so a window holding a line that starts with one ends at that line (a
 * rollup token quoted inline in prose is not a line start and is ignored). No
 * writer emits tokens after the rollup, but the block is extended through any
 * `lisa:usage` token lines (and blank lines) that follow it so a hand-edited or
 * externally repaired section keeps those tokens parsed. Table rows after the
 * rollup are never absorbed, so a person's own table survives. A legacy or
 * damaged section with no rollup token ends after its last usage-token line
 * (see {@link findLastTokenLineEnd}). Neither reading needs a stored-document
 * migration.
 *
 * @param window Text between the `## Lisa Usage` heading line and the next
 *   `##` heading (or the end of the document).
 * @returns The managed block's length in characters from the window start.
 */
function findManagedBlockLength(window) {
  const rollup = ROLLUP_LINE_START_PATTERN.exec(window);
  if (rollup === null) {
    return (
      findLastTokenLineEnd(window) ??
      measureLineRun(window, 0, isManagedShapedLine)
    );
  }
  const lineEnd = window.indexOf("\n", rollup.index);
  if (lineEnd === -1) {
    return window.length;
  }
  return measureLineRun(window, lineEnd + 1, isUsageTokenOrBlankLine);
}
/**
 * Measure the contiguous run of lines, starting at a line boundary, that all
 * satisfy a predicate.
 *
 * @param window Heading-bounded section window.
 * @param from Offset of the first line to test; must start a line.
 * @param belongs Predicate deciding whether a line is part of the block.
 * @returns The offset just past the run (the window length when it reaches
 *   the end of the window).
 */
function measureLineRun(window, from, belongs) {
  const lines = window.slice(from).split("\n");
  const firstForeign = lines.findIndex(line => !belongs(line));
  if (firstForeign === -1) {
    return window.length;
  }
  return lines
    .slice(0, firstForeign)
    .reduce((offset, line) => offset + line.length + 1, from);
}
/**
 * Find the end of the last line in a rollup-less window that carries a usage
 * token. Legacy layouts put free-form lines (a `### Direct Usage` sub-heading,
 * an older managed note) between the heading and their tokens, so a run of
 * managed-shaped lines would stop before the tokens and drop their entries;
 * the last token line is the one boundary every such layout shares.
 *
 * @param window Heading-bounded section window without a rollup token.
 * @returns The offset just past the last token line, or null when the window
 *   has no token line at all.
 */
function findLastTokenLineEnd(window) {
  const lines = window.split("\n");
  const lastTokenLine = lines.findLastIndex(isTokenCarryingLine);
  if (lastTokenLine === -1) {
    return null;
  }
  const end = lines
    .slice(0, lastTokenLine + 1)
    .reduce((offset, line) => offset + line.length + 1, 0);
  return Math.min(end, window.length);
}
/**
 * Decide whether a line carries a usage token: a token line of its own, or a
 * legacy table row with an entry token trailing its cells.
 *
 * @param line One line of the section window, without its newline.
 * @returns True for usage-token lines and token-carrying table rows.
 */
function isTokenCarryingLine(line) {
  const trimmed = line.trim();
  return (
    trimmed.startsWith("<!-- lisa:usage") ||
    (trimmed.startsWith("|") && trimmed.includes("<!-- lisa:usage-entry"))
  );
}
/**
 * Decide whether a line is blank or carries a `lisa:usage` token.
 *
 * @param line One line of the section window, without its newline.
 * @returns True for blank and usage-token lines.
 */
function isUsageTokenOrBlankLine(line) {
  const trimmed = line.trim();
  return trimmed.length === 0 || trimmed.startsWith("<!-- lisa:usage");
}
/**
 * Decide whether a line could have been written by Lisa's section renderer.
 *
 * @param line One line of the section window, without its newline.
 * @returns True for blank, table-row, usage-token, and managed-note lines.
 */
function isManagedShapedLine(line) {
  const trimmed = line.trim();
  return (
    isUsageTokenOrBlankLine(line) ||
    trimmed.startsWith("|") ||
    trimmed.startsWith(MANAGED_NOTE_PREFIX)
  );
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
