// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/**
 * @file npm-update-cache-seed.mjs
 * @description A pre-filled npm and Bun cache for one private updater root.
 *
 * Only an explicit `cacheSeed` option on `prepareUpdate` reaches this, never
 * the environment, so a host cannot turn it on: the updater's only production
 * caller passes no such option. The registry stays the hardcoded public one.
 *
 * What a seed can decide, and what bounds it (CodySwannGT/lisa#5092):
 * - npm checks every cached tarball against the lock's integrity, so for a
 *   package the host's lock pins, a seed can only supply those bytes or fail.
 * - For the update itself, the seed is the registry: its metadata decides the
 *   integrity written into the proposed lock. `prepareUpdate` therefore marks
 *   a seeded proposal, and every later phase refuses it.
 * - Bun writes bun.lock from its own cached manifests, and `verifyBunLock`
 *   refuses a bun.lock whose identity or integrity differs from npm's lock.
 * - Bun installs its cached, already extracted packages without hashing them
 *   again. They land only in the private root, under `--ignore-scripts`, and
 *   the updater reads nothing from them but `package.json` versions, then
 *   deletes the root; only lock files leave it.
 *
 * The seed is copied into the private root and never written. A seed that is
 * not an owned, plain directory tree is refused before anything is copied,
 * and the copy is checked again where nothing else can change it.
 * @module npm-updater
 */
import { cpSync, lstatSync, readdirSync, realpathSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { required } from "./npm-update-contract.mjs";

/** The caches a seed may hold, and nothing else. */
const SEED_KEYS = ["bun", "npm"];

/**
 * Where Bun keeps its cache inside a private root.
 * @param {string} root - The private root, which is also HOME.
 * @returns {string} The cache folder.
 */
export function bunCacheIn(root) {
  return join(root, ".bun", "install", "cache");
}

/**
 * Refuse anything in a seed but owned folders and files nobody else can write.
 * @param {string} path - An absolute path inside the seed.
 * @param {number} uid - The updater's user.
 */
function requireOwnedTree(path, uid) {
  const entry = lstatSync(path);
  required(
    (entry.isDirectory() || entry.isFile()) && !entry.isSymbolicLink(),
    "cache seed holds something that is not a plain file or folder"
  );
  required(entry.uid === uid, "cache seed is not owned by the updater's user");
  required(
    (entry.mode & 0o022) === 0,
    "cache seed is writable by another user"
  );
  if (entry.isDirectory())
    for (const name of readdirSync(path))
      requireOwnedTree(join(path, name), uid);
}

/**
 * Check one seed folder before anything is copied from it.
 * @param {unknown} folder - The folder the caller named.
 * @returns {string} The folder, proven absolute, real and owned.
 */
function seedFolder(folder) {
  required(
    typeof folder === "string" && isAbsolute(folder),
    "cache seed folder must be an absolute path"
  );
  required(
    realpathSync(folder) === folder,
    "cache seed folder must not pass through a link"
  );
  required(
    lstatSync(folder).isDirectory(),
    "cache seed folder must be a folder"
  );
  requireOwnedTree(folder, process.getuid());
  return folder;
}

/**
 * Validate a cache seed. `undefined` is no seed, and changes nothing.
 * @param {unknown} seed - `{ npm, bun? }`, absolute folders, or undefined.
 * @returns {{ npm: string, bun?: string } | undefined} The checked seed.
 */
export function validCacheSeed(seed) {
  if (seed === undefined) return undefined;
  required(
    seed !== null && typeof seed === "object" && !Array.isArray(seed),
    "cache seed must be an object"
  );
  const keys = Object.keys(seed).sort();
  required(
    keys.includes("npm") && keys.every(key => SEED_KEYS.includes(key)),
    "cache seed names only an npm folder and, optionally, a Bun folder"
  );
  return {
    npm: seedFolder(seed.npm),
    ...(seed.bun === undefined ? {} : { bun: seedFolder(seed.bun) }),
  };
}

/**
 * Copy a checked seed into a private root and put npm offline there.
 *
 * Bun is put offline by `prepareUpdate`, which passes `offline` to every Bun
 * install whenever a seed is given, and refuses a seed with no Bun folder for
 * a host that commits bun.lock.
 *
 * Without a seed the environment comes back unchanged, so an updater run that
 * was given none behaves exactly as before.
 * @param {string} root - The private root.
 * @param {NodeJS.ProcessEnv} env - The private root's environment.
 * @param {{ npm: string, bun?: string } | undefined} seed - From {@link validCacheSeed}.
 * @returns {NodeJS.ProcessEnv} The environment npm and Bun run in.
 */
export function seedPrivateRoot(root, env, seed) {
  if (seed === undefined) return env;
  const npmCache = env.NPM_CONFIG_CACHE;
  required(
    typeof npmCache === "string" && npmCache.startsWith(`${root}/`),
    "private npm cache is outside the private root"
  );
  const copies = [[seed.npm, npmCache]];
  if (seed.bun !== undefined) copies.push([seed.bun, bunCacheIn(root)]);
  for (const [source, target] of copies) {
    cpSync(source, target, {
      recursive: true,
      errorOnExist: true,
      force: false,
    });
    // The source was checked before this copy and could have changed since;
    // the copy sits in the private root, which only this user can reach.
    requireOwnedTree(target, process.getuid());
  }
  return { ...env, NPM_CONFIG_OFFLINE: "true" };
}
