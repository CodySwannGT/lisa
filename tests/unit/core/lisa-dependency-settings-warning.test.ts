/**
 * `lisa apply` tells the operator when `dependencies.humanSignOff` or
 * `humanGate.mode` is invalid.
 *
 * Each value degrades to its default rather than failing the apply, so the
 * apply-time warning is the only place the CLI says the project did not get the
 * setting it typed. This drives the real `Lisa.apply` far enough to reach that
 * step, then stops it at the next one, so the assertion is about the call the
 * apply actually makes rather than about a helper in isolation.
 * @module tests/unit/core/lisa-dependency-settings-warning
 */
import { writeFile } from "node:fs/promises";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AutoAcceptPrompter } from "../../../src/cli/prompts.js";
import type { LisaConfig } from "../../../src/core/config.js";
import { NoOpGitService } from "../../../src/core/git-service.js";
import { Lisa, type LisaDependencies } from "../../../src/core/lisa.js";
import { PROJECT_CONFIG_FILENAME } from "../../../src/core/project-config.js";
import { DetectorRegistry } from "../../../src/detection/index.js";
import type { ILogger } from "../../../src/logging/logger.interface.js";
import { MigrationRegistry } from "../../../src/migrations/index.js";
import { StrategyRegistry } from "../../../src/strategies/index.js";
import { BackupService } from "../../../src/transaction/index.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

/** Sentinel that halts apply right after the step under test. */
const HALT = "halted after the dependency-settings step";

/** Private step apply runs next, used only to stop the run there. */
type NextStep = { processLearningsRelocation(): Promise<void> };

/** Logger that records what an operator would have been told. */
class RecordingLogger implements ILogger {
  readonly warnings: string[] = [];

  /**
   * Record a warning.
   * @param message - Warning text.
   */
  warn(message: string): void {
    this.warnings.push(message);
  }

  /** Ignore informational output. */
  info(): void {}

  /** Ignore success output. */
  success(): void {}

  /** Ignore error output. */
  error(): void {}

  /** Ignore dry-run output. */
  dry(): void {}
}

describe("Lisa.apply reports an invalid dependencies.humanSignOff", () => {
  let destDir: string;
  let logger: RecordingLogger;

  beforeEach(async () => {
    destDir = await createTempDir();
    logger = new RecordingLogger();
    vi.spyOn(
      Lisa.prototype as unknown as NextStep,
      "processLearningsRelocation"
    ).mockRejectedValue(new Error(HALT));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await cleanupTempDir(destDir);
  });

  /**
   * Run apply against the temp project until the halt sentinel.
   * @param config - The `.lisa.config.json` contents to write first
   */
  async function applyWith(config: unknown): Promise<void> {
    await writeFile(
      path.join(destDir, PROJECT_CONFIG_FILENAME),
      JSON.stringify(config),
      "utf8"
    );
    const lisaConfig: LisaConfig = {
      destDir,
      dryRun: false,
      harness: "claude",
      lisaDir: process.cwd(),
      skipGitCheck: true,
      validateOnly: false,
      yesMode: true,
    };
    const deps: LisaDependencies = {
      backupService: new BackupService(logger),
      detectorRegistry: new DetectorRegistry(),
      gitService: new NoOpGitService(),
      logger,
      migrationRegistry: new MigrationRegistry(),
      prompter: new AutoAcceptPrompter(),
      strategyRegistry: new StrategyRegistry(),
    };
    await new Lisa(lisaConfig, deps).apply().catch(() => undefined);
    // Proves the run got as far as the step after the one under test, so an
    // empty warnings list below is a real "nothing to report".
    expect(
      (Lisa.prototype as unknown as NextStep).processLearningsRelocation
    ).toHaveBeenCalled();
  }

  it('warns with the rejected value for humanSignOff "sometimes"', async () => {
    await applyWith({ dependencies: { humanSignOff: "sometimes" } });

    const matching = logger.warnings.filter(warning =>
      warning.includes("dependencies.humanSignOff")
    );
    expect(matching).toHaveLength(1);
    expect(matching[0]).toContain('"sometimes"');
    // CodySwannGT/lisa#4687: a present but invalid value fails safe, to
    // "default", whatever the mode.
    expect(matching[0]).toContain('treated as "default"');
  });

  it('warns with the rejected value for humanGate.mode "lenient"', async () => {
    await applyWith({ humanGate: { mode: "lenient" } });

    const matching = logger.warnings.filter(warning =>
      warning.includes("humanGate.mode")
    );
    expect(matching).toHaveLength(1);
    expect(matching[0]).toContain('"lenient"');
    expect(matching[0]).toContain('treated as "strict"');
  });

  it("says nothing about humanGate when it is valid", async () => {
    await applyWith({ humanGate: { mode: "strict" } });

    expect(
      logger.warnings.filter(warning => warning.includes("humanGate"))
    ).toEqual([]);
  });

  it("says nothing about the setting when it is valid", async () => {
    await applyWith({ dependencies: { humanSignOff: "none" } });

    expect(
      logger.warnings.filter(warning => warning.includes("humanSignOff"))
    ).toEqual([]);
  });
});
