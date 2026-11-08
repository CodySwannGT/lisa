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
 * the root is `/`, the home directory, or an ancestor of the home directory —
 * a misconfigured `TMPDIR` must not become a sweep of real files. A root that
 * merely contains the working directory is swept, except for the one
 * top-level entry that holds it. A git checkout, or a folder whose direct
 * child is one, is kept. A folder holding a `.git` entry is kept too,
 * because agents put worktrees in the temp directory and a directory's own
 * mtime says nothing about edits deeper inside it.
 *
 * ## Once per run
 *
 * The gate runner sweeps at `--moment=push` and then starts `test:*:push`
 * scripts, each of which starts `lisa-test-run`; Lisa's own suite also starts
 * nested `lisa-test-run` fixtures. Whoever sweeps first writes its own
 * `<pid>:<start>` into {@link SWEPT_ENV}, everything it starts inherits it, and
 * an entry point skips the sweep — saying so in one line — only while that
 * exact process is still alive. A stale or copied value cannot disable the
 * sweep for good. A nested `lisa-test-run` still sets its own owner marker.
 * @module scripts/lib/lisa-cleanup-sweep
 */
import { lstat, opendir, realpath, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { boundedSpawnSync, isChildTimeout } from "./bounded-spawn.mjs";
import { invokedAsScript } from "./invoked-as-script.mjs";
import {
  liveSweeper,
  ownerMarkerFor,
  sweepOrphans,
} from "./lisa-cleanup-sweep-processes.mjs";

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

/**
 * Set by whoever swept first to its own `<pid>:<start>`; everything it starts
 * skips the sweep while that process is still alive with that start time.
 */
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
  "usage: lisa-cleanup-sweep.mjs [--dry-run] [--json] [--no-processes] [--max-age-hours N]";

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
 * Whether `directory` holds a `.git` entry. Any answer but "absent" is yes.
 * @param {string} directory - Absolute path.
 * @returns {Promise<boolean>} True unless `.git` is provably absent.
 */
async function holdsGit(directory) {
  try {
    await lstat(path.join(directory, ".git"));
    return true;
  } catch (error) {
    return error?.code !== "ENOENT";
  }
}

/**
 * Whether a stale candidate directory is, or directly holds, a git checkout.
 *
 * Agents keep worktrees in the temp directory, sometimes one level down
 * (`lisa-<n>-workspace/repo`), and a folder's own mtime says nothing about
 * edits deeper inside it. Unknown — an unreadable folder or child — keeps it.
 * @param {string} entry - Absolute path of a directory.
 * @returns {Promise<boolean>} True when it must be kept as a checkout.
 */
async function isGitCheckout(entry) {
  if (await holdsGit(entry)) return true;
  try {
    const children = [];
    for await (const child of await opendir(entry)) {
      if (child.isDirectory()) children.push(path.join(entry, child.name));
    }
    const verdicts = await Promise.all(children.map(holdsGit));
    return verdicts.includes(true);
  } catch {
    return true;
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
 * A misconfigured `TMPDIR` (`/`, `$HOME`, `$HOME`'s parent) would otherwise
 * turn a temp sweep into a sweep of the user's own files.
 * @param {string} resolved - Canonical sweep root.
 * @param {string} home - Canonical home directory.
 * @returns {string | null} The refusal reason, or null.
 */
function rootRefusal(resolved, home) {
  if (path.dirname(resolved) === resolved) return "it is the filesystem root";
  if (contains(resolved, home)) return "it is or contains the home directory";
  return null;
}

/**
 * The top-level entry name that holds the working directory, if any.
 *
 * A temp root may legitimately contain the cwd — an agent worktree under
 * `/tmp/lisa-…/` — and the sweep must never delete the folder it runs in.
 * @param {string} resolved - Canonical sweep root.
 * @param {string} cwd - Canonical working directory.
 * @returns {string | null} That entry's name, or null.
 */
function entryHolding(resolved, cwd) {
  if (!contains(resolved, cwd) || resolved === cwd) return null;
  return path.relative(resolved, cwd).split(path.sep)[0] ?? null;
}

/**
 * Map `worker` over `items` with at most `limit` in flight, in order.
 * @template T, R
 * @param {readonly T[]} items - Work items.
 * @param {number} limit - Maximum concurrency.
 * @param {(item: T) => Promise<R>} worker - Async worker; must not throw.
 * @returns {Promise<R[]>} Results, index-aligned with `items`.
 */
async function mapPool(items, limit, worker) {
  const lanes = Math.min(limit, items.length);
  const laneResults = await Promise.all(
    Array.from({ length: lanes }, async (_, lane) => {
      const mine = [];
      for (let index = lane; index < items.length; index += lanes) {
        mine.push([index, await worker(items[index])]);
      }
      return mine;
    })
  );
  return laneResults
    .flat()
    .sort(([left], [right]) => left - right)
    .map(([, result]) => result);
}

/**
 * Classify one Lisa-named entry, turning a failure into a reported verdict.
 * @param {string} entry - Absolute path.
 * @param {number} cutoffMs - Staleness cutoff.
 * @param {number | undefined} uid - This user's id.
 * @returns {Promise<{entry: string, verdict: string, error?: string}>} Verdict.
 */
async function classify(entry, cutoffMs, uid) {
  try {
    return { entry, verdict: await verdictFor(entry, cutoffMs, uid) };
  } catch (error) {
    // An entry that vanished mid-sweep is simply gone; anything else is kept
    // and reported.
    if (error?.code === "ENOENT") return { entry, verdict: "keep" };
    return {
      entry,
      verdict: "error",
      error: `${entry}: ${error?.message ?? error}`,
    };
  }
}

/**
 * Classify the Lisa-named entries at the top level of `root`.
 * @param {string} resolvedRoot - Canonical temp root.
 * @param {string | null} holding - Name of the entry holding the cwd.
 * @param {number} cutoffMs - Staleness cutoff.
 * @param {number | undefined} uid - This user's id.
 * @returns {Promise<Array<{entry: string, verdict: string, error?: string}>>} Verdicts.
 */
async function classifyEntries(resolvedRoot, holding, cutoffMs, uid) {
  const candidates = [];
  for await (const dirent of await opendir(resolvedRoot)) {
    if (dirent.isSymbolicLink() || !isLisaOwnedTempName(dirent.name)) continue;
    if (dirent.name === holding) continue;
    const entry = path.join(resolvedRoot, dirent.name);
    if (path.dirname(entry) === resolvedRoot) candidates.push(entry);
  }
  return mapPool(candidates, REMOVE_CONCURRENCY, entry =>
    classify(entry, cutoffMs, uid)
  );
}

/**
 * Remove one entry, reporting instead of throwing.
 * @param {string} entry - Absolute path.
 * @returns {Promise<{entry: string, error?: string}>} Outcome.
 */
async function removeEntry(entry) {
  try {
    await rm(entry, { recursive: true, force: true });
    return { entry };
  } catch (error) {
    return {
      entry,
      error: `could not remove ${entry}: ${error?.message ?? error}`,
    };
  }
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
  const resolvedRoot = await canonical(root);
  const refusal = rootRefusal(resolvedRoot, await canonical(home));
  if (refusal) {
    return {
      removed: [],
      skippedUnsafe: 0,
      errors: [`refusing to sweep ${root}: ${refusal}`],
    };
  }
  let verdicts;
  try {
    const holding = entryHolding(resolvedRoot, await canonical(cwd));
    const cutoffMs = now - maxAgeHours * HOUR_MS;
    verdicts = await classifyEntries(resolvedRoot, holding, cutoffMs, uid);
  } catch (error) {
    return {
      removed: [],
      skippedUnsafe: 0,
      errors: [`cannot read ${root}: ${error?.message ?? error}`],
    };
  }
  const stale = verdicts.filter(v => v.verdict === "remove").map(v => v.entry);
  const skippedUnsafe = verdicts.filter(v => v.verdict === "unsafe").length;
  const classifyErrors = verdicts.flatMap(v => (v.error ? [v.error] : []));
  if (dryRun) return { removed: stale, skippedUnsafe, errors: classifyErrors };
  const outcomes = await mapPool(stale, REMOVE_CONCURRENCY, removeEntry);
  return {
    removed: outcomes.filter(o => !o.error).map(o => o.entry),
    skippedUnsafe,
    errors: [
      ...classifyErrors,
      ...outcomes.flatMap(o => (o.error ? [o.error] : [])),
    ],
  };
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
 * @returns {{dryRun: boolean, json: boolean, maxAgeHours: number, processes: boolean}} Parsed flags.
 * @throws {Error} On an unknown flag or an invalid age.
 */
export function parseSweepArgs(argv) {
  const parsed = {
    dryRun: false,
    json: false,
    maxAgeHours: DEFAULT_MAX_AGE_HOURS,
    processes: true,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dry-run") parsed.dryRun = true;
    else if (arg === "--json") parsed.json = true;
    else if (arg === "--no-processes") parsed.processes = false;
    else if (arg === "--max-age-hours" || arg.startsWith("--max-age-hours=")) {
      const inline = arg.includes("=");
      const raw = inline ? arg.slice(arg.indexOf("=") + 1) : argv[index + 1];
      if (!inline) index += 1;
      parsed.maxAgeHours = parseAge(raw);
    } else throw new Error(`unknown flag ${arg}`);
  }
  return parsed;
}

/**
 * Validate an age in hours.
 * @param {string | undefined} raw - The flag's value.
 * @returns {number} The age.
 * @throws {Error} When it is not a non-negative number.
 */
function parseAge(raw) {
  const hours = Number(raw);
  if (raw === undefined || raw === "" || !Number.isFinite(hours) || hours < 0) {
    throw new Error(`--max-age-hours needs a non-negative number, got ${raw}`);
  }
  return hours;
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
    ...(flags.processes ? {} : { orphans: false }),
  });
  write(flags.json ? JSON.stringify(result) : formatSummary(result));
  return 0;
}

/**
 * The line printed when a live sweeper already swept.
 * @param {number} pid - The sweeper's pid.
 * @returns {string} One line, no trailing newline.
 */
export function formatAlreadySwept(pid) {
  return `🧹 cleanup sweep already ran (pid ${pid}); skipping`;
}

/**
 * Sweep once from a synchronous caller (the gate runner), never failing it.
 *
 * Runs this file as a bounded child because the caller cannot await, forwards
 * its one summary line, and on any failure prints one line and returns. Skips,
 * with one line, when {@link SWEPT_ENV} names a sweeper that is still alive;
 * otherwise writes the CALLER's own `<pid>:<start>` there first, so everything
 * the caller starts afterwards skips for as long as the caller runs.
 * @param {object} [seams] - Test seams.
 * @param {Record<string, string | undefined>} [seams.env] - Environment, defaults to `process.env`.
 * @param {typeof boundedSpawnSync} [seams.spawn] - Child launcher.
 * @param {(line: string) => void} [seams.log] - Output sink.
 * @param {() => string} [seams.ownerMarker] - This process's `<pid>:<start>`.
 * @param {(value: unknown) => number | null} [seams.liveSweeper] - Who already swept.
 * @returns {void}
 */
export function runStartOfRunSweep(seams = {}) {
  const {
    env = process.env,
    spawn = boundedSpawnSync,
    log = console.log,
    ownerMarker = () => ownerMarkerFor(process.pid),
    liveSweeper: sweptBy = liveSweeper,
  } = seams;
  const sweeper = sweptBy(env[SWEPT_ENV]);
  if (sweeper !== null) {
    log(formatAlreadySwept(sweeper));
    return;
  }
  env[SWEPT_ENV] = ownerMarker();
  launchSweep(spawn, env, log);
}

/**
 * Run the sweep CLI as a bounded child and forward its one line.
 * @param {typeof boundedSpawnSync} spawn - Child launcher.
 * @param {Record<string, string | undefined>} env - Child environment.
 * @param {(line: string) => void} log - Output sink.
 * @returns {void}
 */
function launchSweep(spawn, env, log) {
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

// Set the exit code and let the process end on its own; never `process.exit`.
// A write to a pipe is asynchronous on macOS, so exiting straight after
// `main` writes would drop everything past the pipe buffer: a piped `--json`
// report was cut at exactly 65,536 bytes (CodySwannGT/lisa#4694). Nothing is
// left on the event loop once `main` settles — the child launches are
// synchronous and the grace delay is awaited — so ending naturally only waits
// for stdout to drain. The failure branch keeps exit 0: a sweep never fails
// the run it precedes.
if (invokedAsScript(import.meta.url)) {
  main().then(
    code => {
      process.exitCode = code;
    },
    error => {
      console.log(`🧹 cleanup sweep failed: ${error?.message ?? error}`);
      process.exitCode = 0;
    }
  );
}
