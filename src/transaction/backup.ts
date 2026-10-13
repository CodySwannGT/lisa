import * as fse from "fs-extra";
import { readdir, mkdtemp } from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { BackupError, RollbackError } from "../errors/index.js";
import type { ILogger } from "../logging/index.js";
import { generateBackupDirname } from "../utils/file-operations.js";
import { CreatedPathLedger, occupied } from "./created-paths.js";

/**
 * Interface for backup service
 */
export interface IBackupService {
  /** Initialize backup directory */
  init(destDir: string): Promise<void>;

  /**
   * Call before writing `absolutePath`. An existing file is copied so rollback
   * can restore it; a missing one is recorded as created by this apply, with
   * every ancestor directory that does not exist yet, so rollback can remove it.
   */
  backup(absolutePath: string): Promise<void>;

  /**
   * Withdraw a created-path record made by `backup` when the write it preceded
   * did not happen because someone else's file got there first (an exclusive
   * create that hit EEXIST). Rollback must never delete that file.
   */
  forgetCreated(absolutePath: string): void;

  /** Create persistent timestamped backup in project */
  persistentBackup(absolutePath: string): Promise<void>;

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
  private persistentBackupDirname: string | null = null;
  /** Files whose pre-apply bytes are already saved; the first copy wins. */
  private readonly backedUp = new Set<string>();
  /** Files already copied into this apply's `.lisabak/<timestamp>/`. */
  private readonly persisted = new Set<string>();
  private created = new CreatedPathLedger("");
  private readonly logger: ILogger;

  /**
   * Initialize backup service with logger
   * @param logger - Logger instance for backup operations
   */
  constructor(logger: ILogger) {
    this.logger = logger;
  }

  async init(destDir: string): Promise<void> {
    this.destDir = destDir;
    this.created = new CreatedPathLedger(destDir);
    // A reused service must not write into an earlier apply's .lisabak dir.
    this.persistentBackupDirname = null;
    this.backedUp.clear();
    this.persisted.clear();
    this.backupDir = await mkdtemp(path.join(os.tmpdir(), "lisa-backup-"));
    this.logger.info(`Backup directory: ${this.backupDir}`);
  }

  async backup(absolutePath: string): Promise<void> {
    if (!this.backupDir) {
      throw new BackupError("backup", "Backup service not initialized");
    }

    // A second write to the same path must not replace the pre-apply copy
    // with this apply's own intermediate bytes, and a file this apply created
    // has no pre-apply bytes at all: rollback removes it instead.
    if (this.created.has(absolutePath) || this.backedUp.has(absolutePath)) {
      return;
    }

    try {
      // lstat, not pathExists: a dangling symlink the host already had must
      // be backed up (as a link), never recorded as created and unlinked.
      if (await occupied(absolutePath)) {
        const relativePath = path.relative(this.destDir, absolutePath);
        const backupPath = path.join(this.backupDir, relativePath);

        await fse.ensureDir(path.dirname(backupPath));
        await fse.copy(absolutePath, backupPath);
        this.backedUp.add(absolutePath);
      } else {
        await this.created.record(absolutePath);
      }
    } catch (error) {
      throw new BackupError(
        "backup",
        `Failed to backup ${absolutePath}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  forgetCreated(absolutePath: string): void {
    this.created.forget(absolutePath);
  }

  async persistentBackup(absolutePath: string): Promise<void> {
    // Same first-copy-wins rule as backup(): the .lisabak copy must hold the
    // pre-apply bytes, not this apply's intermediate ones.
    if (this.created.has(absolutePath) || this.persisted.has(absolutePath)) {
      return;
    }
    try {
      if (await fse.pathExists(absolutePath)) {
        // Generate backup directory name on first call
        if (!this.persistentBackupDirname) {
          this.persistentBackupDirname = await this.unusedBackupDirname();
        }

        // Get relative path from destination directory
        const relativePath = path.relative(this.destDir, absolutePath);

        // Create backup in .lisabak/{timestamp}/{relative-path}
        const backupBaseDir = path.join(
          this.destDir,
          ".lisabak",
          this.persistentBackupDirname
        );
        const backupPath = path.join(backupBaseDir, relativePath);

        // The persistent copy is itself a file this apply creates: rollback
        // restores the original in place, so the copy would be pure debris.
        await this.created.record(backupPath);
        await fse.ensureDir(path.dirname(backupPath));
        // Never replace an earlier backup's bytes, whoever wrote them.
        await fse.copy(absolutePath, backupPath, {
          overwrite: false,
          errorOnExist: false,
        });
        this.persisted.add(absolutePath);
        this.logger.info(
          `Backup created: .lisabak/${this.persistentBackupDirname}/${relativePath}`
        );
      }
    } catch (error) {
      throw new BackupError(
        "backup",
        `Failed to create persistent backup of ${absolutePath}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * A `.lisabak/` directory name no earlier apply has used. The timestamp has
   * one-second precision, so two applies in the same second would otherwise
   * share a directory; a numeric suffix keeps them apart.
   * @param base - Timestamp name to start from
   * @param attempt - Suffix counter (0 = no suffix)
   * @returns An unoccupied directory name under `.lisabak/`
   */
  private async unusedBackupDirname(
    base: string = generateBackupDirname(),
    attempt = 0
  ): Promise<string> {
    const candidate = attempt === 0 ? base : `${base}-${attempt}`;
    return (await occupied(path.join(this.destDir, ".lisabak", candidate)))
      ? this.unusedBackupDirname(base, attempt + 1)
      : candidate;
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

      for (const relativePath of await this.created.removeAll()) {
        this.logger.info(`Removed (created by this apply): ${relativePath}`);
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
    this.created.clear();
    this.backedUp.clear();
    this.persisted.clear();
    if (this.backupDir && (await fse.pathExists(this.backupDir))) {
      await fse.remove(this.backupDir);
      this.backupDir = null;
    }
  }

  /**
   * Recursively list all files in a directory
   * @param dir - Directory to scan recursively
   * @returns Array of absolute file paths
   */
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

  forgetCreated(_absolutePath: string): void {
    // No-op
  }

  async persistentBackup(_absolutePath: string): Promise<void> {
    // No-op
  }

  async rollback(): Promise<void> {
    // No-op
  }

  async cleanup(): Promise<void> {
    // No-op
  }
}
