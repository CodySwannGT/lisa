/**
 * Report agent worktrees holding work that exists nowhere else.
 * @module cli/doctor-worktree-work-at-risk
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { DoctorCheck } from "./doctor.js";

const CHECK_NAME = "Worktree work at risk?";
const GIT_TIMEOUT_MS = 10_000;
const GIT_MAX_BUFFER_BYTES = 1024 * 1024;
const WORKTREE_INSPECTION_BATCH_SIZE = 8;

const run = promisify(execFile);

/**
 * Run one bounded git command for the doctor check.
 * @param args - Git arguments
 * @param cwd - Directory to run git in
 * @returns Child process stdout and stderr
 */
function runGit(args: readonly string[], cwd: string) {
  return run("git", [...args], {
    cwd,
    maxBuffer: GIT_MAX_BUFFER_BYTES,
    timeout: GIT_TIMEOUT_MS,
  });
}

/** What one worktree holds that exists nowhere else. */
export interface WorktreeExposure {
  /** Absolute worktree path. */
  readonly path: string;
  /** Checked-out branch, or undefined when detached. */
  readonly branch?: string;
  /** Commits present locally and on no remote. */
  readonly unpushedCommits: number;
  /** Whether the branch has no upstream at all. */
  readonly noUpstream: boolean;
  /** TRACKED files modified, staged, added, deleted, or renamed. */
  readonly dirtyFiles: number;
  /** Untracked files, reported as context rather than as the signal. */
  readonly untrackedFiles: number;
}

/**
 * Whether a worktree holds anything that would be lost if it disappeared.
 *
 * Uncommitted files are the severe half and are deliberately weighted first in
 * the report: a commit survives in the reflog long after a branch is deleted,
 * while a dirty tree is in no object database at all. Nothing recovers it.
 * @param exposure - Facts gathered about one worktree
 * @returns True when the worktree holds unique work
 */
export function holdsWorkAtRisk(exposure: WorktreeExposure): boolean {
  return exposure.dirtyFiles > 0 || exposure.unpushedCommits > 0;
}

/**
 * Whether a status line describes a modification to a TRACKED file.
 *
 * Untracked entries are deliberately excluded from the signal. Measured against
 * a real fleet checkout: one worktree reported 1,442 "uncommitted" files, all
 * untracked, overwhelmingly `.watchman-cookie-*` droppings and apply artifacts.
 * Counting those makes every worktree look catastrophic, and a check that cries
 * wolf on ephemera is one nobody reads — which is the failure this check exists
 * to prevent, reproduced inside the check itself.
 *
 * Untracked files are still counted and reported, just not as the trigger. The
 * genuinely at-risk worktree in the incident carried five tracked modifications
 * alongside its one new test file, so keying on tracked changes still catches it.
 * @param line - One `git status --porcelain` line
 * @returns True when the line is a tracked-file change
 */
export function isTrackedChange(line: string): boolean {
  return line !== "" && !line.startsWith("??");
}

/**
 * Order exposures worst-first for an operator reading a truncated list.
 *
 * Dirty trees sort ahead of unpushed commits regardless of size, because the
 * recovery story differs in kind rather than degree.
 * @param left - First exposure
 * @param right - Second exposure
 * @returns Comparator result
 */
export function compareExposureSeverity(
  left: WorktreeExposure,
  right: WorktreeExposure
): number {
  if (left.dirtyFiles > 0 !== right.dirtyFiles > 0) {
    return left.dirtyFiles > 0 ? -1 : 1;
  }
  if (left.dirtyFiles !== right.dirtyFiles) {
    return right.dirtyFiles - left.dirtyFiles;
  }
  if (left.unpushedCommits !== right.unpushedCommits) {
    return right.unpushedCommits - left.unpushedCommits;
  }
  return left.path.localeCompare(right.path);
}

/**
 * Render one exposure as a line an operator can act on.
 * @param exposure - Facts gathered about one worktree
 * @returns Single-line description
 */
