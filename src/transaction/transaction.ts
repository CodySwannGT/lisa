import type { IBackupService } from "./backup.js";
import type { ILogger } from "../logging/index.js";

/**
 * Transaction wrapper for atomic operations
 * Provides init → execute → cleanup/rollback pattern
 */
export class Transaction {
  private initialized = false;

  /**
   * Initialize transaction with backup and logging services
   *
   * @param backupService - Service for backup operations
   * @param logger - Logger instance for transaction events
   */
  constructor(
    private readonly backupService: IBackupService,
    private readonly logger: ILogger
  ) {}

  /**
   * Initialize the transaction
   *
   * @param destDir - Destination directory to protect during transaction
   */
  async init(destDir: string): Promise<void> {
    await this.backupService.init(destDir);
    this.initialized = true;
  }

  /**
   * Execute an operation within the transaction context
   *
   * Automatically rolls back on failure
   *
   * @param operation - Async operation to execute atomically
   * @returns Promise resolving to operation result
   */
  async execute<T>(operation: () => Promise<T>): Promise<T> {
    if (!this.initialized) {
      throw new Error("Transaction not initialized");
    }

    try {
      const result = await operation();
      await this.backupService.cleanup();
      return result;
    } catch (error) {
      this.logger.error(
        `Operation failed: ${error instanceof Error ? error.message : String(error)}`
      );

      try {
        await this.backupService.rollback();
      } catch (rollbackError) {
        this.logger.error(
          `Rollback also failed: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`
        );
      }

      throw error;
    }
  }

  /**
   * Create a backup of a file within this transaction
   *
   * @param absolutePath - Absolute path to file to backup
   */
  async backup(absolutePath: string): Promise<void> {
    if (!this.initialized) {
      throw new Error("Transaction not initialized");
    }
    await this.backupService.backup(absolutePath);
  }
}

/**
 * No-op transaction for dry-run mode
 */
export class DryRunTransaction {
  /**
   * Initialize dry-run transaction (no-op)
   *
   * @param _destDir - Destination directory (unused)
   */
  async init(_destDir: string): Promise<void> {
    // No-op
  }

  /**
   * Execute operation without backup/rollback (no-op)
   *
   * @param operation - Operation to execute
   * @returns Promise resolving to operation result
   */
  async execute<T>(operation: () => Promise<T>): Promise<T> {
    return operation();
  }

  /**
   * Backup file (no-op)
   *
   * @param _absolutePath - Absolute path (unused)
   */
  async backup(_absolutePath: string): Promise<void> {
    // No-op
  }
}
