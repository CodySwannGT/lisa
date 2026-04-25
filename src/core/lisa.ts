/* eslint-disable max-lines -- Main orchestrator class with apply/validate operations */
import * as fse from "fs-extra";
import { readFile, stat } from "node:fs/promises";
import * as path from "node:path";
import pc from "picocolors";
import type { IPrompter } from "../cli/prompts.js";
import { discoverLisaAgents, installAgents } from "../codex/agent-installer.js";
import { installHooks } from "../codex/hooks-installer.js";
import {
  readManagedManifest,
  writeManagedManifest,
} from "../codex/manifest.js";
import { installAgentsMd } from "../codex/agents-md-installer.js";
import { installSettings } from "../codex/settings-installer.js";
import { installSkills } from "../codex/skills-installer.js";
import { DetectorRegistry } from "../detection/index.js";
import {
  DestinationNotDirectoryError,
  DestinationNotFoundError,
  UserAbortedError,
} from "../errors/index.js";
import type { ILogger } from "../logging/index.js";
import {
  MigrationRegistry,
  type MigrationContext,
  type MigrationResult,
} from "../migrations/index.js";
import { StrategyRegistry, type StrategyContext } from "../strategies/index.js";
import type { IBackupService } from "../transaction/index.js";
import { listFilesRecursive } from "../utils/file-operations.js";
import {
  loadIgnorePatterns,
  type IgnorePatterns,
} from "../utils/ignore-patterns.js";
import {
  getLisaDistDir,
  scheduleReconciliationChild,
  shouldSchedulePostinstallReconciliation,
} from "../utils/postinstall-trampoline.js";
import type {
  CopyStrategy,
  DeletionsConfig,
  FileOperationResult,
  LisaConfig,
  LisaResult,
  OperationCounters,
  ProjectType,
} from "./config.js";
import { COPY_STRATEGIES, createInitialCounters } from "./config.js";
import type { IGitService } from "./git-service.js";

/**
 * Dependencies for Lisa operations
 */
export interface LisaDependencies {
  readonly logger: ILogger;
  readonly prompter: IPrompter;
  readonly backupService: IBackupService;
  readonly detectorRegistry: DetectorRegistry;
  readonly strategyRegistry: StrategyRegistry;
  readonly gitService: IGitService;
  readonly migrationRegistry: MigrationRegistry;
}

/**
 * Main Lisa orchestrator
 */
export class Lisa {
  private counters: OperationCounters = createInitialCounters();
  private detectedTypes: ProjectType[] = [];
  private ignorePatterns: IgnorePatterns = {
    patterns: [],
    shouldIgnore: () => false,
  };
  /**
   * Paths marked for deletion by any detected project type's deletions.json.
   * Used to skip creating files that would just be deleted moments later (e.g.,
   * CDK inherits jest.* files from typescript but its own deletions.json removes
   * them — without this gate, Lisa creates then immediately deletes the files,
   * causing ENOENT races for any concurrent linter/file-watcher).
   */
  private pendingDeletions: Set<string> = new Set();
  private readonly separator = "========================================";
  private readonly lisaignoreSuffix = "(.lisaignore)";

  /**
   * Initialize Lisa orchestrator
   * @param config - Configuration for the apply operation
   * @param deps - Injected service dependencies
   */
  constructor(
    private readonly config: LisaConfig,
    private readonly deps: LisaDependencies
  ) {}

  /**
   * Initialize services
   */
  private async initServices(): Promise<void> {
    const { backupService } = this.deps;

    if (!this.config.dryRun) {
      await backupService.init(this.config.destDir);
    }
  }

  /**
   * Detect and confirm project types
   */
  private async detectTypes(): Promise<void> {
    const { detectorRegistry, prompter } = this.deps;

    const rawTypes = await detectorRegistry.detectAll(this.config.destDir);
    this.detectedTypes = detectorRegistry.expandAndOrderTypes(rawTypes);
    this.detectedTypes = [
      ...(await prompter.confirmProjectTypes(this.detectedTypes)),
    ];
  }

