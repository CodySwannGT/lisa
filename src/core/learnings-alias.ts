/**
 * Reference survival across stamped supersede-in-place consolidation.
 *
 * ## The problem
 *
 * Learning ids are stable public references, while fingerprints are immutable
 * content-version tokens. An exact stamped consolidation keeps the
 * deterministic primary target id, but a multi-target consolidation removes
 * the other live ids. Anything that cited one of those secondary ids (a
 * tracker comment, a gardener ticket, or a cross-link from another learning)
 * would otherwise point at an entry that no longer exists
 * (CodySwannGT/lisa#1997).
 *
 * ## Why aliases still matter after stable-id carry-forward
 *
 * The persisted v2 fingerprint is the compare-and-swap token that makes stable
 * ids safe. Two learner passes racing from the same `{ id, fingerprint }`
 * snapshot cannot overwrite one another: the first exact writer carries the id
 * forward, the second sees a fingerprint mismatch and appends without removing
 * the winner (#1995). A legitimate chained writer holding the winner's current
 * fingerprint can replace it in place.
 *
 * Stable carry-forward preserves the deterministic primary id. Aliases preserve
 * every other exact target and inherited ancestor in a multi-entry
 * consolidation. They are therefore a reference-history layer, never a stale
 * write workaround and never a substitute for stamped compare-and-swap.
 *
 * ## Where the map lives
 *
 * In the entry's own `provenance`, as `supersedes:<old id>` references. No
 * additional schema field or sidecar is required: provenance is already a
 * validated, rendered, merged, budget-counted list of stable references, and
 * "this entry replaced that one" is precisely a provenance claim.
 *
 * Resolution is ONE HOP, never transitive. When an entry is consolidated, the
 * writer copies the removed entries' own alias references forward, so a lineage
 * `base → a → b` leaves `b` carrying both `supersedes:a` and `supersedes:base`.
 * There is no chain for a reader to walk and therefore no cycle or depth limit
 * to get wrong.
 *
 * An alias is recorded ONLY for a target whose exact stamp was present and
 * removed. A stale all-or-nothing plan removes nothing and records no alias, so
 * it cannot hijack a reference that the winning writer legitimately owns.
 * @module core/learnings-alias
 */
import {
  LEARNINGS_CONTRACT,
  type LearningEntry,
} from "./learnings-contract.js";

/** Prefix marking a provenance reference as a superseded-id alias. */
export const SUPERSEDES_PREFIX = "supersedes:";

/**
 * Build the provenance reference recording that an entry replaced another.
 * @param id - Id of the entry that was removed
 * @returns Canonical alias reference
 */
export function buildSupersedesReference(id: string): string {
  return `${SUPERSEDES_PREFIX}${id}`;
}

/**
 * Reject a caller trying to mint its own `supersedes:` reference.
 *
 * The prefix is WRITER-OWNED. An alias is a factual claim that this write
 * removed that entry, and the writer is the only party that knows whether it
 * did — so a hand-written `supersedes:<id>` would let any caller capture a
 * reference to an entry it never touched, silently redirecting an old id at
 * content of its choosing.
 *
 * This lives at the writer's entry point rather than inside
 * `validateLearningEntry` on purpose: that validator also runs on every entry
 * parsed back off disk and on every side of a merge, where writer-added
 * `supersedes:` references are legitimate and must be accepted. Rejecting there
 * would make the contract unable to read its own output.
 * @param entry - Validated entry exactly as the caller composed it
 * @returns The rejection to throw, or undefined when the provenance is clean
 */
export function findCallerMintedAliasError(
  entry: LearningEntry
): Error | undefined {
  const minted = entry.provenance.filter(reference =>
    reference.startsWith(SUPERSEDES_PREFIX)
  );
  return minted.length === 0
    ? undefined
    : new Error(
        `Invalid provenance: '${SUPERSEDES_PREFIX}' references are added by the writer, not the caller (found ${minted.join(", ")})`
      );
}

/**
 * Read the ids one entry declares it superseded.
 * @param entry - Validated learning entry
 * @returns Superseded ids, in the order they were recorded
 */
export function readSupersededIds(entry: LearningEntry): readonly string[] {
  return entry.provenance
    .filter(reference => reference.startsWith(SUPERSEDES_PREFIX))
    .map(reference => reference.slice(SUPERSEDES_PREFIX.length))
    .filter(id => id !== "");
}

