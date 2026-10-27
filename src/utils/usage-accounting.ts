import {
  LISA_USAGE_HEADING,
  parseLisaUsageSection,
} from "../../all/copy-overwrite/scripts/lib/usage-ledger.mjs";
import { verifyLisaUsageSectionIntegrity } from "../../all/copy-overwrite/scripts/lib/usage-ledger-integrity.mjs";
import type {
  LisaUsageEntry,
  LisaUsageRollup,
  LisaUsageChildArtifact,
  ParsedLisaUsageSection,
  LisaUsageSectionIntegrityIssue,
  LisaUsageSectionIntegrityResult,
} from "../../all/copy-overwrite/scripts/lib/usage-ledger.mjs";
export {
  LISA_USAGE_HEADING,
  parseLisaUsageSection,
  verifyLisaUsageSectionIntegrity,
};
export type {
  LisaUsageEntry,
  LisaUsageRollup,
  LisaUsageChildArtifact,
  ParsedLisaUsageSection,
  LisaUsageSectionIntegrityIssue,
  LisaUsageSectionIntegrityResult,
};
/* eslint-disable max-lines -- Usage ledger parsing, rendering, and rollup helpers share one public utility surface. */

import { collectLisaUsageChildArtifacts } from "./usage-accounting-rollup.js";
import { sumNullableDecimals } from "./decimal-sum.js";
import { renderEffectivenessToken } from "./effectiveness.js";

const MIXED_CURRENCY = "mixed";

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
  const mergedExisting = existingEntries.map(entry => {
    const next = incoming.get(entry.entryId);
    return next === undefined
      ? entry
      : {
          ...next,
          ...(next.effectiveness === undefined &&
          entry.effectiveness !== undefined
            ? { effectiveness: entry.effectiveness }
            : {}),
        };
  });
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
  return `${primaryToken} ${measuredSubsetToken}${renderEffectivenessToken(entry.entryId, entry.effectiveness)}`;
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
