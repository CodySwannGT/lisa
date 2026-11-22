/**
 * A fresh clone whose committed plugin marker already matches the installed
 * Lisa version must still get its plugins registered for ITS OWN folder
 * (CodySwannGT/lisa#4504).
 *
 * The marker matching takes the incremental path, which asks
 * `claude plugin list --json` what is installed and installs only the rest.
 * The registry is machine-wide: the same plugin can already be registered for
 * a sibling checkout, or at user scope. Neither makes it available to this
 * folder at project scope, so neither may count as "already installed" here.
 * @module tests/unit/core/plugin-sync-sibling-path
 */
import { mkdir, realpath, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AutoAcceptPrompter } from "../../../src/cli/prompts.js";
import { getPackageVersion } from "../../../src/cli/version.js";
import { NoOpGitService } from "../../../src/core/git-service.js";
import { Lisa } from "../../../src/core/lisa.js";
import { DetectorRegistry } from "../../../src/detection/index.js";
import type { ILogger } from "../../../src/logging/logger.interface.js";
import { MigrationRegistry } from "../../../src/migrations/index.js";
import { StrategyRegistry } from "../../../src/strategies/index.js";
import { BackupService } from "../../../src/transaction/index.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

const LIST = "claude plugin list --json";
const INSTALL = "claude plugin install";
const ENABLED = [
  "lisa@lisa",
  "lisa-typescript@lisa",
  "lisa-expo@lisa",
  "lisa-wiki@lisa",
] as const;

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

/** Logger that discards everything; the commands are the evidence. */
class SilentLogger implements ILogger {
  /** Ignore warnings. */
  warn(): void {}
  /** Ignore info output. */
  info(): void {}
  /** Ignore success output. */
  success(): void {}
  /** Ignore error output. */
  error(): void {}
  /** Ignore dry-run output. */
  dry(): void {}
}

describe("core/lisa registers plugins for this folder when the marker already matches", () => {
  let destDir: string;
  let siblingDir: string;
  let lisaDir: string;
  let commands: string[];
  let surface: InstallSurface;

  beforeEach(async () => {
    destDir = await realpath(await createTempDir());
    siblingDir = await realpath(await createTempDir());
    lisaDir = await createTempDir();
    commands = [];
    await mkdir(path.join(destDir, ".claude"), { recursive: true });
    await writeFile(
      path.join(destDir, ".claude", ".lisa-plugins-synced"),
      `${getPackageVersion()}\n`
    );
    await mkdir(path.join(lisaDir, ".claude-plugin"), { recursive: true });
    await writeFile(
      path.join(lisaDir, ".claude-plugin", "marketplace.json"),
      JSON.stringify({
        name: "lisa",
        plugins: ENABLED.map(id => ({ name: id.replace(/@lisa$/, "") })),
      })
    );
    const logger = new SilentLogger();
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
    await cleanupTempDir(siblingDir);
    await cleanupTempDir(lisaDir);
  });

  it("installs every enabled @lisa plugin at project scope when the registry only lists a sibling folder and user scope", async () => {
    const registry = ENABLED.flatMap(id => [
      { id, scope: "project", projectPath: siblingDir, enabled: true },
      { id, scope: "user", enabled: true },
    ]);
    /**
     * Fake Claude CLI: the plugin list reports only foreign registrations.
     * @param command - Command line
     * @returns Captured stdout
     */
    const run = async (command: string): Promise<unknown> => {
      commands.push(command);
      return { stdout: command === LIST ? JSON.stringify(registry) : "" };
    };

    await surface.installPluginsAndUpdateMarketplace(run, [...ENABLED]);

    expect(commands).toContain(LIST);
    expect(commands.filter(command => command.startsWith(INSTALL))).toEqual(
      ENABLED.map(id => `${INSTALL} ${id} --scope project`)
    );
  });

  it("installs only what this folder is missing when some plugins are already registered for it", async () => {
    const registry = [
      { id: "lisa@lisa", scope: "project", projectPath: destDir },
      { id: "lisa-wiki@lisa", scope: "project", projectPath: siblingDir },
    ];
    /**
     * Fake Claude CLI with one plugin registered for this folder.
     * @param command - Command line
     * @returns Captured stdout
     */
    const run = async (command: string): Promise<unknown> => {
      commands.push(command);
      return { stdout: command === LIST ? JSON.stringify(registry) : "" };
    };

    await surface.installPluginsAndUpdateMarketplace(run, [...ENABLED]);

    expect(commands.filter(command => command.startsWith(INSTALL))).toEqual([
      `${INSTALL} lisa-typescript@lisa --scope project`,
      `${INSTALL} lisa-expo@lisa --scope project`,
      `${INSTALL} lisa-wiki@lisa --scope project`,
    ]);
  });
});
