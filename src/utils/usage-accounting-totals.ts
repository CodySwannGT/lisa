/**
 * @file usage-accounting-totals.ts
 * @description Rollup arithmetic for the managed `## Lisa Usage` ledger: sums
 * direct and descendant tokens and costs, and resolves the currency they are
 * reported in. Rendering and parsing stay in `usage-accounting.ts`, which
 * re-exports {@link createLisaUsageRollup} as part of its public surface.
 * @module utils
 */
import type {
  LisaUsageChildArtifact,
  LisaUsageEntry,
  LisaUsageRollup,
} from "../../all/copy-overwrite/scripts/lib/usage-ledger.mjs";
import { sumNullableDecimals } from "./decimal-sum.js";
import { collectLisaUsageChildArtifacts } from "./usage-accounting-rollup.js";

const MIXED_CURRENCY = "mixed";

/**
 * Sum nullable numeric values while preserving null when nothing was recorded.
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
 * Resolve the child portion of a rollup, preferring fresh child artifacts and
 * falling back to whatever the previous rollup recorded.
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
