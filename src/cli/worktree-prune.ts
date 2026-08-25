/**
 * `lisa worktree prune` — the vetted verb for retiring agent worktrees.
 *
 * The guard in `parity-safety-net.sh` blocks `git worktree remove --force`
 * because it discards a dirty tree, and that block is correct and stays. This
 * command does not relax it, is not an override for it, and never passes
 * `--force` to git: it performs the safety checks itself and then uses the
 * plain `git worktree remove`, whose own refusal of a dirty tree remains in
 * place underneath as a last line of defence.
 *
 * Dry-run is the default. The command is meant to be called by unattended
 * loops on a machine shared with other agents' live work, so the first contact
 * a mis-scoped invocation makes must be a report and not a deletion. `--apply`
 * is the whole opt-in; there is no flag anywhere that widens the entitlement
 * rule itself.
 * @module cli/worktree-prune
 */
import { realpathSync } from "node:fs";
import * as path from "node:path";
import {
  gatherAllWorktreeFacts,
  git,
  listWorktrees,
  type WorktreeEntry,
} from "./worktree-inventory.js";
import {
  probeLiveWorkingDirectories,
  type LivenessProbe,
} from "./worktree-liveness.js";
import { resolveCallerOwnerId } from "./worktree-ownership.js";
import {
  classifyWorktree,
  DEFAULT_MIN_IDLE_SECONDS,
  type WorktreeFacts,
  type WorktreeVerdict,
} from "./worktree-prune-policy.js";

/** Command-line options for the prune verb. */
export interface WorktreePruneOptions {
  /** Perform the removals instead of reporting them. */
  readonly apply?: boolean;
  /** Quiescence window in hours before an unclaimed worktree is eligible. */
  readonly idleHours?: string;
  /** Emit machine-readable output. */
  readonly json?: boolean;
}

/** What one run decided, before anything is removed. */
export interface WorktreePrunePlan {
  /** Repository the plan was computed for. */
  readonly repoPath: string;
  /** Verdict for every registered worktree. */
  readonly verdicts: readonly WorktreeVerdict[];
  /** Facts behind each verdict, in the same order. */
  readonly facts: readonly WorktreeFacts[];
  /** Whether the live-process probe produced an answer. */
  readonly livenessAvailable: boolean;
  /** Registrations whose directory is already gone. */
  readonly prunableRegistrations: readonly string[];
}

/** Injectable collaborators, overridden by tests. */
export interface WorktreePruneDependencies {
  /** Machine-wide live working directory probe. */
  readonly probeLive: LivenessProbe;
  /** Owner id of the running process. */
  readonly callerOwnerId: string | undefined;
  /** Clock in epoch milliseconds. */
  readonly now: () => number;
  /** Path the cleaner is running from. */
  readonly currentPath: string;
}

/**
 * Arguments used to remove one worktree.
 *
 * Exported so a test can pin the absence of `--force` by value rather than by
 * reading the source. The plain form is not a stylistic preference: it is the
 * backstop that makes a bug in the entitlement rule non-destructive, because
 * git still refuses a dirty tree on its own.
 * @param worktreePath - Absolute worktree path
 * @returns Git arguments
 */
export function buildWorktreeRemoveArgs(
  worktreePath: string
): readonly string[] {
  return ["worktree", "remove", worktreePath];
}

/**
 * Resolve the quiescence window from the command line.
 * @param idleHours - Raw `--idle-hours` value
 * @returns Window in seconds
 */
export function resolveMinIdleSeconds(idleHours: string | undefined): number {
  if (idleHours === undefined) return DEFAULT_MIN_IDLE_SECONDS;
  const parsed = Number.parseFloat(idleHours);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error("--idle-hours must be a non-negative number");
  }
  return Math.floor(parsed * 3600);
}

/**
 * Compute what a run would do, without doing any of it.
 * @param repoPath - Any path inside the repository
 * @param options - Command-line options
 * @param dependencies - Injectable collaborators
 * @returns The plan
 */
