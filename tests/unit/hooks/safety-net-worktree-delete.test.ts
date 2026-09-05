/**
 * Tests for the parity-safety-net.sh guard against `rm -rf` of a linked git
 * worktree (CodySwannGT/lisa#3863).
 *
 * `git worktree remove` already refuses a dirty tree and `--force` is already
 * blocked, so the spelling that reached a live worktree was the one git never
 * sees: a recursive delete of the directory. What it destroys is not
 * recoverable from anywhere else — `.git/refs` and the object store are shared
 * between worktrees, `.git/index` and the working files are not.
 *
 * The guard is asserted in BOTH directions, because a rule that blocks
 * everything is indistinguishable from one that works: a registered worktree
 * blocks, and a sibling directory whose name merely shares a prefix with one
 * does not.
 * @module tests/unit/hooks/safety-net-worktree-delete
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";
import { resolveGit } from "../../support/git-executable.js";

const HOOK_PATH = path.resolve("plugins/lisa/hooks/parity-safety-net.sh");
const BASH_PATH = "/bin/bash";
const GIT_PATH = resolveGit();
const EXIT_BLOCKED = 2;
const EXIT_ALLOWED = 0;
const LINKED = "linked";

/**
 * Process env with outer git hook state stripped, plus a fixture identity.
 * @returns Environment safe for fixture git commands
 */
function cleanGitEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith("GIT_")) delete env[key];
  }
  env.GIT_AUTHOR_NAME = "t";
  env.GIT_AUTHOR_EMAIL = "t@t";
  env.GIT_COMMITTER_NAME = "t";
  env.GIT_COMMITTER_EMAIL = "t@t";
  return env;
}

/**
 * Run git in a fixture directory.
 * @param cwd - Directory to run in
 * @param args - Arguments after `git`
 */
function git(cwd: string, args: string[]): void {
  boundedSpawnSync({
    label: `git ${args[0]}`,
    command: GIT_PATH,
    args,
    cwd,
    env: cleanGitEnv(),
  });
}

let tempDirs: string[] = [];

afterEach(async () => {
  for (const dir of tempDirs) await cleanupTempDir(dir);
  tempDirs = [];
});

/**
 * A repository whose primary checkout holds one linked worktree at
 * `worktrees/linked`, plus an unrelated `worktrees/linked-extra` directory.
 * @returns The primary checkout path
 */
async function fixture(): Promise<string> {
  const tempDir = await createTempDir();
  const primary = path.join(tempDir, "primary");

  tempDirs.push(tempDir);
  mkdirSync(primary, { recursive: true });
  git(primary, ["init", "-q", "-b", "main", "."]);
  writeFileSync(path.join(primary, "seed.txt"), "seed\n");
  git(primary, ["add", "seed.txt"]);
  git(primary, ["commit", "-q", "-m", "seed"]);
  git(primary, [
    "worktree",
    "add",
    "-q",
    path.join("worktrees", LINKED),
    "-b",
    "side",
  ]);
  mkdirSync(path.join(primary, "worktrees", "linked-extra"), {
    recursive: true,
  });

  return primary;
}

/**
 * Screen one Bash command through the real hook.
 * @param command - The proposed Bash command
 * @param primary - Project directory the hook runs in
 * @returns The hook's exit status
 */
function runHook(command: string, primary: string): number | null {
  const result = boundedSpawnSync({
    label: "parity-safety-net.sh",
    command: BASH_PATH,
    args: [HOOK_PATH],
    cwd: primary,
    input: JSON.stringify({
      tool_name: "Bash",
      tool_input: { command },
    }),
    env: { ...cleanGitEnv(), CLAUDE_PROJECT_DIR: primary },
  });
  return result.status;
}

describe("parity-safety-net.sh worktree-delete guard", () => {
  it("blocks a recursive delete of a linked worktree by relative path", async () => {
    const primary = await fixture();

    expect(runHook(`rm -rf worktrees/${LINKED}`, primary)).toBe(EXIT_BLOCKED);
  });

  it("blocks the same delete by absolute path", async () => {
    const primary = await fixture();
    const target = path.join(primary, "worktrees", LINKED);

    expect(runHook(`rm -rf "${target}"`, primary)).toBe(EXIT_BLOCKED);
  });

  it("blocks it with a trailing slash", async () => {
    const primary = await fixture();

    expect(runHook(`rm -rf worktrees/${LINKED}/`, primary)).toBe(EXIT_BLOCKED);
  });

  it("blocks it spelled from the project root as ./", async () => {
    const primary = await fixture();

    expect(runHook(`rm -rf ./worktrees/${LINKED}`, primary)).toBe(EXIT_BLOCKED);
  });

  it("allows a sibling directory whose name merely shares the prefix", async () => {
    const primary = await fixture();

    expect(runHook("rm -rf worktrees/linked-extra", primary)).toBe(
      EXIT_ALLOWED
    );
  });

  it("allows cleaning a subdirectory inside a worktree", async () => {
    const primary = await fixture();

    expect(runHook(`rm -rf worktrees/${LINKED}/node_modules`, primary)).toBe(
      EXIT_ALLOWED
    );
  });

  it("allows a non-recursive delete of the worktree path", async () => {
    const primary = await fixture();

    expect(runHook(`rm worktrees/${LINKED}`, primary)).toBe(EXIT_ALLOWED);
  });
});
