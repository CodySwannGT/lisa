#!/usr/bin/env node
/**
 * Publish a fully built plugin tree over the live one without the live tree
 * ever being partly missing (CodySwannGT/lisa#4583).
 *
 * Running sessions read hooks straight out of the live plugin directories: the
 * enforcement dispatcher resolves its guards from `plugins/lisa/hooks/`, and
 * refuses every tool call when it finds none. The builder used to
 * `rm -rf plugins/lisa` and copy the source back in, which left the guards
 * absent for a couple of hundred milliseconds on every rebuild, and every
 * session on that checkout was refused in the meantime.
 *
 * So the builder now writes the complete tree into a staging sibling on the
 * same filesystem, and this helper moves it into place:
 *
 * - a live tree that does not exist yet is created by one directory rename;
 * - otherwise every staged file is renamed over its live counterpart. A rename
 *   onto an existing file replaces it atomically, so a reader sees the old
 *   bytes or the new bytes and never an absent file. Files whose bytes and mode
 *   are already identical are left untouched;
 * - only after every new file is in place are live entries the staged tree no
 *   longer contains removed, so retired files go last, not first.
 *
 * A whole-directory swap (rename live away, rename staged in) is not used: the
 * path is absent between the two renames, which is the defect again in a
 * smaller window, and the exchanging rename that would close it is not portable.
 *
 * Usage: node scripts/lib/publish-plugin-tree.mjs <staged-dir> <live-dir> [...]
 *
 * Any number of pairs, so one build publishes every tree from one process.
 */
import fs from "node:fs";
import path from "node:path";

import { invokedAsScript } from "./invoked-as-script.mjs";

/**
 * Whether two regular files already hold the same bytes and permission bits.
 * @param {string} staged - path of the newly built file
 * @param {fs.Stats} stagedStat - its stat
 * @param {string} live - path of the file currently published
 * @returns {boolean} true when replacing it would change nothing
 */
function sameFile(staged, stagedStat, live) {
  const liveStat = fs.lstatSync(live, { throwIfNoEntry: false });
  if (!liveStat?.isFile()) return false;
  if (liveStat.size !== stagedStat.size) return false;
  if ((liveStat.mode & 0o7777) !== (stagedStat.mode & 0o7777)) return false;
  return fs.readFileSync(staged).equals(fs.readFileSync(live));
}

/**
 * Move every staged entry into the live tree, newest content first.
 * @param {string} stagedDir - directory holding the complete new tree
 * @param {string} liveDir - directory sessions are reading
 * @returns {void}
 */
function placeEntries(stagedDir, liveDir) {
  const liveStat = fs.lstatSync(liveDir, { throwIfNoEntry: false });
  if (liveStat && !liveStat.isDirectory()) {
    fs.rmSync(liveDir, { force: true, recursive: true });
  }
  fs.mkdirSync(liveDir, { recursive: true });
  for (const entry of fs.readdirSync(stagedDir, { withFileTypes: true })) {
    const staged = path.join(stagedDir, entry.name);
    const live = path.join(liveDir, entry.name);
    if (entry.isDirectory()) {
      placeEntries(staged, live);
      continue;
    }
    const stagedStat = fs.lstatSync(staged);
    if (sameFile(staged, stagedStat, live)) continue;
    if (fs.lstatSync(live, { throwIfNoEntry: false })?.isDirectory()) {
      fs.rmSync(live, { force: true, recursive: true });
    }
    fs.renameSync(staged, live);
  }
}

/**
 * Every path the staged tree holds, relative to its root, taken before any of
 * it is moved: placing renames staged files away, so the staged tree cannot be
 * consulted afterwards to decide what is retired.
 * @param {string} dir - directory to list
 * @param {string} [prefix] - relative path of `dir` within the staged root
 * @returns {Map<string, boolean>} relative path to whether it is a directory
 */
function listTree(dir, prefix = "") {
  const listed = new Map();
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const relative = path.join(prefix, entry.name);
    listed.set(relative, entry.isDirectory());
    if (entry.isDirectory()) {
      for (const [inner, isDir] of listTree(
        path.join(dir, entry.name),
        relative
      )) {
        listed.set(inner, isDir);
      }
    }
  }
  return listed;
}

/**
 * Remove live entries the staged tree did not contain.
 * @param {Map<string, boolean>} staged - the staged listing from `listTree`
 * @param {string} liveDir - directory sessions are reading
 * @param {string} [prefix] - relative path of `liveDir` within the live root
 * @returns {void}
 */
function removeRetired(staged, liveDir, prefix = "") {
  for (const entry of fs.readdirSync(liveDir, { withFileTypes: true })) {
    const relative = path.join(prefix, entry.name);
    const live = path.join(liveDir, entry.name);
    if (!staged.has(relative)) {
      fs.rmSync(live, { force: true, recursive: true });
    } else if (entry.isDirectory() && staged.get(relative)) {
      removeRetired(staged, live, relative);
    }
  }
}

