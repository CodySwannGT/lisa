/**
 * Lend a throwaway fixture project this checkout's installed packages without
 * lending it the per-project state tools keep beside them
 * (CodySwannGT/lisa#5028).
 *
 * A fixture that runs a real Vitest needs the same Vitest this suite runs
 * under, so it borrows this checkout's `node_modules`. Borrowing the directory
 * whole also lends it `node_modules/.vitest-cache`, Vitest 5's on-disk module
 * cache. Before every run Vitest compares its root's lockfile hash with the
 * one that cache records and clears the cache when they differ. A fixture has
 * no lockfile, so the two never agree, and the fixture's Vitest deletes the
 * checkout's real cache through the link. That happens in the middle of the
 * very suite that started the fixture, and every sibling test file still
 * reading the cache fails with ENOENT.
 *
 * The borrowed tree is a real directory holding one link per installed entry:
 * packages, `@scope` directories, `.bin` and bun's `.bun` store. Every other
 * dot entry (`.vitest-cache`, `.vite`, `.vite-temp`, `.cache`) is a tool's
 * state rather than an installed package, so it is left behind. A tool run in
 * the fixture writes its own copy inside the fixture, and the fixture's
 * teardown deletes it with the rest.
 * @module tests/helpers/borrowed-node-modules
 */
import * as fs from "node:fs";
import * as path from "node:path";

/** Dot entries that are part of the installed tree rather than tool state. */
const INSTALLED_DOT_ENTRIES: ReadonlySet<string> = new Set([".bin", ".bun"]);

/**
 * Whether a `node_modules` entry is an installed package a fixture may share.
 * @param entry - Entry name directly under `node_modules`
 * @returns False for a tool's per-project state directory
 */
export function isInstalledEntry(entry: string): boolean {
  return !entry.startsWith(".") || INSTALLED_DOT_ENTRIES.has(entry);
}

/**
 * Give `root` a `node_modules` that resolves every package from `source`
 * without sharing any tool's state.
 * @param source - The `node_modules` to borrow from
 * @param root - Fixture project root that receives `node_modules`
 * @param except - Entries the caller provides itself, so they are not linked
 * @returns The fixture's `node_modules` path
 */
export function borrowNodeModules(
  source: string,
  root: string,
  except: readonly string[] = []
): string {
  const target = path.join(root, "node_modules");
  const skipped = new Set(except);
  fs.mkdirSync(target, { recursive: true });
  for (const entry of fs.readdirSync(source)) {
    if (!isInstalledEntry(entry) || skipped.has(entry)) continue;
    fs.symlinkSync(path.join(source, entry), path.join(target, entry));
  }
  return target;
}
