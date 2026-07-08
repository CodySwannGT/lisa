/**
 * Tests for the SessionEnd cleanup-stale-worktrees.sh hook.
 *
 * The hook sweeps abandoned agent worktrees under `<repo>/.claude/worktrees`,
 * but only removes a worktree when ALL safety gates hold: no modified/staged
 * tracked files, HEAD reachable from a remote ref, and old enough. A failed
 * `git status` (corrupted index, permission issue, etc.) must NOT be treated
 * as "clean" — an unreadable worktree state must never be swept.
 * @module tests/unit/hooks/cleanup-stale-worktrees
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

const HOOK_PATH = path.resolve(
  "plugins/src/base/hooks/cleanup-stale-worktrees.sh"
);
const BASH_PATH = "/bin/bash";
const GIT_PATH = "/usr/bin/git";
const GIT_IDENTITY = {
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@t",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@t",
};

/**
 * Return process env without outer git hook state for nested temp repos.
 * @returns Environment safe for fixture git commands
 */
function cleanGitEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith("GIT_")) {
      delete env[key];
    }
  }
  return env;
}

let tempDirs: string[] = [];

afterEach(async () => {
  for (const dir of tempDirs) {
    await cleanupTempDir(dir);
  }
  tempDirs = [];
});

/**
 * Build a primary repo (with a pushable remote) plus one pushed worktree
 * under `.claude/worktrees/<name>` that is old enough to be swept.
 * @returns The primary repo root and the worktree path
 */
async function createRepoWithPushedWorktree(): Promise<{
  root: string;
  worktree: string;
}> {
  const tempDir = await createTempDir();
  const remote = path.join(tempDir, "remote.git");
  const root = path.join(tempDir, "primary");
  const env = cleanGitEnv();
  const worktree = path.join(root, ".claude", "worktrees", "stale");

  tempDirs.push(tempDir);

  spawnSync(GIT_PATH, ["init", "-q", "--bare", remote], { env });
  spawnSync(GIT_PATH, ["init", "-q", root], { env });
  spawnSync(GIT_PATH, ["commit", "-q", "--allow-empty", "-m", "init"], {
    cwd: root,
    env: { ...env, ...GIT_IDENTITY },
  });
  spawnSync(GIT_PATH, ["remote", "add", "origin", remote], {
    cwd: root,
    env,
  });
  spawnSync(GIT_PATH, ["push", "-q", "origin", "HEAD:refs/heads/main"], {
    cwd: root,
    env: { ...env, ...GIT_IDENTITY },
  });
  spawnSync(
    GIT_PATH,
    ["worktree", "add", "-q", worktree, "-b", "stale-branch"],
    { cwd: root, env: { ...env, ...GIT_IDENTITY } }
  );
  spawnSync(
    GIT_PATH,
    ["push", "-q", "origin", "stale-branch:refs/heads/stale-branch"],
    { cwd: worktree, env: { ...env, ...GIT_IDENTITY } }
  );

  return { root, worktree };
}

/**
 * Locate the admin index file for a linked worktree so it can be corrupted
 * to force `git status` to fail there while other git plumbing still works.
 * @param worktree - Path to the linked worktree
 * @returns Absolute path to that worktree's index file
 */
function worktreeIndexPath(worktree: string): string {
  const gitDir = spawnSync(GIT_PATH, ["rev-parse", "--git-dir"], {
    cwd: worktree,
    env: cleanGitEnv(),
    encoding: "utf-8",
  }).stdout.trim();
  return path.isAbsolute(gitDir)
    ? path.join(gitDir, "index")
    : path.join(worktree, gitDir, "index");
}

/**
 * Run the hook against a primary repo root.
 * @param root - Primary repo root (hook's cwd)
 * @param extraEnv - Extra environment overrides for the hook run
 * @returns The hook's exit status
 */
function runHook(
  root: string,
  extraEnv: NodeJS.ProcessEnv = {}
): { status: number | null } {
  const result = spawnSync(BASH_PATH, [HOOK_PATH], {
    cwd: root,
    env: {
      ...cleanGitEnv(),
      LISA_WORKTREE_MAX_AGE_DAYS: "0",
      ...extraEnv,
    },
    encoding: "utf-8",
  });
  return { status: result.status };
}

describe("cleanup-stale-worktrees.sh", () => {
  it("removes a pushed, clean, old-enough worktree", async () => {
    const { root, worktree } = await createRepoWithPushedWorktree();

    const { status } = runHook(root);

    expect(status).toBe(0);
    expect(existsSync(worktree)).toBe(false);
  });

  it("does NOT remove a worktree when git status fails (corrupted index)", async () => {
    const { root, worktree } = await createRepoWithPushedWorktree();

    // Corrupt the worktree's index so `git status` fails there while
    // `git rev-parse HEAD` and `git branch -r --contains` still succeed.
    const indexPath = worktreeIndexPath(worktree);
    await import("node:fs/promises").then(({ writeFile }) =>
      writeFile(indexPath, "not a git index")
    );

    const { status } = runHook(root);

    expect(status).toBe(0);
    expect(existsSync(worktree)).toBe(true);
  });
});
