/**
 * Plugin sync marker write: the success path, and the error path that used to
 * eat its own error (#2487).
 *
 * `writePluginSyncMarker` called `fse.writeFile`, which is `undefined` on the
 * `fs-extra` ESM namespace under real Node. The resulting `TypeError` landed in
 * a `catch` that reported nothing, so the marker was never written, the version
 * gate it exists to feed never once took effect, and every apply paid a full
 * plugin sync. Worse, the `TypeError` thrown from inside the recovery path
 * REPLACED whatever error was actually being handled.
 *
 * The error path is therefore exercised here on its own, with real filesystem
 * failures rather than mocks, and asserted to report the original error.
 * @module tests/unit/core/plugin-sync-marker
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AutoAcceptPrompter } from "../../../src/cli/prompts.js";
import type { LisaConfig } from "../../../src/core/config.js";
import { NoOpGitService } from "../../../src/core/git-service.js";
import { Lisa, type LisaDependencies } from "../../../src/core/lisa.js";
import { DetectorRegistry } from "../../../src/detection/index.js";
import type { ILogger } from "../../../src/logging/logger.interface.js";
import { MigrationRegistry } from "../../../src/migrations/index.js";
import { StrategyRegistry } from "../../../src/strategies/index.js";
import { BackupService } from "../../../src/transaction/index.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

/** Marker file path relative to a project root. */
const MARKER = path.join(".claude", ".lisa-plugins-synced");

/** Private surface under test, reached without widening the public API. */
type MarkerWriter = {
  writePluginSyncMarker(version: string): Promise<void>;
};

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

describe("core/lisa plugin sync marker", () => {
  let destDir: string;
  let logger: RecordingLogger;
  let markerWriter: MarkerWriter;

  beforeEach(async () => {
    destDir = await createTempDir();
    logger = new RecordingLogger();
    const config: LisaConfig = {
      destDir,
      dryRun: false,
      harness: "claude",
      lisaDir: destDir,
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
    markerWriter = new Lisa(config, deps) as unknown as MarkerWriter;
  });

  afterEach(async () => {
    await cleanupTempDir(destDir);
  });

  it("writes the synced version to the marker file", async () => {
    await markerWriter.writePluginSyncMarker("3.5.1");

    expect(await readFile(path.join(destDir, MARKER), "utf8")).toBe("3.5.1\n");
    expect(logger.warnings).toEqual([]);
  });

  it("reports the real failure instead of one manufactured inside the catch", async () => {
    // The marker path is a directory, so the write fails with EISDIR. That is
    // the error an operator needs to see. Before the fix the recovery path
    // threw `fse.writeFile is not a function` before EISDIR could ever be
    // raised, and then swallowed that too — the original failure was replaced
    // by an artifact of the code meant to handle it.
    await mkdir(path.join(destDir, MARKER), { recursive: true });

    await expect(
      markerWriter.writePluginSyncMarker("3.5.1")
    ).resolves.toBeUndefined();

    expect(logger.warnings).toHaveLength(1);
    const [warning = ""] = logger.warnings;
    expect(warning).toContain("EISDIR");
    expect(warning).not.toContain("is not a function");
  });

  it("reports the real failure when the .claude directory cannot be created", async () => {
    // `.claude` already exists as a file, so `ensureDir` fails. This branch
    // survived the original defect (`ensureDir` IS on the namespace), which is
    // exactly why it needs coverage: it proves the catch reports rather than
    // merely that the fixed call no longer throws.
    await writeFile(path.join(destDir, ".claude"), "not a directory\n", "utf8");

    await expect(
      markerWriter.writePluginSyncMarker("3.5.1")
    ).resolves.toBeUndefined();

    expect(logger.warnings).toHaveLength(1);
    const [warning = ""] = logger.warnings;
    expect(warning).toMatch(/ENOTDIR|EEXIST/);
    expect(warning).not.toContain("is not a function");
  });
});
