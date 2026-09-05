/**
 * The worktree-binding guard's shell wrapper, driven as a shell script.
 *
 * The mutation gate cannot instrument a `.sh` file in any configuration — no
 * mutant can be generated for one — so it is silent about this half by
 * construction and says so on every push. The only evidence a shell guard can
 * have is a driving test that feeds it a payload and asserts the verdict with
 * a control on BOTH sides: a suite that proved only the refusal would pass
 * equally against a wrapper that refuses everything, and one that proved only
 * the allow would pass against a wrapper that is a no-op.
 *
 * Kept apart from the classifier's own suite because it is a different subject
 * — what the wrapper contributes is exit-code passthrough and the announced
 * degradation when its interpreter or its classifier is not there, none of
 * which the `.mjs` can be asked about.
 * @module tests/unit/hooks/worktree-binding-guard-wrapper
 */
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";
import { cleanGitEnv, resolveGit } from "../../support/git-executable.js";

const WRAPPER_PATH = path.resolve(
  "plugins/src/base/hooks/worktree-binding-guard.sh"
);
const GIT_PATH = resolveGit();
/** The wrapper's basename: its spawn label, its suite name, and the name a
 * detached copy of it must keep for the sibling-resolution case to be real. */
const WRAPPER_NAME = "worktree-binding-guard.sh";
const SESSION = "wrapper-session";
const QUIET = "-q";

/** Claude's refusal code. Anything else lets the tool call through. */
const BLOCKED = 2;
const ALLOWED = 0;

let tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { force: true, recursive: true });
  }
  tempDirs = [];
});

/**
 * Run git in a fixture directory, failing loudly on a non-zero exit.
 * @param cwd - Directory to run in
 * @param args - Git arguments
 */
function git(cwd: string, args: readonly string[]): void {
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

/** A repository with two linked worktrees and a private guard state home. */
interface Fixture {
  /** The main checkout, also used as a scratch directory. */
  readonly main: string;
  /** The worktree the session binds to first. */
  readonly a: string;
  /** A second worktree, standing in for a displacement. */
  readonly b: string;
  /** Where the guard keeps its per-session binding. */
  readonly state: string;
}

/**
 * Build the repository the wrapper is driven against.
 * @returns Absolute paths of the fixture pieces
 */
function buildFixture(): Fixture {
  const root = mkdtempSync(path.join(tmpdir(), "lisa-wtbw-"));
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

/**
 * Run the wrapper the way a hook runs it.
 * @param script - Wrapper to execute
 * @param cwd - Directory the session is acting from
 * @param state - Guard state home
 * @returns The completed spawn result
 */
function runWrapper(script: string, cwd: string, state: string) {
  return boundedSpawnSync({
    label: WRAPPER_NAME,
    command: "/bin/bash",
    args: [script],
    cwd,
    env: { ...cleanGitEnv(), LISA_STATE_HOME: state },
    input: JSON.stringify({
      session_id: SESSION,
      cwd,
      tool_name: "Bash",
      tool_input: { command: "echo hello" },
    }),
  });
}

describe(WRAPPER_NAME, () => {
  it("allows the bound worktree and refuses the displaced one", () => {
    const fixture = buildFixture();
    expect(runWrapper(WRAPPER_PATH, fixture.a, fixture.state).status).toBe(
      ALLOWED
    );
    const result = runWrapper(WRAPPER_PATH, fixture.b, fixture.state);
    expect(result.status).toBe(BLOCKED);
    expect(result.stderr).toContain("wt-b");
  });

  it("fails open and announces itself when the classifier is missing", () => {
    const fixture = buildFixture();
    const orphan = path.join(fixture.main, WRAPPER_NAME);
    copyFileSync(WRAPPER_PATH, orphan);
    expect(runWrapper(WRAPPER_PATH, fixture.a, fixture.state).status).toBe(
      ALLOWED
    );
    const result = runWrapper(orphan, fixture.b, fixture.state);
    expect(result.status).toBe(ALLOWED);
    expect(result.stderr).toContain("NOT active");
  });
});