  /**
   * Process all configurations
   */
  private async processConfigurations(): Promise<void> {
    const { logger } = this.deps;

    // Load ignore patterns from destination project
    this.ignorePatterns = await loadIgnorePatterns(this.config.destDir);
    if (this.ignorePatterns.patterns.length > 0) {
      logger.info(
        `Loaded .lisaignore with ${this.ignorePatterns.patterns.length} pattern(s)`
      );
    }

    logger.info("Processing common configurations (all/)...");
    await this.processProjectType("all");

    for (const type of this.detectedTypes) {
      const typeDir = path.join(this.config.lisaDir, type);
      if (await fse.pathExists(typeDir)) {
        logger.info(`Processing ${type} configurations...`);
        await this.processProjectType(type);
      } else {
        logger.warn(`No configuration directory found for type: ${type}`);
      }
    }
  }

  /**
   * Pre-compute the set of paths marked for deletion across "all" and every
   * detected project type. This runs before strategy processing so the copy
   * strategies can skip creating files that are about to be deleted anyway.
   *
   * Motivating case: CDK inherits typescript/create-only, which ships
   * `jest.config.local.ts` + `jest.thresholds.json`. CDK's own `deletions.json`
   * then removes them. Without this gate, Lisa would create them and delete
   * them in the same apply, which causes ENOENT errors for any concurrent
   * file-watcher/linter that observed the briefly-existing files.
   *
   * The `keep` list in a deletions.json (e.g., expo keeps
   * `zap-baseline-expo.yml`) is honored — paths in `keep` are not treated as
   * pending-deletions, so they will still be created by upstream strategies.
   * @returns Promise that resolves once pending deletions have been collected
   */
  private async loadPendingDeletions(): Promise<void> {
    const pending = new Set<string>();
    for (const type of ["all", ...this.detectedTypes]) {
      const paths = await this.readPendingDeletionsForType(type);
      for (const p of paths) {
        pending.add(p);
      }
    }
    this.pendingDeletions = pending;
  }

  /**
   * Read the set of paths a single type's deletions.json will delete,
   * filtered by the type's `keep` list. Returns an empty array when the file
   * is missing or malformed — a bad file cannot block strategy processing;
   * any validation errors are surfaced later by processDeletions itself.
   * @param type - Project type (e.g., "all", "cdk", "typescript")
   * @returns Array of relative paths marked for deletion
   */
  private async readPendingDeletionsForType(
    type: string
  ): Promise<readonly string[]> {
    const deletionsPath = path.join(
      this.config.lisaDir,
      type,
      "deletions.json"
    );
    if (!(await fse.pathExists(deletionsPath))) {
      return [];
    }

    try {
      const content = await readFile(deletionsPath, "utf-8");
      const deletions: DeletionsConfig = JSON.parse(content);
      if (!Array.isArray(deletions.paths)) {
        return [];
      }
      const keepSet = new Set(deletions.keep ?? []);
      return deletions.paths.filter(p => !keepSet.has(p));
    } catch {
      return [];
    }
  }

  /**
   * Process deletions from deletions.json files
   */
  private async processDeletions(): Promise<void> {
    const { logger } = this.deps;

    // Process deletions for "all" and each detected type
    const typesToProcess = ["all", ...this.detectedTypes];

    for (const type of typesToProcess) {
      const deletionsPath = path.join(
        this.config.lisaDir,
        type,
        "deletions.json"
      );

      if (await fse.pathExists(deletionsPath)) {
        logger.info(`Processing deletions for ${type}...`);
        await this.processDeletionsFile(deletionsPath);
      }
    }
  }

