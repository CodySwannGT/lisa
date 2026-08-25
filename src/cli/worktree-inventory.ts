/**
 * Enumeration and fact-gathering for registered git worktrees.
 *
 * Enumeration is `git worktree list --porcelain`, never a scan of the worktree
 * roots, and that is load-bearing twice over. It is the git control plane's own
 * record of which checkouts belong to this repository — ownership evidence
 * rather than a path guess — and it reaches worktrees parked outside the tidy
 * roots, which a root scan silently reports as absent.
 * @module cli/worktree-inventory
 */
import { execFile } from "node:child_process";
import { realpath, stat } from "node:fs/promises";
import * as path from "node:path";
import { promisify } from "node:util";
import { countLiveHolders } from "./worktree-liveness.js";
import { judgeOwnership, readOwnerReceipt } from "./worktree-ownership.js";
import type { WorktreeFacts } from "./worktree-prune-policy.js";

const run = promisify(execFile);
const GIT_TIMEOUT_MS = 15_000;
const GIT_MAX_BUFFER_BYTES = 4 * 1024 * 1024;
const INSPECTION_BATCH_SIZE = 8;

/** One entry as git itself reports it. */
export interface WorktreeEntry {
  /** Absolute worktree path. */
  readonly path: string;
  /** Checked-out branch, or undefined when detached. */
  readonly branch?: string;
  /** Whether git reports the entry locked. */
  readonly locked: boolean;
  /** Whether git reports the entry's directory as gone. */
  readonly prunable: boolean;
  /** Whether this is the primary checkout (always the first entry). */
  readonly isPrimary: boolean;
}

/**
 * Parse `git worktree list --porcelain` output.
 *
 * The first record is always the primary checkout, which is how the primary is
 * identified — not by comparing it against a path the caller supplied, which
 * would be wrong the moment the caller ran from a worktree.
 * @param stdout - Porcelain output
 * @returns Parsed entries in git's order
 */
export function parseWorktreeList(stdout: string): readonly WorktreeEntry[] {
  return stdout
    .split(/\n{2,}/)
    .map(block => block.split("\n").filter(line => line !== ""))
    .filter(lines => lines.some(line => line.startsWith("worktree ")))
    .map((lines, index) => parseWorktreeBlock(lines, index === 0));
}

/**
 * Parse one porcelain record.
 * @param lines - Non-empty lines of the record
 * @param isPrimary - Whether this record is the primary checkout
 * @returns Parsed entry
 */
