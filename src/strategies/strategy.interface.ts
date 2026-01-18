import type { CopyStrategy, FileOperationResult, LisaConfig } from '../core/config.js';

/**
 * Context for strategy execution
 */
export interface StrategyContext {
  /** Full configuration */
  readonly config: LisaConfig;

  /** Record a file to the manifest */
  readonly recordFile: (relativePath: string, strategy: CopyStrategy) => void;

  /** Backup a file before modification */
  readonly backupFile: (absolutePath: string) => Promise<void>;

  /** Prompt user for overwrite decision */
  readonly promptOverwrite: (relativePath: string, sourcePath: string, destPath: string) => Promise<boolean>;
}

/**
 * Interface for copy strategy implementations
 */
export interface ICopyStrategy {
  /** Strategy name matching the directory name */
  readonly name: CopyStrategy;

  /**
   * Apply this strategy to copy a file from source to destination
   * @param sourcePath Absolute path to source file
   * @param destPath Absolute path to destination file
   * @param relativePath Path relative to destination root (for logging/manifest)
   * @param context Strategy context with config and utilities
   * @returns Result of the file operation
   */
  apply(
    sourcePath: string,
    destPath: string,
    relativePath: string,
    context: StrategyContext,
  ): Promise<FileOperationResult>;
}
