/**
 * Lend a throwaway fixture project another tree's installed packages without
 * lending it the per-project state tools keep beside them
 * (CodySwannGT/lisa#5028).
 *
 * A fixture that runs a real Vitest needs the same Vitest this suite runs
 * under, so it borrows this checkout's `node_modules`. Borrowing the directory
 * whole also lends it `node_modules/.vitest-cache`, Vitest 5's on-disk module
 * cache. Before every run Vitest compares its root's lockfile hash with the
 * one that cache records and clears the cache when they differ. A fixture with
 * no lockfile never agrees, so its Vitest deletes the checkout's real cache
 * through the link, in the middle of the very suite that started the fixture.
 * Every sibling test file still reading the cache then fails with ENOENT.
 *
 * `borrowNodeModules` builds a real directory holding one link per installed
 * entry: packages, `@scope` directories, `.bin` and bun's `.bun` store. Every
 * other dot entry (`.vitest-cache`, `.vite`, `.vite-temp`, `.cache`) is a
 * tool's state rather than an installed package, so it is left behind. A tool
 * run in the fixture writes its own copy inside the fixture, and the fixture's
 * teardown deletes it with the rest.
 *
 * `linkForeignNodeModules` is for the one case whose subject IS a
 * whole-directory `node_modules` link: a project linked into another
 * checkout's tree. It refuses a source inside this checkout, so the
 * exception is proved at runtime rather than asserted in a comment.
 *
 * Plain `.mjs` so both the TypeScript suites and the `.mjs` support modules
 * import the same rule. tests/unit/config/no-whole-node-modules-link.test.ts
 * refuses any other whole-directory `node_modules` link under tests/.
 * @module tests/support/borrowed-node-modules
 */
import * as fs from "node:fs";
import * as path from "node:path";

/** This checkout's root, which a foreign link may never reach into. */
const CHECKOUT_ROOT = fs.realpathSync(
  path.resolve(import.meta.dirname, "..", "..")
);

/** Dot entries that are part of the installed tree rather than tool state. */
const INSTALLED_DOT_ENTRIES = new Set([".bin", ".bun"]);

/**
 * Whether a `node_modules` entry is an installed package a fixture may share.
 * @param {string} entry - Entry name directly under `node_modules`
 * @returns {boolean} False for a tool's per-project state directory
 */
export function isInstalledEntry(entry) {
  return !entry.startsWith(".") || INSTALLED_DOT_ENTRIES.has(entry);
}

/**
 * Give `root` a `node_modules` that resolves every package from `source`
 * without sharing any tool's state.
 * @param {string} source - The `node_modules` to borrow from
 * @param {string} root - Fixture project root that receives `node_modules`
 * @param {readonly string[]} [except] - Entries the caller provides itself
 * @returns {string} The fixture's `node_modules` path
 */
export function borrowNodeModules(source, root, except = []) {
  const target = path.join(root, "node_modules");
  const skipped = new Set(except);
  fs.mkdirSync(target, { recursive: true });
  for (const entry of fs.readdirSync(source)) {
    if (!isInstalledEntry(entry) || skipped.has(entry)) continue;
    fs.symlinkSync(path.join(source, entry), path.join(target, entry));
  }
  return target;
}

/**
 * Link `root/node_modules` whole to another fixture's tree, for a case whose
 * subject is a linked `node_modules`.
 * @param {string} source - Another fixture's `node_modules`, never this
 *   checkout's
 * @param {string} root - Fixture project root that receives the link
 * @returns {string} The link's path
 */
export function linkForeignNodeModules(source, root) {
  const resolved = fs.realpathSync(path.dirname(source));
  const relative = path.relative(CHECKOUT_ROOT, resolved);
  // Outside means a `..` path SEGMENT (or another root), never a name that
  // merely begins with `..`: `..cache/x` is a child of this checkout.
  const outside =
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative);
  if (!outside) {
    throw new Error(
      `linkForeignNodeModules: ${source} is inside this checkout; borrow it with borrowNodeModules instead`
    );
  }
  const target = path.join(root, "node_modules");
  fs.symlinkSync(source, target, "dir");
  return target;
}
