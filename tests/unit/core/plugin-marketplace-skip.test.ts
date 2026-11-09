/**
 * `lisa apply` must not try to install a `<name>@lisa` key that names no plugin
 * in the Lisa marketplace manifest. Before CodySwannGT/lisa#4645 every enabled
 * key was installed, so a retired key such as `typescript@lisa` failed on every
 * apply, warned every time, and kept the plugin sync from ever completing.
 * @module tests/unit/core/plugin-marketplace-skip
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AutoAcceptPrompter } from "../../../src/cli/prompts.js";
import { NoOpGitService } from "../../../src/core/git-service.js";
import { Lisa } from "../../../src/core/lisa.js";
import { DetectorRegistry } from "../../../src/detection/index.js";
import type { ILogger } from "../../../src/logging/logger.interface.js";
import { MigrationRegistry } from "../../../src/migrations/index.js";
import { StrategyRegistry } from "../../../src/strategies/index.js";
import { BackupService } from "../../../src/transaction/index.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

const MARKER = path.join(".claude", ".lisa-plugins-synced");
const INSTALL = "claude plugin install";
const RETIRED = "typescript@lisa";
const GHOST = "ghost@lisa";
const PLUGIN_DIR = ".claude-plugin";

/** Private orchestrator surface, reached without widening the public API. */
interface InstallSurface {
  installPluginsAndUpdateMarketplace(
    run: (
      command: string,
      options: Record<string, unknown>
    ) => Promise<unknown>,
    plugins: readonly string[]
  ): Promise<void>;
}

/** Logger that records warnings. */
class RecordingLogger implements ILogger {
  readonly warnings: string[] = [];
  /**
   * Record a warning.
   * @param message - Warning text
   */
  warn(message: string): void {
    this.warnings.push(message);
  }
  /** Ignore info output. */
  info(): void {}
  /** Ignore success output. */
  success(): void {}
  /** Ignore error output. */
  error(): void {}
  /** Ignore dry-run output. */
  dry(): void {}
}

describe("core/lisa skips enabled @lisa keys absent from the marketplace", () => {
  let destDir: string;
  let lisaDir: string;
  let logger: RecordingLogger;
  let surface: InstallSurface;
  let commands: string[];

  /**
   * Fake CLI that records commands and fails installs of unknown plugins,
   * exactly as the real CLI does for a key absent from the marketplace.
   * @param command - Command line
   * @returns Empty stdout
   */
  const run = async (command: string): Promise<unknown> => {
    commands.push(command);
    if (command.startsWith(INSTALL) && command.includes(` ${RETIRED} `))
      throw new Error("Plugin not found in marketplace");
    return { stdout: "" };
  };

  beforeEach(async () => {
    destDir = await createTempDir();
    lisaDir = await createTempDir();
    logger = new RecordingLogger();
    commands = [];
    await mkdir(path.join(lisaDir, PLUGIN_DIR), { recursive: true });
    await writeFile(
      path.join(lisaDir, PLUGIN_DIR, "marketplace.json"),
      JSON.stringify({
        name: "lisa",
        plugins: [{ name: "lisa" }, { name: "lisa-typescript" }],
      })
    );
    surface = new Lisa(
      {
        destDir,
        lisaDir,
        dryRun: false,
        harness: "claude",
        skipGitCheck: true,
        validateOnly: false,
        yesMode: true,
      },
      {
        backupService: new BackupService(logger),
        detectorRegistry: new DetectorRegistry(),
        gitService: new NoOpGitService(),
        logger,
        migrationRegistry: new MigrationRegistry(),
        prompter: new AutoAcceptPrompter(),
        strategyRegistry: new StrategyRegistry(),
      }
    ) as unknown as InstallSurface;
  });

  afterEach(async () => {
    await cleanupTempDir(destDir);
    await cleanupTempDir(lisaDir);
  });

  it("skips the unknown key with one warning naming it and its successor, and still records the sync", async () => {
    await surface.installPluginsAndUpdateMarketplace(run, [
      "lisa@lisa",
      RETIRED,
      "lisa-typescript@lisa",
      "coderabbit@claude-plugins-official",
    ]);

    const installs = commands.filter(c => c.startsWith(INSTALL));
    expect(installs).toEqual([
      "claude plugin install lisa@lisa --scope project",
      "claude plugin install lisa-typescript@lisa --scope project",
      "claude plugin install coderabbit@claude-plugins-official --scope project",
    ]);
    const skipWarnings = logger.warnings.filter(w => w.includes(RETIRED));
    expect(skipWarnings).toHaveLength(1);
    expect(skipWarnings[0]).toContain("lisa-typescript@lisa");
    expect(logger.warnings.some(w => w.includes("incomplete"))).toBe(false);
    expect(await readFile(path.join(destDir, MARKER), "utf8")).toMatch(
      /^\d+\.\d+\.\d+\n$/
    );
  });

  it("names a non-retired unknown key without inventing a successor", async () => {
    await surface.installPluginsAndUpdateMarketplace(run, ["lisa@lisa", GHOST]);
    expect(commands.some(c => c.includes(GHOST))).toBe(false);
    const warning = logger.warnings.find(w => w.includes(GHOST)) ?? "";
    expect(warning).not.toContain("successor");
  });

  it("does not skip anything when the manifest cannot be read", async () => {
    await writeFile(
      path.join(lisaDir, PLUGIN_DIR, "marketplace.json"),
      "{ not json"
    );
    await surface.installPluginsAndUpdateMarketplace(run, ["lisa@lisa", GHOST]);
    expect(commands).toContain(`${INSTALL} ${GHOST} --scope project`);
  });
});