/**
 * Publish a staged plugin tree over the live one. The staged tree is consumed.
 * @param {string} stagedDir - directory holding the complete new tree
 * @param {string} liveDir - directory sessions are reading
 * @returns {void}
 */
export function publishPluginTree(stagedDir, liveDir) {
  if (!fs.lstatSync(stagedDir, { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error(`publish-plugin-tree: no staged tree at ${stagedDir}`);
  }
  if (!fs.lstatSync(liveDir, { throwIfNoEntry: false })) {
    fs.mkdirSync(path.dirname(liveDir), { recursive: true });
    fs.renameSync(stagedDir, liveDir);
    return;
  }
  const staged = listTree(stagedDir);
  placeEntries(stagedDir, liveDir);
  removeRetired(staged, liveDir);
  fs.rmSync(stagedDir, { force: true, recursive: true });
}

/** Prefix of a build's staging sibling; the suffix is the owning build's pid. */
const STAGE_PREFIX = ".build-staging-";
/** The checkout-wide publish lock, a sibling of the live trees. */
const LOCK_NAME = ".publish.lock";
/** How long a publish waits for another build's publish before giving up. */
const DEFAULT_LOCK_WAIT_MS = 300_000;
/** How often a waiting publish looks at the lock again. */
const LOCK_POLL_MS = 50;

/**
 * Whether the process that owns a staging area or a lock is confirmed gone.
 *
 * Only `ESRCH` confirms that: `EPERM` means the process exists and belongs to
 * another user, and anything else is not knowledge either way. Anything short
 * of confirmation keeps the owner's files, because removing a running build's
 * files breaks that build.
 * @param {number} pid - owner process id
 * @param {(pid: number, signal: number) => unknown} [probe] - `process.kill`
 * @returns {boolean} true only when the owner does not exist
 */
export function ownerGone(pid, probe = process.kill) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    probe(pid, 0);
    return false;
  } catch (error) {
    return /** @type {NodeJS.ErrnoException} */ (error).code === "ESRCH";
  }
}

/**
 * Remove the staging areas of builds that were killed before their exit trap
 * ran, and nothing whose owner might still be running.
 * @param {string} pluginsDir - directory holding the live trees
 * @param {(pid: number, signal: number) => unknown} [probe] - `process.kill`
 * @returns {readonly string[]} names of the staging areas removed
 */
export function clearStaleStages(pluginsDir, probe = process.kill) {
  const removed = [];
  for (const entry of fs.readdirSync(pluginsDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith(STAGE_PREFIX)) continue;
    const suffix = entry.name.slice(STAGE_PREFIX.length);
    if (!/^\d+$/.test(suffix) || !ownerGone(Number(suffix), probe)) continue;
    fs.rmSync(path.join(pluginsDir, entry.name), {
      force: true,
      recursive: true,
    });
    removed.push(entry.name);
  }
  return removed;
}

/**
 * Block the calling thread without spinning.
 * @param {number} ms - milliseconds to wait
 * @returns {void}
 */
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * The pid recorded in a lock file, or null when it cannot be read.
 * @param {string} file - lock file path
 * @returns {number | null} the owner pid
 */
function lockOwner(file) {
  try {
    const pid = Number(fs.readFileSync(file, "utf8").trim());
    return Number.isSafeInteger(pid) ? pid : null;
  } catch {
    return null;
  }
}

/**
 * Take the checkout-wide publish lock, clearing one left by a dead build.
 *
 * The lock file is complete before it exists under its real name: the pid is
 * written to a private file and hard-linked into place, and the link fails if
 * a lock is already there. So no reader ever sees an empty lock and mistakes
 * it for a stale one.
 * @param {string} lockFile - lock file path
 * @param {number} waitMs - how long to wait for another holder
 * @param {(pid: number, signal: number) => unknown} probe - `process.kill`
 * @returns {void}
 */
function acquireLock(lockFile, waitMs, probe) {
  const mine = `${lockFile}.${process.pid}`;
  fs.writeFileSync(mine, `${process.pid}\n`);
  const deadline = Date.now() + waitMs;
  try {
    for (;;) {
      try {
        fs.linkSync(mine, lockFile);
        return;
      } catch (error) {
        if (/** @type {NodeJS.ErrnoException} */ (error).code !== "EEXIST") {
          throw error;
        }
      }
      const owner = lockOwner(lockFile);
      if (owner !== null && ownerGone(owner, probe)) {
        clearDeadLock(lockFile, owner);
        continue;
      }
      if (Date.now() >= deadline) {
        throw new Error(
          `publish-plugin-tree: another build (pid ${owner ?? "unknown"}) has held ${lockFile} for over ${waitMs} ms`
        );
      }
      sleepSync(LOCK_POLL_MS);
    }
  } finally {
    fs.rmSync(mine, { force: true });
  }
}

