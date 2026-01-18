import * as fse from "fs-extra";
import { stat, readFile, readdir } from "node:fs/promises";

/**
 * Check if two files have identical content
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
 */
export async function ensureParentDir(filePath: string): Promise<void> {
  await fse.ensureDir(filePath.substring(0, filePath.lastIndexOf("/")));
}

/**
 * Read file as UTF-8 string, returning null if file doesn't exist
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
 */
export async function pathExists(filePath: string): Promise<boolean> {
  return fse.pathExists(filePath);
}

/**
 * Check if a path is a file
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
 */
export async function listFilesRecursive(dir: string): Promise<string[]> {
  const files: string[] = [];

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
