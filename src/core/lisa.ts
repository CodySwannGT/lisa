/* eslint-disable max-lines -- Main orchestrator class with apply/uninstall/validate operations */
import * as fse from "fs-extra";
import { readdir, readFile, rmdir, stat } from "node:fs/promises";
import * as path from "node:path";
import pc from "picocolors";
import type { IPrompter } from "../cli/prompts.js";
import { DetectorRegistry } from "../detection/index.js";
import {
  DestinationNotDirectoryError,
  DestinationNotFoundError,
  UserAbortedError,
} from "../errors/index.js";
import type { ILogger } from "../logging/index.js";
import { StrategyRegistry, type StrategyContext } from "../strategies/index.js";
import type { IBackupService } from "../transaction/index.js";
import { listFilesRecursive } from "../utils/file-operations.js";
import {
  loadIgnorePatterns,
  type IgnorePatterns,
} from "../utils/ignore-patterns.js";
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
import type { IManifestService, ManifestEntry } from "./manifest.js";

/**
 * Dependencies for Lisa operations
 */
export interface LisaDependencies {
  readonly logger: ILogger;
  readonly prompter: IPrompter;
  readonly manifestService: IManifestService;
  readonly backupService: IBackupService;
  readonly detectorRegistry: DetectorRegistry;
  readonly strategyRegistry: StrategyRegistry;
  readonly gitService: IGitService;
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
  private readonly separator = "========================================";
  private readonly lisaignoreSuffix = "(.lisaignore)";

  /**
   * Initialize Lisa orchestrator
   * @param config - Configuration for the apply/uninstall operation
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
    const { backupService, manifestService } = this.deps;

    if (!this.config.dryRun) {
      await backupService.init(this.config.destDir);
      await manifestService.init(this.config.destDir, this.config.lisaDir);
    }
  }

  /**
   * Check if project is already on the latest Lisa version
   */
  private async checkForLatestVersion(): Promise<void> {
    const { prompter, manifestService, logger } = this.deps;

    // Skip in dry run and validate modes
    if (this.config.dryRun || this.config.validateOnly) {
      return;
    }

    try {
      const manifestVersion = await manifestService.readVersion(
        this.config.destDir
      );

      // Only check if manifest exists (project has been initialized before)
      if (!manifestVersion) {
        return;
      }

      // Get current Lisa version
      const currentVersion = await this.getCurrentLisaVersion();

      if (manifestVersion === currentVersion) {
        logger.info(`Project is on Lisa version ${manifestVersion}`);
        const proceed = await prompter.confirmLatestVersion(manifestVersion);
        if (!proceed) {
          throw new UserAbortedError(
            "Update cancelled: project is already on the latest version"
          );
        }
      }
    } catch (error) {
      // If error is UserAbortedError, re-throw it
      if (error instanceof UserAbortedError) {
        throw error;
      }
      // For other errors, log and continue
      const message = error instanceof Error ? error.message : String(error);
      logger.warn(`Could not check version: ${message}`);
    }
  }

