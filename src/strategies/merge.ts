import * as fse from 'fs-extra';
import { copyFile } from 'node:fs/promises';
import type { FileOperationResult } from '../core/config.js';
import type { ICopyStrategy, StrategyContext } from './strategy.interface.js';
import { ensureParentDir } from '../utils/file-operations.js';
import { readJson, writeJson, deepMerge } from '../utils/json-utils.js';
import { JsonMergeError } from '../errors/index.js';

/**
 * Merge strategy: Deep merge JSON files (project values take precedence)
 * - Lisa values serve as defaults
 * - Project values take precedence on conflicts
 * - Handle nested paths (.claude/settings.json)
 */
export class MergeStrategy implements ICopyStrategy {
  readonly name = 'merge' as const;

  async apply(
    sourcePath: string,
    destPath: string,
    relativePath: string,
    context: StrategyContext,
  ): Promise<FileOperationResult> {
    const { config, recordFile, backupFile } = context;
    const destExists = await fse.pathExists(destPath);

    if (!destExists) {
      // Destination doesn't exist - copy the file
      if (!config.dryRun) {
        await ensureParentDir(destPath);
        await copyFile(sourcePath, destPath);
        recordFile(relativePath, this.name);
      }
      return { relativePath, strategy: this.name, action: 'copied' };
    }

    // Both files exist - merge them
    let sourceJson: object;
    let destJson: object;

    try {
      sourceJson = await readJson<object>(sourcePath);
    } catch (error) {
      throw new JsonMergeError(relativePath, `Failed to parse source: ${sourcePath}`);
    }

    try {
      destJson = await readJson<object>(destPath);
    } catch (error) {
      throw new JsonMergeError(relativePath, `Failed to parse destination: ${destPath}`);
    }

    // Deep merge: Lisa (source) provides defaults, project (dest) values win
    const merged = deepMerge(sourceJson, destJson);

    // Normalize for comparison (parse and re-stringify both)
    const normalizedDest = JSON.stringify(destJson, null, 2);
    const normalizedMerged = JSON.stringify(merged, null, 2);

    if (normalizedDest === normalizedMerged) {
      if (!config.dryRun) {
        recordFile(relativePath, this.name);
      }
      return { relativePath, strategy: this.name, action: 'skipped' };
    }

    if (!config.dryRun) {
      await backupFile(destPath);
      await writeJson(destPath, merged);
      recordFile(relativePath, this.name);
    }

    return { relativePath, strategy: this.name, action: 'merged' };
  }
}
