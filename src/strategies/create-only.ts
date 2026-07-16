import * as fse from "fs-extra";
import { constants } from "node:fs";
import { copyFile } from "node:fs/promises";
import type { FileOperationResult } from "../core/config.js";
import type { ICopyStrategy, StrategyContext } from "./strategy.interface.js";
import { ensureParentDir } from "../utils/file-operations.js";

/** Copy one source into a destination that must not already exist. */
type ExclusiveCopyFile = (
  sourcePath: string,
  destPath: string,
  mode: number
) => Promise<void>;

/**
 * Create-only strategy: Create file if not exists, never update
 * - Create if not exists
 * - Skip silently if exists (whether identical or different)
 */
export class CreateOnlyStrategy implements ICopyStrategy {
  readonly name = "create-only" as const;

  /**
   * Create a strategy backed by an atomic exclusive-copy primitive.
   *
   * @param copyFileExclusive - Injectable exclusive copy primitive for tests
   */
  constructor(
    private readonly copyFileExclusive: ExclusiveCopyFile = copyFile
  ) {}

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
    if (config.dryRun) {
      const destExists = await fse.pathExists(destPath);
      return {
        relativePath,
        strategy: this.name,
        action: destExists ? "skipped" : "created",
      };
    }

    await ensureParentDir(destPath);
    try {
      await this.copyFileExclusive(
        sourcePath,
        destPath,
        constants.COPYFILE_EXCL
      );
      return { relativePath, strategy: this.name, action: "created" };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        return { relativePath, strategy: this.name, action: "skipped" };
      }
      throw error;
    }
  }
}
