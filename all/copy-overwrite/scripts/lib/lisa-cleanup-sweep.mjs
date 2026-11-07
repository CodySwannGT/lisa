#!/usr/bin/env node
// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/**
 * lisa-cleanup-sweep — one cheap sweep at the start of a test run or push that
 * removes stale Lisa temp entries and kills orphaned test processes
 * (CodySwannGT/lisa#4597).
 *
 * Leftover temp folders and orphaned fixture processes are real (#2902 found
 * 227 orphaned process trees; #3206 found unowned temp output piling up), but
 * preventing every leak per test is what cost about a quarter of unit time.
 * Sweeping once per run keeps the machine clean for a fraction of that.
 *
 *     node scripts/lib/lisa-cleanup-sweep.mjs [--dry-run] [--json] [--max-age-hours N]
 *
 * prints one line, e.g. `🧹 swept 37 stale temp dirs, 2 orphaned test processes
 * (412 ms)`, or with `--json` one JSON object. It exits 0 even when something
 * went wrong — errors are reported, never raised — because a sweep must never
 * fail the run it precedes.
 *
 * ## What counts as a stale Lisa temp entry
 *
 * A TOP-LEVEL entry of `os.tmpdir()` (no recursion while selecting) whose name
 * starts with a {@link LISA_OWNED_TEMP_PREFIXES} prefix, is not protected, is
 * not a symlink, is not a git checkout, and whose own mtime is older than the
 * age limit (24 h by default). Files count as well as folders: `mktemp`
 * without `-d` leaves files such as `lisa-pushed-refs.XXXXXXXX`.
 *
 * The ticket pointed at four prefix sources: `scratchPrefixes` in
 * `vitest.config.local.ts`, `LISA_TEST_SCRATCH_PREFIXES` in the mutation
 * scripts, the paths `check-orphan-test-processes.mjs` matches, and the
 * `mkdtemp` prefixes under `tests/`. Only the `lisa` ones are used, on
 * purpose. The generic ones (`node-`, `worker-`, `state-`, `review-`, `e2e-`,
 * `wiki-`, …) name entries INSIDE a per-run scratch root
 * (`$TMPDIR/lisa-scratch/run-*`), where the scratch authority owns them. At the
 * top of a shared temp directory those same names belong to anything —
 * another tool, another user's build — so matching them there would delete
 * what Lisa does not own. Every Lisa `mkdtemp`/`mktemp` that lands at the top
 * level is spelled `lisa-…` or `lisa.…`.
 *
 * {@link LISA_PROTECTED_TEMP_NAMES} and `lisa-preserve-*` are never swept,
 * whatever their age: they are persistent state, live run roots, or patch
 * backups of an agent's work. A folder holding a `.git` entry is kept too,
 * because agents put worktrees in the temp directory and a directory's own
 * mtime says nothing about edits deeper inside it.
 *
 * ## Once per run
 *
 * The gate runner sweeps at `--moment=push` and then starts `test:*:push`
 * scripts, each of which starts `lisa-test-run`; Lisa's own suite also starts
 * nested `lisa-test-run` fixtures. Whoever sweeps first sets
 * {@link SWEPT_ENV} in its environment, everything it starts inherits it, and
 * an entry point that sees it skips the sweep. A nested `lisa-test-run` still
 * sets its own owner marker.
 * @module scripts/lib/lisa-cleanup-sweep
 */
import { lstat, opendir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { boundedSpawnSync, isChildTimeout } from "./bounded-spawn.mjs";
import { invokedAsScript } from "./invoked-as-script.mjs";
import { sweepOrphans } from "./lisa-cleanup-sweep-processes.mjs";

/** Name prefixes Lisa uses for top-level temp entries. */
export const LISA_OWNED_TEMP_PREFIXES = Object.freeze(["lisa-", "lisa."]);

/**
 * Lisa-prefixed top-level names that are never swept, whatever their age.
 *
 * `lisa-scratch` holds every live run root; `lisa-kill-marks` is the
 * cross-run kill record (`kill-marks.mjs`); `lisa-team-enforce` and
 * `lisa-verification-gate` are hook state directories.
 */
export const LISA_PROTECTED_TEMP_NAMES = Object.freeze([
  "lisa-scratch",
  "lisa-kill-marks",
  "lisa-team-enforce",
  "lisa-verification-gate",
]);

/** Prefixes that are never swept: patch backups of an agent's work. */
export const LISA_PROTECTED_TEMP_PREFIXES = Object.freeze(["lisa-preserve-"]);

/** Set by whoever swept first; everything it starts skips the sweep. */
export const SWEPT_ENV = "LISA_CLEANUP_SWEPT";

/** Default age, in hours, past which a Lisa temp entry is stale. */
export const DEFAULT_MAX_AGE_HOURS = 24;

/** Concurrent removals; enough to hide latency without flooding the disk. */
const REMOVE_CONCURRENCY = 16;

/** Deadline for the launcher's child; the sweep should take seconds. */
const LAUNCH_TIMEOUT_MS = 15_000;

const HOUR_MS = 60 * 60 * 1000;
const SELF = fileURLToPath(import.meta.url);
const USAGE =
  "usage: lisa-cleanup-sweep.mjs [--dry-run] [--json] [--max-age-hours N]";

/**
 * Whether a top-level temp name is Lisa-owned and sweepable.
 * @param {string} name - Entry name.
 * @returns {boolean} True for an unprotected Lisa-prefixed name.
 */
export function isLisaOwnedTempName(name) {
  if (!LISA_OWNED_TEMP_PREFIXES.some(prefix => name.startsWith(prefix)))
    return false;
  if (LISA_PROTECTED_TEMP_NAMES.includes(name)) return false;
  return !LISA_PROTECTED_TEMP_PREFIXES.some(prefix => name.startsWith(prefix));
}

/**
 * Whether a stale candidate directory is a git checkout.
 * @param {string} entry - Absolute path of a directory.
 * @returns {Promise<boolean>} True when it holds a `.git` entry.
 */
async function isGitCheckout(entry) {
  try {
    await lstat(path.join(entry, ".git"));
    return true;
  } catch (error) {
    // Anything but "absent" keeps the entry: an unknown answer never deletes.
    return error?.code !== "ENOENT";
  }
}

/**
 * Decide whether one Lisa-named entry should be removed.
 * @param {string} entry - Absolute path, a direct child of the root.
 * @param {number} cutoffMs - Entries modified before this are stale.
 * @returns {Promise<boolean>} True when it is a stale, non-symlink, non-checkout entry.
 */
async function isStale(entry, cutoffMs) {
  const stats = await lstat(entry);
  if (stats.isSymbolicLink() || stats.mtimeMs >= cutoffMs) return false;
  return !(stats.isDirectory() && (await isGitCheckout(entry)));
}

/**
 * Run `worker` over `items` with at most `limit` in flight.
 * @template T
 * @param {readonly T[]} items - Work items.
 * @param {number} limit - Maximum concurrency.
 * @param {(item: T) => Promise<void>} worker - Async worker.
 * @returns {Promise<void>} Resolves when every item is done.
 */
async function inPool(items, limit, worker) {
  const queue = [...items];
  const lanes = Array.from(
    { length: Math.min(limit, queue.length) },
    async () => {
      for (let item = queue.shift(); item !== undefined; item = queue.shift()) {
        await worker(item);
      }
    }
  );
  await Promise.all(lanes);
}

/**
 * Select the stale Lisa entries at the top level of `root`.
 * @param {string} root - Temp root.
 * @param {number} cutoffMs - Staleness cutoff.
 * @param {string[]} errors - Collector.
 * @returns {Promise<string[]>} Absolute paths to remove.
 */
async function staleEntries(root, cutoffMs, errors) {
  const resolvedRoot = path.resolve(root);
  const candidates = [];
  for await (const dirent of await opendir(resolvedRoot)) {
    if (dirent.isSymbolicLink() || !isLisaOwnedTempName(dirent.name)) continue;
    const entry = path.join(resolvedRoot, dirent.name);
    if (path.dirname(entry) === resolvedRoot) candidates.push(entry);
  }
  const stale = [];
  await inPool(candidates, REMOVE_CONCURRENCY, async entry => {
    try {
      if (await isStale(entry, cutoffMs)) stale.push(entry);
    } catch (error) {
      if (error?.code !== "ENOENT")
        errors.push(`${entry}: ${error?.message ?? error}`);
    }
  });
  return stale.sort();
}

/**
 * Remove stale Lisa temp entries from the top level of `root`.
 * @param {object} options - Sweep options.
 * @param {string} options.root - Temp root.
 * @param {number} options.maxAgeHours - Age limit.
 * @param {number} options.now - Clock, epoch milliseconds.
 * @param {boolean} options.dryRun - Select but remove nothing.
 * @returns {Promise<{removed: string[], errors: string[]}>} What was removed.
 */
export async function sweepTemp({ root, maxAgeHours, now, dryRun }) {
  const errors = [];
  let stale;
  try {
    stale = await staleEntries(root, now - maxAgeHours * HOUR_MS, errors);
  } catch (error) {
    return {
      removed: [],
      errors: [`cannot read ${root}: ${error?.message ?? error}`],
    };
  }
  if (dryRun) return { removed: stale, errors };
  const removed = [];
  await inPool(stale, REMOVE_CONCURRENCY, async entry => {
    try {
      await rm(entry, { recursive: true, force: true });
      removed.push(entry);
    } catch (error) {
      errors.push(`could not remove ${entry}: ${error?.message ?? error}`);
    }
  });
  return { removed: removed.sort(), errors };
}

/**
 * Run the whole sweep: stale temp entries, then orphaned test processes.
 * @param {object} [options] - Options; every one has a default.
 * @param {string} [options.root] - Temp root, defaults to `os.tmpdir()`.
 * @param {number} [options.maxAgeHours] - Age limit, defaults to 24.
 * @param {number} [options.now] - Clock for ages, defaults to `Date.now()`.
 * @param {boolean} [options.dryRun] - Select but change nothing.
 * @param {false | object} [options.orphans] - `false` to skip processes, or
 *   seams for `sweepOrphans`.
 * @returns {Promise<{removed: string[], killed: number[], errors: string[], dryRun: boolean, durationMs: number}>} Result.
 */
export async function sweep(options = {}) {
  const started = performance.now();
  const {
    root = tmpdir(),
    maxAgeHours = DEFAULT_MAX_AGE_HOURS,
    now = Date.now(),
    dryRun = false,
    orphans = {},
  } = options;
  const temp = await sweepTemp({ root, maxAgeHours, now, dryRun });
  const processes =
    orphans === false
      ? { killed: [], errors: [] }
      : await sweepOrphans({ ...orphans, dryRun });
  return {
    removed: temp.removed,
    killed: processes.killed,
    errors: [...temp.errors, ...processes.errors],
    dryRun,
    durationMs: Math.round(performance.now() - started),
  };
}

/**
 * Pluralise a count.
 * @param {number} count - How many.
 * @param {string} one - Singular noun phrase.
 * @param {string} many - Plural noun phrase.
 * @returns {string} e.g. `2 orphaned test processes`.
 */
function counted(count, one, many) {
  return `${count} ${count === 1 ? one : many}`;
}

/**
 * The one summary line a sweep prints.
 * @param {{removed: string[], killed: number[], errors: string[], dryRun: boolean, durationMs: number}} result - Sweep result.
 * @returns {string} A single line, no trailing newline.
 */
export function formatSummary(result) {
  const verb = result.dryRun ? "would sweep" : "swept";
  const dirs = counted(
    result.removed.length,
    "stale temp dir",
    "stale temp dirs"
  );
  const procs = counted(
    result.killed.length,
    "orphaned test process",
    "orphaned test processes"
  );
  const line = `🧹 ${verb} ${dirs}, ${procs} (${Math.round(result.durationMs)} ms)`;
  if (result.errors.length === 0) return line;
  const first = String(result.errors[0]).replace(/\s+/gu, " ");
  return `${line}; ${counted(result.errors.length, "error", "errors")}, first: ${first}`;
}

/**
 * Parse CLI flags.
 * @param {readonly string[]} argv - Arguments after the script path.
 * @returns {{dryRun: boolean, json: boolean, maxAgeHours: number}} Parsed flags.
 * @throws {Error} On an unknown flag or an invalid age.
 */
export function parseSweepArgs(argv) {
  const parsed = {
    dryRun: false,
    json: false,
    maxAgeHours: DEFAULT_MAX_AGE_HOURS,
  };
  const args = [...argv];
  for (let arg = args.shift(); arg !== undefined; arg = args.shift()) {
    if (arg === "--dry-run") parsed.dryRun = true;
    else if (arg === "--json") parsed.json = true;
    else if (arg === "--max-age-hours" || arg.startsWith("--max-age-hours=")) {
      const raw = arg.includes("=")
        ? arg.slice(arg.indexOf("=") + 1)
        : args.shift();
      const hours = Number(raw);
      if (
        raw === undefined ||
        raw === "" ||
        !Number.isFinite(hours) ||
        hours < 0
      ) {
        throw new Error(
          `--max-age-hours needs a non-negative number, got ${raw}`
        );
      }
      parsed.maxAgeHours = hours;
    } else throw new Error(`unknown flag ${arg}`);
  }
  return parsed;
}

/**
 * CLI entry point.
 * @param {readonly string[]} [argv] - Arguments after the script path.
 * @param {object} [seams] - Test seams.
 * @param {object} [seams.sweepOptions] - Extra options merged into `sweep`.
 * @param {(line: string) => void} [seams.write] - Output sink.
 * @returns {Promise<number>} 0, or 2 on a usage error.
 */
export async function main(argv = process.argv.slice(2), seams = {}) {
  const write = seams.write ?? (line => process.stdout.write(`${line}\n`));
  let flags;
  try {
    flags = parseSweepArgs(argv);
  } catch (error) {
    write(`lisa-cleanup-sweep: ${error.message}\n${USAGE}`);
    return 2;
  }
  const result = await sweep({
    dryRun: flags.dryRun,
    maxAgeHours: flags.maxAgeHours,
    ...seams.sweepOptions,
  });
  write(flags.json ? JSON.stringify(result) : formatSummary(result));
  return 0;
}

/**
 * Sweep once from a synchronous caller (the gate runner), never failing it.
 *
 * Runs this file as a bounded child because the caller cannot await, forwards
 * its one summary line, and on any failure prints one line and returns. Skips
 * entirely when {@link SWEPT_ENV} is already set, and sets it afterwards so
 * everything the caller starts skips too.
 * @param {object} [seams] - Test seams.
 * @param {Record<string, string | undefined>} [seams.env] - Environment, defaults to `process.env`.
 * @param {typeof boundedSpawnSync} [seams.spawn] - Child launcher.
 * @param {(line: string) => void} [seams.log] - Output sink.
 * @returns {void}
 */
export function runStartOfRunSweep(seams = {}) {
  const {
    env = process.env,
    spawn = boundedSpawnSync,
    log = console.log,
  } = seams;
  if (env[SWEPT_ENV]) return;
  env[SWEPT_ENV] = "1";
  const didNotFinish = why =>
    log(`🧹 cleanup sweep did not finish (${why}); continuing`);
  try {
    const child = spawn(process.execPath, [SELF], {
      encoding: "utf8",
      env: { ...env },
      stdio: ["ignore", "pipe", "pipe"],
      timeout: LAUNCH_TIMEOUT_MS,
    });
    const line = String(child.stdout ?? "")
      .trim()
      .split("\n")
      .pop();
    if (child.error) didNotFinish(child.error.message);
    else if (child.status !== 0 || !line) didNotFinish(`exit ${child.status}`);
    else log(line);
  } catch (error) {
    didNotFinish(
      isChildTimeout(error)
        ? `timed out after ${LAUNCH_TIMEOUT_MS / 1000} s`
        : error?.message
    );
  }
}

if (invokedAsScript(import.meta.url)) {
  main().then(
    code => process.exit(code),
    error => {
      console.log(`🧹 cleanup sweep failed: ${error?.message ?? error}`);
      process.exit(0);
    }
  );
}
