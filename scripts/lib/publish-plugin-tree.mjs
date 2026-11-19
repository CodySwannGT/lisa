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

if (invokedAsScript(import.meta.url)) {
  const pairs = process.argv.slice(2);
  if (pairs.length === 0 || pairs.length % 2 !== 0) {
    console.error(
      "Usage: node scripts/lib/publish-plugin-tree.mjs <staged-dir> <live-dir> [<staged-dir> <live-dir>...]"
    );
    process.exit(2);
  }
  for (let index = 0; index < pairs.length; index += 2) {
    publishPluginTree(
      path.resolve(pairs[index]),
      path.resolve(pairs[index + 1])
    );
  }
}
