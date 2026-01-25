import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs-extra";
import * as path from "node:path";
import type { LisaConfig } from "../../src/core/config.js";
import { NoOpGitService } from "../../src/core/git-service.js";
import { Lisa, type LisaDependencies } from "../../src/core/lisa.js";
import {
  DryRunManifestService,
  ManifestService,
} from "../../src/core/manifest.js";
import { AutoAcceptPrompter } from "../../src/cli/prompts.js";
import { DetectorRegistry } from "../../src/detection/index.js";
import { SilentLogger } from "../../src/logging/silent-logger.js";
import { StrategyRegistry } from "../../src/strategies/index.js";
import {
  BackupService,
  DryRunBackupService,
} from "../../src/transaction/index.js";
import {
  cleanupTempDir,
  countFiles,
  createCDKProject,
  createExpoProject,
  createMockLisaDir,
  createNestJSProject,
  createTempDir,
  createTypeScriptProject,
} from "../helpers/test-utils.js";

const PACKAGE_JSON = "package.json";

describe("Lisa Integration Tests", () => {
  let tempDir: string;
  let lisaDir: string;
  let destDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
    lisaDir = path.join(tempDir, "lisa");
    destDir = path.join(tempDir, "project");
    await createMockLisaDir(lisaDir);
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  /**
   * Create a Lisa config for testing
   * @param overrides - Configuration overrides
   * @returns Lisa configuration with test defaults
   */
  function createConfig(overrides: Partial<LisaConfig> = {}): LisaConfig {
    return {
      lisaDir,
      destDir,
      dryRun: false,
      yesMode: true,
      validateOnly: false,
      ...overrides,
    };
  }

  /**
   * Create Lisa dependencies for testing
   * @param config - Configuration to use for dependencies
   * @returns Lisa dependencies with test implementations
   */
  function createDeps(config: LisaConfig): LisaDependencies {
    const logger = new SilentLogger();
    return {
      logger,
      prompter: new AutoAcceptPrompter(),
      manifestService: config.dryRun
        ? new DryRunManifestService()
        : new ManifestService(),
      backupService: config.dryRun
        ? new DryRunBackupService()
        : new BackupService(logger),
      detectorRegistry: new DetectorRegistry(),
      strategyRegistry: new StrategyRegistry(),
      gitService: new NoOpGitService(),
    };
  }

  describe("apply", () => {
    it("applies configurations to TypeScript project", async () => {
      await createTypeScriptProject(destDir);

      const config = createConfig();
      const lisa = new Lisa(config, createDeps(config));
      const result = await lisa.apply();

      expect(result.success).toBe(true);
      expect(result.detectedTypes).toContain("typescript");

      // Check that files were copied
      expect(await fs.pathExists(path.join(destDir, "test.txt"))).toBe(true);
      expect(
        await fs.pathExists(path.join(destDir, "tsconfig.base.json"))
      ).toBe(true);
    });

    it("applies configurations to Expo project", async () => {
      await createExpoProject(destDir);

      const config = createConfig();
      const lisa = new Lisa(config, createDeps(config));
      const result = await lisa.apply();

      expect(result.success).toBe(true);
      expect(result.detectedTypes).toContain("expo");
      expect(result.detectedTypes).toContain("typescript"); // Parent type
    });

    it("applies configurations to NestJS project", async () => {
      await createNestJSProject(destDir);

      const config = createConfig();
      const lisa = new Lisa(config, createDeps(config));
      const result = await lisa.apply();

      expect(result.success).toBe(true);
      expect(result.detectedTypes).toContain("nestjs");
      expect(result.detectedTypes).toContain("typescript");
    });

    it("applies configurations to CDK project", async () => {
      await createCDKProject(destDir);

      const config = createConfig();
      const lisa = new Lisa(config, createDeps(config));
      const result = await lisa.apply();

      expect(result.success).toBe(true);
      expect(result.detectedTypes).toContain("cdk");
      expect(result.detectedTypes).toContain("typescript");
    });

    it("creates manifest file after installation", async () => {
      await createTypeScriptProject(destDir);

      const config = createConfig();
      const lisa = new Lisa(config, createDeps(config));
      await lisa.apply();

      expect(await fs.pathExists(path.join(destDir, ".lisa-manifest"))).toBe(
        true
      );
    });

    it("applies all/ configs to project with no detected types", async () => {
      await fs.ensureDir(destDir);
      await fs.writeJson(path.join(destDir, PACKAGE_JSON), {});

      const config = createConfig();
      const lisa = new Lisa(config, createDeps(config));
      const result = await lisa.apply();

      expect(result.success).toBe(true);
      expect(result.detectedTypes).toHaveLength(0);

      // all/ configs should still be applied
      expect(await fs.pathExists(path.join(destDir, "test.txt"))).toBe(true);
    });
  });

  describe("dry run", () => {
    it("does not modify files in dry run mode", async () => {
      await createTypeScriptProject(destDir);
      const beforeCount = await countFiles(destDir);

      const config = createConfig({ dryRun: true });
      const lisa = new Lisa(config, createDeps(config));
      const result = await lisa.apply();

      expect(result.success).toBe(true);
      const afterCount = await countFiles(destDir);
      expect(afterCount).toBe(beforeCount);
    });

    it("returns counters for what would be done", async () => {
      await createTypeScriptProject(destDir);

      const config = createConfig({ dryRun: true });
      const lisa = new Lisa(config, createDeps(config));
      const result = await lisa.apply();

      expect(result.counters.copied).toBeGreaterThan(0);
    });
  });

  describe("validate", () => {
    it("validates project compatibility", async () => {
      await createTypeScriptProject(destDir);

      const config = createConfig({ validateOnly: true, dryRun: true });
      const lisa = new Lisa(config, createDeps(config));
      const result = await lisa.validate();

      expect(result.success).toBe(true);
      expect(result.mode).toBe("validate");
    });

    it("does not modify files in validate mode", async () => {
      await createTypeScriptProject(destDir);
      const beforeCount = await countFiles(destDir);

      const config = createConfig({ validateOnly: true, dryRun: true });
      const lisa = new Lisa(config, createDeps(config));
      await lisa.validate();

      const afterCount = await countFiles(destDir);
      expect(afterCount).toBe(beforeCount);
    });
  });

  describe("uninstall", () => {
    it("removes copy-overwrite and create-only files", async () => {
      await createTypeScriptProject(destDir);

      // First install
      const installConfig = createConfig();
      const installLisa = new Lisa(installConfig, createDeps(installConfig));
      await installLisa.apply();

      // Verify files exist
      expect(await fs.pathExists(path.join(destDir, "test.txt"))).toBe(true);

      // Then uninstall
      const uninstallConfig = createConfig();
      const uninstallLisa = new Lisa(
        uninstallConfig,
        createDeps(uninstallConfig)
      );
      const result = await uninstallLisa.uninstall();

      expect(result.success).toBe(true);
      expect(result.mode).toBe("uninstall");

      // Files should be removed
      expect(await fs.pathExists(path.join(destDir, "test.txt"))).toBe(false);

      // Manifest should be removed
      expect(await fs.pathExists(path.join(destDir, ".lisa-manifest"))).toBe(
        false
      );
    });

    it("fails when no manifest exists", async () => {
      await createTypeScriptProject(destDir);

      const config = createConfig();
      const lisa = new Lisa(config, createDeps(config));
      const result = await lisa.uninstall();

      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it("dry run does not remove files", async () => {
      await createTypeScriptProject(destDir);

      // First install
      const installConfig = createConfig();
      const installLisa = new Lisa(installConfig, createDeps(installConfig));
      await installLisa.apply();

      const beforeCount = await countFiles(destDir);

      // Dry run uninstall
      const uninstallConfig = createConfig({ dryRun: true });
      const uninstallLisa = new Lisa(
        uninstallConfig,
        createDeps(uninstallConfig)
      );
      await uninstallLisa.uninstall();

      const afterCount = await countFiles(destDir);
      expect(afterCount).toBe(beforeCount);
    });
  });

  describe("idempotency", () => {
    it("running twice produces same result", async () => {
      await createTypeScriptProject(destDir);

      const config = createConfig();

      // First run
      const lisa1 = new Lisa(config, createDeps(config));
      const result1 = await lisa1.apply();

      expect(result1.success).toBe(true);

      // Second run
      const lisa2 = new Lisa(config, createDeps(config));
      const result2 = await lisa2.apply();

      expect(result2.success).toBe(true);
      // Second run should skip files since first run already applied them
      expect(result2.counters.skipped).toBeGreaterThan(0);
    });
  });

  describe("error handling", () => {
    it("fails with non-existent destination", async () => {
      const config = createConfig({ destDir: "/nonexistent/path" });
      const lisa = new Lisa(config, createDeps(config));
      const result = await lisa.apply();

      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });
});
