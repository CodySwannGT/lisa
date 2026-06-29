/**
 * Tests for the managed WorktreeCreate hook.
 *
 * Claude Code replaces its default worktree creation with this hook, so the
 * contract is strict: create the worktree, print ONLY its absolute path on
 * stdout, exit 0. The hook reads `{ name, cwd }` from stdin (the observed
 * payload — the docs' `worktree_name`/`base_path` fields do not appear), mirrors
 * the default `<cwd>/.claude/worktrees/<name>` layout on a `worktree-<name>`
 * branch, and keeps all git chatter off stdout.
 * @module tests/unit/hooks/worktree-create
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const HOOK_PATH = path.resolve(
  "typescript/copy-overwrite/.claude/hooks/worktree-create.sh"
);
const SH_PATH = "/bin/sh";
const GIT_PATH = "/usr/bin/git";
const GIT_IDENTITY = {
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@t",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@t",
};
const hasJq = spawnSync(SH_PATH, ["-c", "command -v jq"]).status === 0;

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

afterEach(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { force: true, recursive: true });
  }
  tempDirs = [];
});

/**
 * Create an initialized git repo in a fresh temp dir.
 * @returns The repo root path
 */
function createGitRepo(): string {
  const root = mkdtempSync(path.join(tmpdir(), "lisa-worktree-create-"));
  tempDirs.push(root);
  spawnSync(GIT_PATH, ["init", "-q"], { cwd: root, env: cleanGitEnv() });
  spawnSync(GIT_PATH, ["commit", "-q", "--allow-empty", "-m", "init"], {
    cwd: root,
    env: { ...cleanGitEnv(), ...GIT_IDENTITY },
  });
  return root;
}

/**
 * Run the hook with a WorktreeCreate stdin payload.
 * @param root - Project root passed as `cwd` in the payload
 * @param name - Worktree name
 * @returns The hook's exit status, trimmed stdout, and stderr
 */
function runHook(
  root: string,
  name: string
): { status: number | null; stdout: string; stderr: string } {
  const payload = JSON.stringify({
    hook_event_name: "WorktreeCreate",
    name,
    cwd: root,
  });
  const result = spawnSync(SH_PATH, [HOOK_PATH], {
    cwd: root,
    env: cleanGitEnv(),
    input: payload,
    encoding: "utf-8",
  });
  // Raw stdout (not trimmed): the contract is "ONLY the path", so tests assert
  // the exact `<path>\n` shape and catch any stray whitespace/chatter.
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

describe.skipIf(!hasJq)("WorktreeCreate hook", () => {
  it("creates <cwd>/.claude/worktrees/<name> and prints exactly its path", () => {
    const root = createGitRepo();
    const { status, stdout } = runHook(root, "featureX");
    const expected = path.join(root, ".claude", "worktrees", "featureX");

    expect(status).toBe(0);
    expect(stdout).toBe(`${expected}\n`);
    expect(existsSync(expected)).toBe(true);
  });

  it("checks out a worktree-<name> branch", () => {
    const root = createGitRepo();
    const { stdout } = runHook(root, "featureY");
    const branch = spawnSync(GIT_PATH, ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd: stdout.trim(),
      env: cleanGitEnv(),
      encoding: "utf-8",
    }).stdout.trim();
    expect(branch).toBe("worktree-featureY");
  });

  it("is idempotent: re-creating returns the same path and succeeds", () => {
    const root = createGitRepo();
    const first = runHook(root, "featureZ");
    const second = runHook(root, "featureZ");
    expect(second.status).toBe(0);
    expect(second.stdout).toBe(first.stdout);
  });

  it("emits only the path on stdout — no git chatter", () => {
    const root = createGitRepo();
    const expected = path.join(root, ".claude", "worktrees", "clean");
    expect(runHook(root, "clean").stdout).toBe(`${expected}\n`);
  });

  it("aborts with a non-zero exit when the payload has no name", () => {
    const root = createGitRepo();
    const result = spawnSync(SH_PATH, [HOOK_PATH], {
      cwd: root,
      env: cleanGitEnv(),
      input: JSON.stringify({ hook_event_name: "WorktreeCreate", cwd: root }),
      encoding: "utf-8",
    });
    expect(result.status).not.toBe(0);
    expect((result.stdout ?? "").trim()).toBe("");
  });

  it("rejects an unsafe worktree name (path traversal) without creating it", () => {
    const root = createGitRepo();
    const { status, stdout } = runHook(root, "../escape");
    expect(status).not.toBe(0);
    expect(stdout.trim()).toBe("");
    expect(existsSync(path.join(root, "..", "escape"))).toBe(false);
  });
});
