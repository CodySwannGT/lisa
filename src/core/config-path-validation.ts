/**
 * Shared validation for path-typed `.lisa.config.json` fields.
 *
 * Extracted from `project-config.ts` so every configurable file destination
 * (`projectRulesFile`, `learnings.file`, …) funnels through one hardened
 * safe-relative-Markdown-path check without growing the config module.
 * @module core/config-path-validation
 */
import * as path from "node:path";

/**
 * Whether a path contains an ASCII control character.
 * @param value - Configured path
 * @returns True when any control character is present
 */
function containsControlCharacter(value: string): boolean {
  return Array.from(value).some(character => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127;
  });
}

/**
 * Validate a configurable destination as a safe, relative, non-traversing
 * Markdown path. Shared by every path-typed config field; the `field` label is
 * interpolated into each diagnostic so callers get a field-specific message.
 * @param value - Raw configured path
 * @param source - Config source for errors
 * @param field - Config field name used in error messages
 * @returns Validated project-relative path
 */
export function validateSafeRelativeMarkdownPath(
  value: unknown,
  source: string,
  field: string
): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.trim() !== value ||
    value.includes("\\") ||
    containsControlCharacter(value) ||
    /^[a-z]:/iu.test(value) ||
    path.posix.isAbsolute(value) ||
    path.win32.isAbsolute(value)
  ) {
    throw new Error(
      `Invalid ${field} in ${source}: expected a safe relative POSIX path`
    );
  }
  const segments = value.split("/");
  if (
    segments.some(
      segment => segment === "" || segment === "." || segment === ".."
    )
  ) {
    throw new Error(
      `Invalid ${field} in ${source}: path traversal is not allowed`
    );
  }
  if (path.posix.extname(value).toLowerCase() !== ".md") {
    throw new Error(`Invalid ${field} in ${source}: expected a Markdown file`);
  }
  return value;
}
