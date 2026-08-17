import { readFile } from "node:fs/promises";
import * as path from "node:path";
// minimatch v9+ exposes the matcher as a named ESM export. Keep the legacy
// default fallback so Lisa still runs in projects whose package manager hoists
// an older CJS minimatch for another tool.
import * as minimatchModule from "minimatch";
import { pathExists } from "./file-operations.js";

/**
 * Resolve the minimatch predicate across v9+ named exports and legacy CJS
 * default exports. Throws if neither is available so callers see a clear error
 * instead of "undefined is not a function" at match time.
 */
const minimatchFn: (
  p: string,
  pattern: string,
  options?: { readonly dot?: boolean }
) => boolean = (() => {
  const mod = minimatchModule as unknown as {
    readonly default?: unknown;
    readonly minimatch?: unknown;
  };
  const candidate =
    typeof mod.default === "function" ? mod.default : mod.minimatch;
  if (typeof candidate !== "function") {
    throw new TypeError(
      "minimatch module did not expose a callable export; expected v9+ named export or legacy default"
    );
  }
  return candidate as (
    p: string,
    pattern: string,
    options?: { readonly dot?: boolean }
  ) => boolean;
})();

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
export function parseIgnorePatterns(content: string): readonly string[] {
  return content
    .split("\n")
    .map(line => line.trim())
    .filter(line => line.length > 0 && !line.startsWith("#"));
}

/**
 * Whether one already-normalized path is selected by one pattern.
 *
 * The pattern here is always positive — negation is stripped by the caller and
 * handled as precedence, never passed through to minimatch. That matters: a `!`
 * reaching minimatch means "match everything EXCEPT", the opposite of what a
 * gitignore reader intends.
 * @param normalizedPath - Forward-slash path relative to the project root
 * @param pattern - A single positive gitignore-style pattern
 * @returns True when the pattern selects the path
 */
function patternSelects(normalizedPath: string, pattern: string): boolean {
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
  if (minimatchFn(normalizedPath, pattern, { dot: true })) {
    return true;
  }

  // Handle patterns that should match anywhere in path
  if (!pattern.includes("/")) {
    // Pattern without slashes matches any path segment
    const segments = normalizedPath.split("/");
    return segments.some(segment =>
      minimatchFn(segment, pattern, { dot: true })
    );
  }

  // Handle patterns starting with **/ (match anywhere)
  if (pattern.startsWith("**/")) {
    return minimatchFn(normalizedPath, pattern, { dot: true });
  }

  return false;
}

/**
 * Check if a relative path matches any of the ignore patterns
 *
 * Gitignore semantics: patterns are evaluated in order and the LAST one to
 * select the path decides, so a `!` line re-includes something an earlier
 * pattern ignored. Previously every pattern was combined with `.some()` and
 * handed to minimatch verbatim, which negates by default — so `!scripts/a.mjs`
 * selected every path that was NOT `scripts/a.mjs`, and one such line reported
 * the entire project as ignored. An ignored path is not a candidate for apply,
 * so that silently switched off Lisa's management of the whole repository, with
 * no error and nothing to notice.
 * @param relativePath - Path relative to project root
 * @param patterns - Array of gitignore-style patterns
 * @returns True if the path should be ignored
 */
export function matchesAnyPattern(
  relativePath: string,
  patterns: readonly string[]
): boolean {
  // Normalize path separators
  const normalizedPath = relativePath.replace(/\\/g, "/");

  return patterns.reduce<boolean>((ignored, raw) => {
    const negated = raw.startsWith("!");
    // A bare `!` selects nothing rather than everything; `\!x` is a literal `!x`.
    const pattern = negated ? raw.slice(1) : raw.replace(/^\\!/, "!");
    if (pattern.length === 0) {
      return ignored;
    }
    if (!patternSelects(normalizedPath, pattern)) {
      return ignored;
    }
    return !negated;
  }, false);
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
