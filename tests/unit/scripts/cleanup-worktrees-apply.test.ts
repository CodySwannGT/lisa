/**
 * Proof that `cleanup-worktrees.sh --apply` survives its first removal.
 *
 * `process_worktree` builds `local force_flag=()` and expands it into the
 * removal command. Under `set -u`, bash before 4.4 treats the expansion of an
 * EMPTY array as an unbound variable and aborts — and 4.4 is newer than the
 * 3.2.57 that ships as `/bin/bash` on macOS, which is where this script mostly
 * runs. The abort landed on the FIRST removal candidate, so `--apply` exited 1
 * having printed no summary and removed nothing.
 *
 * That crash was an accidental backstop for the unreadable-worktree defect its
 * sibling suite pins: while `--apply` could not run, the harm was a false clean
 * report rather than deleted work. The two fixes therefore land together, and
 * this case is what stops the crash being reintroduced as a "safety" measure.
 *
 * ## Two assertions, because one of them is platform-conditional
 *
 * The behavioural case can only FAIL where the interpreter has the bug — on
 * bash 4.4+ the unfixed script runs fine, so on Linux CI it is a smoke test
 * rather than a fence. The source-shape case is the portable half: it fails
 * everywhere the guarded expansion is removed. Neither is redundant.
 *
 * `--apply` is passed here, unlike every case in the sibling suite. It is safe
 * because the only thing this test can delete is the throwaway repository it
 * built two lines earlier under the run-scoped temporary directory.
 * @module tests/unit/scripts/cleanup-worktrees-apply
 */
import { existsSync } from "node:fs";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
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
const AGENT_BRANCH = "worktree-disposable";
const TRACKED_FILE = "tracked.txt";
const SAFE_COMMAND_PATH = `${path.dirname(
  GIT_BIN
)}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin`;

/** One fixture repository and the removable worktree linked to it. */
interface Fixture {
  /** Primary checkout the script is pointed at. */
  readonly repo: string;
  /** Linked worktree that satisfies every removal precondition. */
  readonly worktree: string;
}

let tempDir: string | undefined;

/**
 * Resolve the run-scoped scratch directory for one case.
 * @returns Temporary directory path
 */
async function getTempDir(): Promise<string> {
  tempDir ??= await mkdtemp(path.join(os.tmpdir(), "lisa-cleanup-apply-"));
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
 * Build a repository with one linked worktree that is genuinely removable.
 *
 * Clean tree, agent branch name, HEAD already on `origin/main`, and an age the
 * caller waives with `--min-age-days 0`. Nothing here holds work, which is what
 * makes it a legitimate `--apply` target and what puts the empty `force_flag`
 * array on the path the script takes.
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
  return { repo, worktree };
}

/**
 * Run the real cleanup script against a disposable fixture repository.
 * @param repo - Primary checkout to sweep
 * @param apply - Whether to pass `--apply`
 * @param pathPrefix - Directory to prepend to PATH, for shadowing a binary
 * @returns Exit status and everything the script printed
 */
function runCleanup(
  repo: string,
  apply: boolean,
  pathPrefix?: string
): {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
} {
  const result = boundedSpawnSync({
    label: `cleanup-worktrees.sh (${apply ? "apply" : "dry run"})`,
    command: "/bin/bash",
    args: [
      CLEANUP_SCRIPT,
      "--min-age-days",
      "0",
      ...(apply ? ["--apply"] : []),
      repo,
    ],
    env: {
      HOME: path.dirname(repo),
      PATH:
        pathPrefix === undefined
          ? SAFE_COMMAND_PATH
          : `${pathPrefix}:${SAFE_COMMAND_PATH}`,
    },
  });
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

/**
 * Build a `git` that fails only for `worktree list`, and return its directory.
 *
 * Shadowing the real binary is the only way to reach the orphan sweep's
 * enumeration-failure branch: the script refuses a non-repository up front, so
 * the failure has to come from the one subcommand rather than from the repo.
 * Every other invocation is delegated to the real git unchanged.
 * @param root - Directory to create the stub under
 * @returns Directory to prepend to PATH
 */
async function stubGitFailingWorktreeList(root: string): Promise<string> {
  const binDir = path.join(root, "stub-bin");
  await mkdir(binDir, { recursive: true });
  const stub = path.join(binDir, "git");
  await writeFile(
    stub,
    [
      "#!/bin/bash",
      "seen_worktree=0",
      'for arg in "$@"; do',
      '  if [ "$arg" = "worktree" ]; then seen_worktree=1; fi',
      '  if [ "$seen_worktree" = 1 ] && [ "$arg" = "list" ]; then',
      '    echo "fatal: simulated enumeration failure" >&2',
      "    exit 128",
      "  fi",
      "done",
      `exec ${GIT_BIN} "$@"`,
      "",
    ].join("\n"),
    "utf8"
  );
  await chmod(stub, 0o755);
  return binDir;
}

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { force: true, recursive: true });
    tempDir = undefined;
  }
});

