/* eslint-disable sonarjs/no-os-command-from-path -- test fixture runs fixed git
   commands inside an isolated temp repo; no untrusted input or PATH concern. */
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";

import fs from "fs-extra";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ProjectType } from "../../../src/core/config.js";
import { SilentLogger } from "../../../src/logging/silent-logger.js";
import { UntrackCodexMarketplaceMigration } from "../../../src/migrations/untrack-codex-marketplace.js";
import type { MigrationContext } from "../../../src/migrations/migration.interface.js";

const MARKETPLACE = ".agents/plugins/marketplace.json";

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
    execSync("git init", { cwd: projectDir, stdio: "ignore" });
    execSync('git config user.email "test@example.com"', {
      cwd: projectDir,
      stdio: "ignore",
    });
    execSync('git config user.name "Test"', {
      cwd: projectDir,
      stdio: "ignore",
    });
  };

  const commitMarketplace = (): void => {
    execSync("git add .agents/plugins/marketplace.json", {
      cwd: projectDir,
      stdio: "ignore",
    });
    execSync('git commit -m "add marketplace"', {
      cwd: projectDir,
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
      execSync(
        "git ls-files --error-unmatch .agents/plugins/marketplace.json",
        { cwd: projectDir, stdio: "ignore" }
      );
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
});
/* eslint-enable sonarjs/no-os-command-from-path -- end of test-fixture git scope */
