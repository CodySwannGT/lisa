/**
 * The one module under tests/ that creates symbolic links
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
 * Whether a path held in a variable names a whole `node_modules` cannot be
 * told from the source text, so the rule is structural:
 * tests/unit/config/no-whole-node-modules-link.test.ts refuses any direct
 * `symlink`/`symlinkSync` call under tests/ outside this file, and every link
 * here is checked at runtime on resolved paths.
 *
 * - `createSymlink` is the general link. It refuses a whole `node_modules` and a
 *   tool's state directory inside one, as either end.
 * - `linkPackage` links one installed package into a fixture's
 *   `node_modules`.
 * - `borrowNodeModules` builds a real directory holding one link per
 *   installed entry: packages, `@scope` directories, `.bin` and bun's `.bun`
 *   store. Every other dot entry (`.vitest-cache`, `.vite`, `.vite-temp`,
 *   `.cache`) is a tool's state rather than an installed package, so it is
 *   left behind. A tool run in the fixture writes its own copy inside the
 *   fixture, and the fixture's teardown deletes it with the rest.
 * - `linkForeignNodeModules` is for the one case whose subject IS a
 *   whole-directory `node_modules` link: a project linked into another
 *   fixture's tree. It refuses a source that resolves into this checkout, so
 *   the exception is proved at runtime rather than asserted in a comment.
 *
 * Plain `.mjs` so both the TypeScript suites and the `.mjs` support modules
 * import the same rule.
 * @module tests/support/borrowed-node-modules
 */
import * as fs from "node:fs";
import * as path from "node:path";

/** This checkout's root, which a foreign link may never reach into. */
const CHECKOUT_ROOT = fs.realpathSync(
  path.resolve(import.meta.dirname, "..", "..")
);

/** The directory name a link may never stand for as a whole. */
const NODE_MODULES = "node_modules";

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
 * Whether `child` is `parent` or lies beneath it. A name that merely begins
 * with `..` (`..cache/x`) is a child, not a step out.
 * @param {string} parent - Resolved directory
 * @param {string} child - Resolved path
 * @returns {boolean} True when `child` is inside `parent`
 */
function within(parent, child) {
  const relative = path.relative(parent, child);
  return !(
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  );
}

/**
 * A path with every existing ancestor resolved, so a path that does not exist
 * yet still resolves through the links above it.
 * @param {string} candidate - Absolute path
 * @returns {string} The resolved path
 */
function resolveExisting(candidate) {
  if (fs.existsSync(candidate)) return fs.realpathSync(candidate);
  const parent = path.dirname(candidate);
  if (parent === candidate) return candidate;
  return path.join(resolveExisting(parent), path.basename(candidate));
}

/**
 * Why a path may not be one end of a link, if it may not.
 * @param {string} resolved - Resolved path
 * @returns {string | undefined} The refusal, or undefined when allowed
 */
function refusal(resolved) {
  if (path.basename(resolved) === NODE_MODULES) {
    return "is a whole node_modules directory";
  }
  const entry = path.basename(resolved);
  if (
    path.basename(path.dirname(resolved)) === NODE_MODULES &&
    !isInstalledEntry(entry)
  ) {
    return `is ${entry}, a tool's state inside node_modules`;
  }
  return undefined;
}

/**
 * Create one symbolic link, refusing a whole `node_modules` (or a tool's
 * state directory inside one) at either end, checked on resolved paths.
 * @param {string | Buffer} target - What the link points at, absolute or
 *   relative to the link's directory; a Buffer for link bytes that are not
 *   valid UTF-8
 * @param {string} linkPath - Where the link is created
 * @param {import("node:fs").symlink.Type | null} [type] - Link type, for Windows
 * @returns {string} `linkPath`
 */
export function createSymlink(target, linkPath, type) {
  const at = path.resolve(linkPath);
  const ends = [
    ["target", resolveExisting(path.resolve(path.dirname(at), String(target)))],
    ["link", resolveExisting(at)],
  ];
  for (const [end, resolved] of ends) {
    const reason = refusal(resolved);
    if (reason) {
      throw new Error(
        `createSymlink: the ${end} ${resolved} ${reason}; use borrowNodeModules, linkPackage or linkForeignNodeModules`
      );
    }
  }
  fs.symlinkSync(target, linkPath, type);
  return linkPath;
}

/**
 * Link one installed package into a fixture's `node_modules`.
 * @param {string} source - The package directory
 * @param {string} root - Fixture project root
 * @param {string} name - Package name, `@scope/name` allowed
 * @returns {string} The link's path
 */
export function linkPackage(source, root, name) {
  const modules = path.join(root, NODE_MODULES);
  const target = path.join(modules, name);
  if (!within(modules, target) || path.relative(modules, target) === "") {
    throw new Error(`linkPackage: ${name} is not a package name`);
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  return createSymlink(source, target, "dir");
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
    createSymlink(path.join(source, entry), path.join(target, entry));
  }
  return target;
}

/**
 * Whether a resolved source lies in a checkout or in that checkout's resolved
 * `node_modules`, which may itself be a link elsewhere.
 * @param {string} checkout - A checkout root
 * @param {string} resolved - The resolved source
 * @returns {boolean} True when the source belongs to the checkout
 */
function insideCheckout(checkout, resolved) {
  const home = resolveExisting(path.resolve(checkout));
  const modules = resolveExisting(path.join(home, NODE_MODULES));
  return within(home, resolved) || within(modules, resolved);
}

/**
 * Link `root/node_modules` whole to another fixture's tree, for a case whose
 * subject is a linked `node_modules`.
 * @param {string} source - Another fixture's `node_modules`, never this
 *   checkout's
 * @param {string} root - Fixture project root that receives the link
 * @param {string} [checkout] - A further checkout the source must lie
 *   outside, for a case that proves the rule on a scratch stand-in. It adds
 *   to this checkout's boundary; it never replaces it.
 * @returns {string} The link's path
 */
export function linkForeignNodeModules(source, root, checkout) {
  // Resolve the source itself when it exists, so a link standing outside the
  // checkout that points back at its node_modules is still refused; a source
  // not created yet resolves through its parent.
  const resolved = resolveExisting(path.resolve(source));
  const boundaries =
    checkout === undefined ? [CHECKOUT_ROOT] : [CHECKOUT_ROOT, checkout];
  const owner = boundaries.find(boundary => insideCheckout(boundary, resolved));
  if (owner !== undefined) {
    throw new Error(
      `linkForeignNodeModules: ${source} is inside the checkout ${owner}; borrow it with borrowNodeModules instead`
    );
  }
  const target = path.join(root, NODE_MODULES);
  fs.symlinkSync(source, target, "dir");
  return target;
}
