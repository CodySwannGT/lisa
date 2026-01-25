import { exec } from "node:child_process";
import { promisify } from "node:util";
import * as path from "node:path";
import * as fse from "fs-extra";

const execAsync = promisify(exec);

/**
 * Interface for git operations
 */
export interface IGitService {
  /**
   * Check if directory is a git repository
   * @param dir - Directory to check
   * @returns True if directory is a git repository
   */
  isRepository(dir: string): Promise<boolean>;

  /**
   * Check if working directory has uncommitted changes
   * @param dir - Directory to check
   * @returns True if there are uncommitted or unstaged changes
   */
  isDirty(dir: string): Promise<boolean>;

  /**
   * Get git status output
   * @param dir - Directory to check
   * @returns Git status output (short format)
   */
  getStatus(dir: string): Promise<string>;
}

/**
 * Git service implementation
 */
export class GitService implements IGitService {
  async isRepository(dir: string): Promise<boolean> {
    const gitDir = path.join(dir, ".git");
    return fse.pathExists(gitDir);
  }

  async isDirty(dir: string): Promise<boolean> {
    try {
      const { stdout } = await execAsync("git status --porcelain", {
        cwd: dir,
      });
      return stdout.trim().length > 0;
    } catch {
      // If git command fails, assume not dirty (or not a git repo)
      return false;
    }
  }

  async getStatus(dir: string): Promise<string> {
    try {
      const { stdout } = await execAsync("git status --short", {
        cwd: dir,
      });
      return stdout.trim();
    } catch {
      return "";
    }
  }
}

/**
 * No-op git service for testing or when git checks should be skipped
 */
export class NoOpGitService implements IGitService {
  async isRepository(_dir: string): Promise<boolean> {
    return false;
  }

  async isDirty(_dir: string): Promise<boolean> {
    return false;
  }

  async getStatus(_dir: string): Promise<string> {
    return "";
  }
}
