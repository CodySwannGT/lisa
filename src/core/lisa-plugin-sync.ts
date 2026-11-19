/**
 * @file lisa-plugin-sync.ts
 * @description Plugin sync marker, sync planning, and individual Claude CLI plugin commands. One layer of the `Lisa` orchestrator; each layer
 * extends the one below it so the apply pipeline reads as one class while no
 * single module carries the whole pipeline.
 * @module core
 */
import * as fse from "fs-extra";
import { readFile, unlink, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { getPackageVersion } from "../cli/version.js";
import { resolvePrimaryWorktreeRoot } from "../utils/linked-worktree.js";
import {
  PLUGIN_LIST_MAX_CAPTURE_BYTES,
  PLUGIN_PROBE_TIMEOUT_MS,
  PLUGIN_REGISTRATION_TIMEOUT_MS,
} from "./plugin-command.js";
import { LisaDeletions } from "./lisa-deletions.js";
import { PLUGIN_COMMAND_FAILED } from "./lisa-state.js";
import type { PluginExecAsync } from "./lisa-state.js";

/**
 * Plugin sync marker, sync planning, and individual Claude CLI plugin commands.
 */
export abstract class LisaPluginSync extends LisaDeletions {
  /**
   * Exec options shared by all Claude CLI plugin commands.
   * @returns Options object with the project cwd and registration budget
   */
  protected pluginExecOptions(): Record<string, unknown> {
    return {
      cwd: this.config.destDir,
      timeout: PLUGIN_REGISTRATION_TIMEOUT_MS,
    };
  }

  /**
   * Absolute path of the plugin sync marker recording the last fully-synced
   * Lisa version for this project. Shared with install-claude-plugins.sh.
   * @returns Marker path under the project's .claude directory
   */
  protected pluginSyncMarkerPath(): string {
    return path.join(this.config.destDir, ".claude", ".lisa-plugins-synced");
  }

  /**
   * Read the plugin ids already installed for this project via
   * `claude plugin list --json`.
   * @param execAsync - Promisified exec function for running shell commands
   * @returns Set of installed plugin ids, or null when the list cannot be
   *   obtained (older CLI, parse failure) so callers fall back to installing
   *   everything — the pre-existing behavior
   */
  protected async readInstalledPluginIds(
    execAsync: PluginExecAsync
  ): Promise<ReadonlySet<string> | null> {
    try {
      const result = (await execAsync("claude plugin list --json", {
        cwd: this.config.destDir,
        timeout: PLUGIN_PROBE_TIMEOUT_MS,
        maxCaptureBytes: PLUGIN_LIST_MAX_CAPTURE_BYTES,
      })) as { stdout?: unknown };
      const parsed: unknown = JSON.parse(String(result.stdout ?? ""));
      if (!Array.isArray(parsed)) {
        return null;
      }
      const destPath = path.resolve(this.config.destDir);
      const ids = parsed
        .filter(
          (entry): entry is { id: string; projectPath: string } =>
            typeof (entry as { id?: unknown }).id === "string" &&
            (entry as { projectPath?: unknown }).projectPath === destPath
        )
        .map(entry => entry.id);
      return new Set(ids);
    } catch {
      return null;
    }
  }

  /**
   * Record the Lisa version whose plugin set was last fully synced.
   *
   * Writes through `node:fs/promises`. `writeFile` is one of the `graceful-fs`
   * passthroughs Node's ESM loader does not expose on the `fs-extra` namespace,
   * so `fse.writeFile(...)` was `undefined` in the shipped `dist/` and threw a
   * `TypeError` into the catch below (#2487) — the marker was never written, and
   * the version gate it feeds never once took effect.
   *
   * Failure stays non-fatal, but is no longer silent. The catch now reports the
   * real error: a recovery path that says nothing cannot be distinguished from
   * one that never ran, which is precisely how this went unnoticed. The wording
   * matches the sibling best-effort plugin steps above.
   * @param version - Lisa package version to record
   * @returns Promise that resolves when the marker is written (best-effort)
   */
  protected async writePluginSyncMarker(version: string): Promise<void> {
    try {
      await fse.ensureDir(path.join(this.config.destDir, ".claude"));
      await writeFile(this.pluginSyncMarkerPath(), `${version}\n`, "utf-8");
    } catch (error) {
      // Best-effort: a missing marker only costs a redundant full sync next run.
      const message = error instanceof Error ? error.message : String(error);
      this.deps.logger.warn(`Could not record plugin sync marker: ${message}`);
    }
  }

  /** Remove only this project's marker so incomplete incremental syncs retry. */
  protected async invalidatePluginSyncMarker(): Promise<void> {
    try {
      await unlink(this.pluginSyncMarkerPath());
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      const message = error instanceof Error ? error.message : String(error);
      this.deps.logger.warn(
        `Could not invalidate plugin sync marker: ${message}`
      );
    }
  }

  /**
   * Record only a completed sync, keeping failures eligible for a later retry.
   * @param version - Current Lisa version
   * @param fullSync - Whether a version change required every plugin
   * @param completed - Whether all required commands succeeded
   */
  protected async recordPluginSyncOutcome(
    version: string,
    fullSync: boolean,
    completed: boolean
  ): Promise<void> {
    if (!completed) {
      await this.invalidatePluginSyncMarker();
      this.deps.logger.warn(
        "Plugin registration incomplete; retry on the next apply"
      );
      return;
    }
    if (fullSync) {
      // Always the project's OWN marker (destDir): a full sync run from a
      // linked worktree only reinstalled plugins for the worktree's
      // projectPath, so recording it against the primary checkout would let
      // the primary skip the forced reinstall it still needs after a
      // version bump.
      await this.writePluginSyncMarker(version);
    }
  }

  /**
   * Decide whether this apply needs a full plugin sync and which plugins to
   * install.
   *
   * Linked worktrees inherit the primary checkout's sync state: the marker is
   * gitignored (it records this machine's `~/.claude` plugin state), so a
   * fresh agent worktree is always marker-less and would otherwise pay the
   * full sync — marketplace pulls plus a Claude CLI spawn per plugin — on
   * every ticket. When the primary checkout is already synced for this Lisa
   * version, the worktree has nothing left to do: the marketplace cache is
   * machine-global and per-worktree plugin registration is handled by the
   * coding agent's own startup (Claude Code auto-installs the committed
   * `enabledPlugins` for a new projectPath; Codex uses the project-local
   * `.codex-plugin` pointer instead of Claude project-scope registrations).
   * The #320 defense (refresh marketplace whenever installs happened) holds:
   * the skip path performs no installs.
   * @param execAsync - Promisified exec function for running shell commands
   * @param plugins - Plugin identifiers from enabledPlugins
   * @returns Sync plan: fullSync (version changed), plugins to install, the
   *   current Lisa version, and whether destDir is a linked worktree
   */
  protected async computePluginSyncPlan(
    execAsync: PluginExecAsync,
    plugins: readonly string[]
  ): Promise<{
    readonly fullSync: boolean;
    readonly toInstall: readonly string[];
    readonly version: string;
    readonly isLinkedWorktree: boolean;
  }> {
    const version = getPackageVersion();
    const primaryRoot = await resolvePrimaryWorktreeRoot(this.config.destDir);
    const isLinkedWorktree = primaryRoot !== null;
    const readMarker = async (markerPath: string): Promise<string | null> =>
      readFile(markerPath, "utf-8")
        .then(content => content.trim())
        .catch(() => null);
    const ownMarker = await readMarker(this.pluginSyncMarkerPath());
    const syncedVersion =
      ownMarker === version || primaryRoot === null
        ? ownMarker
        : await readMarker(
            path.join(primaryRoot, ".claude", ".lisa-plugins-synced")
          );
    const fullSync = syncedVersion !== version;
    if (isLinkedWorktree && !fullSync) {
      // Skip the `claude plugin list` probe too — registration for this
      // worktree's projectPath is deferred to the coding agent's startup.
      return { fullSync: false, toInstall: [], version, isLinkedWorktree };
    }
    const installed = fullSync
      ? null
      : await this.readInstalledPluginIds(execAsync);
    const toInstall =
      installed === null
        ? plugins
        : plugins.filter(plugin => !installed.has(plugin));
    return { fullSync, toInstall, version, isLinkedWorktree };
  }

  /**
   * Refresh the cached Lisa marketplace via the Claude CLI.
   * @param execAsync - Promisified exec function for running shell commands
   * @param announce - Whether to log the outcome (silent for the pre-install
   *   best-effort refresh)
   * @returns Whether the refresh command succeeded
   */
  protected async updateLisaMarketplace(
    execAsync: PluginExecAsync,
    announce: boolean
  ): Promise<boolean> {
    const { logger } = this.deps;
    try {
      await execAsync(
        "claude plugin marketplace update lisa",
        this.pluginExecOptions()
      );
      if (announce) {
        logger.success("Updated marketplace: lisa");
      }
      return true;
    } catch (error) {
      if (announce) {
        logger.warn(
          `Could not update marketplace: lisa (${error instanceof Error ? error.message : PLUGIN_COMMAND_FAILED})`
        );
      }
      return false;
    }
  }

  /**
   * Install a single plugin at project scope via the Claude CLI.
   * @param execAsync - Promisified exec function for running shell commands
   * @param plugin - Plugin identifier (already validated)
   * @returns Whether the install command succeeded
   */
  protected async installPlugin(
    execAsync: PluginExecAsync,
    plugin: string
  ): Promise<boolean> {
    const { logger } = this.deps;
    try {
      await execAsync(
        `claude plugin install ${plugin} --scope project`,
        this.pluginExecOptions()
      );
      logger.success(`Registered plugin: ${plugin}`);
      return true;
    } catch (error) {
      logger.warn(
        `Could not register plugin: ${plugin} (${error instanceof Error ? error.message : PLUGIN_COMMAND_FAILED})`
      );
      return false;
    }
  }
}
