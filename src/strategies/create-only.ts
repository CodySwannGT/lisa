import * as fse from "fs-extra";
import { copyFile } from "node:fs/promises";
import type { FileOperationResult } from "../core/config.js";
import type { ICopyStrategy, StrategyContext } from "./strategy.interface.js";
import { ensureParentDir } from "../utils/file-operations.js";

/**
 * Create-only strategy: Create file if not exists, never update
 * - Create if not exists
 * - Skip silently if exists (whether identical or different)
 */
export class CreateOnlyStrategy implements ICopyStrategy {
  readonly name = "create-only" as const;

  /**
   * Apply create-only strategy: Create file if not exists, never update
   * @param sourcePath - Source file path
   * @param destPath - Destination file path
   * @param relativePath - Relative path for logging
   * @param context - Strategy context with config and callbacks
   * @returns Result of the create-only operation
   */
  async apply(
    sourcePath: string,
    destPath: string,
    relativePath: string,
    context: StrategyContext
  ): Promise<FileOperationResult> {
    const { config } = context;
    const destExists = await fse.pathExists(destPath);

    if (!destExists) {
      if (!config.dryRun) {
        await ensureParentDir(destPath);
        await copyFile(sourcePath, destPath);
      }
      return { relativePath, strategy: this.name, action: "created" };
    }

    return { relativePath, strategy: this.name, action: "skipped" };
  }
}
