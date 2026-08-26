/**
 * Three-way union-by-id merge for the canonical project-learnings ledger.
 *
 * ## Why this exists
 *
 * The fs-level write lock (`learnings-lock.ts`) serializes writers that share a
 * filesystem path, but every learner pass runs on its own
 * `learning/<fingerprint>` branch in its own worktree. A path-scoped lock
 * provably cannot serialize two worktrees, so N concurrent passes produce N
 * pull requests that each rewrite the same JSONL block, and the collision
 * surfaces at merge time as literal git conflict markers
 * (CodySwannGT/lisa#1995). Git's default line-based merge is the wrong tool for
 * a document whose real unit is an entry keyed by id.
 *
 * ## Why three-way and not a union of the two sides
 *
 * A two-way union cannot tell "the other branch never had this entry" apart
 * from "the other branch deliberately superseded this entry". The writer's
 * whole consolidation mechanism (`persistConsolidatedLearning`'s `supersede`)
 * works by REMOVING entries, so a two-way union would resurrect every
 * consolidated entry and silently undo the consolidation — the exact
 * "lost consolidation target" symptom reported in the issue. Comparing each
 * side against the merge base is what lets a removal survive the merge.
 *
 * ## Conflict policy
 *
 * Per id, against the base: if only one side changed it, that side wins
 * (including a removal). If both sides made the SAME change, it is not a
 * conflict. If both sides changed it differently, the merge FAILS rather than
 * guessing — with two information-preserving exceptions. First, two distinct
 * fingerprint successors of the same base stamp are a concurrent stable-id
 * fork: both survive deterministically, with the lower fingerprint retaining
 * the stable id and the other keyed by its fingerprint. Second, when the only
 * differing field is `last_confirmed`, the later date wins, because that field is a monotonic
 * "this rule demonstrably applied again" stamp and taking the later one loses
 * no information. A confirmation bump never beats a content edit; that is a
 * genuine conflict, because preferring the later timestamp would silently
 * discard the other branch's rewritten rule.
 *
 * The merged document is re-rendered through the canonical serializer and
 * re-checked against the shared budgets, so the driver can never publish a
 * malformed or over-budget ledger — it fails loudly and lets git leave the
 * conflict for a human or agent to recompact.
 * @module core/learnings-merge
 */
import {
  LEARNINGS_CONTRACT,
  type LearningEntry,
} from "./learnings-contract.js";
import {
  assertDocumentBudget,
  parseLearningsFile,
  renderLearningsFile,
} from "./learnings-document.js";
import { validateLearningEntry } from "./learnings-entry.js";

/** A clean union that satisfies every budget. */
export interface LearningsMergeMerged {
  readonly kind: "merged";
  /** Canonical merged document, ready to publish. */
  readonly content: string;
}

/** The merge cannot be completed without losing information. */
export interface LearningsMergeConflict {
  readonly kind: "conflict";
  /** Single-line, operator-facing explanation. */
  readonly reason: string;
}

/** Closed outcome of one ledger merge. */
export type LearningsMergeResult =
  | LearningsMergeMerged
  | LearningsMergeConflict;

/**
 * Merge two divergent ledger versions against their common ancestor.
 * @param base - Merge-base document, or undefined when the file is new on both sides
 * @param ours - Current-branch document
 * @param theirs - Incoming-branch document
 * @returns Canonical merged document, or a conflict with a reason
 */
