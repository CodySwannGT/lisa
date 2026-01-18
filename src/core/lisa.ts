import * as fse from "fs-extra";
import { stat, readdir, rmdir } from "node:fs/promises";
import * as path from "node:path";
import pc from "picocolors";
import type {
  LisaConfig,
  LisaResult,
  OperationCounters,
  ProjectType,
  CopyStrategy,
  FileOperationResult,
} from "./config.js";
import { COPY_STRATEGIES, createInitialCounters } from "./config.js";
import { DetectorRegistry } from "../detection/index.js";
import { StrategyRegistry, type StrategyContext } from "../strategies/index.js";
import type { IManifestService } from "./manifest.js";
import type { IBackupService } from "../transaction/index.js";
import type { ILogger } from "../logging/index.js";
import type { IPrompter } from "../cli/prompts.js";
import { listFilesRecursive } from "../utils/file-operations.js";
import {
  DestinationNotFoundError,
  DestinationNotDirectoryError,
} from "../errors/index.js";

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
}

/**
 * Main Lisa orchestrator
 */
export class Lisa {
  private counters: OperationCounters = createInitialCounters();
  private detectedTypes: ProjectType[] = [];

  constructor(
    private readonly config: LisaConfig,
    private readonly deps: LisaDependencies
  ) {}

  /**
   * Apply Lisa configurations to the destination project
   */
  async apply(): Promise<LisaResult> {
    const {
      logger,
      prompter,
      manifestService,
      backupService,
      detectorRegistry,
    } = this.deps;

    try {
      // Validate destination
      await this.validateDestination();

      // Print header
      this.printHeader();

      // Initialize services
      if (!this.config.dryRun) {
        await backupService.init(this.config.destDir);
        await manifestService.init(this.config.destDir, this.config.lisaDir);
      }
      // Detect project types
      const rawTypes = await detectorRegistry.detectAll(this.config.destDir);
      this.detectedTypes = detectorRegistry.expandAndOrderTypes(rawTypes);

      // Confirm with user
      this.detectedTypes = [
        ...(await prompter.confirmProjectTypes(this.detectedTypes)),
      ];

      // Process 'all' directory first
      logger.info("Processing common configurations (all/)...");
      await this.processProjectType("all");

      // Process each detected type
      for (const type of this.detectedTypes) {
        const typeDir = path.join(this.config.lisaDir, type);
        if (await fse.pathExists(typeDir)) {
          logger.info(`Processing ${type} configurations...`);
          await this.processProjectType(type);
        } else {
          logger.warn(`No configuration directory found for type: ${type}`);
        }
      }

      // Finalize manifest
      if (!this.config.dryRun) {
        await manifestService.finalize();
        await backupService.cleanup();
      }

      this.printSummary();

      return {
        success: true,
        counters: { ...this.counters },
        detectedTypes: [...this.detectedTypes],
        mode: this.config.validateOnly ? "validate" : "apply",
        errors: [],
      };
    } catch (error) {
      if (!this.config.dryRun) {
        try {
          await backupService.rollback();
        } catch {
          // Rollback error already logged
        }
      }

      return {
        success: false,
        counters: { ...this.counters },
        detectedTypes: [...this.detectedTypes],
        mode: this.config.validateOnly ? "validate" : "apply",
        errors: [error instanceof Error ? error.message : String(error)],
      };
    }
  }

  /**
   * Validate compatibility without applying changes
   */
  async validate(): Promise<LisaResult> {
    // Validate mode is essentially a dry run
    return this.apply();
  }

