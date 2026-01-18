import * as fse from "fs-extra";
import { copyFile } from "node:fs/promises";
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
   *
   * @param sourcePath - Source file path
   * @param destPath - Destination file path
   * @param relativePath - Relative path for recording
   * @param context - Strategy context with config and callbacks
   * @returns Result of the copy-overwrite operation
   */
  async apply(
    sourcePath: string,
    destPath: string,
    relativePath: string,
    context: StrategyContext
  ): Promise<FileOperationResult> {
    const { config, recordFile, backupFile, promptOverwrite } = context;
    const destExists = await fse.pathExists(destPath);

    if (!destExists) {
      // Destination doesn't exist - copy silently
      if (!config.dryRun) {
        await ensureParentDir(destPath);
        await copyFile(sourcePath, destPath);
        recordFile(relativePath, this.name);
      }
      return { relativePath, strategy: this.name, action: "copied" };
    }

    // Check if files are identical
    if (await filesIdentical(sourcePath, destPath)) {
      // Files are identical - still record for uninstall tracking
      if (!config.dryRun) {
        recordFile(relativePath, this.name);
      }
      return { relativePath, strategy: this.name, action: "skipped" };
    }

    // Files differ - need to prompt or auto-accept
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
      recordFile(relativePath, this.name);
      return { relativePath, strategy: this.name, action: "overwritten" };
    }

    return { relativePath, strategy: this.name, action: "skipped" };
  }
}
