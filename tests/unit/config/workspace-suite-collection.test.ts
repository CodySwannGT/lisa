/**
 * Guards that every test file in a workspace package is actually collected.
 *
 * Five suites — 1306 lines across the two ESLint plugin workspaces — sat in
 * this repository writing assertions nothing ever evaluated. `include` was
 * `tests/**\/*.test.ts` and `src/**\/*.test.ts`, and `.js` under
 * `eslint-plugin-*\/__tests__\/` matches neither, so `vitest run
 * eslint-plugin-component-structure/__tests__/plugin-index.test.js` answered
 * "No test files found". Every one of those 78 tests passes; they were simply
 * never asked.
 *
 * The load-bearing assertion is the one that fails on an EMPTY enumeration.
 * A guard that walks the workspaces, finds nothing, and passes is the same
 * vacuous green as the suites it exists to protect — so finding nothing is a
 * failure here, exactly as it is inside the `.mjs` runner.
 *
 * Enumeration is deliberately independent of the pattern under test: the walk
 * is a plain recursive `readdir`, so narrowing `include` cannot also narrow
 * what the guard believes exists. A guard that derived both sides from the
 * same glob would agree with itself no matter how wrong the glob got.
 * @module tests/unit/config/workspace-suite-collection
 */

import { globSync, readdirSync, readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import rootConfig from "../../../vitest.config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

/** Directories that never hold this repository's own suites. */
const SKIP = new Set(["node_modules", "dist", "build", ".git", "coverage"]);

/**
 * The workspace packages, read from the root manifest rather than guessed.
 *
 * Reading the manifest is what makes this guard cover a workspace nobody has
 * added yet: a new package with suites the patterns miss fails here on the day
 * it lands, instead of joining the five that went dark unnoticed.
 */
const WORKSPACES: readonly string[] =
  (
    JSON.parse(readFileSync(path.join(REPO_ROOT, "package.json"), "utf8")) as {
      workspaces?: string[];
    }
  ).workspaces ?? [];

/**
 * Every test file under a directory, as repo-relative POSIX paths.
 * @param relativeDir Directory to walk, relative to the repository root.
 * @returns Repo-relative paths of files whose name contains `.test.`.
 */
function walkTests(relativeDir: string): string[] {
  const absolute = path.join(REPO_ROOT, relativeDir);
  const entries = readdirSync(absolute, { withFileTypes: true });

  return entries.flatMap(entry => {
    const child = path.posix.join(relativeDir, entry.name);
    if (entry.isDirectory()) {
      return SKIP.has(entry.name) ? [] : walkTests(child);
    }
    return /\.test\.[cm]?[jt]sx?$/u.test(entry.name) ? [child] : [];
  });
}

/** Test files that exist on disk inside the workspace packages. */
const onDisk: readonly string[] = WORKSPACES.flatMap(walkTests).sort(
  (left, right) => left.localeCompare(right)
);

/** The merged `include` the real test run uses, read from the real config. */
const include: readonly string[] =
  (rootConfig as { test?: { include?: string[] } }).test?.include ?? [];

/** Every file the configured patterns actually collect. */
const collected: ReadonlySet<string> = new Set(
  include
    .flatMap(pattern => globSync(pattern, { cwd: REPO_ROOT }))
    .map(file => file.split(path.sep).join(path.posix.sep))
);

describe("workspace test suites are collected by the real config", () => {
  it("finds workspace packages to check", () => {
    // An empty workspace list would make every assertion below vacuous.
    expect(WORKSPACES.length).toBeGreaterThan(0);
  });

  it("finds test files on disk", () => {
    // THE control. If this ever reads zero, the guard has stopped guarding and
    // must fail rather than quietly agree that nothing needs collecting.
    expect(onDisk.length).toBeGreaterThan(0);
  });

  it("resolves a non-empty include from the root config", () => {
    expect(include.length).toBeGreaterThan(0);
  });

  it("collects every test file that exists in a workspace package", () => {
    const stranded = onDisk.filter(file => !collected.has(file));

    // Named individually: "3 files are stranded" sends the reader hunting,
    // and the whole defect was that nobody knew which files were dark.
    expect(stranded).toEqual([]);
  });
});
