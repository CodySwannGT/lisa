/**
 * Proof that `cleanup-worktrees.sh` distinguishes "I looked and it was clean"
 * from "I could not look."
 *
 * Both KEEP predicates that protect real work read git through a command
 * substitution: `[ -n "$(git -C "$wt" status --porcelain ... 2>/dev/null)" ]`.
 * A command substitution collapses a FAILED git invocation to the empty string,
 * and `-n ""` is false, so an unreadable worktree takes the same branch as a
 * spotless one and falls through every guard to removal.
 *
 * The unreadable state used here is a short index file, which is what a killed
 * git process leaves behind — the ordinary outcome of the concurrency pressure
 * this repository already reaps worktrees for. It is chosen because it fails
 * only the predicate under test: `git status` exits 128, while `rev-parse HEAD`
 * and `branch -r --contains` still answer, so the worktree clears the
 * unpushed-work guard on its own merits and the decision turns purely on the
 * unreadable status.
 *
 * DRY-RUN THROUGHOUT. No case passes `--apply`, so the script reports decisions
 * and deletes nothing.
 * @module tests/unit/scripts/cleanup-worktrees-unreadable
 *
 * COVERAGE CAVEAT, so symmetry is not mistaken for coverage: only the FIRST of
 * the two guards is independently pinned here. The fixture corrupts the index,
 * so `--untracked-files=no` fails and the tracked-only guard returns before the
 * untracked check below it is ever reached. Deleting the second guard leaves
 * this suite green — measured. Pinning it needs a state where the tracked-only
 * read succeeds and the full status fails, which git does not readily produce.
 */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  boundedExecFileSync,
  boundedSpawnSync,
  useIoLatencyBudget,
} from "../../helpers/io-latency-budget.js";
import { cleanGitEnv, GIT_BIN } from "../../support/git-executable.js";

useIoLatencyBudget();

const repoRoot = path.resolve(import.meta.dirname, "../../..");
const CLEANUP_SCRIPT = path.join(repoRoot, "scripts", "cleanup-worktrees.sh");
/** Matches the script's `worktree-*` agent-branch pattern, so it is eligible. */
const AGENT_BRANCH = "worktree-broken";
const TRACKED_FILE = "tracked.txt";
const SAFE_COMMAND_PATH = `${path.dirname(
  GIT_BIN
)}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin`;

/** One fixture repository, its linked worktree, and that worktree's admin dir. */
interface Fixture {
  /** Primary checkout the script is pointed at. */
  readonly repo: string;
  /** Linked worktree carrying an uncommitted tracked change. */
  readonly worktree: string;
  /** The linked worktree's git admin directory, which holds its index. */
  readonly adminDir: string;
}

let tempDir: string | undefined;

/**
 * Resolve the run-scoped scratch directory for one case.
 * @returns Temporary directory path
 */
async function getTempDir(): Promise<string> {
  tempDir ??= await mkdtemp(path.join(os.tmpdir(), "lisa-cleanup-worktrees-"));
  return tempDir;
}

/**
 * Run one git command against a fixture, isolated from the developer's git.
 * @param cwd - Directory to run git in
 * @param hooks - Empty directory standing in for a hooks path
 * @param args - Git arguments
 * @returns Captured stdout
 */
