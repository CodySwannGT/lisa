/**
 * The entitlement rule for removing an agent worktree.
 *
 * Deliberately pure: every fact is gathered elsewhere and handed in, so the
 * decision that authorizes a deletion is a function that can be exhaustively
 * tested and mutation-tested rather than a side effect of a shell pipeline.
 *
 * The rule is **entitlement by proof, never by location.** Nothing here looks
 * at where a worktree lives. `$TMPDIR` and the worktree roots are shared by
 * every agent on the machine, so a path prefix identifies a neighbourhood, not
 * an owner; reaping on one deletes siblings' live work. A worktree is the
 * caller's to remove only when it is claimed by the caller, or when no other
 * party can possibly have a claim on it — no live process inside it, no recent
 * activity, and nothing in it that exists nowhere else.
 * @module cli/worktree-prune-policy
 */

/** Why one worktree was refused. Every value names a specific unmet proof. */
export type WorktreeBlocker =
  | "primary-checkout"
  | "current-worktree"
  | "git-locked"
  | "claimed-by-another-owner"
  | "liveness-unknown"
  | "in-use"
  | "recently-active"
  | "unpushed-commits"
  | "uncommitted-changes"
  | "unreadable";

/** Everything the rule is allowed to consider about one worktree. */
export interface WorktreeFacts {
  /** Absolute worktree path. */
  readonly path: string;
  /** Checked-out branch, or undefined when detached. */
  readonly branch?: string;
  /** Whether this is the repository's primary checkout. */
  readonly isPrimary: boolean;
  /** Whether the cleaner itself is running inside this worktree. */
  readonly isCurrent: boolean;
  /** Whether git reports the worktree as locked. */
  readonly locked: boolean;
  /** Whether git could report on the worktree at all. */
  readonly readable: boolean;
  /** Ownership verdict from the receipt check. */
  readonly ownership: "mine" | "theirs" | "unclaimed";
  /** Live processes whose working directory is inside, or undefined if unknown. */
  readonly liveHolders: number | undefined;
  /** Seconds since the worktree last showed activity. */
  readonly idleSeconds: number;
  /** Modified, staged, added, deleted, or renamed TRACKED files. */
  readonly trackedChanges: number;
  /** Untracked, non-ignored files. */
  readonly untrackedFiles: number;
  /** Commits present locally and on no remote. */
  readonly unpushedCommits: number;
}

/** Tunable part of the rule. */
export interface WorktreePrunePolicy {
  /** Quiescence a worktree must show before an unclaimed one is eligible. */
  readonly minIdleSeconds: number;
}

/** Result of applying the rule to one worktree. */
export interface WorktreeVerdict {
  /** Absolute worktree path. */
  readonly path: string;
  /** Whether the worktree may be removed. */
  readonly eligible: boolean;
  /** Every unmet proof, most severe first. */
  readonly blockers: readonly WorktreeBlocker[];
}

/** Default quiescence window: one day of no activity. */
export const DEFAULT_MIN_IDLE_SECONDS = 24 * 60 * 60;

/** Operator-readable explanation for each blocker. */
export const BLOCKER_EXPLANATIONS: Readonly<Record<WorktreeBlocker, string>> =
  Object.freeze({
    "primary-checkout": "this is the repository's primary checkout",
    "current-worktree": "the cleaner is running inside it",
    "git-locked": "git reports it locked, which means somebody claimed it",
    "claimed-by-another-owner":
      "its ownership receipt names a different agent, so it is not yours to remove",
    "liveness-unknown":
      "the live-process probe could not run, so nothing could be proven idle",
    "in-use": "a live process is working inside it right now",
    "recently-active": "it showed activity too recently to be called abandoned",
    "unpushed-commits":
      "it holds commits that exist on no remote — push them first",
    "uncommitted-changes":
      "it holds uncommitted work — commit and push it first, or save a patch " +
      "under your own TMPDIR; never the shared stash",
    unreadable: "git could not report on it, so nothing about it was proven",
  });

