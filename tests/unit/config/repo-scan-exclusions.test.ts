/**
 * Tests for the directories a repository-wide source scan must not descend into.
 *
 * A scan that walks the repository to assert something about the SOURCE — this
 * file is unique by basename, every shipped hook has a companion — is exposed
 * to anything under the root that is a COPY of the source rather than the
 * source. A mutation sandbox is the dangerous one, because it is a full second
 * copy of the tree.
 *
 * Measured on this repository (CodySwannGT/lisa#3653): a `stryker` run
 * terminated under fleet saturation left 42 MB at
 * `.stryker-tmp/bite-guard-intact/sandbox-<id>/rails/copy-overwrite/scripts/lisa-scratch-run.sh`,
 * and `rails-scratch-supervisor-routes.test.ts` — which asserts that file is
 * unique by basename — failed on the NEXT run with a clean, specific, entirely
 * plausible message about a duplicate file. Nothing in its output mentioned
 * mutation, saturation, or the run that died minutes earlier.
 *
 * Measured at the same time: 42 test files walk from the repository root and
 * none of them excluded the sandbox root. The basename scan is simply the one
 * that tripped first.
 * @module tests/unit/config/repo-scan-exclusions
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  DEFAULT_SANDBOX_ROOT,
  isExcludedFromRepoScan,
  REPO_SCAN_EXCLUSIONS,
} from "../../../src/configs/repo-scan.js";
import { WORKTREE_ROOTS } from "../../../src/configs/worktrees.js";

/** Temporary trees this file created, removed after each case. */
const created: string[] = [];

/** The source path the real scan asserts holds exactly one copy of the file. */
const SOURCE_DIR = path.join("rails", "copy-overwrite", "scripts");

/** The file a killed sandbox duplicated, breaking that uniqueness assertion. */
const SUPERVISOR_BASENAME = "lisa-scratch-run.sh";

afterEach(() => {
  for (const dir of created.splice(0)) {
    fs.rmSync(dir, { force: true, recursive: true });
  }
});

/**
 * Build a throwaway tree with one real source file and one sandbox copy of it.
 * @returns The tree root.
 */
function treeWithSandboxCopy(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lisa-repo-scan-"));
  const real = path.join(root, SOURCE_DIR);
  // The shape a killed run actually leaves: the sandbox root, an arm directory,
  // Stryker's own inner sandbox, then a full copy of the tree beneath it.
  const debris = path.join(
    root,
    DEFAULT_SANDBOX_ROOT,
    "bite-guard-intact",
    "sandbox-WbOW82",
    SOURCE_DIR
  );
  created.push(root);
  for (const dir of [real, debris]) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, SUPERVISOR_BASENAME), "#!/bin/sh\n");
  }
  return root;
}

/**
 * Walk a tree for a basename, honouring the shared exclusions.
 * @param root - Directory to search
 * @param basename - Exact file name to match
 * @returns Root-relative paths.
 */
function findByBasename(root: string, basename: string): readonly string[] {
  const walk = (dir: string): readonly string[] =>
    fs
      .readdirSync(dir, { withFileTypes: true })
      .filter(entry => !isExcludedFromRepoScan(entry.name))
      .flatMap(entry => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return walk(full);
        return entry.name === basename ? [path.relative(root, full)] : [];
      });
  return walk(root);
}

describe("a scan does not read a killed run's sandbox as source", () => {
  it("finds one copy of a file the sandbox also contains", () => {
    // The reported failure, reproduced on the shape a real kill leaves. Without
    // the exclusion this finds two and the uniqueness assertion fails.
    const found = findByBasename(treeWithSandboxCopy(), SUPERVISOR_BASENAME);

    expect(found).toEqual([path.join(SOURCE_DIR, SUPERVISOR_BASENAME)]);
  });

  it("excludes the sandbox root by name", () => {
    expect(isExcludedFromRepoScan(DEFAULT_SANDBOX_ROOT)).toBe(true);
  });

  it("uses Stryker's own default sandbox name", () => {
    // If this drifts from `DEFAULT_TEMP_DIR_NAME` in `lisa-mutation.mjs`, the
    // exclusion stops matching the directory that is actually created.
    expect(DEFAULT_SANDBOX_ROOT).toBe(".stryker-tmp");
  });
});

describe("the exclusion list", () => {
  it.each([
    ".git",
    "node_modules",
    "dist",
    "coverage",
    ".claude",
    "scratchpad",
  ])(
    "still excludes %s, which scans relied on before this was shared",
    entry => {
      // Centralising a hand-rolled list must not quietly drop a member of it.
      expect(isExcludedFromRepoScan(entry)).toBe(true);
    }
  );

  it("excludes every worktree root, which is another branch's source", () => {
    // One host project measured 13,821 of 14,277 collected files coming from
    // worktrees, so a repo-wide scan reading them is not a hypothetical.
    const leaves = WORKTREE_ROOTS.map(root => root.split("/").at(-1) as string);

    expect(leaves.every(leaf => isExcludedFromRepoScan(leaf))).toBe(true);
  });

  it("matches entry NAMES, never paths", () => {
    // The list is consumed against a single `readdirSync` entry. A member
    // containing a separator could never match one, so it would be silently
    // inert — the failure mode this whole issue is about.
    expect(REPO_SCAN_EXCLUSIONS.some(entry => entry.includes("/"))).toBe(false);
  });

  it("does not exclude ordinary source directories", () => {
    // The list can do harm in one direction: hiding real source from a scan
    // that exists to check it.
    const sourceDirs = [
      "src",
      "tests",
      "rails",
      "typescript",
      "all",
      "scripts",
    ];

    expect(sourceDirs.filter(dir => isExcludedFromRepoScan(dir))).toEqual([]);
  });
});
