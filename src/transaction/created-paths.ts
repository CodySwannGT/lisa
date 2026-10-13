import { lstat, rmdir, unlink } from "node:fs/promises";
import * as path from "node:path";

/** Errors that mean a rollback removal has nothing (left) to do. */
const BENIGN_REMOVAL_CODES = new Set(["ENOENT", "ENOTEMPTY", "EEXIST"]);

/**
 * Whether `candidate` lies strictly inside `root`.
 * @param root - Directory the apply operates on
 * @param candidate - Absolute path to test
 * @returns True when candidate is a descendant of root, never root itself
 */
function isStrictlyInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative)
  );
}

/**
 * Whether anything (file, directory, or dangling symlink) occupies a path.
 * @param absolutePath - Path to probe
 * @returns True when the path is occupied
 */
export async function occupied(absolutePath: string): Promise<boolean> {
  try {
    await lstat(absolutePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Run a removal, treating "already gone" and "not empty" as success.
 * @param remove - Removal to attempt
 */
async function removeIfPossible(remove: () => Promise<void>): Promise<void> {
  try {
    await remove();
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? "";
    if (!BENIGN_REMOVAL_CODES.has(code)) {
      throw error;
    }
  }
}

/**
 * Number of path segments, used to order directory removal deepest first.
 * @param dir - Absolute directory path
 * @returns Segment count
 */
function depth(dir: string): number {
  return dir.split(path.sep).length;
}

/**
 * The paths one apply created, recorded explicitly before it wrote them, so a
 * rollback can undo creation as well as modification (CodySwannGT/lisa#4459).
 *
 * Only recorded paths are ever candidates for removal. Nothing is inferred
 * from the tree, so a file that existed before the apply, or that someone
 * else writes while it runs, is never touched — including one written into a
 * directory the apply created: directories are removed only when empty.
 *
 * Accepted residual: if another process creates one of the recorded missing
 * directories mid-apply and leaves it EMPTY, rollback removes that empty
 * directory. A non-empty one is always kept, so no content can be lost.
 */
export class CreatedPathLedger {
  private readonly files = new Set<string>();
  private readonly dirs = new Set<string>();

  /**
   * Create a ledger confined to one destination tree.
   * @param root - Destination directory; nothing outside it is ever recorded
   */
  constructor(private readonly root: string) {}

  /**
   * Record a path about to be created, plus every missing ancestor directory
   * below the root. Must be called before the write (and before any
   * `ensureDir`), or the ancestors it creates are indistinguishable from
   * pre-existing ones.
   * @param absolutePath - File the caller is about to create
   */
  async record(absolutePath: string): Promise<void> {
    if (!isStrictlyInside(this.root, absolutePath)) {
      return;
    }
    await this.recordMissingAncestors(path.dirname(absolutePath));
    this.files.add(absolutePath);
  }

  /**
   * Record `dir` and its missing ancestors, stopping at the first directory
   * that already exists or at the root.
   * @param dir - Directory to probe
   */
  private async recordMissingAncestors(dir: string): Promise<void> {
    if (!isStrictlyInside(this.root, dir) || (await occupied(dir))) {
      return;
    }
    this.dirs.add(dir);
    await this.recordMissingAncestors(path.dirname(dir));
  }

  /**
   * Whether this apply recorded the path as one it created.
   * @param absolutePath - Path to test
   * @returns True when recorded
   */
  has(absolutePath: string): boolean {
    return this.files.has(absolutePath);
  }

  /**
   * Withdraw a file record whose write did not happen. Directory records
   * stay: they are removed only when empty, which is always safe.
   * @param absolutePath - Path to withdraw
   */
  forget(absolutePath: string): void {
    this.files.delete(absolutePath);
  }

  /**
   * Remove every recorded file that is still a non-directory, then every
   * recorded directory that is now empty, deepest first.
   * @returns Root-relative paths of the files removed
   */
  async removeAll(): Promise<readonly string[]> {
    const removed: string[] = [];
    for (const file of this.files) {
      const stat = await lstat(file).catch(() => null);
      if (stat !== null && !stat.isDirectory()) {
        await removeIfPossible(() => unlink(file));
        removed.push(path.relative(this.root, file));
      }
    }
    const deepestFirst = [...this.dirs].sort((a, b) => depth(b) - depth(a));
    for (const dir of deepestFirst) {
      await removeIfPossible(() => rmdir(dir));
    }
    this.clear();
    return removed;
  }

  /** Forget everything (the apply succeeded; its files are now the host's). */
  clear(): void {
    this.files.clear();
    this.dirs.clear();
  }
}
