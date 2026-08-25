/**
 * `lisa stash prune` — the vetted verb for clearing redundant stash entries.
 *
 * The guard blocks `git stash drop` and `git stash clear` because they destroy
 * stashed work. That block stays. This command answers it rather than relaxing
 * it: every entry it drops is first re-anchored under
 * `refs/lisa/pruned-stashes/`, so the stash commit — trees, index state, and
 * the untracked-files parent alike — stays in the object database and is
 * recoverable with a single `git stash apply <ref>`. Nothing is destroyed; the
 * reflog entry is what goes away.
 *
 * Dropping is index-shifting on a ref that every worktree of the repository
 * shares, so entries are addressed by commit id and re-located immediately
 * before each drop. An entry whose id no longer sits where it was is skipped,
 * never dropped by position — that is the difference between a cleaner and a
 * race that eats a sibling's stash.
 * @module cli/stash-prune
 */
import {
  classifyStash,
  DEFAULT_MIN_DEBRIS_AGE_SECONDS,
  type StashFacts,
  type StashVerdict,
} from "./stash-prune-policy.js";
import { git } from "./worktree-inventory.js";

/** Unit-separator field delimiter, matching the `%x1f` in the list format. */
const FIELD = "\u001F";

/** Format that makes `git stash list` machine-readable. */
const STASH_LIST_FORMAT = "--format=%H%x1f%gs%x1f%ct";

/** Namespace the preserved stash commits are anchored under. */
export const PRESERVED_STASH_REF_PREFIX = "refs/lisa/pruned-stashes";

/** Command-line options for the stash prune verb. */
export interface StashPruneOptions {
  /** Perform the drops instead of reporting them. */
  readonly apply?: boolean;
  /** Age in hours a machine backup must reach before it counts as debris. */
  readonly olderThanHours?: string;
  /** Emit machine-readable output. */
  readonly json?: boolean;
}

/** One entry as the listing reports it. */
export interface StashRecord {
  /** Commit id of the entry. */
  readonly sha: string;
  /** Reflog subject. */
  readonly subject: string;
  /** Commit timestamp in epoch seconds. */
  readonly timestamp: number;
}

/** What one run decided, before anything is dropped. */
export interface StashPrunePlan {
  /** Repository the plan was computed for. */
  readonly repoPath: string;
  /** Verdict for every stash entry. */
  readonly verdicts: readonly StashVerdict[];
  /** Facts behind each verdict, in the same order. */
  readonly facts: readonly StashFacts[];
}

/** Outcome of dropping one stash entry. */
export interface StashDropOutcome {
  /** Commit id of the entry. */
  readonly sha: string;
  /** Whether the entry was dropped. */
  readonly dropped: boolean;
  /** Ref the stash commit was anchored under before the drop. */
  readonly preservedRef?: string;
  /** Why the drop did not happen. */
  readonly error?: string;
}

/**
 * Resolve the debris age threshold from the command line.
 * @param olderThanHours - Raw `--older-than-hours` value
 * @returns Threshold in seconds
 */
export function resolveMinDebrisAgeSeconds(
  olderThanHours: string | undefined
): number {
  if (olderThanHours === undefined) return DEFAULT_MIN_DEBRIS_AGE_SECONDS;
  const parsed = Number.parseFloat(olderThanHours);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error("--older-than-hours must be a non-negative number");
  }
  return Math.floor(parsed * 3600);
}

/**
 * Parse the formatted stash listing into its raw fields.
 * @param stdout - Output of the formatted `git stash list`
 * @returns One record per entry, in list order
 */
export function parseStashList(stdout: string): readonly StashRecord[] {
  return stdout
    .split("\n")
    .filter(line => line.includes(FIELD))
    .map(line => line.split(FIELD))
    .map(fields => ({
      sha: (fields[0] ?? "").trim(),
      subject: fields[1] ?? "",
      timestamp: Number.parseInt(fields[2] ?? "", 10) || 0,
    }))
    .filter(record => record.sha !== "");
}

/**
 * The ref one stash commit is preserved under.
 * @param sha - Commit id of the stash entry
 * @returns Fully-qualified ref name
 */
export function preservedStashRef(sha: string): string {
  return `${PRESERVED_STASH_REF_PREFIX}/${sha}`;
}

/**
 * Report whether two revisions have an identical tree.
 * @param repoPath - Any path inside the repository
 * @param left - First revision
 * @param right - Second revision
 * @returns True when the revisions differ in nothing
 */
async function isSameTree(
  repoPath: string,
  left: string,
  right: string
): Promise<boolean> {
  const [leftTree, rightTree] = await Promise.all([
    git(["rev-parse", `${left}^{tree}`], repoPath).then(out => out.trim()),
    git(["rev-parse", `${right}^{tree}`], repoPath).then(out => out.trim()),
  ]);
  return leftTree !== "" && leftTree === rightTree;
}

/**
 * Establish whether one entry holds anything, and whether its base is published.
 *
 * A stash created with `--include-untracked` carries a third parent holding
 * those files. Its presence alone means the entry holds content no comparison
 * against the first two parents would reveal, so it is treated as non-empty
 * without further inspection.
 * @param repoPath - Any path inside the repository
 * @param sha - Commit id of the stash entry
 * @returns Content and publication facts
 */
