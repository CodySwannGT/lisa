/** Lightweight resolver for the configured project-learnings path. */
import {
  DEFAULT_PROJECT_LEARNINGS_FILE,
  eagerContextRejection,
  findEagerContextSurface,
} from "./learnings-location.js";
import { validateSafeRelativeMarkdownPath } from "./safe-relative-markdown-path.js";

/**
 * Validate a `learnings.file` override with the canonical path policy.
 * @param value - Raw configured path
 * @param source - Config source for diagnostics
 * @returns Validated cold, project-relative Markdown path
 */
export function validateConfiguredLearningsFile(
  value: unknown,
  source: string
): string {
  const safe = validateSafeRelativeMarkdownPath(
    value,
    source,
    "learnings.file"
  );
  const surface = findEagerContextSurface(safe);
  if (surface !== undefined) {
    throw new Error(
      `Invalid learnings.file in ${source}: ${eagerContextRejection(surface)}`
    );
  }
  return safe;
}

/**
 * Resolve the learnings path from an untrusted parsed config without importing
 * the full config writer and its package dependencies.
 * @param parsed - Parsed `.lisa.config.json` value
 * @param source - Config source for diagnostics
 * @returns Validated configured path or the canonical default
 */
export function resolveLearningsFileFromRawConfig(
  parsed: unknown,
  source: string
): string {
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(
      `Invalid .lisa.config.json at ${source}: expected JSON object`
    );
  }
  const learnings = (parsed as Record<string, unknown>).learnings;
  if (learnings === undefined) return DEFAULT_PROJECT_LEARNINGS_FILE;
  if (
    learnings === null ||
    typeof learnings !== "object" ||
    Array.isArray(learnings)
  ) {
    throw new Error(`Invalid learnings in ${source}: expected an object`);
  }
  const file = (learnings as Record<string, unknown>).file;
  return file === undefined
    ? DEFAULT_PROJECT_LEARNINGS_FILE
    : validateConfiguredLearningsFile(file, source);
}
