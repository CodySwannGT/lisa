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
      ["lisa@lisa"]
    );
    expect(commands).toContain(
      "claude plugin install lisa@lisa --scope project"
    );
    await expect(
      readFile(path.join(root, ".claude", ".lisa-plugins-synced"))
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

  it("records a sync only after every command succeeds and supplies bounded command budgets", async () => {
    const commands: string[] = [];
    const budgets: unknown[] = [];
    await registration.installPluginsAndUpdateMarketplace(
      async (command, options) => {
        commands.push(command);
        budgets.push(options.timeout);
        return { stdout: "" };
      },
      ["lisa@lisa"]
    );
    expect(commands).toEqual([
      "claude plugin marketplace update lisa",
      "claude plugin install lisa@lisa --scope project",
      "claude plugin marketplace update lisa",
    ]);
    expect(
      budgets.every(
        budget => typeof budget === "number" && budget > 0 && budget <= 120_000
      )
    ).toBe(true);
    expect(
      (
        await readFile(
          path.join(root, ".claude", ".lisa-plugins-synced"),
          "utf8"
        )
      ).trim()
    ).not.toBe("");
  });
});