/**
 * Decide whether one worktree may be removed, and say why not when it may not.
 *
 * Blockers are returned in full rather than short-circuiting at the first
 * failure. A worktree refused for three reasons and a worktree refused for one
 * need different remedies, and reporting only the first trains a reader to fix
 * one thing and re-run into the next refusal.
 * @param facts - Gathered facts about the worktree
 * @param policy - Tunable thresholds
 * @returns Verdict with every unmet proof
 */
export function classifyWorktree(
  facts: WorktreeFacts,
  policy: WorktreePrunePolicy
): WorktreeVerdict {
  const blockers: readonly WorktreeBlocker[] = [
    ...structuralBlockers(facts),
    ...idlenessBlockers(facts, policy),
    ...workAtRiskBlockers(facts),
  ];
  return { path: facts.path, eligible: blockers.length === 0, blockers };
}

/**
 * Blockers that make a worktree ineligible regardless of its contents.
 * @param facts - Gathered facts about the worktree
 * @returns Structural blockers
 */
function structuralBlockers(facts: WorktreeFacts): readonly WorktreeBlocker[] {
  const candidates: readonly (WorktreeBlocker | undefined)[] = [
    facts.readable ? undefined : ("unreadable" as const),
    facts.isPrimary ? ("primary-checkout" as const) : undefined,
    facts.isCurrent ? ("current-worktree" as const) : undefined,
    facts.locked ? ("git-locked" as const) : undefined,
    facts.ownership === "theirs"
      ? ("claimed-by-another-owner" as const)
      : undefined,
  ];
  return candidates.filter(
    (blocker): blocker is WorktreeBlocker => blocker !== undefined
  );
}

/**
 * Blockers derived from whether anybody could still be using the worktree.
 *
 * A matching ownership receipt waives the quiescence window and NOTHING else.
 * An owner asking to clean its own worktree has said what the window is there
 * to infer. It never waives `in-use`: a claim says the work is finished, not
 * that no process is still standing in the directory.
 * @param facts - Gathered facts about the worktree
 * @param policy - Tunable thresholds
 * @returns Non-use blockers
 */
function idlenessBlockers(
  facts: WorktreeFacts,
  policy: WorktreePrunePolicy
): readonly WorktreeBlocker[] {
  const liveness =
    facts.liveHolders === undefined
      ? ("liveness-unknown" as const)
      : facts.liveHolders > 0
        ? ("in-use" as const)
        : undefined;
  const stale =
    facts.ownership === "mine" || facts.idleSeconds >= policy.minIdleSeconds
      ? undefined
      : ("recently-active" as const);
  const candidates: readonly (WorktreeBlocker | undefined)[] = [
    liveness,
    stale,
  ];
  return candidates.filter(
    (blocker): blocker is WorktreeBlocker => blocker !== undefined
  );
}

/**
 * Blockers derived from work that would not survive the removal.
 *
 * Untracked files count. The existing doctor check deliberately excludes them
 * from its "work at risk" signal because untracked droppings make every
 * worktree look catastrophic in a REPORT. A report is not a deletion: here the
 * files are about to stop existing, and an untracked file is in no object
 * database at all, so it is the least recoverable thing in the tree.
 * @param facts - Gathered facts about the worktree
 * @returns Work-at-risk blockers
 */
function workAtRiskBlockers(facts: WorktreeFacts): readonly WorktreeBlocker[] {
  const candidates: readonly (WorktreeBlocker | undefined)[] = [
    facts.unpushedCommits > 0 ? ("unpushed-commits" as const) : undefined,
    facts.trackedChanges > 0 || facts.untrackedFiles > 0
      ? ("uncommitted-changes" as const)
      : undefined,
  ];
  return candidates.filter(
    (blocker): blocker is WorktreeBlocker => blocker !== undefined
  );
}
