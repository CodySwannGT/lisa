/**
 * A fixture's Vitest run must not reach the module cache of the checkout it
 * borrows packages from (CodySwannGT/lisa#5028).
 *
 * Each case builds a stand-in for this checkout's `node_modules`: a real
 * directory resolving every installed package from here, plus a
 * `.vitest-cache` whose metadata records a lockfile hash no real lockfile can
 * produce. A fixture project with no lockfile then borrows that stand-in and
 * runs a real Vitest. When the stand-in is linked whole, Vitest sees the hash
 * mismatch and clears the stand-in's cache through the link, which is exactly
 * how a fixture wiped the checkout's cache in the middle of a push. Borrowed
 * through the helper, the stand-in's cache is never reachable.
 * @module tests/integration/borrowed-node-modules
 */
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { borrowNodeModules } from "../helpers/borrowed-node-modules.js";
import { boundedSpawnSync } from "../helpers/io-latency-budget.js";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");
const REPO_MODULES = path.join(REPO_ROOT, "node_modules");
const CACHE = ".vitest-cache";
const METADATA = `${JSON.stringify({ lockfileHash: "borrowed" })}\n`;
const ENTRY = "sentinel-entry";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

/**
 * A stand-in for this checkout's `node_modules` whose module cache records a
 * hash that differs from any fixture's.
 * @returns The stand-in `node_modules` path
 */
function standInModules(): string {
  const owner = fs.mkdtempSync(path.join(tmpdir(), "lisa-borrowed-source-"));
  // The stand-in plants its own cache, so the checkout's is never linked in,
  // whatever the helper's rule says.
  const modules = borrowNodeModules(REPO_MODULES, owner, [CACHE]);
  roots.push(owner);
  fs.mkdirSync(path.join(modules, CACHE));
  fs.writeFileSync(path.join(modules, CACHE, "_metadata.json"), METADATA);
  fs.writeFileSync(path.join(modules, CACHE, ENTRY), "cached module\n");
  return modules;
}

/**
 * A lockfile-less fixture project holding one passing test file.
 * @param lend - Gives the fixture root its `node_modules`
 * @returns The fixture root
 */
function fixtureProject(lend: (root: string) => void): string {
  const root = fs.mkdtempSync(path.join(tmpdir(), "lisa-borrowed-fixture-"));
  roots.push(root);
  fs.writeFileSync(
    path.join(root, "package.json"),
    `${JSON.stringify({ name: "fixture", private: true, type: "module" })}\n`
  );
  fs.writeFileSync(
    path.join(root, "one.test.js"),
    "import { test } from 'vitest';\ntest('runs', () => {});\n"
  );
  lend(root);
  return root;
}

/**
 * Run a real Vitest in a lockfile-less fixture project.
 * @param lend - Gives the fixture root its `node_modules`
 */
function runFixture(lend: (root: string) => void): void {
  const root = fixtureProject(lend);
  const child = boundedSpawnSync({
    label: "fixture vitest run",
    command: process.execPath,
    args: [path.join(root, "node_modules/vitest/vitest.mjs"), "run"],
    cwd: root,
    env: { ...process.env, TMPDIR: root, TMP: root, TEMP: root },
  });
  expect(child.status, `${child.stdout}\n${child.stderr}`).toBe(0);
}

/**
 * What the stand-in's module cache holds after a fixture run.
 * @param modules - The stand-in `node_modules`
 * @returns The metadata text and whether the planted entry survived
 */
function cacheAfter(modules: string): { metadata: string; entry: boolean } {
  const cache = path.join(modules, CACHE);
  return {
    metadata: fs.readFileSync(path.join(cache, "_metadata.json"), "utf8"),
    entry: fs.existsSync(path.join(cache, ENTRY)),
  };
}

describe("a fixture borrowing this checkout's node_modules", () => {
  it("leaves the lender's Vitest module cache untouched", () => {
    const modules = standInModules();

    runFixture(root => borrowNodeModules(modules, root));

    expect(cacheAfter(modules)).toEqual({ metadata: METADATA, entry: true });
  });

  it("clears the lender's cache when the directory is linked whole (the defect)", () => {
    // The control: the same run through a whole-directory link, the way four
    // fixtures borrowed it before this fix. Without it, the case above could
    // pass because the run never touched any cache at all.
    const modules = standInModules();

    runFixture(root =>
      fs.symlinkSync(modules, path.join(root, "node_modules"), "dir")
    );

    expect(cacheAfter(modules)).not.toEqual({
      metadata: METADATA,
      entry: true,
    });
  });
});