function git(cwd: string, hooks: string, ...args: readonly string[]): string {
  return boundedExecFileSync({
    label: `git ${args.join(" ")}`,
    command: GIT_BIN,
    args: [
      "-c",
      "user.email=fixture@example.invalid",
      "-c",
      "user.name=Lisa Fixture",
      "-c",
      "commit.gpgsign=false",
      "-c",
      `core.hooksPath=${hooks}`,
      ...args,
    ],
    cwd,
    env: { ...cleanGitEnv(), HOME: cwd },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/**
 * Build a repository with one linked, agent-named, pushed, dirty worktree.
 *
 * Every removal precondition the script checks is deliberately satisfied except
 * the dirt: an agent branch name, a HEAD that is on `origin/main`, and an age
 * the caller waives with `--min-age-days 0`. That leaves the tracked-changes
 * guard as the only thing standing between this worktree and deletion.
 * @returns Fixture paths
 */
async function createFixture(): Promise<Fixture> {
  const root = await getTempDir();
  const origin = path.join(root, "origin");
  const repo = path.join(root, "repo");
  const worktree = path.join(root, "parked-elsewhere", AGENT_BRANCH);
  const hooks = path.join(root, "no-hooks");
  await mkdir(origin, { recursive: true });
  await mkdir(hooks, { recursive: true });
  await mkdir(path.dirname(worktree), { recursive: true });

  git(root, hooks, "init", "--initial-branch=main", origin);
  await writeFile(path.join(origin, TRACKED_FILE), "committed\n");
  git(origin, hooks, "add", TRACKED_FILE);
  git(origin, hooks, "commit", "-m", "base");
  git(root, hooks, "clone", origin, repo);
  git(repo, hooks, "worktree", "add", "-b", AGENT_BRANCH, worktree);

  // Real work that exists nowhere else: an uncommitted edit to a TRACKED file.
  await writeFile(
    path.join(worktree, TRACKED_FILE),
    "an agent's uncommitted work\n"
  );
  const adminDir = git(
    worktree,
    hooks,
    "rev-parse",
    "--absolute-git-dir"
  ).trim();
  return { repo, worktree, adminDir };
}

/**
 * Leave a short index file behind so git can no longer report the status.
 *
 * What a SIGKILLed git leaves behind. `git status` then exits 128, while the
 * ref-only queries the script's other guards use keep working.
 * @param adminDir - The worktree's git admin directory
 */
async function makeStatusUnreadable(adminDir: string): Promise<void> {
  await writeFile(path.join(adminDir, "index"), "short");
}

/**
 * Run the real cleanup script in dry-run against a fixture repository.
 * @param repo - Primary checkout to sweep
 * @returns Everything the script printed
 */
function runCleanup(repo: string): string {
  const result = boundedSpawnSync({
    label: "cleanup-worktrees.sh (dry run)",
    command: "/bin/bash",
    // No `--apply`: the script reports decisions and removes nothing.
    args: [CLEANUP_SCRIPT, "--min-age-days", "0", repo],
    env: { HOME: path.dirname(repo), PATH: SAFE_COMMAND_PATH },
  });
  expect(result.status).toBe(0);
  return result.stdout;
}

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { force: true, recursive: true });
    tempDir = undefined;
  }
});

describe("cleanup-worktrees.sh on a worktree it cannot read", () => {
  // Control. Everything about this worktree matches the cases below except that
  // git can still answer, and the script keeps it. Without this case a failure
  // below could just as easily mean the fixture never made the worktree
  // eligible for removal in the first place.
  it("keeps a readable worktree that holds uncommitted tracked changes", async () => {
    const { repo } = await createFixture();

    const output = runCleanup(repo);

    expect(output).toContain("KEEP (modified tracked files)");
    expect(output).not.toContain("WOULD-REMOVE");
  });

  it("keeps a worktree whose git status cannot be read rather than reporting it removable", async () => {
    const { repo, adminDir } = await createFixture();
    await makeStatusUnreadable(adminDir);

    const output = runCleanup(repo);

    expect(output).not.toContain("WOULD-REMOVE");
    // The REASON, not just the outcome. `not.toContain("WOULD-REMOVE")` alone
    // passes if the worktree is kept for any reason at all, so a future change
    // that broke an unrelated predicate into always-keep would leave it green.
    expect(output).toContain("KEEP (git could not report on it");
  });

  it("does not count an unreadable worktree among the worktrees it would remove", async () => {
    const { repo, adminDir } = await createFixture();
    await makeStatusUnreadable(adminDir);

    const output = runCleanup(repo);

    expect(output).toContain("removed (or would remove): 0");
    // Pins the bucket itself. Without this the counter and its summary field
    // can both be deleted with every test still passing — measured.
    expect(output).toContain("1 unreadable");
  });
});