/**
 * Compose the alias references a consolidated entry must carry.
 *
 * Ordering is oldest-lineage-first: the ids inherited from the removed entries
 * come before the removed entries' own ids, so the reference that has existed
 * longest sits earliest and survives longest under the cap below.
 *
 * An entry that supersedes its OWN id is editing itself in place, not renaming
 * itself — the reference never broke, so it earns no alias. Its inherited
 * lineage is still carried forward, because an in-place edit must not drop the
 * ancestors that already resolve through it.
 * @param removed - Entries this write actually removed from the document
 * @param selfId - Id of the entry being written
 * @returns Deduplicated alias references in lineage order
 */
function composeAliasReferences(
  removed: readonly LearningEntry[],
  selfId: string
): readonly string[] {
  const inherited = removed.flatMap(entry => readSupersededIds(entry));
  const direct = removed.map(entry => entry.id);
  return [...new Set([...inherited, ...direct])]
    .filter(id => id !== selfId)
    .map(buildSupersedesReference);
}

/** Result of folding alias references into a consolidated entry. */
export interface AliasedLearningEntry {
  /** Entry provenance with as many alias references as the contract allows. */
  readonly provenance: readonly string[];
  /**
   * Alias references that did not fit and were dropped. Never silent: the
   * writer reports these so a reference that is about to stop resolving is
   * visible instead of quietly disappearing.
   */
  readonly dropped: readonly string[];
}

/**
 * Fold alias references into a caller's provenance within the contract cap.
 *
 * Caller-supplied provenance is NEVER sacrificed for an alias. It is the
 * evidence the learning rests on — the tracker links and commits that justify
 * the rule existing at all — while an alias is a convenience for finding the
 * entry by a name it used to have. Evicting evidence to store a convenience
 * would quietly delete the reason a learning is believed.
 *
 * When the two together exceed `maxProvenanceReferences`, the NEWEST aliases
 * drop first, so the oldest surviving reference is kept longest. An alias gets
 * MORE valuable as it ages, not less: an id that churned in this very pull
 * request is still discoverable from the branch, the commit, and the capture
 * report, whereas a months-old tracker comment citing an old id has no other
 * way home — and silently breaking exactly those references is what
 * CodySwannGT/lisa#1997 exists to fix. (An earlier revision dropped oldest-first
 * on the theory that ancient references were probably already closed out; that
 * has it backwards. A closed ticket citing an id is precisely where someone
 * searching history lands.)
 * @param entry - New entry as the caller composed it
 * @param removed - Entries this write actually removed from the document
 * @returns Merged provenance plus any alias references that did not fit
 */
export function applySupersedeAliases(
  entry: LearningEntry,
  removed: readonly LearningEntry[]
): AliasedLearningEntry {
  const provenance = entry.provenance;
  const existing = new Set(provenance);
  const aliases = composeAliasReferences(removed, entry.id).filter(
    reference => !existing.has(reference)
  );
  const room = Math.max(
    0,
    LEARNINGS_CONTRACT.maxProvenanceReferences - provenance.length
  );
  return {
    provenance: [...provenance, ...aliases.slice(0, room)],
    dropped: aliases.slice(room),
  };
}

/**
 * Resolve every entry an id could refer to, live id first.
 *
 * A live id always wins: if an entry still carries the id, that entry IS the
 * reference and no alias can shadow it.
 *
 * More than one entry can claim the same alias in exactly one situation — the
 * union merge driver joined two branches that had each removed the same target
 * — so this returns all claimants in deterministic id order rather than
 * pretending the ambiguity away. {@link resolveLearningReference} takes the
 * first for callers that just need a pointer.
 * @param entries - Validated entries from the document
 * @param id - Possibly-superseded id to resolve
 * @returns Matching entries, deterministically ordered
 */
export function resolveLearningReferences(
  entries: readonly LearningEntry[],
  id: string
): readonly LearningEntry[] {
  const live = entries.find(entry => entry.id === id);
  if (live !== undefined) {
    return [live];
  }
  const alias = buildSupersedesReference(id);
  return entries
    .filter(entry => entry.provenance.includes(alias))
    .sort((left, right) => (left.id < right.id ? -1 : 1));
}

/**
 * Resolve one id to the entry that now carries its content.
 * @param entries - Validated entries from the document
 * @param id - Possibly-superseded id to resolve
 * @returns The entry the reference now points at, when one exists
 */
export function resolveLearningReference(
  entries: readonly LearningEntry[],
  id: string
): LearningEntry | undefined {
  return resolveLearningReferences(entries, id)[0];
}
