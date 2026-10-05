/** Ordinary optional-registration completion and retry-state contracts. */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AutoAcceptPrompter } from "../../../src/cli/prompts.js";
import { NoOpGitService } from "../../../src/core/git-service.js";
import { Lisa } from "../../../src/core/lisa.js";
import { runPluginCommand } from "../../../src/core/plugin-command.js";
import { DetectorRegistry } from "../../../src/detection/index.js";
import { SilentLogger } from "../../../src/logging/silent-logger.js";
import { MigrationRegistry } from "../../../src/migrations/index.js";
import { StrategyRegistry } from "../../../src/strategies/index.js";
import { BackupService } from "../../../src/transaction/index.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

vi.mock("../../../src/core/plugin-command.js", async importOriginal => ({
  ...(await importOriginal<
    typeof import("../../../src/core/plugin-command.js")
  >()),
  runPluginCommand: vi.fn().mockResolvedValue({ stdout: "[]" }),
}));

const PLUGIN_ID = "lisa@lisa";
const MARKER_NAME = ".lisa-plugins-synced";
const MARKETPLACE_UPDATE = "claude plugin marketplace update lisa";
const PLUGIN_INSTALL = "claude plugin install lisa@lisa --scope project";

/** Existing private orchestrator surface exercised without new public API. */
interface RegistrationSurface {
  registerPlugins(): Promise<void>;
  installPluginsAndUpdateMarketplace(
    run: (
      command: string,
      options: Record<string, unknown>
    ) => Promise<unknown>,
    plugins: readonly string[]
  ): Promise<void>;
}

describe("optional plugin registration retry state", () => {
  let root: string;
  let registration: RegistrationSurface;
  beforeEach(async () => {
    vi.mocked(runPluginCommand).mockClear();
    root = await createTempDir();
    const logger = new SilentLogger();
    registration = new Lisa(
      {
        destDir: root,
        lisaDir: root,
        dryRun: false,
        harness: "claude",
        skipGitCheck: true,
        validateOnly: false,
        yesMode: true,
      },
      {
        logger,
        prompter: new AutoAcceptPrompter(),
        gitService: new NoOpGitService(),
        backupService: new BackupService(logger),
        detectorRegistry: new DetectorRegistry(),
        migrationRegistry: new MigrationRegistry(),
        strategyRegistry: new StrategyRegistry(),
      }
    ) as unknown as RegistrationSurface;
  });
  afterEach(async () => {
    await cleanupTempDir(root);
  });

  it("does not claim a complete sync when an attempted install fails", async () => {
    const commands: string[] = [];
    await registration.installPluginsAndUpdateMarketplace(
      async command => {
        commands.push(command);
        if (command.includes("plugin install"))
          throw new Error("ordinary CLI failure");
        return { stdout: "" };
      },
      [PLUGIN_ID]
    );
    expect(commands).toContain(PLUGIN_INSTALL);
    await expect(
      readFile(path.join(root, ".claude", MARKER_NAME))
    ).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("does not attempt explicitly disabled project plugins", async () => {
    await mkdir(path.join(root, ".claude"));
    await writeFile(
      path.join(root, ".claude", "settings.json"),
      JSON.stringify({ enabledPlugins: { "disabled@marketplace": false } })
    );
    await registration.registerPlugins();
    expect(runPluginCommand).not.toHaveBeenCalled();
  });

  it("invalidates a matching marker after an incremental refresh failure and retries the full sync", async () => {
    await registration.installPluginsAndUpdateMarketplace(
      async () => ({ stdout: "" }),
      [PLUGIN_ID]
    );
    const marker = path.join(root, ".claude", MARKER_NAME);
    const version = await readFile(marker, "utf8");
    await registration.installPluginsAndUpdateMarketplace(
      async command => {
        if (command.includes("marketplace update"))
          throw new Error("ordinary refresh failure");
        return { stdout: "[]" };
      },
      [PLUGIN_ID]
    );
    await expect(readFile(marker)).rejects.toMatchObject({ code: "ENOENT" });
    const commands: string[] = [];
    await registration.installPluginsAndUpdateMarketplace(
      async command => {
        commands.push(command);
        return {
          stdout: JSON.stringify([{ id: PLUGIN_ID, projectPath: root }]),
        };
      },
      [PLUGIN_ID]
    );
    expect(commands).toEqual([
      MARKETPLACE_UPDATE,
      PLUGIN_INSTALL,
      MARKETPLACE_UPDATE,
    ]);
    expect(await readFile(marker, "utf8")).toBe(version);
  });

  it("records a sync only after every command succeeds and supplies bounded command budgets", async () => {
    const commands: string[] = [];
    const budgets: unknown[] = [];
    await registration.installPluginsAndUpdateMarketplace(
      async (command, options) => {
        commands.push(command);
        budgets.push(options.timeout);
        return { stdout: "" };
      },
      [PLUGIN_ID]
    );
    expect(commands).toEqual([
      MARKETPLACE_UPDATE,
      PLUGIN_INSTALL,
      MARKETPLACE_UPDATE,
    ]);
    expect(
      budgets.every(
        budget => typeof budget === "number" && budget > 0 && budget <= 120_000
      )
    ).toBe(true);
    expect(
      (await readFile(path.join(root, ".claude", MARKER_NAME), "utf8")).trim()
    ).not.toBe("");
  });
});
