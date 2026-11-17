/**
 * @file lisa-plugins.ts
 * @description Project-scoped Claude Code plugin registration. One layer of the `Lisa` orchestrator; each layer
 * extends the one below it so the apply pipeline reads as one class while no
 * single module carries the whole pipeline.
 * @module core
 */
import * as fse from "fs-extra";
import { readFile } from "node:fs/promises";
import * as path from "node:path";
import pc from "picocolors";
import { readMarketplaceCatalog } from "../utils/marketplace-manifest.js";
import {
  describeSkippedPluginKey,
  partitionByLisaMarketplace,
} from "./plugin-marketplace-filter.js";
import { pruneDeadPluginRegistrations } from "./plugin-registration-prune.js";
import { harnessIncludesAgent } from "./config.js";
import {
  PLUGIN_LIST_MAX_CAPTURE_BYTES,
  PLUGIN_PROBE_TIMEOUT_MS,
  PLUGIN_PRUNE_TIMEOUT_MS,
  PLUGIN_REGISTRATION_TIMEOUT_MS,
  runPluginCommand,
} from "./plugin-command.js";
import { LisaPluginSync } from "./lisa-plugin-sync.js";
import { PLUGIN_COMMAND_FAILED } from "./lisa-state.js";
import type { PluginExecAsync } from "./lisa-state.js";

/**
 * Project-scoped Claude Code plugin registration.
 */
export abstract class LisaPlugins extends LisaPluginSync {
  /**
   * Register plugins from merged settings.json with Claude Code at project scope
   */
  protected async registerPlugins(): Promise<void> {
    if (
      this.config.dryRun ||
      !harnessIncludesAgent(this.config.harness, "claude")
    ) {
      return;
    }

    const settingsPath = path.join(
      this.config.destDir,
      ".claude",
      "settings.json"
    );

    if (!(await fse.pathExists(settingsPath))) {
      return;
    }

    const settings = await readFile(settingsPath, "utf-8")
      .then(content => JSON.parse(content) as Record<string, unknown>)
      .catch(() => null);

    if (!settings?.enabledPlugins) {
      return;
    }

    const plugins = Object.entries(
      settings.enabledPlugins as Record<string, boolean>
    )
      .filter(([, enabled]) => enabled === true)
      .map(([plugin]) => plugin);

    if (plugins.length === 0) {
      return;
    }

    const operationDeadline = Date.now() + PLUGIN_REGISTRATION_TIMEOUT_MS;
    const execAsync: PluginExecAsync = async (command, options) =>
      await runPluginCommand(command.split(" ").slice(1), {
        cwd: this.config.destDir,
        timeoutMs: Math.min(
          Number(options.timeout),
          operationDeadline - Date.now()
        ),
        ...(typeof options.maxCaptureBytes === "number"
          ? { maxCaptureBytes: options.maxCaptureBytes }
          : {}),
      });

    try {
      await execAsync("claude --version", { timeout: PLUGIN_PROBE_TIMEOUT_MS });
    } catch (error) {
      this.reportPluginProbeFailure(error);
      return;
    }

    await this.installPluginsAndUpdateMarketplace(execAsync, plugins);

    // After installs, on its own budget, so a long backlog of dead
    // registrations never starves this checkout's own registration (#4645).
    const pruneDeadline = Date.now() + PLUGIN_PRUNE_TIMEOUT_MS;
    await pruneDeadPluginRegistrations(this.config.destDir, {
      runClaude: async (args, cwd) =>
        await runPluginCommand(args, {
          cwd,
          timeoutMs: Math.min(
            PLUGIN_PROBE_TIMEOUT_MS,
            pruneDeadline - Date.now()
          ),
          maxCaptureBytes: PLUGIN_LIST_MAX_CAPTURE_BYTES,
        }),
      deadlineReached: () => Date.now() >= pruneDeadline,
      logger: this.deps.logger,
    });
  }

