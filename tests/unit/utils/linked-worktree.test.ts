/** Linked-worktree primary-root resolution coverage. */
import * as fs from "fs-extra";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolvePrimaryWorktreeRoot } from "../../../src/utils/linked-worktree.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

describe("utils/linked-worktree", () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.realpath(await createTempDir());
  });

  afterEach(async () => {
    await cleanupTempDir(root);
  });

  /**
   * Lay out a primary checkout plus a linked worktree without spawning git.
   * @param options - Fixture switches.
   * @param options.primaryHasClaudeDir - Whether the primary gets a .claude
   *   directory.
   * @param options.relativeGitdir - Whether the worktree .git file uses a
   *   relative gitdir path.
   * @returns Absolute primary and worktree roots.
   */
  async function writeWorktreeFixture(options: {
    primaryHasClaudeDir: boolean;
    relativeGitdir?: boolean;
  }): Promise<{ primary: string; worktree: string }> {
    const primary = path.join(root, "primary");
    const worktree = path.join(root, "wt");
    const gitdir = path.join(primary, ".git", "worktrees", "wt");
    await fs.mkdirp(gitdir);
    await fs.mkdirp(worktree);
    if (options.primaryHasClaudeDir) {
      await fs.mkdirp(path.join(primary, ".claude"));
    }
    const target = options.relativeGitdir
      ? path.relative(worktree, gitdir)
      : gitdir;
    await fs.writeFile(path.join(worktree, ".git"), `gitdir: ${target}\n`);
    return { primary, worktree };
  }

  it("resolves the primary root from an absolute gitdir pointer", async () => {
    const { primary, worktree } = await writeWorktreeFixture({
      primaryHasClaudeDir: true,
    });

    expect(await resolvePrimaryWorktreeRoot(worktree)).toBe(primary);
  });

  it("resolves the primary root from a relative gitdir pointer", async () => {
    const { primary, worktree } = await writeWorktreeFixture({
      primaryHasClaudeDir: true,
      relativeGitdir: true,
    });

    expect(await resolvePrimaryWorktreeRoot(worktree)).toBe(primary);
  });

  it("returns null when the primary checkout has no .claude directory", async () => {
    const { worktree } = await writeWorktreeFixture({
      primaryHasClaudeDir: false,
    });

    expect(await resolvePrimaryWorktreeRoot(worktree)).toBeNull();
  });

  it("returns null for a primary checkout (.git directory)", async () => {
    const primary = path.join(root, "repo");
    await fs.mkdirp(path.join(primary, ".git"));
    await fs.mkdirp(path.join(primary, ".claude"));

    expect(await resolvePrimaryWorktreeRoot(primary)).toBeNull();
  });

  it("returns null for a submodule-style gitdir pointer", async () => {
    const submodule = path.join(root, "sub");
    await fs.mkdirp(submodule);
    await fs.writeFile(
      path.join(submodule, ".git"),
      `gitdir: ${path.join(root, ".git", "modules", "sub")}\n`
    );

    expect(await resolvePrimaryWorktreeRoot(submodule)).toBeNull();
  });

  it("returns null when no .git entry exists", async () => {
    const plain = path.join(root, "plain");
    await fs.mkdirp(plain);

    expect(await resolvePrimaryWorktreeRoot(plain)).toBeNull();
  });
});
