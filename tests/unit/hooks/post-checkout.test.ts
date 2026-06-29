/**
 * Tests for the managed post-checkout worktree plugin-bootstrap hook.
 *
 * A git worktree is a distinct project path to Claude Code, so plugins enabled
 * in .claude/settings.json are "not installed here" for the worktree until
 * `claude plugin install --scope project` runs against that path — leaving
 * guardrail hooks off in worktree sessions. The hook seeds those installs once,
 * at `git worktree add` time, guarded so it only fires inside a worktree, on a
 * branch checkout, once per worktree.
 * @module tests/unit/hooks/post-checkout
 */
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const HOOK_PATH = path.resolve("typescript/copy-contents/.husky/post-checkout");
const SH_PATH = "/bin/sh";
const GIT_PATH = "/usr/bin/git";
const NULL_SHA = "0".repeat(40);
const HEAD_SHA = "1".repeat(40);
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

/** A temp git repo wired with a fake `claude` for exercising the hook. */
interface Repo {
  /** Target root — a linked worktree, or the primary checkout. */
  readonly root: string;
  /** Directory holding the fake `claude` binary, prepended to PATH. */
  readonly binDir: string;
  /** File the fake `claude` appends its argv to. */
  readonly callsFile: string;
}

/**
 * Create a temp git repo and, when requested, a REAL linked worktree off it,
 * seed .claude/settings.json with the enabled plugins, and a fake `claude` that
 * logs its argv. The hook detects linked worktrees via git metadata (private
 * git dir ≠ common dir), so fixtures must be genuine worktrees rather than a
 * directory that merely looks like one.
 * @param options - Fixture shape
 * @param options.worktree - Whether `root` is a linked worktree or the primary checkout
 * @param enabledPlugins - Map written to .claude/settings.json enabledPlugins
 * @returns The target root, fake-bin directory, and the claude-call log path
 */
function createRepo(
  options: { readonly worktree: boolean },
  enabledPlugins: Record<string, boolean>
): Repo {
  const base = mkdtempSync(path.join(tmpdir(), "lisa-post-checkout-"));
  const main = path.join(base, "main");
  const binDir = path.join(base, "bin");
  const callsFile = path.join(base, "claude-calls.log");
  const claudeBin = path.join(binDir, "claude");
  const root = options.worktree
    ? path.join(main, ".claude", "worktrees", "wtA")
    : main;

  tempDirs.push(base);
  mkdirSync(main, { recursive: true });
  mkdirSync(binDir, { recursive: true });
  spawnSync(GIT_PATH, ["init", "-q"], { cwd: main, env: cleanGitEnv() });
  spawnSync(GIT_PATH, ["commit", "-q", "--allow-empty", "-m", "init"], {
    cwd: main,
    env: { ...cleanGitEnv(), ...GIT_IDENTITY },
  });

  if (options.worktree) {
    spawnSync(GIT_PATH, ["worktree", "add", "-q", "-b", "feat", root, "HEAD"], {
      cwd: main,
      env: { ...cleanGitEnv(), ...GIT_IDENTITY },
    });
  }

  mkdirSync(path.join(root, ".claude"), { recursive: true });
  writeFileSync(
    path.join(root, ".claude", "settings.json"),
    JSON.stringify({ enabledPlugins })
  );
  writeFileSync(claudeBin, `#!/bin/sh\necho "$*" >> "${callsFile}"\n`);
  chmodSync(claudeBin, 0o755);

  return { root, binDir, callsFile };
}

/**
 * Run the hook in the repo with a given checkout flag and the fake claude on PATH.
 * @param repo - Repo context from createRepo
 * @param flag - post-checkout's third arg ("1" = branch checkout, "0" = file)
 * @returns The fake-claude calls recorded during the run
 */
function runHook(repo: Repo, flag: string): string[] {
  spawnSync(SH_PATH, [HOOK_PATH, NULL_SHA, HEAD_SHA, flag], {
    cwd: repo.root,
    env: { ...cleanGitEnv(), PATH: `${repo.binDir}:${process.env.PATH ?? ""}` },
    encoding: "utf-8",
  });
  if (!existsSync(repo.callsFile)) {
    return [];
  }
  return readFileSync(repo.callsFile, "utf-8").split("\n").filter(Boolean);
}

const INSTALL_LISA = "plugin install lisa@lisa --scope project";
const WORKTREE = { worktree: true } as const;
const MAIN = { worktree: false } as const;

describe.skipIf(!hasJq)("post-checkout worktree plugin bootstrap", () => {
  it("installs each enabled plugin at project scope inside a worktree", () => {
    const repo = createRepo(WORKTREE, {
      "lisa@lisa": true,
      "coderabbit@claude-plugins-official": true,
    });
    const calls = runHook(repo, "1");
    expect(calls).toContain("plugin marketplace update lisa");
    expect(calls).toContain(INSTALL_LISA);
    expect(calls).toContain(
      "plugin install coderabbit@claude-plugins-official --scope project"
    );
  });

  it("skips plugin ids containing shell-unsafe characters", () => {
    const repo = createRepo(WORKTREE, {
      "lisa@lisa": true,
      "bad;rm -rf": true,
    });
    const calls = runHook(repo, "1");
    expect(calls).toContain(INSTALL_LISA);
    expect(calls.some(call => call.includes("bad;rm"))).toBe(false);
  });

  it("does not install plugins disabled (set to false) in settings", () => {
    const repo = createRepo(WORKTREE, {
      "lisa@lisa": true,
      "code-review@claude-plugins-official": false,
    });
    const calls = runHook(repo, "1");
    expect(calls).toContain(INSTALL_LISA);
    expect(calls.some(call => call.includes("code-review"))).toBe(false);
  });

  it("is idempotent: a second checkout is a no-op (sentinel)", () => {
    const repo = createRepo(WORKTREE, { "lisa@lisa": true });
    const first = runHook(repo, "1");
    const second = runHook(repo, "1");
    expect(second).toEqual(first);
  });

  it("does nothing on a file checkout (flag 0)", () => {
    const repo = createRepo(WORKTREE, { "lisa@lisa": true });
    expect(runHook(repo, "0")).toEqual([]);
  });

  it("does nothing in the primary (non-worktree) checkout", () => {
    const repo = createRepo(MAIN, { "lisa@lisa": true });
    expect(runHook(repo, "1")).toEqual([]);
  });
});