function parseWorktreeBlock(
  lines: readonly string[],
  isPrimary: boolean
): WorktreeEntry {
  const worktreePath = (
    lines.find(line => line.startsWith("worktree ")) ?? "worktree "
  ).slice("worktree ".length);
  const branchLine = lines.find(line => line.startsWith("branch "));
  const branch =
    branchLine === undefined
      ? undefined
      : branchLine.slice("branch ".length).replace(/^refs\/heads\//, "");
  const base = {
    path: worktreePath,
    locked: lines.some(line => line === "locked" || line.startsWith("locked ")),
    prunable: lines.some(
      line => line === "prunable" || line.startsWith("prunable ")
    ),
    isPrimary,
  };
  return branch === undefined ? base : { ...base, branch };
}

/**
 * Run one bounded git command.
 * @param args - Git arguments
 * @param cwd - Directory to run git in
 * @returns Trimmed stdout
 */
export async function git(
  args: readonly string[],
  cwd: string
): Promise<string> {
  const { stdout } = await run("git", [...args], {
    cwd,
    maxBuffer: GIT_MAX_BUFFER_BYTES,
    timeout: GIT_TIMEOUT_MS,
  });
  return stdout;
}

/**
 * List every worktree registered for a checkout.
 * @param repoPath - Any path inside the repository
 * @returns Registered entries
 */
export async function listWorktrees(
  repoPath: string
): Promise<readonly WorktreeEntry[]> {
  return parseWorktreeList(
    await git(["worktree", "list", "--porcelain"], repoPath)
  );
}

/** The half of the facts that only git and the filesystem can answer. */
export interface WorktreeGitState {
  /** Ownership verdict from the receipt check. */
  readonly ownership: WorktreeFacts["ownership"];
  /** Seconds since the worktree last showed activity. */
  readonly idleSeconds: number;
  /** Modified, staged, added, deleted, or renamed TRACKED files. */
  readonly trackedChanges: number;
  /** Untracked, non-ignored files. */
  readonly untrackedFiles: number;
  /** Commits present locally and on no remote. */
  readonly unpushedCommits: number;
}

/** Inputs shared by every fact-gathering call in one run. */
export interface GatherContext {
  /** Live working directories, or undefined when the probe could not run. */
  readonly liveWorkingDirectories: readonly string[] | undefined;
  /** Owner id of the process running the cleaner. */
  readonly callerOwnerId: string | undefined;
  /** Absolute path the cleaner is running from. */
  readonly currentPath: string;
  /** Clock in epoch milliseconds. */
  readonly nowMs: number;
}

/**
 * Gather every fact the entitlement rule is allowed to consider.
 *
 * A worktree git cannot report on yields `readable: false` with zeroed counts.
 * The zeros are never read as "holds nothing" because `readable: false` is
 * itself a blocker — the same reason the doctor check returns undefined for an
 * unreadable worktree instead of a zeroed exposure.
 * @param entry - Registered worktree entry
 * @param context - Shared run inputs
 * @returns Facts for the entitlement rule
 */
export async function gatherWorktreeFacts(
  entry: WorktreeEntry,
  context: GatherContext
): Promise<WorktreeFacts> {
  // Compared against the PHYSICAL path. `lsof` reports resolved paths, and on
  // macOS the scratch and temp roots agents park worktrees under are symlinks
  // (`/tmp` is `/private/tmp`). Comparing the registered spelling against a
  // resolved one finds no live holder for a worktree somebody is sitting in —
  // a false "abandoned" verdict on exactly the busiest case.
  const physical = await realpath(entry.path).catch(() => entry.path);
  const shell = {
    path: entry.path,
    ...(entry.branch === undefined ? {} : { branch: entry.branch }),
    isPrimary: entry.isPrimary,
    isCurrent: isCurrentWorktree(physical, context.currentPath),
    locked: entry.locked,
    liveHolders:
      context.liveWorkingDirectories === undefined
        ? undefined
        : countLiveHolders(physical, context.liveWorkingDirectories),
  };
  const state = await readWorktreeState(entry.path, context).catch(
    () => undefined
  );
  return state === undefined
    ? {
        ...shell,
        readable: false,
        ownership: "unclaimed",
        idleSeconds: 0,
        trackedChanges: 0,
        untrackedFiles: 0,
        unpushedCommits: 0,
      }
    : { ...shell, readable: true, ...state };
}

/**
 * Read the git-derived half of one worktree's facts.
 * @param worktree - Absolute worktree path
 * @param context - Shared run inputs
 * @returns Ownership, idleness, and work-at-risk facts
 */
async function readWorktreeState(
  worktree: string,
  context: GatherContext
): Promise<WorktreeGitState> {
  const [status, adminDirectory, unpushed] = await Promise.all([
    git(["status", "--porcelain"], worktree),
    git(["rev-parse", "--absolute-git-dir"], worktree).then(out => out.trim()),
    git(["rev-list", "--count", "HEAD", "--not", "--remotes"], worktree),
  ]);
  const lines = status.split("\n").filter(line => line !== "");
  const untrackedFiles = lines.filter(line => line.startsWith("??")).length;
  const receiptOwner = await readOwnerReceipt(adminDirectory);
  return {
    ownership: judgeOwnership(receiptOwner, context.callerOwnerId),
    idleSeconds: await measureIdleSeconds(
      worktree,
      adminDirectory,
      context.nowMs
    ),
    trackedChanges: lines.length - untrackedFiles,
    untrackedFiles,
    unpushedCommits: Number.parseInt(unpushed.trim(), 10) || 0,
  };
}

/**
 * Report whether the cleaner is running inside a worktree.
 * @param worktree - Absolute worktree path
 * @param currentPath - Path the cleaner runs from
 * @returns True when the cleaner is inside
 */
function isCurrentWorktree(worktree: string, currentPath: string): boolean {
  const relative = path.relative(
    path.resolve(worktree),
    path.resolve(currentPath)
  );
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
}

/**
 * Measure how long a worktree has shown no activity.
 *
 * The probes are the worktree root and the control-plane files git touches on
 * every command run inside it. A working-tree edit that misses all of them
 * still cannot slip through, because an edit shows up as a tracked or untracked
 * change, which is a blocker in its own right.
 * @param worktree - Absolute worktree path
 * @param adminDirectory - Worktree's git admin directory
 * @param nowMs - Clock in epoch milliseconds
 * @returns Seconds since the most recent observed activity
 */
async function measureIdleSeconds(
  worktree: string,
  adminDirectory: string,
  nowMs: number
): Promise<number> {
  const probes = [
    worktree,
    path.join(adminDirectory, "HEAD"),
    path.join(adminDirectory, "index"),
    path.join(adminDirectory, "gitdir"),
  ];
  const times = await Promise.all(
    probes.map(probe =>
      stat(probe).then(
        info => info.mtimeMs,
        () => 0
      )
    )
  );
  const newest = Math.max(0, ...times);
  return newest === 0 ? 0 : Math.max(0, Math.floor((nowMs - newest) / 1000));
}

/**
 * Gather facts for many worktrees without spawning git for all of them at once.
 * @param entries - Registered worktree entries
 * @param context - Shared run inputs
 * @param start - Batch start index
 * @returns Facts in the original entry order
 */
export async function gatherAllWorktreeFacts(
  entries: readonly WorktreeEntry[],
  context: GatherContext,
  start = 0
): Promise<readonly WorktreeFacts[]> {
  if (start >= entries.length) return [];
  const batch = entries.slice(start, start + INSPECTION_BATCH_SIZE);
  return [
    ...(await Promise.all(
      batch.map(entry => gatherWorktreeFacts(entry, context))
    )),
    ...(await gatherAllWorktreeFacts(
      entries,
      context,
      start + INSPECTION_BATCH_SIZE
    )),
  ];
}
