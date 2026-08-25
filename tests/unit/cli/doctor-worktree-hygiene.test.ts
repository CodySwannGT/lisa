import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  checkWorktreeHygiene,
  WORKTREE_COUNT_WARN_THRESHOLD,
} from "../../../src/cli/doctor-worktree-hygiene.js";

const WORKTREE_HYGIENE_CHECK = "Agent worktree hygiene?";
const CLAUDE_WORKTREE_ROOT = ".claude/worktrees";
const BARE_WORKTREE_ROOT = ".worktrees";

let tempDir: string | undefined;

/**
 * Resolve the temporary directory for one worktree hygiene test case.
 * @returns Temporary directory path
 */
async function getTempDir(): Promise<string> {
  tempDir ??= await mkdtemp(path.join(os.tmpdir(), "lisa-worktree-hygiene-"));
  return tempDir;
}

/**
 * Create `count` worktree-shaped directories under one root.
 * @param cwd - Project path
 * @param root - Repo-relative worktree root
 * @param count - Number of directories to create
 */
async function seedWorktrees(
  cwd: string,
  root: string,
  count: number
): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    await mkdir(path.join(cwd, root, `agent-${index}`), { recursive: true });
  }
}

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { force: true, recursive: true });
    tempDir = undefined;
  }
});

describe("checkWorktreeHygiene", () => {
  it("passes when no worktree roots exist", async () => {
    const cwd = await getTempDir();

    await expect(checkWorktreeHygiene(cwd)).resolves.toMatchObject({
      name: WORKTREE_HYGIENE_CHECK,
      status: "ok",
      detail: expect.stringContaining("No agent worktrees"),
    });
  });

  it("passes and reports the count when worktrees sit under the threshold", async () => {
    const cwd = await getTempDir();
    await seedWorktrees(cwd, CLAUDE_WORKTREE_ROOT, 3);

    const check = await checkWorktreeHygiene(cwd);

    expect(check.status).toBe("ok");
    expect(check.detail).toContain("3 agent worktree");
  });

  // The two cases below pin BOTH sides of the boundary. One alone is not
  // enough: at-threshold-ok alone survives `<` becoming `<=`, and
  // over-threshold-warns alone survives `<=` becoming `<`. Only the pair
  // forbids an off-by-one in either direction.
  it("still passes at exactly the threshold", async () => {
    const cwd = await getTempDir();
    await seedWorktrees(
      cwd,
      CLAUDE_WORKTREE_ROOT,
      WORKTREE_COUNT_WARN_THRESHOLD
    );

    const check = await checkWorktreeHygiene(cwd);

    expect(check.status).toBe("ok");
    expect(check.detail).toContain(
      `${String(WORKTREE_COUNT_WARN_THRESHOLD)} agent worktrees`
    );
  });

  it("warns at one over the threshold", async () => {
    const cwd = await getTempDir();
    await seedWorktrees(
      cwd,
      CLAUDE_WORKTREE_ROOT,
      WORKTREE_COUNT_WARN_THRESHOLD + 1
    );

    const check = await checkWorktreeHygiene(cwd);

    expect(check.status).toBe("warn");
    expect(check.detail).toContain(
      `${String(WORKTREE_COUNT_WARN_THRESHOLD + 1)} agent worktrees`
    );
  });

  it("warns with the count once the threshold is exceeded", async () => {
    const cwd = await getTempDir();
    await seedWorktrees(cwd, CLAUDE_WORKTREE_ROOT, 12);

    const check = await checkWorktreeHygiene(cwd);

    expect(check.status).toBe("warn");
    expect(check.detail).toContain("12 agent worktrees");
    expect(check.detail).toContain(String(WORKTREE_COUNT_WARN_THRESHOLD));
  });

  it("counts both worktree roots together", async () => {
    const cwd = await getTempDir();
    await seedWorktrees(cwd, CLAUDE_WORKTREE_ROOT, 7);
    await seedWorktrees(cwd, BARE_WORKTREE_ROOT, 5);

    const check = await checkWorktreeHygiene(cwd);

    expect(check.status).toBe("warn");
    expect(check.detail).toContain("12 agent worktrees");
    expect(check.detail).toContain(CLAUDE_WORKTREE_ROOT);
    expect(check.detail).toContain(BARE_WORKTREE_ROOT);
  });

  it("offers a repair hint that never force-removes a dirty worktree", async () => {
    const cwd = await getTempDir();
    await seedWorktrees(cwd, CLAUDE_WORKTREE_ROOT, 12);

    const check = await checkWorktreeHygiene(cwd);

    expect(check.detail).toContain("git worktree remove");
    expect(check.detail).toContain("git worktree prune");
    expect(check.detail).not.toContain("--force");
    expect(check.detail).not.toContain(" -f ");
  });

  it("points at the vetted verb rather than leaving the operator a procedure", async () => {
    const cwd = await getTempDir();
    await seedWorktrees(cwd, CLAUDE_WORKTREE_ROOT, 12);

    const check = await checkWorktreeHygiene(cwd);

    expect(check.detail).toContain("lisa worktree prune");
    expect(check.detail).toContain("--apply");
    expect(check.detail).toContain("CodySwannGT/lisa#2993");
  });

  it("names the issue so the operator can find the measurements", async () => {
    const cwd = await getTempDir();
    await seedWorktrees(cwd, CLAUDE_WORKTREE_ROOT, 12);

    const check = await checkWorktreeHygiene(cwd);

    expect(check.detail).toContain("CodySwannGT/lisa#2490");
  });

  it("ignores files sitting beside worktree directories", async () => {
    const cwd = await getTempDir();
    await seedWorktrees(cwd, CLAUDE_WORKTREE_ROOT, 2);
    await writeFile(path.join(cwd, CLAUDE_WORKTREE_ROOT, ".DS_Store"), "");

    const check = await checkWorktreeHygiene(cwd);

    expect(check.status).toBe("ok");
    expect(check.detail).toContain("2 agent worktree");
  });

  it("reports an unreadable worktree root as uninspectable rather than clean", async () => {
    const cwd = await getTempDir();
    // A regular file where a worktree root directory is expected: readdir fails.
    await writeFile(path.join(cwd, BARE_WORKTREE_ROOT), "not a directory\n");

    const check = await checkWorktreeHygiene(cwd);

    expect(check.status).toBe("warn");
    expect(check.detail).toContain("Could not inspect");
    expect(check.detail).toContain(BARE_WORKTREE_ROOT);
  });
});