export async function planWorktreePrune(
  repoPath: string,
  options: WorktreePruneOptions,
  dependencies: WorktreePruneDependencies
): Promise<WorktreePrunePlan> {
  const minIdleSeconds = resolveMinIdleSeconds(options.idleHours);
  const entries = await listWorktrees(repoPath);
  const live = await dependencies.probeLive();
  const present = entries.filter(entry => !entry.prunable);
  const facts = await gatherAllWorktreeFacts(present, {
    liveWorkingDirectories: live,
    callerOwnerId: dependencies.callerOwnerId,
    currentPath: dependencies.currentPath,
    nowMs: dependencies.now(),
  });
  return {
    repoPath,
    verdicts: facts.map(fact => classifyWorktree(fact, { minIdleSeconds })),
    facts,
    livenessAvailable: live !== undefined,
    prunableRegistrations: entries
      .filter((entry: WorktreeEntry) => entry.prunable)
      .map(entry => entry.path),
  };
}

/** Outcome of removing one worktree. */
export interface RemovalOutcome {
  /** Absolute worktree path. */
  readonly path: string;
  /** Whether git removed it. */
  readonly removed: boolean;
  /** Git's message when it refused. */
  readonly error?: string;
}

/**
 * Remove every eligible worktree in a plan.
 *
 * Removals run one at a time rather than concurrently. `git worktree remove`
 * takes the repository's worktree lock, and a batch of parallel removals on a
 * machine where other agents are also running git turns a contended lock into
 * a spurious failure that reads like a refusal.
 * @param plan - Plan produced by {@link planWorktreePrune}
 * @param index - Index of the eligible worktree to remove next
 * @returns One outcome per eligible worktree
 */
export async function applyWorktreePrune(
  plan: WorktreePrunePlan,
  index = 0
): Promise<readonly RemovalOutcome[]> {
  const eligible = plan.verdicts.filter(verdict => verdict.eligible);
  if (index >= eligible.length) return [];
  const target = eligible[index] as WorktreeVerdict;
  const outcome = await git(
    buildWorktreeRemoveArgs(target.path),
    plan.repoPath
  ).then(
    (): RemovalOutcome => ({ path: target.path, removed: true }),
    (error: unknown): RemovalOutcome => ({
      path: target.path,
      removed: false,
      error: describeError(error),
    })
  );
  return [outcome, ...(await applyWorktreePrune(plan, index + 1))];
}

/**
 * Drop registrations whose directory has already disappeared.
 *
 * Separate from removal because it destroys nothing: git is only forgetting a
 * pointer to a directory that no longer exists.
 * @param plan - Plan produced by {@link planWorktreePrune}
 * @returns Number of registrations git was asked to forget
 */
export async function pruneMissingRegistrations(
  plan: WorktreePrunePlan
): Promise<number> {
  if (plan.prunableRegistrations.length === 0) return 0;
  await git(["worktree", "prune"], plan.repoPath).catch(() => "");
  return plan.prunableRegistrations.length;
}

/**
 * Default collaborators for a real run.
 * @returns Dependencies wired to the real probe, environment, and clock
 */
export function defaultWorktreePruneDependencies(): WorktreePruneDependencies {
  return {
    probeLive: probeLiveWorkingDirectories,
    callerOwnerId: resolveCallerOwnerId(),
    now: () => Date.now(),
    currentPath: resolvePhysicalCwd(),
  };
}

/**
 * Resolve the directory the cleaner runs from, following symlinks.
 *
 * The physical form is what the liveness probe reports, so the two have to be
 * in the same spelling or the cleaner cannot recognise its own worktree.
 * @returns Absolute physical path of the current working directory
 */
function resolvePhysicalCwd(): string {
  const resolved = path.resolve(process.cwd());
  try {
    return realpathSync.native(resolved);
  } catch {
    return resolved;
  }
}

/**
 * Render an error for the report.
 * @param error - Rejection from git
 * @returns Single-line message
 */
function describeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.split("\n").filter(line => line.trim() !== "")[0] ?? "unknown";
}
