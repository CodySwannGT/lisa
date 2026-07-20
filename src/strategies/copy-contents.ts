import * as fse from "fs-extra";
import { readFile, copyFile, writeFile } from "node:fs/promises";
import * as path from "node:path";
import type { FileOperationResult } from "../core/config.js";
import type { ICopyStrategy, StrategyContext } from "./strategy.interface.js";
import { filesIdentical, ensureParentDir } from "../utils/file-operations.js";

const BEGIN_MARKER_PREFIX = "# BEGIN: AI GUARDRAILS";
const END_MARKER_PREFIX = "# END: AI GUARDRAILS";

/**
 * Produce the exact copy-contents result without reading or writing files.
 * @param sourceContent - Lisa-managed source block
 * @param destinationContent - Existing host content
 * @returns Content that apply would persist
 */
export function mergeCopyContents(
  sourceContent: string,
  destinationContent: string
): string {
  if (!sourceContent.includes(BEGIN_MARKER_PREFIX)) return sourceContent;
  const lines = sourceContent.split(/\r?\n/);
  const begin =
    lines.find(line => line.startsWith(BEGIN_MARKER_PREFIX)) ??
    BEGIN_MARKER_PREFIX;
  const suffix = begin.slice(BEGIN_MARKER_PREFIX.length);
  const matchingEnd = `${END_MARKER_PREFIX}${suffix}`;
  const end = lines.includes(matchingEnd) ? matchingEnd : END_MARKER_PREFIX;
  const startIndex = destinationContent.indexOf(begin);
  const endIndex = destinationContent.indexOf(end, startIndex + begin.length);
  if (startIndex !== -1 && endIndex !== -1) {
    const trimmedSource = sourceContent.endsWith("\n")
      ? sourceContent.slice(0, -1)
      : sourceContent;
    return (
      destinationContent.slice(0, startIndex) +
      trimmedSource +
      destinationContent.slice(endIndex + end.length)
    );
  }
  const prefix = destinationContent.endsWith("\n") ? "\n" : "\n\n";
  return destinationContent + prefix + sourceContent;
}

/**
 * Copy-contents strategy: Block-based merge for .gitignore-style files
 * - Create new files silently
 * - Replace content between "# BEGIN: AI GUARDRAILS" and "# END: AI GUARDRAILS" markers
 * - If markers don't exist, append entire content to bottom
 * - Preserves all custom user-added content outside the block
 */
export class CopyContentsStrategy implements ICopyStrategy {
  readonly name = "copy-contents" as const;

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
   * Overwrite the destination with the full source content.
   *
   * Used when a copy-contents source carries no guardrails block: such a file
   * cannot be block-merged, and the append fallback would duplicate the entire
   * file on every content change. Overwriting matches the file's intent (a
   * fully Lisa-managed file) and is idempotent.
   * @param destPath Destination file path
   * @param relativePath Relative path
   * @param sourceContent Full source content to write
   * @param context Strategy context
   * @returns Result of the overwrite operation
   */
  private async handleOverwrite(
    destPath: string,
    relativePath: string,
    sourceContent: string,
    context: StrategyContext
  ): Promise<FileOperationResult> {
    const { config, backupFile } = context;
    if (!config.dryRun) {
      await backupFile(destPath);
      await writeFile(destPath, sourceContent, "utf-8");
    }
    return {
      relativePath,
      strategy: this.name,
      action: "overwritten",
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
    // npm strips `.gitignore` from published tarballs, so these templates ship
    // as `gitignore` (no leading dot). Restore the real dotfile name at the
    // destination so downstream projects actually receive their `.gitignore`.
    const shippedAsDotless = path.basename(destPath) === "gitignore";
    const realDestPath = shippedAsDotless
      ? path.join(path.dirname(destPath), ".gitignore")
      : destPath;
    const realRelativePath = shippedAsDotless
      ? path.join(path.dirname(relativePath), ".gitignore")
      : relativePath;

    const destExists = await fse.pathExists(realDestPath);

    if (!destExists) {
      return this.handleNewFile(
        sourcePath,
        realDestPath,
        realRelativePath,
        context
      );
    }

    if (await filesIdentical(sourcePath, realDestPath)) {
      return {
        relativePath: realRelativePath,
        strategy: this.name,
        action: "skipped",
      };
    }

    if (context.config.skipGitCheck) {
      return {
        relativePath: realRelativePath,
        strategy: this.name,
        action: "skipped",
      };
    }

    const sourceContent = await readFile(sourcePath, "utf-8");
    const destContent = await readFile(realDestPath, "utf-8");

    // A copy-contents source must itself carry a guardrails block to manage.
    // Without a BEGIN marker there is no block to replace, and the append
    // fallback would duplicate the whole file on every content change (the
    // bug that shipped lisa-mutation.mjs twice). Such a file is fully
    // Lisa-managed and belongs in copy-overwrite — treat it as an overwrite
    // here so a miscategorized file can never silently self-duplicate.
    if (!sourceContent.includes(BEGIN_MARKER_PREFIX)) {
      return this.handleOverwrite(
        realDestPath,
        realRelativePath,
        sourceContent,
        context
      );
    }

    const mergedContent = mergeCopyContents(sourceContent, destContent);

    if (mergedContent === destContent) {
      return {
        relativePath: realRelativePath,
        strategy: this.name,
        action: "skipped",
      };
    }

    return this.handleMerge(
      realDestPath,
      realRelativePath,
      mergedContent,
      context
    );
  }
}
