import type { IBackupService } from './backup.js';
import type { ILogger } from '../logging/index.js';

/**
 * Transaction wrapper for atomic operations
 * Provides init → execute → cleanup/rollback pattern
 */
export class Transaction {
  private initialized = false;

  constructor(
    private readonly backupService: IBackupService,
    private readonly logger: ILogger,
  ) {}

  /**
   * Initialize the transaction
   */
  async init(destDir: string): Promise<void> {
    await this.backupService.init(destDir);
    this.initialized = true;
  }

  /**
   * Execute an operation within the transaction context
   * Automatically rolls back on failure
   */
  async execute<T>(operation: () => Promise<T>): Promise<T> {
    if (!this.initialized) {
      throw new Error('Transaction not initialized');
    }

    try {
      const result = await operation();
      await this.backupService.cleanup();
      return result;
    } catch (error) {
      this.logger.error(
        `Operation failed: ${error instanceof Error ? error.message : String(error)}`,
      );

      try {
        await this.backupService.rollback();
      } catch (rollbackError) {
        this.logger.error(
          `Rollback also failed: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`,
        );
      }

      throw error;
    }
  }

  /**
   * Create a backup of a file within this transaction
   */
  async backup(absolutePath: string): Promise<void> {
    if (!this.initialized) {
      throw new Error('Transaction not initialized');
    }
    await this.backupService.backup(absolutePath);
  }
}

/**
 * No-op transaction for dry-run mode
 */
export class DryRunTransaction {
  async init(_destDir: string): Promise<void> {
    // No-op
  }

  async execute<T>(operation: () => Promise<T>): Promise<T> {
    return operation();
  }

  async backup(_absolutePath: string): Promise<void> {
    // No-op
  }
}