export function mergeLearningsDocuments(
  base: string | undefined,
  ours: string,
  theirs: string
): LearningsMergeResult {
  try {
    const baseEntries = parseSide(base);
    const ourEntries = parseSide(ours);
    const theirEntries = parseSide(theirs);
    const resolved = resolveAllIds(baseEntries, ourEntries, theirEntries);
    if (resolved.kind === "conflict") {
      return resolved;
    }
    return renderWithinBudget(resolved.entries);
  } catch (error) {
    return {
      kind: "conflict",
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Parse one side into an id-keyed map, treating an absent side as empty.
 *
 * Parsing (rather than diffing raw lines) is what makes the driver safe: a side
 * carrying conflict markers, a broken fence, or an invalid entry throws here and
 * becomes a conflict instead of being silently half-merged.
 * @param content - Document for one merge side
 * @returns Entries keyed by id
 */
function parseSide(
  content: string | undefined
): ReadonlyMap<string, LearningEntry> {
  if (content === undefined || content === "") {
    return new Map();
  }
  return new Map(parseLearningsFile(content).map(entry => [entry.id, entry]));
}

/**
 * Resolve every id seen on any side into the merged entry set.
 * @param base - Merge-base entries
 * @param ours - Current-branch entries
 * @param theirs - Incoming-branch entries
 * @returns Merged entries, or the first conflicting id
 */
function resolveAllIds(
  base: ReadonlyMap<string, LearningEntry>,
  ours: ReadonlyMap<string, LearningEntry>,
  theirs: ReadonlyMap<string, LearningEntry>
):
  | { readonly kind: "entries"; readonly entries: readonly LearningEntry[] }
  | LearningsMergeConflict {
  const ids = [...new Set([...base.keys(), ...ours.keys(), ...theirs.keys()])];
  const resolutions = ids.map(id =>
    resolveOneId(base.get(id), ours.get(id), theirs.get(id))
  );
  const conflicted = resolutions.find(resolution => resolution === "conflict");
  if (conflicted !== undefined) {
    const conflictingIds = ids.filter(
      (_unused, index) => resolutions[index] === "conflict"
    );
    return {
      kind: "conflict",
      reason: `Both branches changed learning ${conflictingIds.map(id => `'${id}'`).join(", ")} differently; recompact by hand to keep the intended content`,
    };
  }
  const unsortedEntries = resolutions.flatMap(resolution =>
    resolution === "absent" || resolution === "conflict"
      ? []
      : Array.isArray(resolution)
        ? resolution
        : [resolution]
  );
  const entries = sortLearningEntries(unsortedEntries);
  const duplicateId = findDuplicate(entries.map(entry => entry.id));
  if (duplicateId !== undefined) {
    return {
      kind: "conflict",
      reason: `Concurrent learning fork would collide with live id '${duplicateId}'; recompact by hand to preserve both entries`,
    };
  }
  const duplicateFingerprint = findDuplicate(
    entries.map(entry => entry.fingerprint)
  );
  if (duplicateFingerprint !== undefined) {
    return {
      kind: "conflict",
      reason: `Merged project learnings contain duplicate fingerprint '${duplicateFingerprint}'; recompact by hand rather than guessing which identical capture wins`,
    };
  }
  return { kind: "entries", entries };
}

/**
 * Resolve one id with standard three-way semantics.
 * @param base - Ancestor version, if any
 * @param base - Common ancestor version, if any
 * @param ours - Current-branch version, if any
 * @param theirs - Incoming-branch version, if any
 * @returns The winning entry, `absent` when both sides removed it, or `conflict`
 */
function resolveOneId(
  base: LearningEntry | undefined,
  ours: LearningEntry | undefined,
  theirs: LearningEntry | undefined
): LearningEntry | readonly LearningEntry[] | "absent" | "conflict" {
  if (sameEntry(ours, theirs)) {
    return ours ?? "absent";
  }
  // Exactly one side diverged from the ancestor: that side's intent wins,
  // whether it was an edit, an addition, or a supersede-driven removal.
  if (sameEntry(base, ours)) {
    return theirs ?? "absent";
  }
  if (sameEntry(base, theirs)) {
    return ours ?? "absent";
  }
  return resolveDivergentEdit(base, ours, theirs);
}

/**
 * Resolve the one divergence that is safe to auto-merge: both branches only
 * re-confirmed the same entry, so the later monotonic stamp wins.
 * @param base - Common ancestor version, if any
 * @param ours - Current-branch version, if any
 * @param theirs - Incoming-branch version, if any
 * @returns The later-confirmed entry, or `conflict`
 */
function resolveDivergentEdit(
  base: LearningEntry | undefined,
  ours: LearningEntry | undefined,
  theirs: LearningEntry | undefined
): LearningEntry | readonly LearningEntry[] | "conflict" {
  if (ours === undefined || theirs === undefined) {
    // One side edited the entry while the other superseded it. Dropping the
    // edit or resurrecting the removal are both information loss.
    return "conflict";
  }
  const fork = forkConcurrentStableRewrite(base, ours, theirs);
  if (fork !== undefined) {
    return fork;
  }
  // Neutralize only `last_confirmed`: if the entries match once that field is
  // aligned, it was the sole difference and taking the later stamp loses nothing.
  return sameEntry({ ...ours, last_confirmed: theirs.last_confirmed }, theirs)
    ? pickLaterConfirmation(ours, theirs)
    : "conflict";
}

/**
 * Preserve both successors when two branches legitimately rewrote the same
 * stable identity from the same fingerprint snapshot.
 *
 * The lower fingerprint keeps the stable public id; the other successor is
 * re-keyed to its own globally unique fingerprint. This ordering is independent
 * of ours/theirs orientation, so reversing merge sides produces identical
 * bytes. A confirmation-versus-rewrite is not a fork: both successors must
 * carry new, distinct fingerprints relative to the base.
 * @param base - Common ancestor entry
 * @param ours - Current-branch successor
 * @param theirs - Incoming-branch successor
 * @returns Two deterministic survivors, or undefined when this is not a fork
 */
function forkConcurrentStableRewrite(
  base: LearningEntry | undefined,
  ours: LearningEntry,
  theirs: LearningEntry
): readonly LearningEntry[] | undefined {
  if (
    base === undefined ||
    ours.id !== base.id ||
    theirs.id !== base.id ||
    ours.fingerprint === base.fingerprint ||
    theirs.fingerprint === base.fingerprint ||
    ours.fingerprint === theirs.fingerprint
  ) {
    return undefined;
  }
  const [primary, forked] =
    compareTokens(ours.fingerprint, theirs.fingerprint) <= 0
      ? [ours, theirs]
      : [theirs, ours];
  return [
    primary,
    validateLearningEntry({ ...forked, id: forked.fingerprint }),
  ];
}

/**
 * Find the first repeated token in encounter order.
 * @param values - Stable tokens to inspect
 * @returns First duplicate, when one exists
 */
function findDuplicate(values: readonly string[]): string | undefined {
  return values.find((value, index) => values.indexOf(value) !== index);
}

/**
 * Compare stable tokens without locale dependence.
 * @param left - First token
 * @param right - Second token
 * @returns Negative, zero, or positive ordering result
 */
function compareTokens(left: string, right: string): number {
  return left === right ? 0 : left < right ? -1 : 1;
}

/**
 * Sort entries by id without mutating a caller-owned or local array.
 * @param entries - Entries in arbitrary order
 * @returns New deterministically ordered array
 */
function sortLearningEntries(
  entries: readonly LearningEntry[]
): readonly LearningEntry[] {
  return entries.reduce<readonly LearningEntry[]>((ordered, entry) => {
    const insertion = ordered.findIndex(
      current => compareTokens(entry.id, current.id) < 0
    );
    return insertion === -1
      ? [...ordered, entry]
      : [...ordered.slice(0, insertion), entry, ...ordered.slice(insertion)];
  }, []);
}

/**
 * Choose the later of two confirmation stamps.
 * @param ours - Current-branch version
 * @param theirs - Incoming-branch version
 * @returns The entry carrying the later `last_confirmed`
 */
function pickLaterConfirmation(
  ours: LearningEntry,
  theirs: LearningEntry
): LearningEntry {
  return theirs.last_confirmed > ours.last_confirmed ? theirs : ours;
}

/**
 * Compare two optional entries by value using the canonical serialization.
 *
 * The renderer is the single source of truth for field order, so serializing
 * both sides through `JSON.stringify` compares exactly what would be written.
 * @param left - First entry, if any
 * @param right - Second entry, if any
 * @returns Whether both are absent or byte-identical once serialized
 */
function sameEntry(
  left: LearningEntry | undefined,
  right: LearningEntry | undefined
): boolean {
  if (left === undefined || right === undefined) {
    return left === undefined && right === undefined;
  }
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * Render the merged entries and refuse to publish an over-budget ledger.
 *
 * A union can legitimately exceed the budget when both branches added entries
 * to an already-full ledger. Emitting it anyway would push the breach onto the
 * CI gate after the merge has landed; failing here keeps the conflict visible
 * at the point a human or agent can still recompact deliberately.
 * @param entries - Resolved merged entries, sorted by id
 * @returns Canonical merged document, or a budget conflict
 */
function renderWithinBudget(
  entries: readonly LearningEntry[]
): LearningsMergeResult {
  const content = renderLearningsFile(entries);
  try {
    assertDocumentBudget(content, entries.length, "Merged project learnings");
    return { kind: "merged", content };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      kind: "conflict",
      reason: `${detail} — the union of both branches does not fit the ${LEARNINGS_CONTRACT.maxEntries}-entry budget; consolidate before merging`,
    };
  }
}