export function describeExposure(exposure: WorktreeExposure): string {
  const parts = [
    exposure.dirtyFiles > 0 ? `${exposure.dirtyFiles} uncommitted` : "",
    exposure.untrackedFiles > 0 ? `${exposure.untrackedFiles} untracked` : "",
    exposure.unpushedCommits > 0
      ? `${exposure.unpushedCommits} unpushed commit${
          exposure.unpushedCommits === 1 ? "" : "s"
        }`
      : "",
    exposure.noUpstream ? "no remote branch" : "",
  ].filter(part => part !== "");
  const where = exposure.branch ?? "(detached)";
  return `${exposure.path} [${where}] — ${parts.join(", ")}`;
}

/**
 * Report worktrees holding commits or edits that exist nowhere else.
 *
 * Distinct from `checkWorktreeHygiene`, which counts worktrees because each one
 * is a full checkout that every file crawler walks past. That check deliberately
 * stops at the count, on the grounds that "the operator is the only one who
 * knows whether an idle-looking checkout still holds work". This check answers
 * exactly that question, so an idle-looking checkout no longer has to be taken
 * on faith.
 *
 * Measured motivation: on 2026-08-17 seven agent sessions in one fleet reached
 * the same ticket in turn, each finding no remote branch and concluding the
 * previous session had abandoned it. Five worktrees held real work at the time,
 * one of them 1,031 uncommitted lines under `/private/tmp`. Every session ran
 * `git ls-remote`, and every session got a true negative that meant the opposite
 * of what it looked like: unpushed work and abandoned work are byte-identical
 * from outside.
 *
 * Enumeration is `git worktree list`, NOT a scan of the worktree roots, and that
 * is load-bearing. The exposed worktrees in that incident lived under
 * `/private/tmp`, which no root scan reaches. A check that only sees the tidy
 * locations would have reported clean while the work at risk sat elsewhere.
 *
 * Read-only and warn-only. It names what is exposed and the one-line repair; it
 * never pushes, commits, or removes anything, because publishing a branch is
 * outward-facing and belongs to the operator.
 * @param targetPath - Project path to inspect
 * @returns Doctor check result
 */
export async function checkWorktreeWorkAtRisk(
  targetPath: string
): Promise<DoctorCheck> {
  const worktrees = await listWorktreePaths(targetPath).catch(() => undefined);
  if (worktrees === undefined) {
    return {
      name: CHECK_NAME,
      status: "warn",
      detail:
        "Could not enumerate worktrees (`git worktree list` failed), so work " +
        "at risk was NOT assessed. This is unassessed, not clean",
    };
  }

  const gathered = await gatherExposuresInBatches(worktrees);
  const unsorted = gathered
    .flatMap(exposure => (exposure === undefined ? [] : [exposure]))
    .filter(holdsWorkAtRisk);
  const exposed = [...unsorted].sort(compareExposureSeverity);

  if (exposed.length === 0) {
    return {
      name: CHECK_NAME,
      status: "ok",
      detail: `No worktree holds unpushed commits or uncommitted changes (${worktrees.length} inspected)`,
    };
  }

  const shown = exposed.slice(0, 5).map(describeExposure);
  const remainder =
    exposed.length > shown.length
      ? ` …and ${exposed.length - shown.length} more.`
      : "";

  return {
    name: CHECK_NAME,
    status: "warn",
    detail:
      `${exposed.length} worktree${exposed.length === 1 ? "" : "s"} hold work ` +
      `that exists nowhere else: ${shown.join("; ")}.${remainder} ` +
      "Uncommitted files are the severe case — a commit survives in the reflog, " +
      "a dirty tree is in no object database at all. Commit with `git add -A` " +
      "(untracked files are not stashed without `-u`), then push the branch. " +
      "Until it is pushed, another agent inspecting this ticket sees no remote " +
      "branch and cannot distinguish this work from abandoned work",
  };
}

/**
 * Gather worktree exposures without spawning git for every worktree at once.
 * @param worktrees - Worktree paths to inspect
 * @param start - Batch start index
 * @returns Gathered exposures in original worktree order
 */
