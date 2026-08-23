import os from "node:os";
import path from "node:path";

import fs from "fs-extra";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ProjectType } from "../../../src/core/config.js";
import { SilentLogger } from "../../../src/logging/silent-logger.js";
import { UntrackCodexMarketplaceMigration } from "../../../src/migrations/untrack-codex-marketplace.js";
import type { MigrationContext } from "../../../src/migrations/migration.interface.js";
import { boundedExecFileSync } from "../../helpers/io-latency-budget.js";
import { resolveGit } from "../../support/git-executable.js";

const GIT = resolveGit();
const MARKETPLACE = ".agents/plugins/marketplace.json";

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

describe("UntrackCodexMarketplaceMigration", () => {
  const migration = new UntrackCodexMarketplaceMigration();
  let tempDir: string;
  let projectDir: string;
  let lisaDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "lisa-untrack-"));
    lisaDir = path.join(tempDir, "lisa");
    projectDir = path.join(tempDir, "project");
    await fs.ensureDir(lisaDir);
    await fs.ensureDir(projectDir);
  });

  afterEach(async () => {
    await fs.remove(tempDir);
  });

  const ctx = (dryRun = false): MigrationContext => ({
    projectDir,
    lisaDir,
    detectedTypes: ["typescript"] as ProjectType[],
    dryRun,
    logger: new SilentLogger(),
  });

  const initRepo = (): void => {
    boundedExecFileSync({
      label: "git init",
      command: GIT,
      args: ["init"],
      cwd: projectDir,
      env: cleanGitEnv(),
      stdio: "ignore",
    });
    boundedExecFileSync({
      label: "git config user.email",
      command: GIT,
      args: ["config", "user.email", "test@example.com"],
      cwd: projectDir,
      env: cleanGitEnv(),
      stdio: "ignore",
    });
    boundedExecFileSync({
      label: "git config user.name",
      command: GIT,
      args: ["config", "user.name", "Test"],
      cwd: projectDir,
      env: cleanGitEnv(),
      stdio: "ignore",
    });
  };

  const commitMarketplace = (): void => {
    boundedExecFileSync({
      label: "git add marketplace.json",
      command: GIT,
      args: ["add", MARKETPLACE],
      cwd: projectDir,
      env: cleanGitEnv(),
      stdio: "ignore",
    });
    boundedExecFileSync({
      label: "git commit",
      command: GIT,
      args: ["commit", "-m", "add marketplace"],
      cwd: projectDir,
      env: cleanGitEnv(),
      stdio: "ignore",
    });
  };

  const writeMarketplace = async (): Promise<void> => {
    await fs.ensureDir(path.join(projectDir, ".agents", "plugins"));
    await fs.writeFile(
      path.join(projectDir, MARKETPLACE),
      JSON.stringify({ name: "lisa", plugins: [] }),
      "utf8"
    );
  };

  const isTracked = (): boolean => {
    try {
      boundedExecFileSync({
        label: "git ls-files --error-unmatch marketplace.json",
        command: GIT,
        args: ["ls-files", "--error-unmatch", MARKETPLACE],
        cwd: projectDir,
        env: cleanGitEnv(),
        stdio: "ignore",
      });
      return true;
    } catch {
      return false;
    }
  };

  it("does not apply when the file is absent", async () => {
    initRepo();
    expect(await migration.applies(ctx())).toBe(false);
  });

  it("does not apply when the file exists but is untracked", async () => {
    initRepo();
    await writeMarketplace();
    expect(await migration.applies(ctx())).toBe(false);
  });

  it("does not apply outside a git repository", async () => {
    await writeMarketplace();
    expect(await migration.applies(ctx())).toBe(false);
  });

  it("untracks a committed marketplace file but keeps the working copy", async () => {
    initRepo();
    await writeMarketplace();
    commitMarketplace();

    expect(await migration.applies(ctx())).toBe(true);

    const result = await migration.apply(ctx());
    expect(result.action).toBe("applied");
    expect(result.changedFiles).toContain(MARKETPLACE);
    // Untracked now…
    expect(isTracked()).toBe(false);
    // …but the working copy is preserved (regenerated on apply).
    expect(await fs.pathExists(path.join(projectDir, MARKETPLACE))).toBe(true);
    // Idempotent.
    expect(await migration.applies(ctx())).toBe(false);
  });

  it("dry-run reports the change without untracking", async () => {
    initRepo();
    await writeMarketplace();
    commitMarketplace();

    const result = await migration.apply(ctx(true));
    expect(result.action).toBe("applied");
    expect(isTracked()).toBe(true);
  });

  it("throws when git rm --cached fails unexpectedly after file is confirmed tracked", async () => {
    initRepo();
    await writeMarketplace();
    commitMarketplace();

    // Create a .git/index.lock to simulate a concurrent git process holding the lock.
    // git ls-files (read-only) succeeds; git rm --cached (write) fails.
    const lockFile = path.join(projectDir, ".git", "index.lock");
    await fs.writeFile(lockFile, "lock", "utf8");

    try {
      await expect(migration.apply(ctx())).rejects.toThrow();
    } finally {
      await fs.remove(lockFile);
    }
  });
});
