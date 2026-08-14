import type {
  CopyStrategy,
  FileOperationResult,
  LisaConfig,
} from "../core/config.js";
import type { HashLedger } from "../core/lisa-owned-provenance.js";

/**
 * Context for strategy execution
 */
export interface StrategyContext {
  /** Full configuration */
  readonly config: LisaConfig;

  /** Backup a file before modification */
  readonly backupFile: (absolutePath: string) => Promise<void>;

  /** Prompt user for overwrite decision */
  readonly promptOverwrite: (
    relativePath: string,
    sourcePath: string,
    destPath: string
  ) => Promise<boolean>;

  /**
   * Known-good hashes proving which contents Lisa has shipped at each path.
   *
   * Injected rather than imported so a test can state which bytes count as a
   * genuine past release. Without that seam a test can only stage invented
   * content, which the classifier correctly reads as host-modified — so every
   * "refresh delivers the fix" test would be asserting the upgrade path while
   * exercising the downgrade-protection path instead.
   *
   * Defaults to Lisa's real shipping history when omitted.
   */
  readonly hashLedger?: HashLedger;
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
   * @param relativePath Path relative to destination root (for logging)
   * @param context Strategy context with config and utilities
   * @returns Result of the file operation
   */
  apply(
    sourcePath: string,
    destPath: string,
    relativePath: string,
    context: StrategyContext
  ): Promise<FileOperationResult>;
}
