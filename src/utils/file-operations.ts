import * as fse from "fs-extra";
import { stat, readFile, readdir } from "node:fs/promises";

/**
 * Check if two files have identical content
 * @param path1 First file path
 * @param path2 Second file path
 * @returns True if files have identical content
 */
export async function filesIdentical(
  path1: string,
  path2: string
): Promise<boolean> {
  try {
    const [content1, content2] = await Promise.all([
      readFile(path1),
      readFile(path2),
    ]);
    return content1.equals(content2);
  } catch {
    return false;
  }
}

/**
 * Ensure the parent directory of a file exists
 * @param filePath Path to ensure parent exists for
 */
export async function ensureParentDir(filePath: string): Promise<void> {
  await fse.ensureDir(filePath.substring(0, filePath.lastIndexOf("/")));
}

/**
 * Read file as UTF-8 string, returning null if file doesn't exist
 * @param filePath Path to file to read
 * @returns File contents or null if file doesn't exist
 */
export async function readFileOrNull(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, "utf-8");
  } catch {
    return null;
  }
}

/**
 * Check if a path exists
 * @param filePath Path to check
 * @returns True if path exists
 */
export async function pathExists(filePath: string): Promise<boolean> {
  return fse.pathExists(filePath);
}

/**
 * Check if a path is a file
 * @param filePath Path to check
 * @returns True if path is a file
 */
export async function isFile(filePath: string): Promise<boolean> {
  try {
    const stats = await stat(filePath);
    return stats.isFile();
  } catch {
    return false;
  }
}

/**
 * Check if a path is a directory
 * @param filePath Path to check
 * @returns True if path is a directory
 */
export async function isDirectory(filePath: string): Promise<boolean> {
  try {
    const stats = await stat(filePath);
    return stats.isDirectory();
  } catch {
    return false;
  }
}

/**
 * List all files in a directory recursively
 * @param dir Directory to walk
 * @returns Array of file paths
 */
export async function listFilesRecursive(dir: string): Promise<string[]> {
  const files: string[] = [];

  /**
   * Recursively walk directory tree collecting files
   * @param currentDir Current directory being walked
   */
  async function walk(currentDir: string): Promise<void> {
    const entries = await readdir(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = `${currentDir}/${entry.name}`;

      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile()) {
        files.push(fullPath);
      }
    }
  }

  if (await isDirectory(dir)) {
    await walk(dir);
  }

  return files;
}