  /**
   * Distinguish a missing optional CLI from a failed or timed-out real probe.
   * @param error - Probe failure
   */
  protected reportPluginProbeFailure(error: unknown): void {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      this.deps.logger.info(
        "Claude CLI not found, skipping plugin registration"
      );
      return;
    }
    this.deps.logger.warn(
      `Claude CLI probe failed; plugin registration will retry (${error instanceof Error ? error.message : PLUGIN_COMMAND_FAILED})`
    );
  }

  /**
   * Install each plugin and refresh the Lisa marketplace cache.
   *
   * Version-gated (perf): `claude plugin marketplace update` is a network git
   * pull of the Lisa repo and every `claude plugin install` spawns the Claude
   * CLI (seconds each); re-running all of it on every apply made a single
   * `bun add` cost minutes across the repeated apply passes. A full sync
   * (marketplace refresh + install every plugin) still runs whenever the
   * installed Lisa version differs from the `.claude/.lisa-plugins-synced`
   * marker; between version changes only plugins missing for this project are
   * installed, so the self-heal property (a removed plugin comes back on the
   * next install) survives at the cost of one `claude plugin list` call.
   * @param execAsync - Promisified exec function for running shell commands
   * @param enabledPlugins - Plugin identifiers from enabledPlugins (e.g. "lisa@lisa")
   */
  protected async installPluginsAndUpdateMarketplace(
    execAsync: PluginExecAsync,
    enabledPlugins: readonly string[]
  ): Promise<void> {
    const { logger } = this.deps;
    const validPluginName = /^[\w@./-]+$/;
    const plugins = await this.withoutUnavailableLisaPlugins(enabledPlugins);
    const { fullSync, toInstall, version, isLinkedWorktree } =
      await this.computePluginSyncPlan(execAsync, plugins);

    if (!fullSync && toInstall.length === 0) {
      if (isLinkedWorktree) {
        // Record the settled state on the worktree's own marker so repeat
        // applies (and health's root-confined marker probe) do not have to
        // re-derive it from the primary checkout.
        await this.writePluginSyncMarker(version);
      }
      logger.info(
        pc.gray(`Plugins already in sync for Lisa ${version}; skipping`)
      );
      return;
    }

    logger.info("Registering plugins with Claude Code (project scope)...");

    const sync = { succeeded: true };
    if (fullSync) {
      // Best-effort cache refresh. Individual plugin installs below will still
      // report whether the marketplace entry is available.
      sync.succeeded = await this.updateLisaMarketplace(execAsync, false);
    }

    for (const plugin of toInstall) {
      if (!validPluginName.test(plugin)) {
        logger.warn(`Skipping invalid plugin name: ${plugin}`);
        sync.succeeded = false;
        continue;
      }
      const installed = await this.installPlugin(execAsync, plugin);
      sync.succeeded = installed && sync.succeeded;
    }

    // Post-install refresh must run whenever installs happened: installing can
    // register the marketplace for the first time, and without a refresh newly
    // added skills are not discovered ("Unknown skill" in nightly CI — #320).
    const refreshed = await this.updateLisaMarketplace(execAsync, true);

    await this.recordPluginSyncOutcome(
      version,
      fullSync,
      sync.succeeded && refreshed
    );
  }

  /**
   * Drop enabled `<name>@lisa` keys the Lisa marketplace cannot supply, with
   * one warning each. A skip never counts against the sync, so a retired key
   * such as `typescript@lisa` no longer fails every apply (#4645). An
   * unreadable manifest skips nothing.
   * @param enabledPlugins - Plugin identifiers from enabledPlugins
   * @returns The identifiers worth attempting, in order
   */
  protected async withoutUnavailableLisaPlugins(
    enabledPlugins: readonly string[]
  ): Promise<readonly string[]> {
    const { installable, skipped } = partitionByLisaMarketplace(
      enabledPlugins,
      await readMarketplaceCatalog(
        path.join(this.config.lisaDir, ".claude-plugin", "marketplace.json")
      )
    );
    for (const key of skipped) {
      this.deps.logger.warn(describeSkippedPluginKey(key));
    }
    return installable;
  }
}
