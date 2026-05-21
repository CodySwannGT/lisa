import * as fse from "fs-extra";
import { readFile, copyFile, writeFile } from "node:fs/promises";
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

  private readonly BEGIN_MARKER_PREFIX = "# BEGIN: AI GUARDRAILS";
  private readonly END_MARKER_PREFIX = "# END: AI GUARDRAILS";

  /**
   * Find the guardrails block in content
   * @param content File content to search
   * @param beginMarker Opening marker for this managed block
   * @param endMarker Closing marker for this managed block
   * @returns Object with start/end indices or null if not found
   */
  private findGuardrailsBlock(
    content: string,
    beginMarker: string,
    endMarker: string
  ): { start: number; end: number } | null {
    const startIndex = content.indexOf(beginMarker);
    if (startIndex === -1) {
      return null;
    }

    const endIndex = content.indexOf(
      endMarker,
      startIndex + beginMarker.length
    );
    if (endIndex === -1) {
      return null;
    }

    return { start: startIndex, end: endIndex + endMarker.length };
  }

  /**
   * Read the guardrail marker pair from the source block. This supports
   * stack-specific blocks such as `# BEGIN: AI GUARDRAILS HARPER-FABRIC`
   * without replacing the universal guardrails block.
   * @param sourceContent Source file content
   * @returns Marker pair to use while merging
   */
  private getSourceMarkers(sourceContent: string): {
    readonly begin: string;
    readonly end: string;
  } {
    const lines = sourceContent.split(/\r?\n/);
    const begin =
      lines.find(line => line.startsWith(this.BEGIN_MARKER_PREFIX)) ??
      this.BEGIN_MARKER_PREFIX;
    const suffix = begin.slice(this.BEGIN_MARKER_PREFIX.length);
    const matchingEnd = `${this.END_MARKER_PREFIX}${suffix}`;
    const end = lines.includes(matchingEnd)
      ? matchingEnd
      : this.END_MARKER_PREFIX;

    return { begin, end };
  }

  /**
   * Merge source content with destination, replacing or appending guardrails block
   * @param sourceContent Source file content
   * @param destContent Destination file content
   * @returns Merged content
   */
  private mergeContent(sourceContent: string, destContent: string): string {
    const markers = this.getSourceMarkers(sourceContent);
    const block = this.findGuardrailsBlock(
      destContent,
      markers.begin,
      markers.end
    );

    if (block) {
      // Replace existing block, trimming source trailing newline
      // to prevent doubling with destination's post-marker newline
      const trimmedSource = sourceContent.endsWith("\n")
        ? sourceContent.slice(0, -1)
        : sourceContent;
      return (
        destContent.slice(0, block.start) +
        trimmedSource +
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
    const { config } = context;
    if (!config.dryRun) {
      await ensureParentDir(destPath);
      await copyFile(sourcePath, destPath);
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
    const { config, backupFile } = context;
    if (!config.dryRun) {
      await backupFile(destPath);
      await writeFile(destPath, mergedContent, "utf-8");
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
   * @param relativePath - Relative path for logging
   * @param context - Strategy context with config and callbacks
   * @returns Result of the copy-contents operation
   */
  async apply(
    sourcePath: string,
    destPath: string,
    relativePath: string,
    context: StrategyContext
  ): Promise<FileOperationResult> {
    const destExists = await fse.pathExists(destPath);

    if (!destExists) {
      return this.handleNewFile(sourcePath, destPath, relativePath, context);
    }

    if (await filesIdentical(sourcePath, destPath)) {
      return { relativePath, strategy: this.name, action: "skipped" };
    }

    const sourceContent = await readFile(sourcePath, "utf-8");
    const destContent = await readFile(destPath, "utf-8");
    const mergedContent = this.mergeContent(sourceContent, destContent);

    if (mergedContent === destContent) {
      return { relativePath, strategy: this.name, action: "skipped" };
    }

    return this.handleMerge(destPath, relativePath, mergedContent, context);
  }
}
