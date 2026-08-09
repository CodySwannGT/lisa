import * as fse from "fs-extra";
import { copyFile } from "node:fs/promises";
import { mayRefreshTemplate } from "../core/config.js";
import type { FileOperationResult } from "../core/config.js";
import type { ICopyStrategy, StrategyContext } from "./strategy.interface.js";
import { filesIdentical, ensureParentDir } from "../utils/file-operations.js";

/**
 * Copy-overwrite strategy: Replace file if exists (prompts on conflict)
 * - Create new files silently
 * - Skip identical files
 * - Prompt on differences (or auto-accept in yesMode)
 * - Backup before overwriting
 */
export class CopyOverwriteStrategy implements ICopyStrategy {
  readonly name = "copy-overwrite" as const;

  /**
   * Apply copy-overwrite strategy: Create, skip, or prompt to overwrite file
   * @param sourcePath - Source file path
   * @param destPath - Destination file path
   * @param relativePath - Relative path for logging
   * @param context - Strategy context with config and callbacks
   * @returns Result of the copy-overwrite operation
   */
  async apply(
    sourcePath: string,
    destPath: string,
    relativePath: string,
    context: StrategyContext
  ): Promise<FileOperationResult> {
    const { config, backupFile, promptOverwrite } = context;
    const destExists = await fse.pathExists(destPath);

    if (!destExists) {
      if (!config.dryRun) {
        await ensureParentDir(destPath);
        await copyFile(sourcePath, destPath);
      }
      return { relativePath, strategy: this.name, action: "copied" };
    }

    if (await filesIdentical(sourcePath, destPath)) {
      return { relativePath, strategy: this.name, action: "skipped" };
    }

    // A non-interactive apply (postinstall / `--skip-git-check`) cannot prompt,
    // and replacing a file the project may have customised without asking is
    // not a decision this path gets to make. So the file is left alone — but
    // reported as `stale`, never as `skipped`.
    //
    // Reporting it as `skipped` is what made template changes undeliverable in
    // practice: the postinstall bootstrap is how downstream projects take an
    // upgrade, so every changed template landed here, and the summary counted
    // it beside genuinely-identical files under "identical or create-only".
    // A fix to an enforcement guard could ship in a release and reach nobody,
    // with nothing in the output to say so.
    if (config.skipGitCheck) {
      return this.applyNonInteractive(
        sourcePath,
        destPath,
        relativePath,
        context
      );
    }

    if (config.dryRun) {
      return { relativePath, strategy: this.name, action: "overwritten" };
    }

    const shouldOverwrite = await promptOverwrite(
      relativePath,
      sourcePath,
      destPath
    );

    if (shouldOverwrite) {
      await backupFile(destPath);
      await copyFile(sourcePath, destPath);
      return { relativePath, strategy: this.name, action: "overwritten" };
    }

    return { relativePath, strategy: this.name, action: "skipped" };
  }

  /**
   * Resolve a differing managed file on a non-interactive apply.
   *
   * There is no prompt available here, so the file is left alone and reported
   * as `stale` — unless `--refresh-templates` covers it, which is the operator
   * deciding in advance to take upstream's version. That flag is the supported
   * way to deliver a changed enforcement guard to an installed project; without
   * it the only route is deleting the file so the create path picks it up,
   * which is a workaround nobody should have to know.
   * @param sourcePath - Packaged template path
   * @param destPath - Installed file path
   * @param relativePath - Repo-relative path for reporting
   * @param context - Strategy context with config and callbacks
   * @returns Whether the file was refreshed or left out of date
   */
  private async applyNonInteractive(
    sourcePath: string,
    destPath: string,
    relativePath: string,
    context: StrategyContext
  ): Promise<FileOperationResult> {
    const { config, backupFile } = context;

    if (!mayRefreshTemplate(relativePath, config.refreshTemplates)) {
      return { relativePath, strategy: this.name, action: "stale" };
    }

    // Backed up first: opting in to an overwrite is not opting out of being
    // able to undo it.
    if (!config.dryRun) {
      await backupFile(destPath);
      await copyFile(sourcePath, destPath);
    }
    return { relativePath, strategy: this.name, action: "overwritten" };
  }
}