  /**
   * Uninstall Lisa-managed files from the project
   */
  async uninstall(): Promise<LisaResult> {
    const { logger, manifestService } = this.deps;

    // Validate destination
    await this.validateDestination();

    // Print header
    console.log("");
    console.log(pc.blue("========================================"));
    console.log(pc.blue("    Lisa Uninstaller"));
    console.log(pc.blue("========================================"));
    console.log("");

    let removed = 0;
    let skipped = 0;
    const errors: string[] = [];

    try {
      // Read manifest
      const entries = await manifestService.read(this.config.destDir);
      logger.info(
        `Reading manifest: ${path.join(this.config.destDir, ".lisa-manifest")}`
      );
      console.log("");

      // Process each entry
      for (const entry of entries) {
        const destFile = path.join(this.config.destDir, entry.relativePath);

        switch (entry.strategy) {
          case "copy-overwrite":
          case "create-only":
            // These files can be safely removed
            if (await fse.pathExists(destFile)) {
              if (this.config.dryRun) {
                logger.dry(`Would remove: ${entry.relativePath}`);
              } else {
                await fse.remove(destFile);
                logger.success(`Removed: ${entry.relativePath}`);
              }
              removed++;
            } else {
              skipped++;
            }
            break;

          case "copy-contents":
            // Cannot safely remove - would need to diff
            logger.warn(
              `Cannot auto-remove (copy-contents): ${entry.relativePath}`
            );
            logger.info("  Manually review and remove added lines if needed.");
            skipped++;
            break;

          case "merge":
            // Cannot safely remove merged JSON
            logger.warn(
              `Cannot auto-remove (merged JSON): ${entry.relativePath}`
            );
            logger.info("  Manually remove Lisa-added keys if needed.");
            skipped++;
            break;
        }
      }

      // Remove empty directories and manifest
      if (!this.config.dryRun) {
        await this.removeEmptyDirectories();
        await manifestService.remove(this.config.destDir);
        logger.success("Removed manifest file");
      }

      // Print summary
      console.log("");
      console.log(pc.green("========================================"));
      console.log(
        pc.green(
          this.config.dryRun
            ? "    Lisa Uninstall Dry Run Complete"
            : "    Lisa Uninstall Complete!"
        )
      );
      console.log(pc.green("========================================"));
      console.log("");
      console.log(
        `  ${pc.green("Removed:")}     ${String(removed).padStart(3)} files`
      );
      console.log(
        `  ${pc.yellow("Skipped:")}     ${String(skipped).padStart(3)} files (manual review needed)`
      );
      console.log("");

      return {
        success: true,
        counters: { ...this.counters, copied: removed, skipped },
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
   * Process all files for a given project type
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
    const files = await listFilesRecursive(srcDir);

    const context: StrategyContext = {
      config: this.config,
      recordFile: (relativePath, strat) => {
        this.deps.manifestService.record(relativePath, strat);
      },
      backupFile: async absolutePath => {
        await this.deps.backupService.backup(absolutePath);
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
   * Log operation result
   */
  private logResult(result: FileOperationResult): void {
    const { logger } = this.deps;

    switch (result.action) {
      case "copied":
        if (this.config.dryRun) {
          logger.dry(`Would copy: ${result.relativePath}`);
        } else {
          logger.success(`Copied: ${result.relativePath}`);
        }
        break;
      case "created":
        if (this.config.dryRun) {
          logger.dry(`Would create: ${result.relativePath}`);
        } else {
          logger.success(`Created: ${result.relativePath}`);
        }
        break;
      case "skipped":
        // Silent for skipped files
        break;
      case "overwritten":
        if (this.config.dryRun) {
          logger.dry(`Would prompt to overwrite: ${result.relativePath}`);
        } else {
          logger.success(`Overwritten: ${result.relativePath}`);
        }
        break;
      case "appended":
        if (this.config.dryRun) {
          logger.dry(
            `Would append ${result.linesAdded} lines to: ${result.relativePath}`
          );
        } else {
          logger.success(
            `Appended ${result.linesAdded} lines to: ${result.relativePath}`
          );
        }
        break;
      case "merged":
        if (this.config.dryRun) {
          logger.dry(`Would merge: ${result.relativePath}`);
        } else {
          logger.success(`Merged: ${result.relativePath}`);
        }
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
   * Print header banner
   */
  private printHeader(): void {
    const { logger } = this.deps;

    console.log("");
    console.log(pc.blue("========================================"));

    if (this.config.validateOnly) {
      console.log(pc.blue("    Lisa Project Bootstrapper (VALIDATE)"));
    } else if (this.config.dryRun) {
      console.log(pc.blue("    Lisa Project Bootstrapper (DRY RUN)"));
    } else {
      console.log(pc.blue("    Lisa Project Bootstrapper"));
    }

    console.log(pc.blue("========================================"));
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
   * Print summary
   */
  private printSummary(): void {
    console.log("");
    console.log(pc.green("========================================"));

    if (this.config.validateOnly) {
      console.log(pc.green("    Lisa Validation Complete"));
    } else if (this.config.dryRun) {
      console.log(pc.green("    Lisa Dry Run Complete"));
    } else {
      console.log(pc.green("    Lisa Installation Complete!"));
    }

    console.log(pc.green("========================================"));
    console.log("");

    const { copied, skipped, overwritten, appended, merged } = this.counters;

    if (this.config.validateOnly) {
      console.log(
        `  ${pc.green("Compatible files:")}    ${String(copied).padStart(3)} files`
      );
      console.log(
        `  ${pc.blue("Already present:")}     ${String(skipped).padStart(3)} files`
      );
      console.log(
        `  ${pc.yellow("Would conflict:")}      ${String(overwritten).padStart(3)} files`
      );
      console.log(
        `  ${pc.blue("Would append:")}        ${String(appended).padStart(3)} files`
      );
      console.log(
        `  ${pc.green("Would merge:")}         ${String(merged).padStart(3)} files`
      );
    } else if (this.config.dryRun) {
      console.log(
        `  ${pc.green("Would copy:")}      ${String(copied).padStart(3)} files`
      );
      console.log(
        `  ${pc.blue("Would skip:")}      ${String(skipped).padStart(3)} files (identical or create-only)`
      );
      console.log(
        `  ${pc.yellow("Would prompt:")}    ${String(overwritten).padStart(3)} files (differ)`
      );
      console.log(
        `  ${pc.blue("Would append:")}    ${String(appended).padStart(3)} files (copy-contents)`
      );
      console.log(
        `  ${pc.green("Would merge:")}     ${String(merged).padStart(3)} files (JSON)`
      );
    } else {
      console.log(
        `  ${pc.green("Copied:")}      ${String(copied).padStart(3)} files`
      );
      console.log(
        `  ${pc.blue("Skipped:")}     ${String(skipped).padStart(3)} files (identical or create-only)`
      );
      console.log(
        `  ${pc.yellow("Overwritten:")} ${String(overwritten).padStart(3)} files (user approved)`
      );
      console.log(
        `  ${pc.blue("Appended:")}    ${String(appended).padStart(3)} files (copy-contents)`
      );
      console.log(
        `  ${pc.green("Merged:")}      ${String(merged).padStart(3)} files (JSON merged)`
      );
    }

    console.log("");

    if (this.detectedTypes.length > 0) {
      console.log(`Project types: ${pc.green(this.detectedTypes.join(" "))}`);
    } else {
      console.log(
        `Project types: ${pc.yellow("(none detected - only 'all' was applied)")}`
      );
    }

    console.log("");

    // Validation result for CI/CD
    if (this.config.validateOnly) {
      const { logger } = this.deps;
      if (overwritten > 0) {
        logger.warn(
          `Validation found ${overwritten} file(s) that would conflict`
        );
        console.log("Run without --validate to apply changes interactively");
      } else {
        logger.success("Project is compatible with Lisa configurations");
      }
    }
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
