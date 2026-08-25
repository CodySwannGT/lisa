/**
 * The entitlement rule for dropping a stash entry.
 *
 * Stashes are harder to own than worktrees: `refs/stash` is a single reflog
 * shared by every worktree of a repository, so an entry an agent finds may have
 * been pushed a minute ago by a sibling working three directories away. There
 * is no path, no branch, and no author to scope by. The only defensible
 * entitlement is therefore not "mine" but **provably redundant** — an entry
 * whose content is already preserved somewhere else, or machine-generated
 * debris whose producing run is provably long dead.
 *
 * Everything else is kept and reported. A stash that cannot be proven redundant
 * is precisely the case the standing block on `git stash drop` exists for.
 * @module cli/stash-prune-policy
 */

/** Why one stash entry was kept. */
export type StashBlocker =
  | "not-provably-redundant"
  | "too-recent"
  | "unreadable";

/** Why one stash entry may be dropped. */
export type StashRedundancy = "empty-and-published" | "machine-debris";

/** Everything the rule is allowed to consider about one stash entry. */
export interface StashFacts {
  /** Position in `git stash list` at plan time. */
  readonly index: number;
  /** Commit id of the stash entry — the identity that survives renumbering. */
  readonly sha: string;
  /** Reflog subject, e.g. `WIP on main: …` or the lint-staged backup message. */
  readonly subject: string;
  /** Age of the entry in seconds. */
  readonly ageSeconds: number;
  /** Whether every fact below could be established. */
  readonly readable: boolean;
  /** Whether the entry records no change at all against the commit it came from. */
  readonly recordsNoChange: boolean;
  /** Whether the commit the entry came from is reachable from a remote. */
  readonly baseOnRemote: boolean;
}

/** Tunable part of the rule. */
export interface StashPrunePolicy {
  /** Age a machine-generated backup must reach before it is debris. */
  readonly minDebrisAgeSeconds: number;
}

/** Result of applying the rule to one stash entry. */
export interface StashVerdict {
  /** Position in `git stash list` at plan time. */
  readonly index: number;
  /** Commit id of the stash entry. */
  readonly sha: string;
  /** Whether the entry may be dropped. */
  readonly eligible: boolean;
  /** Why it may be dropped, when it may. */
  readonly redundancy?: StashRedundancy;
  /** Why it was kept, when it was. */
  readonly blockers: readonly StashBlocker[];
}

/** Default debris age: a lint-staged run that old is not coming back. */
export const DEFAULT_MIN_DEBRIS_AGE_SECONDS = 24 * 60 * 60;

/**
 * The exact message lint-staged gives its automatic backup stash.
 *
 * Matched exactly, and with the `On <branch>: ` prefix git adds when the entry
 * is stored through `git stash push`, because a substring match would sweep a
 * human stash whose message merely mentions lint-staged.
 */
const LINT_STAGED_BACKUP = /^(?:On [^:]+: )?lint-staged automatic backup$/;

/** Operator-readable explanation for each blocker. */
export const STASH_BLOCKER_EXPLANATIONS: Readonly<
  Record<StashBlocker, string>
> = Object.freeze({
  "not-provably-redundant":
    "its content is not provably preserved anywhere else, so dropping it could destroy the only copy",
  "too-recent":
    "it is machine-generated backup debris, but recent enough that the run which created it may still be alive",
  unreadable: "git could not report on it, so nothing about it was proven",
});

/**
 * Report whether a reflog subject is lint-staged's automatic backup.
 * @param subject - Reflog subject of the stash entry
 * @returns True when the entry is machine-generated backup debris
 */
export function isLintStagedBackup(subject: string): boolean {
  return LINT_STAGED_BACKUP.test(subject.trim());
}

/**
 * Decide whether one stash entry may be dropped, and say why not when it may not.
 * @param facts - Gathered facts about the entry
 * @param policy - Tunable thresholds
 * @returns Verdict with the reason it may be dropped, or every reason it may not
 */
export function classifyStash(
  facts: StashFacts,
  policy: StashPrunePolicy
): StashVerdict {
  if (!facts.readable) {
    return {
      index: facts.index,
      sha: facts.sha,
      eligible: false,
      blockers: ["unreadable"],
    };
  }
  const redundancy = findRedundancy(facts, policy);
  if (redundancy !== undefined) {
    return {
      index: facts.index,
      sha: facts.sha,
      eligible: true,
      redundancy,
      blockers: [],
    };
  }
  return {
    index: facts.index,
    sha: facts.sha,
    eligible: false,
    blockers: [
      isLintStagedBackup(facts.subject)
        ? "too-recent"
        : "not-provably-redundant",
    ],
  };
}

/**
 * Identify which redundancy proof, if any, one entry satisfies.
 * @param facts - Gathered facts about the entry
 * @param policy - Tunable thresholds
 * @returns The satisfied proof, or undefined when none is
 */
function findRedundancy(
  facts: StashFacts,
  policy: StashPrunePolicy
): StashRedundancy | undefined {
  if (facts.recordsNoChange && facts.baseOnRemote) return "empty-and-published";
  return isLintStagedBackup(facts.subject) &&
    facts.ageSeconds >= policy.minDebrisAgeSeconds
    ? "machine-debris"
    : undefined;
}
