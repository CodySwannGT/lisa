/**
 * Reference survival across supersede-in-place consolidation.
 *
 * ## The problem
 *
 * `persistConsolidatedLearning(..., { supersede: [ids] })` removes the
 * superseded entries and adds a new one under the caller's own id — the
 * learner's content fingerprint. So every consolidation churns the id, and
 * anything that had cited the old id (a tracker comment, a gardener ticket, a
 * cross-link from another learning) silently points at an entry that no longer
 * exists (CodySwannGT/lisa#1997).
 *
 * ## Why an alias map and NOT "carry the earliest superseded id forward"
 *
 * The issue offered both. Carry-forward was implemented first and had to be
 * abandoned, because the churning fingerprint id is doing a second job nobody
 * wrote down: it is an accidental **compare-and-swap token**.
 *
 * Two learner passes racing to consolidate the same entry `base` each hold a
 * stale snapshot. Today the first writer removes `base` and lands under `a`; the
 * second finds `base` already gone, is tolerated rather than fatal (#1995), and
 * lands under `b`. Both learnings survive — "at worst two entries where one
 * consolidation was intended," exactly the cost the writer documents.
 *
 * Carry the id forward and that protection evaporates: the first writer lands
 * under `base`, so the second writer's stale "supersede base" now MATCHES,
 * removes the first writer's entry, and overwrites it. `learnings-supersede-race`
 * proves the damage — nine writers consolidating one target went from nine
 * preserved learnings to **one**, destroying eight. That is the #1995 data-loss
 * symptom re-opened, which the brief explicitly forbids.
 *
 * The fix is undecidable from the seven fields alone: a stale "supersede base"
 * and a legitimate chained "supersede base" are the same bytes. Telling them
 * apart needs a real version token — the fingerprint retained as an eighth,
 * disambiguating field, per the issue's parenthetical. That is a persisted-schema
 * change: a contract version bump propagated through every reader, the merge
 * driver, the CI budget gate, and all six plugin skill projections. It is the
 * principled long-term answer and it deserves its own change.
 *
 * So this takes the issue's second option. Ids keep churning — the CAS token,
 * the #1995 guarantee, and the fingerprint-is-the-id dedupe model are all left
 * exactly as they are — and references survive because the consolidated entry
 * *records what it replaced*.
 *
 * ## Where the map lives
 *
 * In the entry's own `provenance`, as `supersedes:<old id>` references. No new
 * field, no new file, no new format: provenance is already a validated,
 * rendered, merged, budget-counted list of stable references, and "this entry
 * replaced that one" is precisely a provenance claim.
 *
 * Resolution is ONE HOP, never transitive. When an entry is consolidated, the
 * writer copies the removed entries' own alias references forward, so a lineage
 * `base → a → b` leaves `b` carrying both `supersedes:a` and `supersedes:base`.
 * There is no chain for a reader to walk and therefore no cycle or depth limit
 * to get wrong.
 *
 * An alias is recorded ONLY for a target that was actually present and removed.
 * A supersede naming an already-consolidated id removed nothing, so claiming its
 * reference would hijack a pointer that the earlier writer legitimately owns —
 * in the nine-writer race, only the one writer that truly removed `base` claims
 * `base`, and the reference stays unambiguous.
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
