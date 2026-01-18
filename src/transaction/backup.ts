import * as fse from "fs-extra";
import { readdir, mkdtemp } from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { BackupError, RollbackError } from "../errors/index.js";
import type { ILogger } from "../logging/index.js";

/**
 * Interface for backup service
 */
export interface IBackupService {
  /** Initialize backup directory */
  init(destDir: string): Promise<void>;

  /** Backup a file before modification */
  backup(absolutePath: string): Promise<void>;

  /** Rollback all changes from backup */
  rollback(): Promise<void>;

  /** Cleanup backup directory (on success) */
  cleanup(): Promise<void>;
}

/**
 * Service for backing up and restoring files during operations
 */
export class BackupService implements IBackupService {
  private backupDir: string | null = null;
  private destDir: string = "";
  private readonly logger: ILogger;

  constructor(logger: ILogger) {
    this.logger = logger;
  }

  async init(destDir: string): Promise<void> {
    this.destDir = destDir;
    this.backupDir = await mkdtemp(path.join(os.tmpdir(), "lisa-backup-"));
    this.logger.info(`Backup directory: ${this.backupDir}`);
  }

  async backup(absolutePath: string): Promise<void> {
    if (!this.backupDir) {
      throw new BackupError("backup", "Backup service not initialized");
    }

    try {
      if (await fse.pathExists(absolutePath)) {
        const relativePath = path.relative(this.destDir, absolutePath);
        const backupPath = path.join(this.backupDir, relativePath);

        await fse.ensureDir(path.dirname(backupPath));
        await fse.copy(absolutePath, backupPath);
      }
    } catch (error) {
      throw new BackupError(
        "backup",
        `Failed to backup ${absolutePath}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async rollback(): Promise<void> {
    if (!this.backupDir || !(await fse.pathExists(this.backupDir))) {
      throw new RollbackError("No backup directory available");
    }

    this.logger.warn("Rolling back changes...");

    try {
      // Find all backed up files and restore them
      const files = await this.listFilesRecursive(this.backupDir);

      for (const backupFile of files) {
        const relativePath = path.relative(this.backupDir, backupFile);
        const destFile = path.join(this.destDir, relativePath);

        await fse.copy(backupFile, destFile);
        this.logger.info(`Restored: ${relativePath}`);
      }

      await this.cleanup();
      this.logger.success("Rollback complete");
    } catch (error) {
      throw new RollbackError(
        `Failed to rollback: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async cleanup(): Promise<void> {
    if (this.backupDir && (await fse.pathExists(this.backupDir))) {
      await fse.remove(this.backupDir);
      this.backupDir = null;
    }
  }

  private async listFilesRecursive(dir: string): Promise<string[]> {
    const files: string[] = [];

    const entries = await readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        const subFiles = await this.listFilesRecursive(fullPath);
        files.push(...subFiles);
      } else if (entry.isFile()) {
        files.push(fullPath);
      }
    }

    return files;
  }
}

/**
 * No-op backup service for dry-run mode
 */
export class DryRunBackupService implements IBackupService {
  async init(_destDir: string): Promise<void> {
    // No-op
  }

  async backup(_absolutePath: string): Promise<void> {
    // No-op
  }

  async rollback(): Promise<void> {
    // No-op
  }

  async cleanup(): Promise<void> {
    // No-op
  }
}