/**
 * Remove a lock whose owner is gone, without removing one a live build has
 * taken since. The lock is first moved to a private name, so two builds
 * clearing the same dead lock cannot both act on it; if what was moved turns
 * out to belong to someone else, it is linked back.
 * @param {string} lockFile - lock file path
 * @param {number} deadOwner - the pid confirmed gone
 * @returns {void}
 */
function clearDeadLock(lockFile, deadOwner) {
  const claimed = `${lockFile}.stale.${process.pid}`;
  try {
    fs.renameSync(lockFile, claimed);
  } catch {
    return;
  }
  if (lockOwner(claimed) !== deadOwner) {
    try {
      fs.linkSync(claimed, lockFile);
    } catch {
      // A new holder already exists; the moved lock is not needed.
    }
  }
  fs.rmSync(claimed, { force: true });
}

/**
 * Run `work` while holding the checkout-wide publish lock.
 *
 * Two builds in one checkout must not publish at once: one build's retirement
 * pass, decided from its own listing, would delete a file the other had just
 * placed, leaving a changed file whose new import is missing. The lock covers
 * listing, placement and retirement together, and is released on every exit
 * path, including a thrown error and SIGINT or SIGTERM.
 * @template T
 * @param {string} pluginsDir - directory holding the live trees
 * @param {() => T} work - the publication to perform
 * @param {{ waitMs?: number, probe?: (pid: number, signal: number) => unknown }} [options] - lock wait and liveness probe
 * @returns {T} what `work` returned
 */
export function withPublishLock(pluginsDir, work, options = {}) {
  const lockFile = path.join(pluginsDir, LOCK_NAME);
  const waitMs = options.waitMs ?? DEFAULT_LOCK_WAIT_MS;
  fs.mkdirSync(pluginsDir, { recursive: true });
  acquireLock(lockFile, waitMs, options.probe ?? process.kill);
  const release = () => {
    if (lockOwner(lockFile) === process.pid)
      fs.rmSync(lockFile, { force: true });
  };
  const onSignal = (/** @type {NodeJS.Signals} */ signal) => {
    release();
    process.exit(signal === "SIGINT" ? 130 : 143);
  };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);
  try {
    return work();
  } finally {
    process.removeListener("SIGINT", onSignal);
    process.removeListener("SIGTERM", onSignal);
    release();
  }
}

/**
 * Parse the command line: staged/live pairs, `--retire <live>` entries, and
 * `--clear-stale <plugins-dir>` as a mode of its own.
 * @param {readonly string[]} args - arguments after the script path
 * @returns {{ clearStale?: string, pairs: Array<[string, string]>, retire: string[] } | null} the plan, or null when malformed
 */
function parseArgs(args) {
  if (args[0] === "--clear-stale") {
    return args.length === 2
      ? { clearStale: path.resolve(args[1]), pairs: [], retire: [] }
      : null;
  }
  const pairs = [];
  const retire = [];
  const positional = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--retire") {
      const target = args[index + 1];
      if (!target) return null;
      retire.push(path.resolve(target));
      index += 1;
    } else {
      positional.push(path.resolve(args[index]));
    }
  }
  if (positional.length % 2 !== 0) return null;
  for (let index = 0; index < positional.length; index += 2) {
    pairs.push([positional[index], positional[index + 1]]);
  }
  return pairs.length + retire.length > 0 ? { pairs, retire } : null;
}

/**
 * Publish and retire every named tree under one lock. All live trees must
 * share one parent, which is the checkout's plugins directory.
 * @param {Array<[string, string]>} pairs - staged and live directories
 * @param {string[]} retire - live trees whose source is gone
 * @returns {void}
 */
function publishAll(pairs, retire) {
  const parents = new Set([
    ...pairs.map(([, live]) => path.dirname(live)),
    ...retire.map(live => path.dirname(live)),
  ]);
  if (parents.size !== 1) {
    throw new Error(
      "publish-plugin-tree: every live tree must share one plugins directory"
    );
  }
  const waitMs = Number(process.env.LISA_PLUGIN_PUBLISH_LOCK_WAIT_MS);
  withPublishLock(
    [...parents][0],
    () => {
      for (const [staged, live] of pairs) publishPluginTree(staged, live);
      for (const live of retire) {
        fs.rmSync(live, { force: true, recursive: true });
      }
    },
    Number.isFinite(waitMs) && waitMs >= 0 ? { waitMs } : {}
  );
}

if (invokedAsScript(import.meta.url)) {
  const plan = parseArgs(process.argv.slice(2));
  if (plan === null) {
    console.error(
      "Usage: node scripts/lib/publish-plugin-tree.mjs <staged-dir> <live-dir> [...] [--retire <live-dir>]...\n" +
        "       node scripts/lib/publish-plugin-tree.mjs --clear-stale <plugins-dir>"
    );
    process.exit(2);
  }
  if (plan.clearStale) {
    clearStaleStages(plan.clearStale);
  } else {
    publishAll(plan.pairs, plan.retire);
  }
}
