/**
 * The worktree-binding guard's test harness: one fixture repository with two
 * linked worktrees, and one way to feed the guard a hook envelope.
 *
 * Extracted when CodySwannGT/lisa#3924 added the script-reach cases and put the
 * suite over the 300-line budget. Shared rather than copied on purpose — a
 * duplicated fixture builder is the same class of defect these guards exist to
 * catch, and the budget was the signal rather than the problem.
 * @module tests/unit/hooks/support/worktree-binding
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, expect } from "vitest";

import { boundedSpawnSync } from "../../../helpers/io-latency-budget.js";
import { cleanGitEnv, resolveGit } from "../../../support/git-executable.js";

const GUARD_PATH = path.resolve(
  "plugins/src/base/hooks/worktree-binding-guard.mjs"
);
export const GIT_PATH = resolveGit();

/** Claude's refusal code. Anything else lets the tool call through. */
export const BLOCKED = 2;
export const ALLOWED = 0;

export const SESSION = "session-under-test";
/** Git's quiet flag, named because the fixture repeats it. */
export const QUIET = "-q";
/** This guard's spawn label, named because every case spawns it. */
export const GUARD_LABEL = "worktree-binding-guard";

/**
 * Directories to remove after each case.
 *
 * A const array emptied in place rather than a reassigned `let`: the
 * `afterEach` below closes over this binding, and reassigning it would leave
 * the hook draining a list nobody is adding to.
 */
const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { force: true, recursive: true });
  }
  tempDirs.length = 0;
});

/** Absolute paths of one fixture repository and its two linked worktrees. */
/**
 * Track a directory this suite created, for removal after the case.
 *
 * The cleanup list lives here because the `afterEach` that drains it does,
 * and two lists would mean whichever module a case reached for decided
 * whether its fixture was removed.
 * @param dir - Absolute path to remove after the current test
 */
export function trackTempDir(dir: string): void {
  tempDirs.push(dir);
}

/** Absolute paths of one fixture repository and its two linked worktrees. */
export interface Fixture {
  /** The main checkout. */
  readonly main: string;
  /** The worktree a session binds to first. */
  readonly a: string;
  /** The worktree it is told, falsely, that it moved to. */
  readonly b: string;
  /** Where the guard keeps its per-session binding. */
  readonly state: string;
}

/**
 * Run git in a fixture directory, failing loudly on a non-zero exit.
 * @param cwd - Directory to run in
 * @param args - Git arguments
 */
export function git(cwd: string, args: readonly string[]): void {
  const result = boundedSpawnSync({
    label: `git ${args[0]}`,
    command: GIT_PATH,
    args: [...args],
    cwd,
    env: cleanGitEnv(),
  });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  }
}

/**
 * A repository with two linked worktrees and an empty guard state directory.
 * @returns Absolute paths of the fixture pieces
 */
export function buildFixture(): Fixture {
  const root = mkdtempSync(path.join(tmpdir(), "lisa-wtb-"));
  const main = path.join(root, "main");
  const state = path.join(root, "state");
  const a = path.join(root, "wt-a");
  const b = path.join(root, "wt-b");

  tempDirs.push(root);
  git(root, ["init", QUIET, "main"]);
  git(main, ["config", "user.email", "t@example.invalid"]);
  git(main, ["config", "user.name", "Test"]);
  writeFileSync(path.join(main, "seed.txt"), "seed\n");
  git(main, ["add", "seed.txt"]);
  git(main, ["commit", QUIET, "-m", "seed"]);
  git(main, ["worktree", "add", QUIET, "-b", "branch-a", a]);
  git(main, ["worktree", "add", QUIET, "-b", "branch-b", b]);

  return { main, a, b, state };
}

/** One hook envelope: what the session is about to do, and from where. */
export interface Call {
  readonly cwd: string;
  readonly tool?: string;
  readonly input?: Record<string, unknown>;
  readonly session?: string;
  readonly state: string;
}

/**
 * Feed one hook envelope to the guard.
 * @param call - What the session is about to do, and from where
 * @returns The completed spawn result
 */
export function runGuard(call: Call) {
  const payload = {
    session_id: call.session ?? SESSION,
    cwd: call.cwd,
    tool_name: call.tool ?? "Bash",
    tool_input: call.input ?? { command: "echo hello" },
  };
  return boundedSpawnSync({
    label: GUARD_LABEL,
    command: process.execPath,
    args: [GUARD_PATH],
    cwd: call.cwd,
    env: { ...cleanGitEnv(), LISA_STATE_HOME: call.state },
    input: JSON.stringify(payload),
  });
}

/**
 * Feed a raw envelope, for the malformed-input cases.
 * @param raw - Exact stdin bytes
 * @param cwd - Directory to run the guard in
 * @param state - Guard state home
 * @returns The completed spawn result
 */
export function runRaw(raw: string, cwd: string, state: string) {
  return boundedSpawnSync({
    label: GUARD_LABEL,
    command: process.execPath,
    args: [GUARD_PATH],
    cwd,
    env: { ...cleanGitEnv(), LISA_STATE_HOME: state },
    input: raw,
  });
}

/**
 * Bind the session to a worktree, the way its first tool call would.
 * @param fixture - The repository under test
 * @param worktree - Worktree the session is to be bound to
 */
export function bindTo(fixture: Fixture, worktree: string): void {
  expect(runGuard({ cwd: worktree, state: fixture.state }).status).toBe(
    ALLOWED
  );
}
