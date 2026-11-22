import * as fse from "fs-extra";
import { stat } from "node:fs/promises";
import pc from "picocolors";
import { isLisaSourceRepo } from "./self-apply.js";
import {
  DestinationNotDirectoryError,
  DestinationNotFoundError,
  UserAbortedError,
} from "../errors/index.js";
import { hashFile } from "../utils/postinstall-trampoline.js";
import type { LisaResult } from "./config.js";
import { LisaMaintenance } from "./lisa-maintenance.js";
export type { LisaDependencies } from "./lisa-state.js";

/**
 * Main Lisa orchestrator
 */
export class Lisa extends LisaMaintenance {
  /**
   * Initialize services
   */
  protected async initServices(): Promise<void> {
    const { backupService } = this.deps;

    if (!this.config.dryRun) {
      await backupService.init(this.config.destDir);
    }
  }

  /**
   * Detect and confirm project types
   */
  protected async detectTypes(): Promise<void> {
    const { detectorRegistry, prompter } = this.deps;

    const rawTypes = await detectorRegistry.detectAll(this.config.destDir);
    this.detectedTypes = detectorRegistry.expandAndOrderTypes(rawTypes);
    this.detectedTypes = [
      ...(await prompter.confirmProjectTypes(this.detectedTypes)),
    ];
  }

  /**
   * Detect whether this apply targets the Lisa source repo itself and, if so,
   * announce the narrowed behavior. A self-apply skips deletions, template
   * application, and agent-surface emit, but still applies package.lisa.json
   * dependency governance so Lisa's own deps track the floors it forces
   * downstream. See {@link isLisaSourceRepo}.
   */
  protected async detectSelfApply(): Promise<void> {
    this.selfApply = await isLisaSourceRepo(this.config.destDir);
    if (this.selfApply) {
      this.deps.logger.info(
        pc.yellow(
          "Detected Lisa source repo — self-apply mode: applying only " +
            "package.lisa.json dependency governance (skipping template " +
            "application, deletions, postinstall injection, and agent emit)."
        )
      );
    }
  }

  /**
   * Validate destination directory exists and is a directory
   */
  protected async validateDestination(): Promise<void> {
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
  protected async validateGitState(): Promise<void> {
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
   * Finalize operation
   * @returns Promise that resolves when finalization is complete
   */
  protected async finalize(): Promise<void> {
    const { backupService } = this.deps;

    if (!this.config.dryRun) {
      await backupService.cleanup();
    }
  }

  /**
   * Create success result
   * @returns Success result with operation counters and detected types
   */
  protected getSuccessResult(): LisaResult {
    const mode = this.config.validateOnly ? "validate" : "apply";
    return {
      success: true,
      counters: { ...this.counters },
      detectedTypes: [...this.detectedTypes],
      mode,
      errors: [],
      stalePaths: [...this.stalePaths],
      deletedPaths: [...this.deletedPaths],
      deletionNotices: [...this.deletionNotices],
    };
  }

  /**
   * Handle apply error and rollback
   * @param error Error that occurred during apply
   * @returns Error result
   */
  protected async handleApplyError(error: unknown): Promise<LisaResult> {
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
      stalePaths: [...this.stalePaths],
      deletedPaths: [...this.deletedPaths],
      deletionNotices: [...this.deletionNotices],
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
      await this.detectSelfApply();
      await this.loadProjectLearningsFile();
      await this.reportInvalidDependencySettings();
      await this.processLearningsRelocation();
      await this.loadPendingDeletions();
      await this.loadCreateOnlyOwnership();
      await this.loadCopyOverwriteOwnership();
      // Captured BEFORE any mutation (migrations included): the hash gates both
      // the detached trampoline and the in-process lockfile reconcile, and
      // before-strategies migrations can wire scripts.postinstall — a change the
      // package manager's end-of-command rewrite would clobber (#383).
      const prePackageJsonHash = hashFile(this.hostPackageJsonPath());
      await this.runMigrationsBeforeStrategies();
      await this.processConfigurations();
      if (this.selfApply) {
        this.deps.logger.info(
          pc.gray(
            "Self-apply (Lisa source repo): skipped deletions.json processing"
          )
        );
      } else {
        await this.processDeletions();
      }
      await this.processMigrations();
      await this.processCodexEmit();
      await this.processClaudeEmit();
      await this.processAgyEmit();
      await this.processCopilotEmit();
      await this.processOpencodeEmit();
      await this.processDevinEmit();
      await this.processSonarIntegration();
      // Must follow processSonarIntegration: re-running `sonar integrate`
      // restores the vendor shim, which calls `sonar hook` directly and blocks
      // every prompt when the CLI is unauthenticated (#4502).
      await this.processSonarShimRepoint();
      await this.processInstructionFilesMigration();
      await this.registerPlugins();
      await this.finalize();
      this.printSummary();
      await this.printMigrationNotices(this.config.destDir);
      await this.schedulePostinstallReconciliation(prePackageJsonHash);
      await this.reconcileLockfilesInProcess(prePackageJsonHash);
      await this.installRailsGitHooks();
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
}