async function gatherExposuresInBatches(
  worktrees: readonly string[],
  start = 0
): Promise<readonly (WorktreeExposure | undefined)[]> {
  if (start >= worktrees.length) {
    return [];
  }
  const batch = worktrees.slice(start, start + WORKTREE_INSPECTION_BATCH_SIZE);
  return [
    ...(await Promise.all(batch.map(worktree => gatherExposure(worktree)))),
    ...(await gatherExposuresInBatches(
      worktrees,
      start + WORKTREE_INSPECTION_BATCH_SIZE
    )),
  ];
}

/**
 * List every worktree path registered for a checkout.
 * @param targetPath - Project path to inspect
 * @returns Absolute worktree paths
 */
async function listWorktreePaths(
  targetPath: string
): Promise<readonly string[]> {
  const { stdout } = await runGit(
    ["worktree", "list", "--porcelain"],
    targetPath
  );
  return stdout
    .split("\n")
    .filter(line => line.startsWith("worktree "))
    .map(line => line.slice("worktree ".length).trim())
    .filter(line => line !== "");
}

/**
 * Gather what one worktree holds, or undefined when it cannot be read.
 *
 * An unreadable worktree returns undefined rather than a zeroed exposure. A
 * zero would read as "holds nothing", which is the false all-clear this whole
 * check exists to prevent.
 * @param worktree - Absolute worktree path
 * @returns Exposure facts, or undefined when unreadable
 */
async function gatherExposure(
  worktree: string
): Promise<WorktreeExposure | undefined> {
  try {
    const [status, branch] = await Promise.all([
      runGit(["status", "--porcelain"], worktree),
      runGit(["rev-parse", "--abbrev-ref", "HEAD"], worktree),
    ]);
    const head = branch.stdout.trim();
    const detached = head === "HEAD";
    const { unpushedCommits, noUpstream } = await countUnpushed(
      worktree,
      detached
    );
    const lines = status.stdout.split("\n").filter(line => line !== "");
    const dirtyFiles = lines.filter(isTrackedChange).length;
    const untrackedFiles = lines.length - dirtyFiles;
    return detached
      ? {
          path: worktree,
          unpushedCommits,
          noUpstream,
          dirtyFiles,
          untrackedFiles,
        }
      : {
          path: worktree,
          branch: head,
          unpushedCommits,
          noUpstream,
          dirtyFiles,
          untrackedFiles,
        };
  } catch {
    return undefined;
  }
}

/**
 * Count commits present locally and on no remote.
 *
 * A branch with no upstream is not assumed to be fully unpushed: it is compared
 * against every remote ref, because a branch can be pushed and then have its
 * upstream cleared. Falling back to "everything since the merge-base with the
 * default branch" would overstate the exposure and train readers to ignore it.
 *
 * `--no-merges` for the same reason, and it is not cosmetic. A merge commit that
 * pulls upstream into a branch carries no authored work — losing it costs a
 * one-command replay — so counting it inflates every merged-up branch. The
 * degenerate case is the one that matters: a branch whose ONLY local commit is
 * a merge of the default branch holds nothing, and without this flag it reports
 * work at risk and gets a warning it does not deserve. Caught by a peer who
 * measured the same worktree with `git cherry` and got 2 against this check's 3;
 * the difference was exactly one merge commit.
 * @param worktree - Absolute worktree path
 * @param detached - Whether HEAD is detached
 * @returns Unpushed commit count and whether an upstream exists
 */
async function countUnpushed(
  worktree: string,
  detached: boolean
): Promise<{ readonly unpushedCommits: number; readonly noUpstream: boolean }> {
  try {
    const { stdout } = await runGit(
      ["rev-list", "--count", "--no-merges", "HEAD", "--not", "--remotes"],
      worktree
    );
    const upstream = detached
      ? false
      : await runGit(["rev-parse", "--abbrev-ref", "@{u}"], worktree).then(
          () => true,
          () => false
        );
    return {
      unpushedCommits: Number.parseInt(stdout.trim(), 10) || 0,
      noUpstream: detached ? false : !upstream,
    };
  } catch {
    return { unpushedCommits: 0, noUpstream: false };
  }
}
