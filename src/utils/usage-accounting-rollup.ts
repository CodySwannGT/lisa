import type {
  LisaUsageChildArtifact,
  LisaUsageEntry,
} from "./usage-accounting.js";

/**
 * Append a unique string to a stable-order list.
 *
 * @param items Existing ordered values.
 * @param value Candidate value.
 * @returns The original list when present/empty, otherwise a new list.
 */
function appendUniqueString(
  items: readonly string[],
  value: string
): readonly string[] {
  if (value.length === 0 || items.includes(value)) {
    return items;
  }

  return [...items, value];
}

/**
 * Append a child usage entry when it is not already represented directly or by
 * another descendant path.
 *
 * @param entries Existing ordered descendant entries.
 * @param entry Candidate child usage entry.
 * @param directEntryIds Direct entry ids that must never be counted as child totals.
 * @returns The original list when the entry is already represented, otherwise a new list.
 */
function appendUniqueChildEntry(
  entries: readonly LisaUsageEntry[],
  entry: LisaUsageEntry,
  directEntryIds: readonly string[]
): readonly LisaUsageEntry[] {
  if (
    directEntryIds.includes(entry.entryId) ||
    entries.some(existing => existing.entryId === entry.entryId)
  ) {
    return entries;
  }

  return [...entries, entry];
}

/**
 * Collect descendant usage entries and consulted child refs in deterministic order.
 *
 * @param childArtifacts Child artifacts consulted for the rollup.
 * @param directEntryIds Direct entry ids already attached to the target artifact.
 * @returns Dedupe descendant entries plus the unique child refs consulted.
 */
export function collectLisaUsageChildArtifacts(
  childArtifacts: readonly LisaUsageChildArtifact[],
  directEntryIds: readonly string[]
): {
  childEntries: readonly LisaUsageEntry[];
  childRefs: readonly string[];
} {
  return childArtifacts.reduce(
    (state, childArtifact) => ({
      childEntries: childArtifact.entries.reduce(
        (entries, entry) =>
          appendUniqueChildEntry(entries, entry, directEntryIds),
        state.childEntries
      ),
      childRefs: appendUniqueString(state.childRefs, childArtifact.artifactRef),
    }),
    {
      childEntries: [] as readonly LisaUsageEntry[],
      childRefs: [] as readonly string[],
    }
  );
}