describe("cleanup-worktrees.sh --apply with no force flag to pass", () => {
  // Control. The same fixture in dry-run reaches the same decision, so a
  // failure below is about `--apply` and not about the fixture being ineligible.
  it("would remove a clean, pushed, agent-named worktree in dry run", async () => {
    const { repo } = await createFixture();

    const { status, stdout } = runCleanup(repo, false);

    expect(status).toBe(0);
    expect(stdout).toContain("WOULD-REMOVE");
  });

  it("completes the removal instead of aborting on the empty force-flag array", async () => {
    const { repo, worktree } = await createFixture();

    const { status, stdout, stderr } = runCleanup(repo, true);

    // Measured pre-fix on bash 3.2.57: stderr carries `force_flag[@]: unbound
    // variable`, the exit status is 1, the summary is never printed because the
    // abort happens mid-loop, and the worktree is still there.
    expect(stderr).not.toContain("unbound variable");
    expect(status).toBe(0);
    // Not `toContain("REMOVE")` — "WOULD-REMOVE" contains it, so that spelling
    // passes in dry run and says nothing about whether anything was applied.
    expect(stdout).not.toContain("WOULD-REMOVE");
    expect(stdout).toContain("=== summary ===");
    expect(stdout).toContain("removed (or would remove): 1");
    expect(existsSync(worktree)).toBe(false);
  });

  it("guards the array expansion in the source, which is the portable half", async () => {
    // The behavioural case above can only fail on bash < 4.4. This one fails on
    // every platform if the guard is dropped, so the fix cannot be undone on a
    // machine whose bash happens to tolerate it.
    const source = await readFile(CLEANUP_SCRIPT, "utf8");

    expect(source).toContain('${force_flag[@]+"${force_flag[@]}"}');
    expect(source).not.toContain('worktree remove "${force_flag[@]}"');
  });

  it("never sweeps orphan directories from an enumeration it could not read", async () => {
    // The orphan sweep ends in `rm -rf`, which bypasses `git worktree remove`'s
    // own refusal to delete a dirty worktree — so a failed `git worktree list`
    // reading as "nothing is registered" deletes live work outright. The guard
    // is fenced in the source rather than behaviourally because making the
    // enumeration fail also breaks the main loop that feeds it, so a fixture
    // cannot isolate this branch without stubbing git itself.
    const source = await readFile(CLEANUP_SCRIPT, "utf8");

    expect(source).toContain("registered_rc");
    expect(source).toContain("SKIP orphan sweep");
    // The pipe-per-candidate form is what read a failure as an absence.
    expect(source).not.toContain(
      'if ! git -C "$REPO" worktree list --porcelain | grep -qF'
    );
    // Whole-line match: a registered `wt-280` must not mark `wt-28` registered.
    expect(source).toContain('grep -qxF "worktree $d"');
  });

  it("skips the orphan sweep entirely when it could not enumerate worktrees", async () => {
    // The discriminating case for the arm that ends in a recursive delete. A
    // failed enumeration produces empty output, so every registered worktree
    // reads as unregistered and the sweep treats live work as an orphan. The
    // source-shape case above cannot catch a mutant that keeps the tokens and
    // makes the branch dead; this one fails on any implementation that sweeps
    // from an enumeration it did not prove.
    const { repo } = await createFixture();
    await mkdir(path.join(repo, ".claude", "worktrees", "looks-orphaned"), {
      recursive: true,
    });
    const stubDir = await stubGitFailingWorktreeList(path.dirname(repo));

    const { status, stdout } = runCleanup(repo, false, stubDir);

    expect(status).toBe(0);
    expect(stdout).toContain("SKIP orphan sweep");
    expect(stdout).not.toContain("orphan dir, not a registered worktree");
    expect(stdout).toContain("orphan dirs: 0");
  });
});
