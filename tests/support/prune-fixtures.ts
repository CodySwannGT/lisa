/**
 * Real-git fixtures for the cleanup-verb suites (CodySwannGT/lisa#2993).
 *
 * Shared by the negative-controls suite and the report-reachability suite, so
 * both drive the same repository shape — a bare remote, one published commit,
 * and worktrees on branches that are already on that remote. A fixture that
 * drifted between the two would let one suite prove something about a
 * repository the other never builds.
 * @module tests/support/prune-fixtures
 */
import { type ChildProcess, spawn } from "node:child_process";
import { realpathSync } from "node:fs";
import { writeFileSync } from "node:fs";
import * as path from "node:path";
import { afterEach, vi } from "vitest";
import { boundedSpawnSync } from "../helpers/io-latency-budget.js";
import { cleanupTempDir, createTempDir } from "../helpers/test-utils.js";
import { cleanGitEnv, GIT_BIN } from "./git-executable.js";

const IDENTITY = {
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@t",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@t",
};

/** Zero quiescence, so a fixture's freshness never masks the real blocker. */
export const NO_IDLE_WINDOW = { idleHours: "0" };

/** The helpers one suite gets, bound to that suite's cleanup. */
export interface PruneFixtures {
  /** Run one git command against a fixture and return trimmed stdout. */
  readonly runGit: (args: readonly string[], cwd: string) => string;
  /** Build a repository with a remote, one commit, and everything published. */
  readonly createPublishedRepo: () => Promise<string>;
  /** Add a worktree on a branch that is already published. */
  readonly addPublishedWorktree: (root: string, name: string) => string;
  /** Spawn a live process inside a directory and wait for it to be visible. */
  readonly holdDirectoryOpen: (cwd: string) => Promise<void>;
  /** Capture what the runners write to the real stdout stream. */
  readonly captureStdout: () => { text: () => string };
}

/**
 * Register the fixtures and their cleanup for one suite.
 * @returns Fixture helpers bound to this suite
 */
export function usePruneFixtures(): PruneFixtures {
  const temporaryDirectories: string[] = [];
  const children: ChildProcess[] = [];

  const runGit = (args: readonly string[], cwd: string): string =>
    (
      boundedSpawnSync({
        label: `git ${args[0] ?? ""}`,
        command: GIT_BIN,
        args,
        cwd,
        env: { ...cleanGitEnv(), ...IDENTITY },
      }).stdout ?? ""
    ).trim();

  const createPublishedRepo = async (): Promise<string> => {
    const temporary = realpathSync.native(await createTempDir());
    const remote = path.join(temporary, "remote.git");
    const root = path.join(temporary, "primary");
    temporaryDirectories.push(temporary);
    runGit(["init", "-q", "--bare", remote], temporary);
    runGit(["init", "-q", "-b", "main", root], temporary);
    writeFileSync(path.join(root, "file.txt"), "one\n", "utf8");
    runGit(["add", "."], root);
    runGit(["commit", "-q", "-m", "init"], root);
    runGit(["remote", "add", "origin", remote], root);
    runGit(["push", "-q", "-u", "origin", "main"], root);
    return root;
  };

  const addPublishedWorktree = (root: string, name: string): string => {
    const worktree = path.join(root, ".worktrees", name);
    runGit(["worktree", "add", "-q", "-b", name, worktree, "main"], root);
    runGit(["push", "-q", "-u", "origin", name], worktree);
    return worktree;
  };

  const holdDirectoryOpen = async (cwd: string): Promise<void> => {
    const child = spawn(
      process.execPath,
      ["-e", "setInterval(() => {}, 1000)"],
      { cwd, stdio: "ignore" }
    );
    children.push(child);
    await new Promise(resolve => {
      setTimeout(resolve, 500);
    });
  };

  // Reads the REAL stream rather than an injected sink: the runners write
  // through `process.stdout`, so a test against an injected writer would pass
  // while the wiring printed nothing to an operator.
  const captureStdout = (): { text: () => string } => {
    const chunks: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
      chunks.push(String(chunk));
      return true;
    });
    return { text: () => chunks.join("") };
  };

  afterEach(async () => {
    vi.restoreAllMocks();
    children.splice(0).forEach(child => {
      child.kill("SIGKILL");
    });
    for (const dir of temporaryDirectories.splice(0)) {
      await cleanupTempDir(dir);
    }
  });

  return {
    runGit,
    createPublishedRepo,
    addPublishedWorktree,
    holdDirectoryOpen,
    captureStdout,
  };
}
