import * as fse from "fs-extra";
import { readFile, copyFile } from "node:fs/promises";
import type { FileOperationResult } from "../core/config.js";
import type { ICopyStrategy, StrategyContext } from "./strategy.interface.js";
import { filesIdentical, ensureParentDir } from "../utils/file-operations.js";

/**
 * Copy-contents strategy: Block-based merge for .gitignore-style files
 * - Create new files silently
 * - Replace content between "# BEGIN: AI GUARDRAILS" and "# END: AI GUARDRAILS" markers
 * - If markers don't exist, append entire content to bottom
 * - Preserves all custom user-added content outside the block
 */
export class CopyContentsStrategy implements ICopyStrategy {
  readonly name = "copy-contents" as const;

  private readonly BEGIN_MARKER = "# BEGIN: AI GUARDRAILS";
  private readonly END_MARKER = "# END: AI GUARDRAILS";

  /**
   * Find the guardrails block in content
   * @param content File content to search
   * @returns Object with start/end indices or null if not found
   */
  private findGuardrailsBlock(
    content: string
  ): { start: number; end: number } | null {
    const startIndex = content.indexOf(this.BEGIN_MARKER);
    const endIndex = content.indexOf(this.END_MARKER);

    if (startIndex === -1 || endIndex === -1) {
      return null;
    }

    return { start: startIndex, end: endIndex + this.END_MARKER.length };
  }

  /**
   * Merge source content with destination, replacing or appending guardrails block
   * @param sourceContent Source file content
   * @param destContent Destination file content
   * @returns Merged content
   */
  private mergeContent(sourceContent: string, destContent: string): string {
    const block = this.findGuardrailsBlock(destContent);

    if (block) {
      // Replace existing block
      return (
        destContent.slice(0, block.start) +
        sourceContent +
        destContent.slice(block.end)
      );
    }

    // Append if no block exists
    const prefix = destContent.endsWith("\n") ? "\n" : "\n\n";
    return destContent + prefix + sourceContent;
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
   * Handle merging content into existing file
   * @param destPath Destination file path
   * @param relativePath Relative path
   * @param mergedContent The merged content
   * @param context Strategy context
   * @returns Result of the merge operation
   */
  private async handleMerge(
    destPath: string,
    relativePath: string,
    mergedContent: string,
    context: StrategyContext
  ): Promise<FileOperationResult> {
    const { config, recordFile, backupFile } = context;
    if (!config.dryRun) {
      await backupFile(destPath);
      await fse.writeFile(destPath, mergedContent, "utf-8");
      recordFile(relativePath, this.name);
    }
    return {
      relativePath,
      strategy: this.name,
      action: "merged",
    };
  }

  /**
   * Apply copy-contents strategy: Create, replace block, or append to file
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
    const mergedContent = this.mergeContent(sourceContent, destContent);

    if (mergedContent === destContent) {
      if (!config.dryRun) {
        recordFile(relativePath, this.name);
      }
      return { relativePath, strategy: this.name, action: "skipped" };
    }

    return this.handleMerge(destPath, relativePath, mergedContent, context);
  }
}
