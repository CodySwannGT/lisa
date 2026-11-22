/**
 * @file lisa-templates.ts
 * @description Template ownership resolution and per-type template application. One layer of the `Lisa` orchestrator; each layer
 * extends the one below it so the apply pipeline reads as one class while no
 * single module carries the whole pipeline.
 * @module core
 */
import * as fse from "fs-extra";
import * as path from "node:path";
import { isPostinstallSafeApply } from "./apply-mode.js";
import { type StrategyContext } from "../strategies/index.js";
import { listFilesRecursive } from "../utils/file-operations.js";
import { loadIgnorePatterns } from "../utils/ignore-patterns.js";
import type { CopyStrategy, FileOperationResult } from "./config.js";
import { COPY_STRATEGIES } from "./config.js";
import {
  decideTemplateOwnership,
  templateSkipDescription,
} from "./template-ownership.js";
import { LisaFileResults } from "./lisa-file-results.js";
import {
  CREATE_ONLY_STRATEGY,
  COPY_CONTENTS_STRATEGY,
  PROJECT_LEARNINGS_TEMPLATE_PATH,
} from "./lisa-state.js";

/**
 * Template ownership resolution and per-type template application.
 */
export abstract class LisaTemplates extends LisaFileResults {
  /**
   * Pre-compute, for every relative path shipped by any type's `create-only/`
   * directory, which single type "owns" it. The owner is the most-specific
   * detected type — i.e., the last entry in [all, ...detectedTypes] (already
   * canonically ordered parent-before-child by `expandAndOrderTypes`).
   *
   * Why this is needed: the `create-only` strategy intentionally does nothing
   * when the destination file already exists. Combined with the per-type
   * outer loop in `processConfigurations`, that means the *first* type to
   * ship a `create-only/<path>` creates the file and every later type's
   * version is silently skipped. For paths that overlap between a parent
   * stack (typescript) and a child stack (cdk/expo/nestjs/npm-package), this
   * lets the parent win — the exact opposite of the rest of Lisa's
   * "child overrides parent" semantics. See `copy-overwrite` for comparison:
   * because it always overwrites, the per-type ordering naturally lets
   * children win. `create-only` needs explicit help.
   *
   * The fix: the orchestrator pre-computes this ownership map and, while
   * processing `create-only`, skips any source whose owning type isn't the
   * current one. The result is that exactly one source wins per path — the
   * most-specific detected type.
   * @returns Promise that resolves once ownership has been resolved
   */
  protected async loadCreateOnlyOwnership(): Promise<void> {
    const ownership = new Map<string, string>();
    for (const type of ["all", ...this.detectedTypes]) {
      const createOnlyDir = path.join(
        this.config.lisaDir,
        type,
        CREATE_ONLY_STRATEGY
      );
      if (!(await fse.pathExists(createOnlyDir))) {
        continue;
      }
      const files = await listFilesRecursive(createOnlyDir);
      for (const file of files) {
        const sourceRelativePath = path.relative(createOnlyDir, file);
        const relativePath = this.resolveTemplateDestination(
          sourceRelativePath,
          CREATE_ONLY_STRATEGY,
          type
        );
        // Later types overwrite earlier ones, so child wins over parent.
        ownership.set(relativePath, type);
      }
    }
    const canonicalSource = path.join(
      this.config.lisaDir,
      "all",
      CREATE_ONLY_STRATEGY,
      PROJECT_LEARNINGS_TEMPLATE_PATH
    );
    this.projectLearningsTemplateRegistered =
      await fse.pathExists(canonicalSource);
    if (this.projectLearningsTemplateRegistered) {
      // Durable project memory is a single contract, not a stack override.
      ownership.set(this.projectLearningsFile, "all");
    }
    this.createOnlyOwnership = ownership;
  }

  /**
   * Pre-compute, for every relative path shipped by any type's `copy-overwrite/`
   * directory, which single type "owns" it — the most-specific detected type
   * (last entry in [all, ...detectedTypes], already ordered parent-before-child).
   *
   * Consumed by `shouldProcessFile` to skip non-owning sources so each path is
   * written exactly once, by its winning stack. See the `copyOverwriteOwnership`
   * field doc for the crash-safety rationale (eliminating the parent-then-child
   * overwrite window that left half-applied configs when the process was killed
   * mid-apply during postinstall — the bug behind #318).
   * @returns Promise that resolves once ownership has been resolved
   */
  protected async loadCopyOverwriteOwnership(): Promise<void> {
    const ownership = new Map<string, string>();
    for (const type of ["all", ...this.detectedTypes]) {
      const copyOverwriteDir = path.join(
        this.config.lisaDir,
        type,
        "copy-overwrite"
      );
      if (!(await fse.pathExists(copyOverwriteDir))) {
        continue;
      }
      const files = await listFilesRecursive(copyOverwriteDir);
      for (const file of files) {
        const relativePath = path.relative(copyOverwriteDir, file);
        // Later types overwrite earlier ones, so child wins over parent.
        ownership.set(relativePath, type);
      }
    }
    this.copyOverwriteOwnership = ownership;
  }

