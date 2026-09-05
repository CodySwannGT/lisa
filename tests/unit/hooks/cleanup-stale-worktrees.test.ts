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
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";
import { resolveGit } from "../../support/git-executable.js";

const HOOK_PATH = path.resolve(
  "plugins/src/base/hooks/cleanup-stale-worktrees.sh"
);
const BASH_PATH = "/bin/bash";
const GIT_PATH = resolveGit();
const UNCOMMITTED_BYTES = "export const answer = 42;\n";
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

  boundedSpawnSync({
    label: "git init --bare (remote)",
    command: GIT_PATH,
    args: ["init", "-q", "--bare", remote],
    env,
  });
  boundedSpawnSync({
    label: "git init (primary)",
    command: GIT_PATH,
    args: ["init", "-q", root],
    env,
  });
  boundedSpawnSync({
    label: "git commit --allow-empty",
    command: GIT_PATH,
    args: ["commit", "-q", "--allow-empty", "-m", "init"],
    cwd: root,
    env: { ...env, ...GIT_IDENTITY },
  });
  boundedSpawnSync({
    label: "git remote add origin",
    command: GIT_PATH,
    args: ["remote", "add", "origin", remote],
    cwd: root,
    env,
  });
  boundedSpawnSync({
    label: "git push origin HEAD:main",
    command: GIT_PATH,
    args: ["push", "-q", "origin", "HEAD:refs/heads/main"],
    cwd: root,
    env: { ...env, ...GIT_IDENTITY },
  });
  boundedSpawnSync({
    label: "git worktree add stale-branch",
    command: GIT_PATH,
    args: ["worktree", "add", "-q", worktree, "-b", "stale-branch"],
    cwd: root,
    env: { ...env, ...GIT_IDENTITY },
  });
  boundedSpawnSync({
    label: "git push origin stale-branch",
    command: GIT_PATH,
    args: ["push", "-q", "origin", "stale-branch:refs/heads/stale-branch"],
    cwd: worktree,
    env: { ...env, ...GIT_IDENTITY },
  });

  return { root, worktree };
}

/**
 * Deliver the content-reachability guard where an applied host project has it.
 *
 * The sweep resolves `scripts/lisa-worktree-guard.mjs` first, so a fixture that
 * copies the real script there exercises the real wiring rather than a stub.
 * @param root - Primary repo root
 */
function deliverGuard(root: string): void {
  const source = path.resolve("all/copy-overwrite/scripts");
  const dest = path.join(root, "scripts");

  mkdirSync(dest, { recursive: true });
  copyFileSync(
    path.join(source, "lisa-worktree-guard.mjs"),
    path.join(dest, "lisa-worktree-guard.mjs")
  );
  // The shared `lib/` is copied WHOLE rather than by naming the modules the
  // guard imports: a fixture that lists them is a second copy of the guard's
  // dependency set, and it reports clean for the entire period it is wrong.
  cpSync(path.join(source, "lib"), path.join(dest, "lib"), {
    recursive: true,
  });
}

/**
 * Commit one file in a worktree and push its branch, so the sweep's
 * HEAD-is-pushed gate still passes.
 * @param worktree - Linked worktree path
 * @param file - Repo-relative file to commit
 */
function commitAndPush(worktree: string, file: string): void {
  const env = { ...cleanGitEnv(), ...GIT_IDENTITY };
  boundedSpawnSync({
    label: "git add",
    command: GIT_PATH,
    args: ["add", file],
    cwd: worktree,
    env,
  });
  boundedSpawnSync({
    label: "git commit",
    command: GIT_PATH,
    args: ["commit", "-q", "-m", "keep"],
    cwd: worktree,
    env,
  });
  boundedSpawnSync({
    label: "git push origin stale-branch",
    command: GIT_PATH,
    args: [
      "push",
      "-q",
      "-f",
      "origin",
      "stale-branch:refs/heads/stale-branch",
    ],
    cwd: worktree,
    env,
  });
}

/**
 * Locate the admin index file for a linked worktree so it can be corrupted
 * to force `git status` to fail there while other git plumbing still works.
 * @param worktree - Path to the linked worktree
 * @returns Absolute path to that worktree's index file
 */
function worktreeIndexPath(worktree: string): string {
  const gitDir = boundedSpawnSync({
    label: "git rev-parse --git-dir",
    command: GIT_PATH,
    args: ["rev-parse", "--git-dir"],
    cwd: worktree,
    env: cleanGitEnv(),
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
  const result = boundedSpawnSync({
    label: "cleanup-stale-worktrees.sh",
    command: BASH_PATH,
    args: [HOOK_PATH],
    cwd: root,
    env: {
      ...cleanGitEnv(),
      LISA_WORKTREE_MAX_AGE_DAYS: "0",
      ...extraEnv,
    },
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

  it("does NOT remove a worktree holding untracked bytes that exist in no commit", async () => {
    const { root, worktree } = await createRepoWithPushedWorktree();
    deliverGuard(root);
    writeFileSync(path.join(worktree, "fresh.ts"), UNCOMMITTED_BYTES);

    const { status } = runHook(root);

    expect(status).toBe(0);
    expect(existsSync(worktree)).toBe(true);
  });

  it("still removes a worktree whose untracked bytes are already committed", async () => {
    const { root, worktree } = await createRepoWithPushedWorktree();
    deliverGuard(root);
    writeFileSync(path.join(worktree, "kept.ts"), UNCOMMITTED_BYTES);
    commitAndPush(worktree, "kept.ts");
    writeFileSync(path.join(worktree, "duplicate.ts"), UNCOMMITTED_BYTES);

    const { status } = runHook(root);

    expect(status).toBe(0);
    expect(existsSync(worktree)).toBe(false);
  });

  it("falls back to keeping any untracked worktree when the guard is absent", async () => {
    const { root, worktree } = await createRepoWithPushedWorktree();
    writeFileSync(path.join(worktree, "fresh.ts"), UNCOMMITTED_BYTES);

    const { status } = runHook(root);

    expect(status).toBe(0);
    expect(existsSync(worktree)).toBe(true);
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
