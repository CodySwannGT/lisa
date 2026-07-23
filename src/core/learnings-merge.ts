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
 * guessing — with one narrow exception: when the only differing field is
 * `last_confirmed`, the later date wins, because that field is a monotonic
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
  return {
    kind: "entries",
    entries: resolutions
      .filter(
        (resolution): resolution is LearningEntry =>
          resolution !== "absent" && resolution !== "conflict"
      )
      .sort((left, right) => left.id.localeCompare(right.id)),
  };
}

/**
 * Resolve one id with standard three-way semantics.
 * @param base - Ancestor version, if any
 * @param ours - Current-branch version, if any
 * @param theirs - Incoming-branch version, if any
 * @returns The winning entry, `absent` when both sides removed it, or `conflict`
 */
function resolveOneId(
  base: LearningEntry | undefined,
  ours: LearningEntry | undefined,
  theirs: LearningEntry | undefined
): LearningEntry | "absent" | "conflict" {
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
  return resolveDivergentEdit(ours, theirs);
}

/**
 * Resolve the one divergence that is safe to auto-merge: both branches only
 * re-confirmed the same entry, so the later monotonic stamp wins.
 * @param ours - Current-branch version, if any
 * @param theirs - Incoming-branch version, if any
 * @returns The later-confirmed entry, or `conflict`
 */
function resolveDivergentEdit(
  ours: LearningEntry | undefined,
  theirs: LearningEntry | undefined
): LearningEntry | "conflict" {
  if (ours === undefined || theirs === undefined) {
    // One side edited the entry while the other superseded it. Dropping the
    // edit or resurrecting the removal are both information loss.
    return "conflict";
  }
  // Neutralize only `last_confirmed`: if the entries match once that field is
  // aligned, it was the sole difference and taking the later stamp loses nothing.
  return sameEntry({ ...ours, last_confirmed: theirs.last_confirmed }, theirs)
    ? pickLaterConfirmation(ours, theirs)
    : "conflict";
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
