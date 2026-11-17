/**
 * Shared fixtures for the deterministic Health regression suites
 * (`deterministic-regressions*.test.ts`). Each suite owns its own temporary
 * roots and their cleanup; this module only supplies a pure file helper and
 * the values the suites share.
 * @module tests/unit/health/deterministic-regressions-fixtures
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

/** The host CI workflow every ruleset fixture project declares. */
export const CI_WORKFLOW_PATH = ".github/workflows/ci.yml";
/** Minimal content for the host CI workflow. */
export const CI_WORKFLOW_CONTENT = "on: push\n";
/** The GitHub Actions app id Lisa-required status checks are bound to. */
export const ACTIONS_INTEGRATION_ID = 15_368;

/**
 * Write one fixture file, creating its parent directories.
 * @param relativeRoot - Root the fixture path is resolved against
 * @param relativePath - Fixture path relative to the root
 * @param content - Exact file content
 */
export async function write(
  relativeRoot: string,
  relativePath: string,
  content: string
): Promise<void> {
  const destination = path.join(relativeRoot, relativePath);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, content);
}
