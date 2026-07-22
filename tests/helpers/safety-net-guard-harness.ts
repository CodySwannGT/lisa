/**
 * Harness for driving the REAL parity-safety-net.sh hook in tests.
 *
 * Spawns the hook as a bash subprocess with PreToolUse JSON on stdin and
 * surfaces its exit status: 2 = blocked, 0 = allowed. Also builds the temp git
 * repos the working-tree-state guards (reset --hard/--merge) are asserted in.
 * @module tests/helpers/safety-net-guard-harness
 */
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const HOOK_PATH = path.resolve("plugins/lisa/hooks/parity-safety-net.sh");
const BASH_PATH = "/bin/bash";
const GIT_BIN = "/usr/bin/git";
const README = "README.md";

/** Exit status the hook uses to deny a command. */
export const EXIT_BLOCKED = 2;

/** Exit status the hook uses to let a command proceed. */
export const EXIT_ALLOWED = 0;

/** Expected hook verdict for a fixture. */
export type Verdict = "allow" | "block";

/** One row of the guard-parity matrix. */
export interface GuardFixture {
  readonly id: string;
  readonly command: string;
  readonly expected: Verdict;
  readonly guard: string;
}

/** A guard-matrix row whose verdict depends on working-tree state. */
export interface GitStateFixture extends GuardFixture {
  readonly repo: "clean" | "dirty";
}

/** Mid-rebase repository shapes for the rebase-abort guard (#1956 Fix 4). */
export type RebaseRepoKind =
  | "apply-conflict"
  | "conflict-missing-automerge"
  | "conflict-resolved"
  | "conflict-untouched"
  | "wedged-clean";

/** A guard-matrix row whose verdict depends on in-progress rebase state. */
export interface RebaseStateFixture extends GuardFixture {
  readonly repo: RebaseRepoKind;
}

/** An environment map as spawned processes accept it. */
type EnvMap = Record<string, string | undefined>;

/** Exit status and stderr captured from one hook invocation. */
interface HookResult {
  readonly status: number | null;
  readonly stderr: string;
}

/** Per-invocation working directory and extra environment. */
interface RunOptions {
  readonly cwd: string;
  readonly env?: EnvMap;
}

/** The hook/git runners bound to a sanitized base environment. */
interface GuardHarness {
  readonly runHookRaw: (input: string, options: RunOptions) => HookResult;
  readonly runHook: (command: string, options: RunOptions) => HookResult;
  readonly makeRepo: (root: string, name: string, dirty: boolean) => string;
  readonly makeRebaseRepo: (
    root: string,
    name: string,
    kind: RebaseRepoKind
  ) => string;
}

/**
 * Maps a verdict to the exit status the hook must produce.
 * @param verdict - Expected verdict.
 * @returns 2 for block, 0 for allow.
 */
export const expectedStatus = (verdict: Verdict): number =>
  verdict === "block" ? EXIT_BLOCKED : EXIT_ALLOWED;

/**
 * Binds the hook/git runners to a base environment.
 *
 * Hook-managed GIT_DIR / GIT_WORK_TREE / GIT_INDEX_FILE poison git
 * subprocesses in temp repos (known repo learning), so every spawn strips
 * GIT_* wholesale from the given base env.
 * @param baseEnv - Environment to inherit (callers pass process.env).
 * @returns The bound harness.
 */
/** Repeated literals used by the rebase repo builders. */
const MAIN_BRANCH = "main";
const FEATURE_BRANCH = "feature";
const CONFLICTED_FILE = "conflicted.txt";
const BRANCH_CHANGE = "feat: branch change";
const BASE_CHANGE = "chore: base change";

/** Throwing git runner bound to a repo directory. */
type GitRunner = (cwd: string, ...args: readonly string[]) => void;

/** Non-throwing git runner returning the exit status. */
type GitStatusRunner = (cwd: string, ...args: readonly string[]) => number;

/**
 * Strips hook-managed GIT_* variables from an environment map.
 *
 * Hook-managed GIT_DIR / GIT_WORK_TREE / GIT_INDEX_FILE poison git
 * subprocesses in temp repos (known repo learning).
 * @param baseEnv - Environment to sanitize.
 * @returns The environment without GIT_* keys.
 */
const stripGitVars = (baseEnv: EnvMap): EnvMap =>
  Object.fromEntries(
    Object.entries(baseEnv).filter(([key]) => !key.startsWith("GIT_"))
  );

/**
 * Seeds a feature/main divergence that rebases CLEANLY, then installs a
 * failing prepare-commit-msg hook so the pick cannot commit — the exact #1956
 * clean wedge: rebase-merge exists, no unmerged paths, and both the worktree
 * and the index match the AUTO_MERGE tree.
 * @param dir - Seeded repo on the feature branch.
 * @param gitIn - Throwing git runner.
 */
