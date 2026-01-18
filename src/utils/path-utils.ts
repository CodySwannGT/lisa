import * as path from "node:path";

/**
 * Resolve a path to an absolute path
 */
export function toAbsolutePath(inputPath: string): string {
  if (path.isAbsolute(inputPath)) {
    return inputPath;
  }
  return path.resolve(process.cwd(), inputPath);
}

/**
 * Get the relative path from base to target
 */
export function getRelativePath(basePath: string, targetPath: string): string {
  return path.relative(basePath, targetPath);
}

/**
 * Join path segments
 */
export function joinPaths(...segments: string[]): string {
  return path.join(...segments);
}

/**
 * Get the directory name of a path
 */
export function getDirname(filePath: string): string {
  return path.dirname(filePath);
}

/**
 * Get the base name of a path
 */
export function getBasename(filePath: string): string {
  return path.basename(filePath);
}
