import * as fs from "fs-extra";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createPrompter } from "../../src/cli/prompts.js";
import type { LisaConfig } from "../../src/core/config.js";
import { GitService } from "../../src/core/git-service.js";
import { Lisa, type LisaDependencies } from "../../src/core/lisa.js";
import { DetectorRegistry } from "../../src/detection/index.js";
import { SilentLogger } from "../../src/logging/silent-logger.js";
import { MigrationRegistry } from "../../src/migrations/index.js";
import { StrategyRegistry } from "../../src/strategies/index.js";
import { BackupService } from "../../src/transaction/index.js";
import {
  createRailsHookFixture,
  fixtureGit,
  installedFixtureHooks,
  RAILS_HOOKS,
  type RailsHookFixture,
} from "../helpers/rails-hook-install-fixture.js";
import { cleanGitEnv, cleanupTempDir } from "../helpers/test-utils.js";

describe("actual Rails apply hook installation", () => {
  let fixture: RailsHookFixture | undefined;

  beforeEach(async () => {
    fixture = await createRailsHookFixture();
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    if (fixture) await cleanupTempDir(fixture.root);
    fixture = undefined;
  });

  /**
   * Run the actual orchestrator with only the fixture's tool environment.
   * @param current Isolated host
   * @param overrides Apply modes
   * @returns Actual result and observed warnings
   */
  async function applyFixture(
    current: RailsHookFixture,
    overrides: Partial<LisaConfig> = {}
  ) {
    const clean = cleanGitEnv(process.env);
    const config: LisaConfig = {
      lisaDir: process.cwd(),
      destDir: current.project,
      dryRun: false,
      yesMode: true,
      validateOnly: false,
      skipGitCheck: false,
      harness: "codex",
      ...overrides,
    };
    const logger = new SilentLogger();
    const warnings = vi.spyOn(logger, "warn");
    const dependencies: LisaDependencies = {
      logger,
      prompter: createPrompter(true),
      backupService: new BackupService(logger),
      detectorRegistry: new DetectorRegistry(),
      strategyRegistry: new StrategyRegistry(),
      gitService: new GitService(),
      migrationRegistry: new MigrationRegistry(),
    };
    for (const key of Object.keys(process.env)) {
      if (!Object.hasOwn(clean, key)) vi.stubEnv(key, undefined);
    }
    vi.stubEnv("PATH", current.env.PATH);
    vi.stubEnv("LISA_TEST_BUNDLE_JOURNAL", current.journal);
    return { result: await new Lisa(config, dependencies).apply(), warnings };
  }

  it("finishes the real orchestrator with all four wrappers installed", async () => {
    const current = fixture!;
    expect(fixtureGit(current, ["status", "--porcelain"])).toBe("");
    expect(await installedFixtureHooks(current)).toEqual([]);
    const { result } = await applyFixture(current);
    expect(result.success).toBe(true);
    expect(await installedFixtureHooks(current)).toEqual(RAILS_HOOKS);
  });

  it.each(["dryRun", "validateOnly"] as const)(
    "does not install hooks in %s mode",
    async mode => {
      const current = fixture!;
      await applyFixture(current, { [mode]: true });
      expect(await installedFixtureHooks(current)).toEqual([]);
      expect(await fs.pathExists(current.journal)).toBe(false);
    }
  );

  it("keeps apply successful and reports an actual installation failure", async () => {
    const current = fixture!;
    vi.stubEnv("LISA_TEST_BUNDLE_FAIL", "1");
    const { result, warnings } = await applyFixture(current);
    expect(result.success).toBe(true);
    expect(await installedFixtureHooks(current)).toEqual([]);
    expect(
      warnings.mock.calls.filter(([message]) =>
        String(message).includes("Rails Git hooks:")
      )
    ).toEqual([
      [
        "Rails Git hooks: installation failed (exit 32); run bundle exec lefthook install.",
      ],
    ]);
  });

  it("does not install Rails hooks for an unrelated project type", async () => {
    const current = fixture!;
    for (const name of [
      "Gemfile",
      "bin/rails",
      "config/application.rb",
      "lefthook.yml",
    ])
      await fs.remove(path.join(current.project, name));
    fixtureGit(current, ["add", "."]);
    fixtureGit(current, [
      "-c",
      "user.name=Lisa fixture",
      "-c",
      "user.email=fixture@example.test",
      "commit",
      "--quiet",
      "-m",
      "test: seed non-Rails fixture",
    ]);
    const { result } = await applyFixture(current);
    expect(result.success).toBe(true);
    expect(await fs.pathExists(current.journal)).toBe(false);
  });
});
