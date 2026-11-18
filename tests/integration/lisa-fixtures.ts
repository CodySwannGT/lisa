/**
 * Shared fixtures for the Lisa apply/validate integration suites: the file and
 * directory names they assert on, plus factories for a test config and its
 * dependency graph.
 * @module tests/integration/lisa-fixtures
 */
import * as path from "node:path";

import type { LisaConfig } from "../../src/core/config.js";
import { NoOpGitService } from "../../src/core/git-service.js";
import type { LisaDependencies } from "../../src/core/lisa.js";
import { AutoAcceptPrompter } from "../../src/cli/prompts.js";
import { DetectorRegistry } from "../../src/detection/index.js";
import { SilentLogger } from "../../src/logging/silent-logger.js";
import { MigrationRegistry } from "../../src/migrations/index.js";
import { StrategyRegistry } from "../../src/strategies/index.js";
import {
  BackupService,
  DryRunBackupService,
} from "../../src/transaction/index.js";

export const PACKAGE_JSON = "package.json";
export const SETTINGS_JSON = "settings.json";
export const TEST_TXT = "test.txt";
export const TSCONFIG_BASE = "tsconfig.base.json";
export const TSCONFIG_JSON = "tsconfig.json";
export const LISAIGNORE = ".lisaignore";
export const LEGACY_WORKFLOW = "legacy-workflow.yml";
export const CREATE_ONLY = "create-only";
export const COPY_CONTENTS = "copy-contents";
export const COPY_OVERWRITE = "copy-overwrite";
export const KNIP_JSON = "knip.json";
export const LINT_STAGED_JSON = ".lintstagedrc.json";
export const SAFETY_NET_JSON = ".safety-net.json";
export const GITIGNORE = ".gitignore";
export const ESLINT_IGNORE_CONFIG = "eslint.ignore.config.json";
export const GITHUB_ACTIONS_MD = path.join(".github", "GITHUB_ACTIONS.md");
export const HARPER_FABRIC_TYPE = "harper-fabric";
export const HARPER_FABRIC_TXT = "harper-fabric.txt";
export const JEST_CONFIG_LOCAL = "jest.config.local.ts";
export const PACKAGE_LISA_DIR = "package-lisa";
export const LISA_MANIFEST = ".lisa-manifest";
export const PROJECT_LEARNINGS = "PROJECT_LEARNINGS.md";
export const LISA_STATE_DIR = ".lisa";
/** Project-level Codex overlay directory. */
export const CODEX_DIR = ".codex";
/** Manifest an agent emit writes to record the files it owns. */
export const LISA_MANAGED_JSON = ".lisa-managed.json";
export const DEPENDENCY_DECISIONS = "DEPENDENCY_DECISIONS.md";
export const LISA_CONFIG_JSON = ".lisa.config.json";
export const TSC_BUILD_SCRIPT = "tsc -p tsconfig.build.json";

/**
 * Create a Lisa config for testing
 * @param lisaDir - Mock Lisa source directory
 * @param destDir - Destination project directory
 * @param overrides - Configuration overrides
 * @returns Lisa configuration with test defaults
 */
export function buildConfig(
  lisaDir: string,
  destDir: string,
  overrides: Partial<LisaConfig> = {}
): LisaConfig {
  return {
    lisaDir,
    destDir,
    dryRun: false,
    yesMode: true,
    validateOnly: false,
    skipGitCheck: false,
    harness: "claude",
    ...overrides,
  };
}

/**
 * Create Lisa dependencies for testing
 * @param config - Configuration to use for dependencies
 * @returns Lisa dependencies with test implementations
 */
export function createDeps(config: LisaConfig): LisaDependencies {
  const logger = new SilentLogger();
  return {
    logger,
    prompter: new AutoAcceptPrompter(),
    backupService: config.dryRun
      ? new DryRunBackupService()
      : new BackupService(logger),
    detectorRegistry: new DetectorRegistry(),
    strategyRegistry: new StrategyRegistry(),
    gitService: new NoOpGitService(),
    migrationRegistry: new MigrationRegistry(),
  };
}