  /**
   * Process all configurations
   */
  protected async processConfigurations(): Promise<void> {
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
   * Process all files for a given project type
   * @param type Project type to process
   */
  protected async processProjectType(type: string): Promise<void> {
    const { logger, strategyRegistry } = this.deps;

    for (const strategy of COPY_STRATEGIES) {
      // Self-apply (Lisa source repo) applies ONLY dependency governance via the
      // package-lisa strategy — every other strategy would overwrite Lisa's own
      // hand-authored source with the templates it ships.
      if (this.selfApply && strategy !== "package-lisa") {
        continue;
      }
      const srcDir = path.join(this.config.lisaDir, type, strategy);

      if (await fse.pathExists(srcDir)) {
        logger.info(`Processing ${type}/${strategy}...`);
        await this.processDirectory(
          srcDir,
          strategyRegistry.get(strategy),
          type
        );
      }
    }
  }

  /**
   * Process all files in a directory with the given strategy
   * @param srcDir Source directory
   * @param strategy Strategy to apply
   * @param strategy.name Strategy name
   * @param strategy.apply Apply function
   * @param currentType Project type (e.g. "all", "typescript", "cdk") supplying these files
   */
  protected async processDirectory(
    srcDir: string,
    strategy: {
      name: CopyStrategy;
      apply: (
        s: string,
        d: string,
        r: string,
        c: StrategyContext
      ) => Promise<FileOperationResult>;
    },
    currentType: string
  ): Promise<void> {
    const allFiles = await listFilesRecursive(srcDir);
    const files = allFiles
      .map(srcFile => {
        const sourceRelativePath = path.relative(srcDir, srcFile);
        return {
          srcFile,
          relativePath: this.resolveTemplateDestination(
            sourceRelativePath,
            strategy.name,
            currentType
          ),
        };
      })
      .filter(({ relativePath }) =>
        this.shouldProcessFile(relativePath, strategy.name, currentType)
      );

    const context: StrategyContext = {
      config: this.config,
      // Installation's internal --yes is not an operator's consent. Resolve
      // the declared safe-install mode separately from the git waiver, then
      // carry that and the actual prompter's availability to strategies.
      unattended:
        isPostinstallSafeApply(this.config) || this.deps.prompter.unattended,
      backupFile: async absolutePath => {
        await this.deps.backupService.backup(absolutePath);
        await this.deps.backupService.persistentBackup(absolutePath);
      },
      forgetCreated: absolutePath => {
        this.deps.backupService.forgetCreated(absolutePath);
      },
      promptOverwrite: async (relativePath, sourcePath, destPath) => {
        return this.handleOverwritePrompt(relativePath, sourcePath, destPath);
      },
    };

    for (const { srcFile, relativePath } of files) {
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
   * Map the stable canonical learnings source to the project's configured
   * sibling path. No other template source is redirected.
   * @param sourceRelativePath - Path relative to the strategy source directory
   * @param strategyName - Strategy delivering the source file
   * @param currentType - Project type that owns the source directory
   * @returns Destination path relative to the host project
   */
  protected resolveTemplateDestination(
    sourceRelativePath: string,
    strategyName: CopyStrategy,
    currentType: string
  ): string {
    if (
      currentType === "all" &&
      strategyName === CREATE_ONLY_STRATEGY &&
      sourceRelativePath === PROJECT_LEARNINGS_TEMPLATE_PATH
    ) {
      return this.projectLearningsFile;
    }
    if (
      strategyName === COPY_CONTENTS_STRATEGY &&
      path.basename(sourceRelativePath) === "gitignore"
    ) {
      return path.join(path.dirname(sourceRelativePath), ".gitignore");
    }
    return sourceRelativePath;
  }

  /**
   * Decide whether a candidate source file should be passed to its strategy.
   * Centralizes three independent skip rules that all need to short-circuit
   * before a strategy ever sees the file:
   *
   * 1. `.lisaignore` patterns from the destination project
   * 2. Pending deletions from any detected type's `deletions.json`
   *    (avoids the create-then-delete ENOENT race)
   * 3. Create-only ownership conflicts (parent stack ships a path that a
   *    child stack also ships under create-only — child wins)
   * 4. Cross-strategy ownership conflicts (a child stack ships a create-only
   *    path that a parent stack ships under copy-overwrite — child wins before
   *    the parent can overwrite a host-owned or soon-to-be-created child file)
   * 5. Copy-overwrite ownership conflicts (parent and child both ship a path
   *    under copy-overwrite — only the most-specific stack writes it, so there
   *    is no parent-then-child overwrite window; see copyOverwriteOwnership)
   * @param relativePath - Path relative to the strategy's source directory
   * @param strategyName - Name of the strategy that would apply the file
   * @param currentType - Project type currently being processed
   * @returns True if the strategy should apply the file, false to skip
   */
  protected shouldProcessFile(
    relativePath: string,
    strategyName: CopyStrategy,
    currentType: string
  ): boolean {
    const decision = decideTemplateOwnership({
      relativePath,
      strategy: strategyName,
      currentType,
      orderedTypes: ["all", ...this.detectedTypes],
      ignored: this.ignorePatterns.shouldIgnore(relativePath),
      pendingDeletion: this.pendingDeletions.has(relativePath),
      projectLearningsPath: this.projectLearningsTemplateRegistered
        ? this.projectLearningsFile
        : undefined,
      suppressLearningsSeed: this.suppressLearningsSeedForRelocation,
      createOnlyOwner: this.createOnlyOwnership.get(relativePath),
      copyOverwriteOwner: this.copyOverwriteOwnership.get(relativePath),
    });
    if (decision.process) return true;
    if (decision.reason === "ignored") {
      this.counters.ignored++;
      this.logSkip("ignored", relativePath, "Ignored");
      return false;
    }
    this.counters.skipped++;
    const reason = templateSkipDescription(decision);
    this.logSkip(reason, relativePath, `Skipped (${reason})`);
    return false;
  }
}
