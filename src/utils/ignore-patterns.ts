import { readFile } from "node:fs/promises";
import * as path from "node:path";
import { minimatch } from "minimatch";
import { pathExists } from "./file-operations.js";

/**
 * Name of the ignore file that projects can use to skip Lisa files
 */
export const LISAIGNORE_FILENAME = ".lisaignore";

/**
 * Parsed ignore patterns from a .lisaignore file
 */
export interface IgnorePatterns {
  /** Raw patterns from the file */
  readonly patterns: readonly string[];
  /** Check if a relative path should be ignored */
  readonly shouldIgnore: (relativePath: string) => boolean;
}

/**
 * Parse a .lisaignore file content into patterns
 * Supports gitignore-style syntax:
 * - Lines starting with # are comments
 * - Empty lines are ignored
 * - Patterns are matched against relative paths
 * - Directory patterns end with /
 * @param content - Raw content of the .lisaignore file
 * @returns Array of parsed patterns
 */
function parseIgnorePatterns(content: string): readonly string[] {
  return content
    .split("\n")
    .map(line => line.trim())
    .filter(line => line.length > 0 && !line.startsWith("#"));
}

/**
 * Check if a relative path matches any of the ignore patterns
 * @param relativePath - Path relative to project root
 * @param patterns - Array of gitignore-style patterns
 * @returns True if the path should be ignored
 */
function matchesAnyPattern(
  relativePath: string,
  patterns: readonly string[]
): boolean {
  // Normalize path separators
  const normalizedPath = relativePath.replace(/\\/g, "/");

  return patterns.some(pattern => {
    // Handle directory patterns (ending with /)
    if (pattern.endsWith("/")) {
      const dirPattern = pattern.slice(0, -1);
      return (
        normalizedPath.startsWith(`${dirPattern}/`) ||
        normalizedPath === dirPattern
      );
    }

    // Handle exact match
    if (normalizedPath === pattern) {
      return true;
    }

    // Handle glob patterns
    if (minimatch(normalizedPath, pattern, { dot: true })) {
      return true;
    }

    // Handle patterns that should match anywhere in path
    if (!pattern.includes("/")) {
      // Pattern without slashes matches any path segment
      const segments = normalizedPath.split("/");
      return segments.some(segment =>
        minimatch(segment, pattern, { dot: true })
      );
    }

    // Handle patterns starting with **/ (match anywhere)
    if (pattern.startsWith("**/")) {
      return minimatch(normalizedPath, pattern, { dot: true });
    }

    return false;
  });
}

/**
 * Load and parse .lisaignore file from a project directory
 * @param projectDir - Path to the project directory
 * @returns Parsed ignore patterns, or empty patterns if file doesn't exist
 */
export async function loadIgnorePatterns(
  projectDir: string
): Promise<IgnorePatterns> {
  const ignorePath = path.join(projectDir, LISAIGNORE_FILENAME);

  if (!(await pathExists(ignorePath))) {
    return {
      patterns: [],
      shouldIgnore: () => false,
    };
  }

  const content = await readFile(ignorePath, "utf-8");
  const patterns = parseIgnorePatterns(content);

  return {
    patterns,
    shouldIgnore: (relativePath: string) =>
      matchesAnyPattern(relativePath, patterns),
  };
}