  /**
   * Get the current Lisa version
   * @returns The version string from package.json, or "unknown" if it cannot be read
   */
  private async getCurrentLisaVersion(): Promise<string> {
    try {
      const packageJsonPath = path.join(this.config.lisaDir, "package.json");
      const content = await readFile(packageJsonPath, "utf-8");
      const packageJson = JSON.parse(content);
      return packageJson.version || "unknown";
    } catch {
      return "unknown";
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

      for (const relativePath of deletions.paths) {
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
   * Finalize operation
   * @returns Promise that resolves when finalization is complete
   */
  private async finalize(): Promise<void> {
    const { manifestService, backupService } = this.deps;

    if (!this.config.dryRun) {
      await manifestService.finalize();
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
      await this.checkForLatestVersion();
      await this.detectTypes();
      await this.processConfigurations();
      await this.processDeletions();
      await this.finalize();
      this.printSummary();
      return this.getSuccessResult();
    } catch (error) {
      return this.handleApplyError(error);
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
   * Uninstall Lisa-managed files from the project
   * @returns Result of the uninstall operation with removal statistics
   */
  async uninstall(): Promise<LisaResult> {
    const { logger, manifestService } = this.deps;

    // Validate destination
    await this.validateDestination();

    // Print header
    console.log("");
    console.log(pc.blue(this.separator));
    console.log(pc.blue("    Lisa Uninstaller"));
    console.log(pc.blue(this.separator));
    console.log("");

    const errors: string[] = [];

    try {
      // Read manifest
      const entries = await manifestService.read(this.config.destDir);
      logger.info(
        `Reading manifest: ${path.join(this.config.destDir, ".lisa-manifest")}`
      );
      console.log("");

      // Process entries
      const stats = await this.processUninstallEntries(entries);

      // Remove empty directories and manifest
      if (!this.config.dryRun) {
        await this.removeEmptyDirectories();
        await manifestService.remove(this.config.destDir);
        logger.success("Removed manifest file");
      }

      // Print summary
      console.log("");
      console.log(pc.green(this.separator));
      console.log(
        pc.green(
          this.config.dryRun
            ? "    Lisa Uninstall Dry Run Complete"
            : "    Lisa Uninstall Complete!"
        )
      );
      console.log(pc.green(this.separator));
      console.log("");
      console.log(
        `  ${pc.green("Removed:")}     ${String(stats.removed).padStart(3)} files`
      );
      console.log(
        `  ${pc.yellow("Skipped:")}     ${String(stats.skipped).padStart(3)} files (manual review needed)`
      );
      console.log("");

      return {
        success: true,
        counters: {
          ...this.counters,
          copied: stats.removed,
          skipped: stats.skipped,
        },
        detectedTypes: [],
        mode: "uninstall",
        errors,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(message);
      errors.push(message);

      return {
        success: false,
        counters: this.counters,
        detectedTypes: [],
        mode: "uninstall",
        errors,
      };
    }
  }

  /**
   * Process single uninstall entry and return updated counts
   * @param entry - Manifest entry to process for removal
   * @param stats - Current removal statistics
   * @param stats.removed - Number of files removed so far
   * @param stats.skipped - Number of files skipped so far
   * @returns Updated removal statistics after processing this entry
   */
  private async processEntry(
    entry: ManifestEntry,
    stats: { removed: number; skipped: number }
  ): Promise<{ removed: number; skipped: number }> {
    const { logger } = this.deps;
    const destFile = path.join(this.config.destDir, entry.relativePath);

    switch (entry.strategy) {
      case "copy-overwrite":
      case "create-only": {
        if (await fse.pathExists(destFile)) {
          if (this.config.dryRun) {
            logger.dry(`Would remove: ${entry.relativePath}`);
          } else {
            await fse.remove(destFile);
            logger.success(`Removed: ${entry.relativePath}`);
          }
          return { ...stats, removed: stats.removed + 1 };
        }
        return { ...stats, skipped: stats.skipped + 1 };
      }
      case "copy-contents": {
        logger.warn(
          `Cannot auto-remove (copy-contents): ${entry.relativePath}`
        );
        logger.info("  Manually review and remove added lines if needed.");
        return { ...stats, skipped: stats.skipped + 1 };
      }
      case "merge": {
        logger.warn(`Cannot auto-remove (merged JSON): ${entry.relativePath}`);
        logger.info("  Manually remove Lisa-added keys if needed.");
        return { ...stats, skipped: stats.skipped + 1 };
      }
    }
  }

  /**
   * Process manifest entries during uninstall
   * @param entries Manifest entries to process
   * @returns Stats with removed and skipped counts
   */
  private async processUninstallEntries(
    entries: readonly ManifestEntry[]
  ): Promise<{ removed: number; skipped: number }> {
    const initial = { removed: 0, skipped: 0 };
    return await entries.reduce(async (statsPromise, entry) => {
      const stats = await statsPromise;
      return this.processEntry(entry, stats);
    }, Promise.resolve(initial));
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

    // Filter out ignored files
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
      return true;
    });

    const context: StrategyContext = {
      config: this.config,
      recordFile: (relativePath, strat) => {
        this.deps.manifestService.record(relativePath, strat);
      },
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
   * Print summary statistics
   */
  private printSummaryStats(): void {
    const { copied, skipped, overwritten, appended, merged, deleted, ignored } =
      this.counters;

    if (this.config.validateOnly) {
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
    } else if (this.config.dryRun) {
      this.printStatLine("Would copy:     ", copied, pc.green);
      this.printStatLine(
        "Would skip:     ",
        skipped,
        pc.blue,
        "(identical or create-only)"
      );
      this.printStatLine(
        "Would prompt:   ",
        overwritten,
        pc.yellow,
        "(differ)"
      );
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
    } else {
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
   * Remove empty directories after uninstall
   */
  private async removeEmptyDirectories(): Promise<void> {
    const destDir = this.config.destDir;

    const removeEmpty = async (dir: string): Promise<void> => {
      if (dir === destDir) return;
      if (dir.includes(".git") || dir.includes("node_modules")) return;

      try {
        const entries = await readdir(dir);
        if (entries.length === 0) {
          await rmdir(dir);
          // Recursively check parent
          await removeEmpty(path.dirname(dir));
        }
      } catch {
        // Directory might not exist or not be empty
      }
    };

    // Get all directories and check if empty
    const entries = await readdir(destDir, { withFileTypes: true });
    for (const entry of entries) {
      if (
        entry.isDirectory() &&
        !entry.name.startsWith(".git") &&
        entry.name !== "node_modules"
      ) {
        await removeEmpty(path.join(destDir, entry.name));
      }
    }
  }
}
/* eslint-enable max-lines -- Main orchestrator class with apply/uninstall/validate operations */
