/**
 * Harness for driving the REAL parity-safety-net.sh hook in tests.
 *
 * Spawns the hook as a bash subprocess with PreToolUse JSON on stdin and
 * surfaces its exit status: 2 = blocked, 0 = allowed. Also builds the temp git
 * repos the working-tree-state guards (reset --hard/--merge) are asserted in.
 * @module tests/helpers/safety-net-guard-harness
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
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
export const createGuardHarness = (baseEnv: EnvMap): GuardHarness => {
  const strippedEnv = (): EnvMap =>
    Object.fromEntries(
      Object.entries(baseEnv).filter(([key]) => !key.startsWith("GIT_"))
    );

  const runHookRaw = (input: string, options: RunOptions): HookResult => {
    const result = spawnSync(BASH_PATH, [HOOK_PATH], {
      cwd: options.cwd,
      encoding: "utf-8",
      env: {
        ...strippedEnv(),
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

  const gitIn = (cwd: string, ...args: readonly string[]): void => {
    const result = spawnSync(GIT_BIN, [...args], {
      cwd,
      encoding: "utf-8",
      env: {
        ...strippedEnv(),
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_CONFIG_SYSTEM: "/dev/null",
      },
    });
    if (result.status !== 0) {
      throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
    }
  };

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

  return { runHookRaw, runHook, makeRepo };
};