  /**
   * Process a single deletions.json file
   * @param deletionsPath - Path to the deletions.json file
   */
  private async processDeletionsFile(deletionsPath: string): Promise<void> {
    const { logger } = this.deps;

    try {
      const content = await readFile(deletionsPath, "utf-8");
      const deletions: DeletionsConfig = JSON.parse(content);

      if (!Array.isArray(deletions.paths)) {
        logger.warn(`Invalid deletions.json format: paths must be an array`);
        return;
      }

      const keepSet = new Set(deletions.keep ?? []);

      for (const relativePath of deletions.paths) {
        if (keepSet.has(relativePath)) {
          logger.info(`Kept (protected): ${relativePath}`);
          continue;
        }
        await this.processSingleDeletion(relativePath);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn(`Failed to process deletions file: ${message}`);
    }
  }

  /**
   * Process a single deletion path
   * @param relativePath - Relative path to delete
   */
  private async processSingleDeletion(relativePath: string): Promise<void> {
    const { logger } = this.deps;
    const targetPath = path.join(this.config.destDir, relativePath);

    const resolvedTarget = path.resolve(targetPath);
    const resolvedDest = path.resolve(this.config.destDir);

    // Explicit guard: disallow deleting the project root itself
    if (resolvedTarget === resolvedDest) {
      logger.warn(
        `Skipping deletion of project root directory: ${relativePath || "."}`
      );
      return;
    }

    // Safety check: only allow paths strictly inside destDir
    if (!resolvedTarget.startsWith(resolvedDest + path.sep)) {
      logger.warn(
        `Skipping deletion outside project directory: ${relativePath}`
      );
      return;
    }

    if (this.ignorePatterns.shouldIgnore(relativePath)) {
      logger.info(`Kept ${this.lisaignoreSuffix}: ${relativePath}`);
      this.counters.ignored++;
      return;
    }

    if (!(await fse.pathExists(targetPath))) {
      return;
    }

    if (this.config.dryRun) {
      logger.dry(`Would delete: ${relativePath}`);
      this.counters.deleted++;
    } else {
      await fse.remove(targetPath);
      logger.success(`Deleted: ${relativePath}`);
      this.counters.deleted++;
    }
  }

  /**
   * Invoke pre-strategy migration hooks so migrations can snapshot project state
   * before strategies overwrite or delete managed files.
   */
  private async runMigrationsBeforeStrategies(): Promise<void> {
    const { logger, migrationRegistry } = this.deps;

    const ctx: MigrationContext = {
      projectDir: this.config.destDir,
      lisaDir: this.config.lisaDir,
      detectedTypes: this.detectedTypes,
      dryRun: this.config.dryRun,
      logger,
    };

    await migrationRegistry.runBeforeStrategies(ctx);
  }

  /**
   * Run all applicable migrations against the destination project
   */
  private async processMigrations(): Promise<void> {
    const { logger, migrationRegistry } = this.deps;

    const ctx: MigrationContext = {
      projectDir: this.config.destDir,
      lisaDir: this.config.lisaDir,
      detectedTypes: this.detectedTypes,
      dryRun: this.config.dryRun,
      logger,
    };

    logger.info("Running migrations...");
    const results = await migrationRegistry.runAll(ctx);
    this.updateMigrationCounters(results);
  }

  /**
   * Update migration counters from aggregated migration results
   * @param results - Migration results to aggregate into counters
   */
  private updateMigrationCounters(results: readonly MigrationResult[]): void {
    for (const result of results) {
      if (result.action === "applied") {
        this.counters.migrationsApplied++;
      } else {
        this.counters.migrationsSkipped++;
      }
    }
  }

  /* v8 ignore start -- calls external CLI, covered by integration tests */
  /**
   * Register plugins from merged settings.json with Claude Code at project scope
   */
  private async registerPlugins(): Promise<void> {
    const { logger } = this.deps;

    if (this.config.dryRun) {
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

    const plugins = Object.keys(
      settings.enabledPlugins as Record<string, boolean>
    );

    if (plugins.length === 0) {
      return;
    }

    const { exec: execCb } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const execAsync = promisify(execCb);

    try {
      await execAsync("command -v claude", { shell: "/bin/sh" });
    } catch {
      logger.info("Claude CLI not found, skipping plugin registration");
      return;
    }

    await this.installPluginsAndUpdateMarketplace(execAsync, plugins);
  }

  /**
   * Install each plugin and refresh the Lisa marketplace cache
   * @param execAsync - Promisified exec function for running shell commands
   * @param plugins - Plugin identifiers from enabledPlugins (e.g. "lisa@lisa")
   */
  private async installPluginsAndUpdateMarketplace(
    execAsync: (cmd: string, opts: Record<string, unknown>) => Promise<unknown>,
    plugins: readonly string[]
  ): Promise<void> {
    const { logger } = this.deps;
    const validPluginName = /^[\w@./-]+$/;

    logger.info("Registering plugins with Claude Code (project scope)...");

    for (const plugin of plugins) {
      if (!validPluginName.test(plugin)) {
        logger.warn(`Skipping invalid plugin name: ${plugin}`);
        continue;
      }

      try {
        await execAsync(`claude plugin install ${plugin} --scope project`, {
          cwd: this.config.destDir,
          shell: "/bin/sh",
        });
        logger.success(`Registered plugin: ${plugin}`);
      } catch {
        logger.warn(`Could not register plugin: ${plugin}`);
      }
    }

    try {
      await execAsync("claude plugin marketplace update lisa", {
        cwd: this.config.destDir,
        shell: "/bin/sh",
      });
      logger.success("Updated marketplace: lisa");
    } catch {
      logger.warn("Could not update marketplace: lisa");
    }
  }
  /* v8 ignore stop */

  /**
   * Finalize operation
   * @returns Promise that resolves when finalization is complete
   */
  private async finalize(): Promise<void> {
    const { backupService } = this.deps;

    if (!this.config.dryRun) {
      await backupService.cleanup();
    }
  }

  /**
   * Create success result
   * @returns Success result with operation counters and detected types
   */
  private getSuccessResult(): LisaResult {
    const mode = this.config.validateOnly ? "validate" : "apply";
    return {
      success: true,
      counters: { ...this.counters },
      detectedTypes: [...this.detectedTypes],
      mode,
      errors: [],
    };
  }

  /**
   * Handle apply error and rollback
   * @param error Error that occurred during apply
   * @returns Error result
   */
  private async handleApplyError(error: unknown): Promise<LisaResult> {
    const { backupService } = this.deps;
    if (!this.config.dryRun) {
      try {
        await backupService.rollback();
      } catch {
        // Rollback error already logged
      }
    }

    const mode = this.config.validateOnly ? "validate" : "apply";
    const message = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      counters: { ...this.counters },
      detectedTypes: [...this.detectedTypes],
      mode,
      errors: [message],
    };
  }

  /**
   * Apply Lisa configurations to the destination project
   * @returns Result of the apply operation
   */
  async apply(): Promise<LisaResult> {
    try {
      await this.validateDestination();
      await this.validateGitState();
      this.printHeader();
      await this.initServices();
      await this.detectTypes();
      await this.loadPendingDeletions();
      await this.runMigrationsBeforeStrategies();
      await this.processConfigurations();
      await this.processDeletions();
      await this.processMigrations();
      await this.processCodexEmit();
      await this.registerPlugins();
      await this.finalize();
      this.printSummary();
      await this.printMigrationNotices(this.config.destDir);
      await this.schedulePostinstallReconciliation();
      return this.getSuccessResult();
    } catch (error) {
      return this.handleApplyError(error);
    }
  }

  /**
   * Emit Codex-targeted artifacts (agents, hooks, settings) when the host
   * project's harness is `codex` or `both`. No-op for `claude` (default).
   *
   * Codex artifacts cannot be shipped via plugins (the Codex plugin manifest
   * has no fields for hooks or agent roles, confirmed in
   * `codex-rs/core-plugins/src/manifest.rs`). Lisa instead writes them
   * directly into the host project's `.codex/` tree as part of `apply()`,
   * tracking ownership via `.codex/.lisa-managed.json` so updates can clean
   * up stale entries without touching host customizations.
   */
  private async processCodexEmit(): Promise<void> {
    const { harness } = this.config;
    if (harness !== "codex" && harness !== "both") {
      return;
    }
    if (this.config.dryRun) {
      this.deps.logger.info(pc.gray("Codex emit: skipped (dry-run mode)"));
      return;
    }

    const previous = await readManagedManifest(this.config.destDir);

    const agentSources = await discoverLisaAgents(this.config.lisaDir);
    const agentResult = await installAgents(
      agentSources,
      this.config.destDir,
      previous.files
    );

    const hooksResult = await installHooks(
      this.config.lisaDir,
      this.config.destDir,
      this.detectedTypes
    );

    const settingsResult = await installSettings(this.config.destDir);

    const skillsResult = await installSkills(
      this.config.lisaDir,
      this.config.destDir,
      previous.files
    );

    // AGENTS.md is create-only — produced once and never managed by Lisa
    // afterward, so it's not added to the manifest (Lisa doesn't own it).
    await installAgentsMd(this.config.destDir);

    const allManagedFiles = [
      ...agentResult.managedFiles,
      ...hooksResult.managedFiles,
      ...settingsResult.managedFiles,
      ...skillsResult.managedFiles,
    ];
    await writeManagedManifest(this.config.destDir, allManagedFiles);

    this.deps.logger.info(
      pc.cyan(
        `Codex emit: ${agentResult.installed.length} agents, ${hooksResult.hookEntries} hooks, ${skillsResult.installed.length} skills, settings ${settingsResult.created ? "created" : "merged"}${
          agentResult.deleted.length > 0
            ? ` (${agentResult.deleted.length} stale removed)`
            : ""
        }`
      )
    );
  }

  /**
   * Schedule a reconciliation re-run when Lisa is invoked as a package-manager
   * lifecycle script. Works around the fact that `bun add` (and similar
   * package-manager mutations) cache package.json in memory at the start of
   * the command and rewrite it at the end, clobbering any changes made by
   * postinstall scripts.
   *
   * The trampoline is always fully detached so the package manager can exit
   * normally; the child then detects the exit and re-runs Lisa. See
   * utils/postinstall-trampoline.ts for details.
   * @returns Promise that resolves immediately after the detached child is spawned
   */
  private async schedulePostinstallReconciliation(): Promise<void> {
    if (!shouldSchedulePostinstallReconciliation(this.config.dryRun)) {
      return;
    }
    try {
      const lisaDistDir = getLisaDistDir(import.meta.url);
      await scheduleReconciliationChild(
        this.config.destDir,
        lisaDistDir,
        process.ppid
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.deps.logger.warn(
        `Could not schedule postinstall reconciliation: ${message}`
      );
    }
  }

  /**
   * Validate compatibility without applying changes
   * @returns Result of the validate operation
   */
  async validate(): Promise<LisaResult> {
    // Validate mode is essentially a dry run
    return this.apply();
  }

  /**
   * Process all files for a given project type
   * @param type Project type to process
   */
  private async processProjectType(type: string): Promise<void> {
    const { logger, strategyRegistry } = this.deps;

    for (const strategy of COPY_STRATEGIES) {
      const srcDir = path.join(this.config.lisaDir, type, strategy);

      if (await fse.pathExists(srcDir)) {
        logger.info(`Processing ${type}/${strategy}...`);
        await this.processDirectory(srcDir, strategyRegistry.get(strategy));
      }
    }
  }

  /**
   * Process all files in a directory with the given strategy
   * @param srcDir Source directory
   * @param strategy Strategy to apply
   * @param strategy.name Strategy name
   * @param strategy.apply Apply function
   */
  private async processDirectory(
    srcDir: string,
    strategy: {
      name: CopyStrategy;
      apply: (
        s: string,
        d: string,
        r: string,
        c: StrategyContext
      ) => Promise<FileOperationResult>;
    }
  ): Promise<void> {
    const { logger } = this.deps;
    const allFiles = await listFilesRecursive(srcDir);

    // Filter out ignored files AND files pending deletion by a detected type.
    // Pending-deletion filtering prevents the create-then-delete churn (and
    // associated ENOENT races) when a parent type ships a file the child type
    // removes, e.g., CDK removes typescript's jest.* files.
    const files = allFiles.filter(srcFile => {
      const relativePath = path.relative(srcDir, srcFile);
      if (this.ignorePatterns.shouldIgnore(relativePath)) {
        this.counters.ignored++;
        if (this.config.dryRun) {
          logger.dry(`Would skip (ignored): ${relativePath}`);
        } else {
          logger.info(`Ignored: ${relativePath}`);
        }
        return false;
      }
      if (this.pendingDeletions.has(relativePath)) {
        this.counters.skipped++;
        if (this.config.dryRun) {
          logger.dry(
            `Would skip (pending deletion by detected type): ${relativePath}`
          );
        } else {
          logger.info(`Skipped (pending deletion): ${relativePath}`);
        }
        return false;
      }
      return true;
    });

    const context: StrategyContext = {
      config: this.config,
      backupFile: async absolutePath => {
        await this.deps.backupService.backup(absolutePath);
        await this.deps.backupService.persistentBackup(absolutePath);
      },
      promptOverwrite: async (relativePath, sourcePath, destPath) => {
        return this.handleOverwritePrompt(relativePath, sourcePath, destPath);
      },
    };

    for (const srcFile of files) {
      const relativePath = path.relative(srcDir, srcFile);
      const destFile = path.join(this.config.destDir, relativePath);

      const result = await strategy.apply(
        srcFile,
        destFile,
        relativePath,
        context
      );
      this.updateCounters(result);
      this.logResult(result);
    }
  }

  /**
   * Handle overwrite prompt for conflicting files
   * @param relativePath Relative path of the file
   * @param sourcePath Source file path
   * @param destPath Destination file path
   * @returns True if user approves overwrite
   */
  private async handleOverwritePrompt(
    relativePath: string,
    sourcePath: string,
    destPath: string
  ): Promise<boolean> {
    const { logger, prompter } = this.deps;

    const decision = await prompter.promptOverwrite(relativePath);

    if (decision === "diff") {
      // Show diff and re-prompt
      await this.showDiff(sourcePath, destPath);
      return this.handleOverwritePrompt(relativePath, sourcePath, destPath);
    }

    if (decision === "yes") {
      logger.info(
        `Auto-accepting overwrite (non-interactive): ${relativePath}`
      );
      return true;
    }

    return false;
  }

  /**
   * Show diff between two files
   * @param sourcePath Source file path
   * @param destPath Destination file path
   */
  private async showDiff(sourcePath: string, destPath: string): Promise<void> {
    const { spawn } = await import("node:child_process");

    return new Promise(resolve => {
      console.log("--- Differences ---");
      const diff = spawn("diff", [destPath, sourcePath], { stdio: "inherit" });
      diff.on("close", () => {
        console.log("-------------------");
        resolve();
      });
    });
  }

  /**
   * Update counters based on operation result
   * @param result Operation result to count
   */
  private updateCounters(result: FileOperationResult): void {
    switch (result.action) {
      case "copied":
      case "created":
        this.counters.copied++;
        break;
      case "skipped":
        this.counters.skipped++;
        break;
      case "overwritten":
        this.counters.overwritten++;
        break;
      case "appended":
        this.counters.appended++;
        break;
      case "merged":
        this.counters.merged++;
        break;
    }
  }

  /**
   * Log a message using appropriate logger method
   * @param dryMsg Message for dry run mode
   * @param successMsg Message for success mode
   */
  private logMessage(dryMsg: string, successMsg: string): void {
    const { logger } = this.deps;
    this.config.dryRun ? logger.dry(dryMsg) : logger.success(successMsg);
  }

  /**
   * Log operation result
   * @param result Result to log
   */
  private logResult(result: FileOperationResult): void {
    switch (result.action) {
      case "copied":
        this.logMessage(
          `Would copy: ${result.relativePath}`,
          `Copied: ${result.relativePath}`
        );
        break;
      case "created":
        this.logMessage(
          `Would create: ${result.relativePath}`,
          `Created: ${result.relativePath}`
        );
        break;
      case "skipped":
        // Silent for skipped files
        break;
      case "overwritten":
        this.logMessage(
          `Would prompt to overwrite: ${result.relativePath}`,
          `Overwritten: ${result.relativePath}`
        );
        break;
      case "appended": {
        const msg = `Appended ${result.linesAdded} lines to: ${result.relativePath}`;
        this.logMessage(`Would ${msg}`, msg);
        break;
      }
      case "merged":
        this.logMessage(
          `Would merge: ${result.relativePath}`,
          `Merged: ${result.relativePath}`
        );
        break;
    }
  }

  /**
   * Validate destination directory exists and is a directory
   */
  private async validateDestination(): Promise<void> {
    const { destDir } = this.config;

    if (!(await fse.pathExists(destDir))) {
      throw new DestinationNotFoundError(destDir);
    }

    const stats = await stat(destDir);
    if (!stats.isDirectory()) {
      throw new DestinationNotDirectoryError(destDir);
    }
  }

  /**
   * Check for uncommitted git changes and prompt user if dirty
   */
  private async validateGitState(): Promise<void> {
    const { gitService, prompter, logger } = this.deps;
    const { destDir } = this.config;

    // Skip git check if not a git repository
    if (!(await gitService.isRepository(destDir))) {
      return;
    }

    // Skip git check when requested (e.g. during postinstall where lockfile is always dirty)
    if (this.config.skipGitCheck) {
      return;
    }

    // Check for uncommitted changes
    if (!(await gitService.isDirty(destDir))) {
      return;
    }

    const status = await gitService.getStatus(destDir);
    logger.warn("Git working directory has uncommitted changes");

    // Always prompt for dirty git, even in yesMode
    const proceed = await prompter.confirmDirtyGit(status);
    if (!proceed) {
      throw new UserAbortedError(
        "Aborted: please commit or stash your changes before running Lisa"
      );
    }
  }

  /**
   * Print header banner
   */
  private printHeader(): void {
    const { logger } = this.deps;

    console.log("");
    console.log(pc.blue(this.separator));

    if (this.config.validateOnly) {
      console.log(pc.blue("    Lisa Project Bootstrapper (VALIDATE)"));
    } else if (this.config.dryRun) {
      console.log(pc.blue("    Lisa Project Bootstrapper (DRY RUN)"));
    } else {
      console.log(pc.blue("    Lisa Project Bootstrapper"));
    }

    console.log(pc.blue(this.separator));
    console.log("");

    if (this.config.validateOnly) {
      logger.info("Validate mode - checking project compatibility");
    } else if (this.config.dryRun) {
      logger.warn("Dry run mode - no changes will be made");
    }

    logger.info(`Lisa directory: ${this.config.lisaDir}`);
    logger.info(`Destination:    ${this.config.destDir}`);
    console.log("");
  }

  /**
   * Print summary header with mode
   */
  private printSummaryHeader(): void {
    console.log("");
    console.log(pc.green(this.separator));

    if (this.config.validateOnly) {
      console.log(pc.green("    Lisa Validation Complete"));
    } else if (this.config.dryRun) {
      console.log(pc.green("    Lisa Dry Run Complete"));
    } else {
      console.log(pc.green("    Lisa Installation Complete!"));
    }

    console.log(pc.green(this.separator));
    console.log("");
  }

  /**
   * Print a single stat line with color
   * @param label - Stat label
   * @param value - Stat value
   * @param color - Color function from picocolors
   * @param suffix - Optional suffix after the count
   */
  private printStatLine(
    label: string,
    value: number,
    color: (s: string) => string,
    suffix = ""
  ): void {
    const suffixText = suffix ? ` ${suffix}` : "";
    console.log(
      `  ${color(label)} ${String(value).padStart(3)} files${suffixText}`
    );
  }

  /**
   * Print summary statistics for validate mode
   */
  private printValidateStats(): void {
    const { copied, skipped, overwritten, appended, merged, deleted, ignored } =
      this.counters;
    this.printStatLine("Compatible files:   ", copied, pc.green);
    this.printStatLine("Already present:    ", skipped, pc.blue);
    this.printStatLine("Would conflict:     ", overwritten, pc.yellow);
    this.printStatLine("Would append:       ", appended, pc.blue);
    this.printStatLine("Would merge:        ", merged, pc.green);
    this.printStatLine("Would delete:       ", deleted, pc.red);
    if (ignored > 0) {
      this.printStatLine(
        "Ignored:            ",
        ignored,
        pc.magenta,
        this.lisaignoreSuffix
      );
    }
  }

  /**
   * Print summary statistics for dry-run mode
   */
  private printDryRunStats(): void {
    const { copied, skipped, overwritten, appended, merged, deleted, ignored } =
      this.counters;
    this.printStatLine("Would copy:     ", copied, pc.green);
    this.printStatLine(
      "Would skip:     ",
      skipped,
      pc.blue,
      "(identical or create-only)"
    );
    this.printStatLine("Would prompt:   ", overwritten, pc.yellow, "(differ)");
    this.printStatLine(
      "Would append:   ",
      appended,
      pc.blue,
      "(copy-contents)"
    );
    this.printStatLine("Would merge:    ", merged, pc.green, "(JSON)");
    this.printStatLine("Would delete:   ", deleted, pc.red);
    if (ignored > 0) {
      this.printStatLine(
        "Would ignore:   ",
        ignored,
        pc.magenta,
        this.lisaignoreSuffix
      );
    }
  }

  /**
   * Print summary statistics for apply mode
   */
  private printApplyStats(): void {
    const { copied, skipped, overwritten, appended, merged, deleted, ignored } =
      this.counters;
    this.printStatLine("Copied:     ", copied, pc.green);
    this.printStatLine(
      "Skipped:    ",
      skipped,
      pc.blue,
      "(identical or create-only)"
    );
    this.printStatLine(
      "Overwritten:",
      overwritten,
      pc.yellow,
      "(user approved)"
    );
    this.printStatLine("Appended:   ", appended, pc.blue, "(copy-contents)");
    this.printStatLine("Merged:     ", merged, pc.green, "(JSON merged)");
    this.printStatLine("Deleted:    ", deleted, pc.red);
    if (ignored > 0) {
      this.printStatLine(
        "Ignored:    ",
        ignored,
        pc.magenta,
        this.lisaignoreSuffix
      );
    }
  }

  /**
   * Print summary statistics
   */
  private printSummaryStats(): void {
    if (this.config.validateOnly) {
      this.printValidateStats();
    } else if (this.config.dryRun) {
      this.printDryRunStats();
    } else {
      this.printApplyStats();
    }

    const { migrationsApplied } = this.counters;
    if (migrationsApplied > 0) {
      this.printStatLine("Migrations: ", migrationsApplied, pc.cyan, "applied");
    }
  }

  /**
   * Print project types
   */
  private printProjectTypes(): void {
    console.log("");

    const allAndDetected =
      this.detectedTypes.length > 0
        ? `all ${this.detectedTypes.join(" ")}`
        : "all";

    console.log(`Project types: ${pc.green(allAndDetected)}`);

    console.log("");
  }

  /**
   * Print validation result
   */
  private printValidationResult(): void {
    if (!this.config.validateOnly) return;

    const { logger } = this.deps;
    const { overwritten } = this.counters;

    if (overwritten > 0) {
      logger.warn(
        `Validation found ${overwritten} file(s) that would conflict`
      );
      console.log("Run without --validate to apply changes interactively");
    } else {
      logger.success("Project is compatible with Lisa configurations");
    }
  }

  /**
   * Print summary
   */
  private printSummary(): void {
    this.printSummaryHeader();
    this.printSummaryStats();
    this.printProjectTypes();
    this.printValidationResult();
  }

  /**
   * Read a file's contents, returning null if the file does not exist or cannot be read.
   * Used for optional file checks that should not interrupt the main flow on failure.
   * @param filePath - Absolute path to the file to read
   * @returns File contents as a string, or null if unavailable
   */
  private async tryReadFile(filePath: string): Promise<string | null> {
    try {
      return await readFile(filePath, "utf-8");
    } catch {
      return null;
    }
  }

  /**
   * Print migration notices when the project's ci.yml or deploy.yml still reference
   * local quality/release workflows instead of the canonical Lisa repo versions.
   * Printed after the update summary so users see it as a post-update action item.
   * @param projectDir - The destination project directory to inspect
   */
  private async printMigrationNotices(projectDir: string): Promise<void> {
    const ciPath = path.join(projectDir, ".github", "workflows", "ci.yml");
    const deployPath = path.join(
      projectDir,
      ".github",
      "workflows",
      "deploy.yml"
    );

    const [ciContent, deployContent] = await Promise.all([
      this.tryReadFile(ciPath),
      this.tryReadFile(deployPath),
    ]);

    const isRailsProject = this.detectedTypes.includes("rails");

    const notices = [
      ciContent?.includes("uses: ./.github/workflows/quality.yml") &&
      !isRailsProject
        ? "  .github/workflows/ci.yml — change:\n    uses: ./.github/workflows/quality.yml\n    → uses: CodySwannGT/lisa/.github/workflows/quality.yml@main"
        : null,
      ciContent?.includes("uses: ./.github/workflows/quality.yml") &&
      isRailsProject
        ? "  .github/workflows/ci.yml — change:\n    uses: ./.github/workflows/quality.yml\n    → uses: CodySwannGT/lisa/.github/workflows/quality-rails.yml@main"
        : null,
      deployContent?.includes("uses: ./.github/workflows/release.yml") &&
      !isRailsProject
        ? "  .github/workflows/deploy.yml — change:\n    uses: ./.github/workflows/release.yml\n    → uses: CodySwannGT/lisa/.github/workflows/release.yml@main"
        : null,
      deployContent?.includes("uses: ./.github/workflows/release.yml") &&
      isRailsProject
        ? "  .github/workflows/deploy.yml — change:\n    uses: ./.github/workflows/release.yml\n    → uses: CodySwannGT/lisa/.github/workflows/release-rails.yml@main"
        : null,
    ].filter((n): n is string => n !== null);

    if (notices.length === 0) {
      return;
    }

    console.log("");
    console.log(
      pc.yellow(
        "⚠️  Action required: Update your CI/Deploy workflows to call the Lisa repo directly."
      )
    );
    console.log("");
    console.log(notices.join("\n\n"));
    console.log("");
    console.log(
      "  After this one-time change, quality/release workflow updates will be automatic."
    );
    console.log("");
  }
}
/* eslint-enable max-lines -- Main orchestrator class with apply/validate operations */
