import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import * as path from "node:path";
import { pathExists } from "./file-operations.js";

/** The matcher signature Lisa uses. */
type MinimatchFn = (
  p: string,
  pattern: string,
  options?: { readonly dot?: boolean }
) => boolean;

const requireFromHere = createRequire(import.meta.url);

/**
 * Resolve the minimatch predicate, via CJS, on first use.
 *
 * Three deliberate choices, each fixing something the previous shape got wrong.
 *
 * **CJS, not ESM.** `minimatch@10`'s ESM entry opens with
 * `import { expand } from 'brace-expansion'`, which throws at MODULE LOAD in any
 * project whose tree resolves `brace-expansion` to the 2.x line — a very common
 * CVE remediation (`">=2.1.4 <3"`), since 2.x is CJS and exports no named
 * `expand`. Its CJS entry has no such problem. Measured on a real consumer:
 * `import('minimatch')` threw while `require('minimatch')` returned a working
 * function, same package, same version, same tree.
 *
 * **Lazily, not at module load.** The previous version resolved this eagerly
 * behind a static `import`, and that is what made the failure fatal: Lisa's own
 * CLI could not boot, so `lisa apply` could not run — and `lisa apply` is what
 * writes the `brace-expansion` override that fixes the tree. The remedy shipped
 * inside the thing that could not start. Resolving on first use breaks that
 * deadlock: the CLI boots, `doctor` reports, and apply repairs the override.
 *
 * **The old compatibility shim was unreachable.** Its comment said it existed
 * so "Lisa still runs in projects whose package manager hoists an older CJS
 * minimatch" — but a static ESM import fails before any fallback can be
 * consulted. A guard that cannot fire is not a guard.
 * @returns The matcher.
 */
const loadMinimatch = (): MinimatchFn => {
  const mod = requireFromHere("minimatch") as {
    readonly default?: unknown;
    readonly minimatch?: unknown;
  };
  const candidate =
    typeof mod.minimatch === "function"
      ? mod.minimatch
      : typeof mod.default === "function"
        ? mod.default
        : mod;
  if (typeof candidate !== "function") {
    throw new TypeError(
      "minimatch did not expose a callable export; expected a named `minimatch`, a default, or a callable module"
    );
  }
  return candidate as MinimatchFn;
};

/**
 * The matcher, resolved on each call.
 *
 * No memoisation, and that is not an oversight. Node's `require` cache already
 * makes every call after the first a map lookup, so a hand-rolled cache would
 * duplicate the module system's own work — and every shape it could take here
 * (a reassignable binding, a mutated holder) is forbidden by this codebase's
 * immutability rules for reasons that are worth more than the nanoseconds.
 * @param p Path to test.
 * @param pattern Glob pattern.
 * @param options Match options.
 * @returns Whether the path matches.
 */
const minimatchFn: MinimatchFn = (p, pattern, options) =>
  loadMinimatch()(p, pattern, options);

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
