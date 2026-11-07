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
 * {@link LISA_PROTECTED_TEMP_NAMES}, `lisa-preserve-*` and `lisa-backup-*` are
 * never swept, whatever their age: they are persistent state, live run roots,
 * patch backups of an agent's work, or `lisa apply`'s rollback copy. Nor is an
 * entry another user owns, a directory group or other can open, or a file
 * group or other can write: in a shared temp directory a Lisa-looking name
 * proves nothing about who made it. And the whole temp half is refused when
 * the root is `/`, the home directory, or an ancestor of the home or working
 * directory — a misconfigured `TMPDIR` must not become a sweep of real files. A folder holding a `.git` entry is kept too,
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
import { lstat, opendir, realpath, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
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

/**
 * Prefixes that are never swept: `lisa-preserve-*` holds patch backups of an
 * agent's work, and `lisa-backup-*` is the rollback copy `lisa apply` takes
 * (`src/transaction/backup.ts`).
 */
export const LISA_PROTECTED_TEMP_PREFIXES = Object.freeze([
  "lisa-preserve-",
  "lisa-backup-",
]);

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
 * Whether this user alone could have created and filled an entry.
 *
 * A Lisa-looking name in a shared temp directory proves nothing: another user
 * can create `lisa-anything`, or leave a group- or world-writable one for this
 * user's sweep to recurse into. So an entry is removable only when this user
 * owns it and nobody else could have written into it — a directory closed to
 * group and other (`mkdtemp` makes them 0700), a file not writable by group or
 * other. Skipped where there is no uid to compare (Windows).
 * @param {import("node:fs").Stats} stats - The entry's own lstat.
 * @param {number | undefined} uid - This user's id.
 * @returns {boolean} True when the entry is safe to remove.
 */
function isOwnedAndPrivate(stats, uid) {
  if (uid === undefined) return true;
  if (stats.uid !== uid) return false;
  const openBits = stats.isDirectory() ? 0o077 : 0o022;
  return (stats.mode & openBits) === 0;
}

/**
 * Decide what to do with one Lisa-named entry.
 * @param {string} entry - Absolute path, a direct child of the root.
 * @param {number} cutoffMs - Entries modified before this are stale.
 * @param {number | undefined} uid - This user's id.
 * @returns {Promise<"remove" | "keep" | "unsafe">} The verdict.
 */
async function verdictFor(entry, cutoffMs, uid) {
  const stats = await lstat(entry);
  if (stats.isSymbolicLink() || stats.mtimeMs >= cutoffMs) return "keep";
  if (!isOwnedAndPrivate(stats, uid)) return "unsafe";
  if (stats.isDirectory() && (await isGitCheckout(entry))) return "keep";
  return "remove";
}

/**
 * Canonical spelling of a path, or its resolved spelling when it cannot be read.
 * @param {string} target - Path.
 * @returns {Promise<string>} Absolute path.
 */
async function canonical(target) {
  try {
    return await realpath(target);
  } catch {
    return path.resolve(target);
  }
}

/**
 * Whether `outer` is `inner` or one of its ancestors.
 * @param {string} outer - Candidate ancestor.
 * @param {string} inner - Candidate descendant.
 * @returns {boolean} True when `inner` lies at or below `outer`.
 */
function contains(outer, inner) {
  const relative = path.relative(outer, inner);
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

/**
 * Why a root must not be swept, or null when it may be.
 *
 * A misconfigured `TMPDIR` (`/`, `$HOME`, a checkout's parent) would otherwise
 * turn a temp sweep into a sweep of the user's own files.
 * @param {string} root - Proposed sweep root.
 * @param {{home: string, cwd: string}} places - The home and working directories.
 * @returns {Promise<string | null>} An operator-readable refusal, or null.
 */
async function rootRefusal(root, { home, cwd }) {
  const resolved = await canonical(root);
  const why = [
    [path.dirname(resolved) === resolved, "it is the filesystem root"],
    [
      contains(resolved, await canonical(home)),
      "it is or contains the home directory",
    ],
    [
      contains(resolved, await canonical(cwd)),
      "it contains the working directory",
    ],
  ].find(([refused]) => refused);
  return why ? `refusing to sweep ${root}: ${why[1]}` : null;
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
 * @param {number | undefined} uid - This user's id.
 * @param {{skippedUnsafe: number, errors: string[]}} tally - Collector.
 * @returns {Promise<string[]>} Absolute paths to remove.
 */
async function staleEntries(root, cutoffMs, uid, tally) {
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
      const verdict = await verdictFor(entry, cutoffMs, uid);
      if (verdict === "remove") stale.push(entry);
      if (verdict === "unsafe") tally.skippedUnsafe += 1;
    } catch (error) {
      if (error?.code !== "ENOENT")
        tally.errors.push(`${entry}: ${error?.message ?? error}`);
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
 * @param {number} [options.uid] - This user's id; defaults to `process.getuid()`.
 * @param {string} [options.home] - Home directory; defaults to `os.homedir()`.
 * @param {string} [options.cwd] - Working directory; defaults to `process.cwd()`.
 * @returns {Promise<{removed: string[], skippedUnsafe: number, errors: string[]}>} What was removed.
 */
export async function sweepTemp({
  root,
  maxAgeHours,
  now,
  dryRun,
  uid = process.getuid?.(),
  home = homedir(),
  cwd = process.cwd(),
}) {
  const refusal = await rootRefusal(root, { home, cwd });
  if (refusal) return { removed: [], skippedUnsafe: 0, errors: [refusal] };
  const tally = { skippedUnsafe: 0, errors: [] };
  let stale;
  try {
    stale = await staleEntries(root, now - maxAgeHours * HOUR_MS, uid, tally);
  } catch (error) {
    return {
      removed: [],
      skippedUnsafe: 0,
      errors: [`cannot read ${root}: ${error?.message ?? error}`],
    };
  }
  const { skippedUnsafe, errors } = tally;
  if (dryRun) return { removed: stale, skippedUnsafe, errors };
  const removed = [];
  await inPool(stale, REMOVE_CONCURRENCY, async entry => {
    try {
      await rm(entry, { recursive: true, force: true });
      removed.push(entry);
    } catch (error) {
      errors.push(`could not remove ${entry}: ${error?.message ?? error}`);
    }
  });
  return { removed: removed.sort(), skippedUnsafe, errors };
}

/**
 * Run the whole sweep: stale temp entries, then orphaned test processes.
 * @param {object} [options] - Options; every one has a default.
 * @param {string} [options.root] - Temp root, defaults to `os.tmpdir()`.
 * @param {number} [options.maxAgeHours] - Age limit, defaults to 24.
 * @param {number} [options.now] - Clock for ages, defaults to `Date.now()`.
 * @param {boolean} [options.dryRun] - Select but change nothing.
 * @param {number} [options.uid] - This user's id, for the ownership check.
 * @param {string} [options.home] - Home directory, for the root refusal.
 * @param {string} [options.cwd] - Working directory, for the root refusal.
 * @param {false | object} [options.orphans] - `false` to skip processes, or
 *   seams for `sweepOrphans`.
 * @returns {Promise<{removed: string[], skippedUnsafe: number, killed: number[], errors: string[], dryRun: boolean, durationMs: number}>} Result.
 */
export async function sweep(options = {}) {
  const started = performance.now();
  const {
    root = tmpdir(),
    maxAgeHours = DEFAULT_MAX_AGE_HOURS,
    now = Date.now(),
    dryRun = false,
    orphans = {},
    ...identity
  } = options;
  const temp = await sweepTemp({ root, maxAgeHours, now, dryRun, ...identity });
  const processes =
    orphans === false
      ? { killed: [], errors: [] }
      : await sweepOrphans({ ...orphans, dryRun });
  return {
    removed: temp.removed,
    skippedUnsafe: temp.skippedUnsafe,
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
  const unsafe = result.skippedUnsafe ?? 0;
  const kept =
    unsafe > 0
      ? `; kept ${counted(unsafe, "entry", "entries")} not private to this user`
      : "";
  const line = `🧹 ${verb} ${dirs}, ${procs} (${Math.round(result.durationMs)} ms)${kept}`;
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