const seedWedgedCleanRepo = (dir: string, gitIn: GitRunner): void => {
  const hookFile = path.join(dir, ".git", "hooks", "prepare-commit-msg");
  writeFileSync(path.join(dir, "branch.txt"), "branch\n");
  gitIn(dir, "add", "branch.txt");
  gitIn(dir, "commit", "-m", BRANCH_CHANGE);
  gitIn(dir, "switch", MAIN_BRANCH);
  writeFileSync(path.join(dir, "base.txt"), "base advance\n");
  gitIn(dir, "add", "base.txt");
  gitIn(dir, "commit", "-m", BASE_CHANGE);
  gitIn(dir, "switch", FEATURE_BRANCH);
  mkdirSync(path.dirname(hookFile), { recursive: true });
  writeFileSync(hookFile, "#!/bin/sh\nexit 1\n");
  chmodSync(hookFile, 0o755);
};

/**
 * Seeds a feature/main divergence where both sides rewrite the same file so a
 * rebase stops on a conflict.
 * @param dir - Seeded repo on the feature branch.
 * @param gitIn - Throwing git runner.
 */
const seedConflictRepo = (dir: string, gitIn: GitRunner): void => {
  const conflicted = path.join(dir, CONFLICTED_FILE);
  writeFileSync(conflicted, "feature\n");
  gitIn(dir, "add", CONFLICTED_FILE);
  gitIn(dir, "commit", "-m", BRANCH_CHANGE);
  gitIn(dir, "switch", MAIN_BRANCH);
  writeFileSync(conflicted, "main\n");
  gitIn(dir, "add", CONFLICTED_FILE);
  gitIn(dir, "commit", "-m", BASE_CHANGE);
  gitIn(dir, "switch", FEATURE_BRANCH);
};

/**
 * Drives a seeded repo into the requested mid-rebase state (#1956 Fix 4).
 * @param dir - Repo directory produced by makeRepo.
 * @param kind - Mid-rebase shape to build.
 * @param gitIn - Throwing git runner.
 * @param gitTry - Non-throwing git runner (the rebase is expected to stop).
 * @returns The repo directory.
 */
const buildRebaseState = (
  dir: string,
  kind: RebaseRepoKind,
  gitIn: GitRunner,
  gitTry: GitStatusRunner
): string => {
  gitIn(dir, "switch", "-c", FEATURE_BRANCH);
  if (kind === "wedged-clean") seedWedgedCleanRepo(dir, gitIn);
  else seedConflictRepo(dir, gitIn);
  if (
    gitTry(
      dir,
      ...(kind === "apply-conflict"
        ? ["rebase", "--apply", MAIN_BRANCH]
        : ["rebase", MAIN_BRANCH])
    ) === 0
  ) {
    throw new Error(`expected the ${kind} rebase to stop before completing`);
  }
  if (kind === "conflict-resolved") {
    writeFileSync(path.join(dir, CONFLICTED_FILE), "resolved by a human\n");
    gitIn(dir, "add", CONFLICTED_FILE);
  }
  if (kind === "conflict-missing-automerge") {
    gitIn(dir, "update-ref", "-d", "AUTO_MERGE");
  }
  return dir;
};

export const createGuardHarness = (baseEnv: EnvMap): GuardHarness => {
  const runHookRaw = (input: string, options: RunOptions): HookResult => {
    const result = spawnSync(BASH_PATH, [HOOK_PATH], {
      cwd: options.cwd,
      encoding: "utf-8",
      env: {
        ...stripGitVars(baseEnv),
        CLAUDE_PROJECT_DIR: options.cwd,
        // Point at a path that does not exist so project-local custom rules
        // cannot leak into built-in guard assertions.
        SAFETY_NET_RULES_FILE: path.join(options.cwd, "no-rules-here.txt"),
        ...options.env,
      },
      input,
    });
    return { status: result.status, stderr: result.stderr };
  };

  const runHook = (command: string, options: RunOptions): HookResult =>
    runHookRaw(
      JSON.stringify({ tool_name: "Bash", tool_input: { command } }),
      options
    );

  const spawnGit = (cwd: string, args: readonly string[]) =>
    spawnSync(GIT_BIN, [...args], {
      cwd,
      encoding: "utf-8",
      env: {
        ...stripGitVars(baseEnv),
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_CONFIG_SYSTEM: "/dev/null",
      },
    });

  const gitIn = (cwd: string, ...args: readonly string[]): void => {
    const result = spawnGit(cwd, args);
    if (result.status !== 0) {
      throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
    }
  };

  const gitTry = (cwd: string, ...args: readonly string[]): number =>
    spawnGit(cwd, args).status ?? 1;

  const makeRepo = (root: string, name: string, dirty: boolean): string => {
    const dir = path.join(root, name);
    mkdirSync(dir);
    gitIn(dir, "init", "--initial-branch=main");
    gitIn(dir, "config", "user.email", "safety-net-test@lisa.dev");
    gitIn(dir, "config", "user.name", "Lisa Safety Net Test");
    writeFileSync(path.join(dir, README), "seed\n");
    gitIn(dir, "add", README);
    gitIn(dir, "commit", "-m", "seed");
    if (dirty) {
      writeFileSync(path.join(dir, README), "seed\nuncommitted edit\n");
    }
    return dir;
  };

  const makeRebaseRepo = (
    root: string,
    name: string,
    kind: RebaseRepoKind
  ): string =>
    buildRebaseState(makeRepo(root, name, false), kind, gitIn, gitTry);

  return { runHookRaw, runHook, makeRepo, makeRebaseRepo };
};
