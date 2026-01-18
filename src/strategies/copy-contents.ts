import * as fse from 'fs-extra';
import { readFile, copyFile, appendFile } from 'node:fs/promises';
import type { FileOperationResult } from '../core/config.js';
import type { ICopyStrategy, StrategyContext } from './strategy.interface.js';
import { filesIdentical, ensureParentDir } from '../utils/file-operations.js';

/**
 * Copy-contents strategy: Append missing lines (for .gitignore-style files)
 * - Create new files silently
 * - Append missing lines using Set difference
 * - Handle empty lines, normalize line endings
 * - O(n log n) algorithm using Set operations
 */
export class CopyContentsStrategy implements ICopyStrategy {
  readonly name = 'copy-contents' as const;

  async apply(
    sourcePath: string,
    destPath: string,
    relativePath: string,
    context: StrategyContext,
  ): Promise<FileOperationResult> {
    const { config, recordFile, backupFile } = context;
    const destExists = await fse.pathExists(destPath);

    if (!destExists) {
      // Destination doesn't exist - copy silently
      if (!config.dryRun) {
        await ensureParentDir(destPath);
        await copyFile(sourcePath, destPath);
        recordFile(relativePath, this.name);
      }
      return { relativePath, strategy: this.name, action: 'copied' };
    }

    // Check if files are identical
    if (await filesIdentical(sourcePath, destPath)) {
      if (!config.dryRun) {
        recordFile(relativePath, this.name);
      }
      return { relativePath, strategy: this.name, action: 'skipped' };
    }

    // Find lines in source that are not in destination
    const sourceContent = await readFile(sourcePath, 'utf-8');
    const destContent = await readFile(destPath, 'utf-8');

    // Get non-empty lines from source
    const sourceLines = sourceContent
      .split('\n')
      .map((line) => line.trimEnd())
      .filter((line) => line.length > 0);

    // Get all lines from destination
    const destLines = new Set(destContent.split('\n').map((line) => line.trimEnd()));

    // Find lines that need to be added
    const newLines = sourceLines.filter((line) => !destLines.has(line));

    if (newLines.length === 0) {
      if (!config.dryRun) {
        recordFile(relativePath, this.name);
      }
      return { relativePath, strategy: this.name, action: 'skipped' };
    }

    if (!config.dryRun) {
      await backupFile(destPath);

      // Ensure destination ends with newline before appending
      let appendContent = newLines.join('\n');
      if (!destContent.endsWith('\n')) {
        appendContent = '\n' + appendContent;
      }
      appendContent += '\n';

      await appendFile(destPath, appendContent, 'utf-8');
      recordFile(relativePath, this.name);
    }

    return {
      relativePath,
      strategy: this.name,
      action: 'appended',
      linesAdded: newLines.length,
    };
  }
}
