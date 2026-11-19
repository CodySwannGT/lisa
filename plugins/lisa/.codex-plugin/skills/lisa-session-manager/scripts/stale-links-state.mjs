/**
 * The session manager's stale-link state across cycles (CodySwannGT/lisa#5065),
 * kept in its state directory:
 *
 * - `stale-links-pending.json`: comments owed for confirmed removals, until
 *   they post.
 * - `stale-links-failures.json`: items whose planned removals did not
 *   happen, so the planner puts them after every other candidate.
 *
 * Both are replaced atomically. Only a missing file reads as empty. Every
 * read-change-write of either file runs inside {@link withStateLock}, the
 * ledger's cross-process lock, so two overlapping commands on one project
 * root never drop each other's owed comment or failure count.
 * @module session-manager/stale-links-state
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

import { CliError } from "./cli-runtime.mjs";
import { withLedgerLock } from "./ledger-lock.mjs";

/**
 * @param {string} root - Project root
 * @param {string} name - File name
 * @returns {string} The state file
 */
const stateFile = (root, name) =>
  path.join(root, ".lisa", "session-manager", name);

/**
 * Run one whole read-change-write of the stale-link state under the
 * project root's lock.
 * @template T
 * @param {string} root - Project root
 * @param {() => T | Promise<T>} operation - Reads, changes and writes
 * @returns {Promise<T>}
 */
export async function withStateLock(root, operation) {
  const target = stateFile(root, "stale-links-state");
  mkdirSync(path.dirname(target), { recursive: true });
  return withLedgerLock(target, undefined, async () => operation());
}

/**
 * @param {string} root - Project root
 * @returns {string} The pending-comments file
 */
export const pendingPath = root => stateFile(root, "stale-links-pending.json");

/**
 * @param {string} root - Project root
 * @returns {string} The removal-failures file
 */
export const failuresPath = root =>
  stateFile(root, "stale-links-failures.json");

/**
 * Read one state file.
 * @param {string} file
 * @param {(parsed: unknown) => boolean} valid - Shape check
 * @param {unknown} empty - Value when the file does not exist yet
 * @returns {any}
 */
function readState(file, valid, empty) {
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    if (!valid(parsed)) throw new Error("unexpected shape");
    return parsed;
  } catch (error) {
    // probe-direction: fail-closed — only a missing file reads as empty; an
    // unreadable or corrupt one throws, so no owed comment or failure count
    // is silently dropped.
    if (error?.code === "ENOENT") return empty;
    throw new CliError(`${file}: ${error.message}`, 1);
  }
}

/**
 * Replace one state file atomically.
 * @param {string} file
 * @param {unknown} value
 * @returns {void}
 */
function writeState(file, value) {
  mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(temp, file);
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
const isRecord = value =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

/**
 * @param {string} root
 * @returns {import("../../../scripts/stale-blocker-pending.mjs").PendingComment[]}
 */
export const readPending = root =>
  readState(pendingPath(root), Array.isArray, []);

/**
 * @param {string} root
 * @param {readonly object[]} pending
 * @returns {void}
 */
export const writePending = (root, pending) =>
  writeState(pendingPath(root), pending);

/**
 * @param {string} root
 * @returns {import("../../../scripts/stale-blocker-pending.mjs").RemovalFailures}
 */
export const readFailures = root => readState(failuresPath(root), isRecord, {});

/**
 * @param {string} root
 * @param {object} failures
 * @returns {void}
 */
export const writeFailures = (root, failures) =>
  writeState(failuresPath(root), failures);