async function probeStashContent(
  repoPath: string,
  sha: string
): Promise<{ recordsNoChange: boolean; baseOnRemote: boolean }> {
  const hasUntrackedParent = await git(
    ["rev-parse", "--verify", "--quiet", `${sha}^3`],
    repoPath
  ).then(
    () => true,
    () => false
  );
  const [sameWorktree, sameIndex, unpublished] = await Promise.all([
    isSameTree(repoPath, `${sha}^`, sha),
    isSameTree(repoPath, `${sha}^`, `${sha}^2`),
    git(["rev-list", "--count", `${sha}^`, "--not", "--remotes"], repoPath),
  ]);
  return {
    recordsNoChange: !hasUntrackedParent && sameWorktree && sameIndex,
    baseOnRemote: (Number.parseInt(unpublished.trim(), 10) || 0) === 0,
  };
}

/**
 * Gather every fact the entitlement rule may consider for one entry.
 * @param repoPath - Any path inside the repository
 * @param record - Raw listing fields
 * @param index - Position in the listing
 * @param nowSeconds - Clock in epoch seconds
 * @returns Facts for the entitlement rule
 */
async function gatherStashFacts(
  repoPath: string,
  record: StashRecord,
  index: number,
  nowSeconds: number
): Promise<StashFacts> {
  const shell = {
    index,
    sha: record.sha,
    subject: record.subject,
    ageSeconds: Math.max(0, nowSeconds - record.timestamp),
  };
  const probed = await probeStashContent(repoPath, record.sha).catch(
    () => undefined
  );
  return probed === undefined
    ? { ...shell, readable: false, recordsNoChange: false, baseOnRemote: false }
    : { ...shell, readable: true, ...probed };
}

/**
 * Compute what a run would do, without dropping anything.
 * @param repoPath - Any path inside the repository
 * @param options - Command-line options
 * @param now - Clock in epoch milliseconds
 * @returns The plan
 */
export async function planStashPrune(
  repoPath: string,
  options: StashPruneOptions,
  now: () => number = () => Date.now()
): Promise<StashPrunePlan> {
  const minDebrisAgeSeconds = resolveMinDebrisAgeSeconds(
    options.olderThanHours
  );
  const listed = parseStashList(
    await git(["stash", "list", STASH_LIST_FORMAT], repoPath).catch(() => "")
  );
  const nowSeconds = Math.floor(now() / 1000);
  const facts = await Promise.all(
    listed.map((record, index) =>
      gatherStashFacts(repoPath, record, index, nowSeconds)
    )
  );
  return {
    repoPath,
    facts,
    verdicts: facts.map(fact => classifyStash(fact, { minDebrisAgeSeconds })),
  };
}

/**
 * Locate a stash entry by commit id, as `git stash list` currently numbers it.
 *
 * Re-derived immediately before every drop. Positions shift under a concurrent
 * push or drop from any worktree of the repository, and a stale position is how
 * a cleaner destroys the entry after the one it meant to.
 * @param repoPath - Any path inside the repository
 * @param sha - Commit id of the entry
 * @returns Current `stash@{n}` reference, or undefined when the entry is gone
 */
export async function locateStash(
  repoPath: string,
  sha: string
): Promise<string | undefined> {
  const listed = parseStashList(
    await git(["stash", "list", STASH_LIST_FORMAT], repoPath)
  );
  const position = listed.findIndex(record => record.sha === sha);
  return position === -1 ? undefined : `stash@{${position}}`;
}

/**
 * Preserve one stash commit under a ref, verify it, then drop the entry.
 * @param repoPath - Any path inside the repository
 * @param sha - Commit id of the entry
 * @returns Outcome for the entry
 */
async function dropOne(
  repoPath: string,
  sha: string
): Promise<StashDropOutcome> {
  const ref = preservedStashRef(sha);
  const preserved = await git(["update-ref", ref, sha], repoPath).then(
    () => git(["rev-parse", "--verify", ref], repoPath),
    () => ""
  );
  if (preserved.trim() !== sha) {
    return {
      sha,
      dropped: false,
      error: "could not preserve the stash commit, so it was not dropped",
    };
  }
  const located = await locateStash(repoPath, sha);
  if (located === undefined) {
    return {
      sha,
      dropped: false,
      preservedRef: ref,
      error: "entry moved or was dropped elsewhere before this drop",
    };
  }
  return git(["stash", "drop", located], repoPath).then(
    (): StashDropOutcome => ({ sha, dropped: true, preservedRef: ref }),
    (error: unknown): StashDropOutcome => ({
      sha,
      dropped: false,
      preservedRef: ref,
      error:
        error instanceof Error
          ? (error.message.split("\n")[0] ?? "unknown")
          : "unknown",
    })
  );
}

/**
 * Preserve and drop every eligible stash entry in a plan.
 * @param plan - Plan produced by {@link planStashPrune}
 * @param index - Index of the eligible entry to drop next
 * @returns One outcome per eligible entry
 */
export async function applyStashPrune(
  plan: StashPrunePlan,
  index = 0
): Promise<readonly StashDropOutcome[]> {
  const eligible = plan.verdicts.filter(verdict => verdict.eligible);
  if (index >= eligible.length) return [];
  const target = eligible[index] as StashVerdict;
  return [
    await dropOne(plan.repoPath, target.sha),
    ...(await applyStashPrune(plan, index + 1)),
  ];
}
