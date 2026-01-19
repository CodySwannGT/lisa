import * as fse from "fs-extra";
import { readFile, copyFile, appendFile } from "node:fs/promises";
import type { FileOperationResult } from "../core/config.js";
import type { ICopyStrategy, StrategyContext } from "./strategy.interface.js";
import { filesIdentical, ensureParentDir } from "../utils/file-operations.js";

/**
 * Copy-contents strategy: Append missing lines (for .gitignore-style files)
 * - Create new files silently
 * - Append missing lines using Set difference
 * - Handle empty lines, normalize line endings
 * - O(n log n) algorithm using Set operations
 */
export class CopyContentsStrategy implements ICopyStrategy {
  readonly name = "copy-contents" as const;

  /**
   * Extract non-empty lines from content
   * @param content Text content to extract lines from
   * @returns Array of non-empty lines
   */
  private extractLines(content: string): string[] {
    return content
      .split("\n")
      .map(line => line.trimEnd())
      .filter(line => line.length > 0);
  }

  /**
   * Find lines that need to be added
   * @param sourceContent Source file content
   * @param destContent Destination file content
   * @returns Array of lines to add
   */
  private findNewLines(sourceContent: string, destContent: string): string[] {
    const sourceLines = this.extractLines(sourceContent);
    const destLines = new Set(this.extractLines(destContent));
    return sourceLines.filter(line => !destLines.has(line));
  }

  /**
   * Handle the case where destination doesn't exist
   * @param sourcePath Source file path
   * @param destPath Destination file path
   * @param relativePath Relative path
   * @param context Strategy context
   * @returns Result of copying the file
   */
  private async handleNewFile(
    sourcePath: string,
    destPath: string,
    relativePath: string,
    context: StrategyContext
  ): Promise<FileOperationResult> {
    const { config, recordFile } = context;
    if (!config.dryRun) {
      await ensureParentDir(destPath);
      await copyFile(sourcePath, destPath);
      recordFile(relativePath, this.name);
    }
    return { relativePath, strategy: this.name, action: "copied" };
  }

  /**
   * Handle appending new lines to existing file
   * @param destPath Destination file path
   * @param relativePath Relative path
   * @param newLines Lines to append
   * @param destContent Destination file content
   * @param context Strategy context
   * @returns Result of appending lines
   */
  private async handleAppend(
    destPath: string,
    relativePath: string,
    newLines: string[],
    destContent: string,
    context: StrategyContext
  ): Promise<FileOperationResult> {
    const { config, recordFile, backupFile } = context;
    if (!config.dryRun) {
      await backupFile(destPath);
      const prefix = destContent.endsWith("\n") ? "" : "\n";
      const appendContent = `${prefix}${newLines.join("\n")}\n`;
      await appendFile(destPath, appendContent, "utf-8");
      recordFile(relativePath, this.name);
    }
    return {
      relativePath,
      strategy: this.name,
      action: "appended",
      linesAdded: newLines.length,
    };
  }

  /**
   * Apply copy-contents strategy: Create or append missing lines to file
   * @param sourcePath - Source file path
   * @param destPath - Destination file path
   * @param relativePath - Relative path for recording
   * @param context - Strategy context with config and callbacks
   * @returns Result of the copy-contents operation
   */
  async apply(
    sourcePath: string,
    destPath: string,
    relativePath: string,
    context: StrategyContext
  ): Promise<FileOperationResult> {
    const { config, recordFile } = context;
    const destExists = await fse.pathExists(destPath);

    if (!destExists) {
      return this.handleNewFile(sourcePath, destPath, relativePath, context);
    }

    if (await filesIdentical(sourcePath, destPath)) {
      if (!config.dryRun) {
        recordFile(relativePath, this.name);
      }
      return { relativePath, strategy: this.name, action: "skipped" };
    }

    const sourceContent = await readFile(sourcePath, "utf-8");
    const destContent = await readFile(destPath, "utf-8");
    const newLines = this.findNewLines(sourceContent, destContent);

    if (newLines.length === 0) {
      if (!config.dryRun) {
        recordFile(relativePath, this.name);
      }
      return { relativePath, strategy: this.name, action: "skipped" };
    }

    return this.handleAppend(
      destPath,
      relativePath,
      newLines,
      destContent,
      context
    );
  }
}
