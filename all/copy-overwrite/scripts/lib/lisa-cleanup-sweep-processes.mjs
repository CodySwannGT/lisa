// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/**
 * The orphaned-process half of the start-of-run cleanup sweep
 * (CodySwannGT/lisa#4597).
 *
 * ## How a test process says who owns it
 *
 * `lisa-test-run` (and, for RSpec, the Rails pre-push) puts
 * `LISA_TEST_RUN_OWNER=<pid>:<start>` in its own environment before it starts
 * anything, so every test process and every descendant inherits it. `<start>`
 * is the owner's process start time — Linux start ticks from `/proc`, or whole
 * epoch seconds from `ps -o lstart=` on macOS — so a pid the kernel has since
 * handed to an unrelated process is not mistaken for the owner. `0` means the
 * start time could not be read when the marker was written.
 *
 * ## What is killed, and what never is
 *
 * A marked process is killed only when its owner is gone: the owner pid is
 * dead, or it is alive with a start time that differs from the recorded one.
 * Everything that cannot be proven gone is spared — an owner whose current or
 * recorded start time is unknown, a process listing that failed, a pid that
 * answers EPERM. The sweep itself and every one of its ancestors are spared
 * unconditionally, so a nested run can never kill the run that launched it.
 *
 * Only the current user's processes are listed, and nothing but the pid, the
 * parent pid and the marker is kept from a listing: `ps -E` prints the whole
 * environment, which routinely holds tokens. A marker counts only where it is
 * genuinely environment — a whole `/proc/<pid>/environ` entry, or the text
 * `ps -E` prints after the process's own arguments — so a marker typed as an
 * argument cannot get a process killed. Each orphan's start time is recorded
 * before SIGTERM, and a pid whose start time changed during the grace (a new
 * process that inherited the pid) gets no SIGKILL.
 *
 * ## A macOS visibility gap, and why it fails safe
 *
 * macOS withholds the environment of Apple-signed binaries (`/bin/sleep`,
 * `/bin/sh`, `/bin/bash`, the system `ruby` and `perl`) from `ps -E`, even for
 * the same user. Such a process shows no marker, so the sweep never selects
 * it: an orphaned `sh -c` wrapper survives, while the `node`/`bun` test
 * processes under it — whose environment IS shown — are killed. Linux reads
 * `/proc/<pid>/environ` and has no such gap.
 *
 * `ps -E` also joins variables with bare spaces, so on macOS another
 * variable whose VALUE contains ` LISA_TEST_RUN_OWNER=<pid>:<start>` is
 * indistinguishable from the real variable. Only a process whose environment
 * deliberately carries that text is exposed, and only to the same user's
 * sweep; Linux reads whole environ entries and has no such ambiguity.
 *
 * Self-contained: the per-test scratch policing this sweep replaced was
 * retired (CodySwannGT/lisa#4602), so nothing here depends on it.
 * @module scripts/lib/lisa-cleanup-sweep-processes
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";

import { boundedSpawnSync } from "./bounded-spawn.mjs";

/** Environment variable every test run's processes inherit. */
export const OWNER_ENV = "LISA_TEST_RUN_OWNER";

/** Recorded start time meaning "could not be read when the marker was set". */
export const UNKNOWN_START = "0";

/** Default wait between SIGTERM and SIGKILL. */
export const DEFAULT_GRACE_MS = 500;

/** Deadline for each `ps` call; the sweep must stay inside seconds. */
const PS_TIMEOUT_MS = 5_000;

/** `ps -E` prints every environment; leave room for a busy desktop. */
const PS_MAX_BUFFER = 64 * 1024 * 1024;

/** Pids per `ps -p` call, so one argument list stays well under `ARG_MAX`. */
const PS_BATCH = 256;

/** Locale-independent `ps` output, so `lstart` parses the same everywhere. */
const PS_ENV = { ...process.env, LC_ALL: "C", LANG: "C" };

const MARKER_IN_TEXT = /(?:^|\s)LISA_TEST_RUN_OWNER=(\d+:\d+)(?=\s|$)/gu;

/** Prefix of the one environ entry that carries the owner. */
const MARKER_ENTRY = `${OWNER_ENV}=`;

/**
 * Format the owner marker value.
 * @param {number} pid - Owner process id.
 * @param {string | undefined} start - Owner start time, when known.
 * @returns {string} `<pid>:<start>`.
 */
export function formatOwnerMarker(pid, start) {
  return `${pid}:${start ?? UNKNOWN_START}`;
}

/**
 * Parse an owner marker value.
 * @param {unknown} value - Raw `LISA_TEST_RUN_OWNER` value.
 * @returns {{pid: number, start: string} | null} The owner, or null when malformed.
 */
export function parseOwnerMarker(value) {
  const match = /^(\d+):(\d+)$/u.exec(typeof value === "string" ? value : "");
  if (!match) return null;
  const pid = Number(match[1]);
  return Number.isSafeInteger(pid) && pid > 0 ? { pid, start: match[2] } : null;
}

/**
 * Find the owner marker in the environment half of a `ps -E` line.
 *
 * Two different markers there mean something other than the real variable
 * says so — another variable's value — and the row is spared.
 * @param {string} environment - Space-separated environment text.
 * @returns {{pid: number, start: string} | null} The owner, if unambiguous.
 */
function ownerInEnvironment(environment) {
  const found = new Set(
    [...environment.matchAll(MARKER_IN_TEXT)].map(match => match[1])
  );
  return found.size === 1 ? parseOwnerMarker([...found][0]) : null;
}

/**
 * Find the owner in a NUL-separated `/proc/<pid>/environ`.
 *
 * Only a whole entry counts, so a marker quoted inside another variable's
 * value is not mistaken for the real one.
 * @param {string} environ - Raw environ contents.
 * @returns {{pid: number, start: string} | null} The owner, if marked.
 */
export function parseLinuxEnviron(environ) {
  const entry = environ.split("\0").find(item => item.startsWith(MARKER_ENTRY));
  return entry ? parseOwnerMarker(entry.slice(MARKER_ENTRY.length)) : null;
}

/**
 * Map pid to its arguments from `ps -ww -o pid=,command=` output.
 * @param {string} stdout - Raw `ps` output, without `-E`.
 * @returns {Map<number, string>} Arguments by pid.
 */
function argumentsByPid(stdout) {
  return new Map(
    stdout.split("\n").flatMap(line => {
      const match = /^\s*(\d+) (.*)$/u.exec(line);
      return match ? [[Number(match[1]), match[2]]] : [];
    })
  );
}

/**
 * Parse `ps -E` output, keeping only pid, ppid and owner.
 *
 * `ps -E -o command=` prints a process's ARGUMENTS and then its environment
 * on one line, so a marker typed as an argument reads exactly like one in the
 * environment. The same process's arguments, listed without `-E`, are stripped
 * off the front first, and only what follows is searched. A row whose
 * arguments do not line up — the process exec'd or exited between the two
 * listings — is given no marker, which spares it.
 * @param {string} withEnvironment - `ps -E -ww -o pid=,ppid=,command=` output.
 * @param {string} argumentsOnly - `ps -ww -o pid=,command=` output.
 * @returns {Array<{pid: number, ppid: number, owner: {pid: number, start: string} | null}>} Rows.
 */
export function parseDarwinProcessTable(withEnvironment, argumentsOnly) {
  const args = argumentsByPid(argumentsOnly);
  return withEnvironment.split("\n").flatMap(line => {
    const match = /^\s*(\d+)\s+(\d+)(?:\s(.*))?$/u.exec(line);
    if (!match) return [];
    const pid = Number(match[1]);
    const command = match[3] ?? "";
    const known = args.get(pid);
    const aligned = known !== undefined && command.startsWith(known);
    const owner = aligned
      ? ownerInEnvironment(command.slice(known.length))
      : null;
    return [{ pid, ppid: Number(match[2]), owner }];
  });
}

/**
 * Parse `ps -o pid= -o lstart=` output into whole epoch seconds.
 * @param {string} stdout - Raw `ps` output.
 * @returns {Map<number, string>} Start time by pid.
 */
export function parseDarwinStartTimes(stdout) {
  return new Map(
    stdout.split("\n").flatMap(line => {
      const match = /^\s*(\d+)\s+(\S.*\S)\s*$/u.exec(line);
      const epochMs = match ? Date.parse(match[2].replace(/\s+/gu, " ")) : NaN;
      if (!match || !Number.isFinite(epochMs)) return [];
      return [[Number(match[1]), String(Math.floor(epochMs / 1000))]];
    })
  );
}

/**
 * Read ppid and start ticks from a `/proc/<pid>/stat` line.
 *
 * Fields are counted from the LAST `)`, because the command name between the
 * parentheses may itself contain spaces and parentheses.
 * @param {string} stat - Contents of `/proc/<pid>/stat`.
 * @returns {{ppid: number, start: string} | null} Parsed fields, or null.
 */
export function parseLinuxStat(stat) {
  const commEnd = stat.lastIndexOf(")");
  if (commEnd < 0) return null;
  const fields = stat
    .slice(commEnd + 2)
    .trim()
    .split(/\s+/u);
  const ppid = Number(fields[1]);
  const start = fields[19];
  if (!Number.isSafeInteger(ppid) || !start || !/^\d+$/u.test(start))
    return null;
  return { ppid, start };
}

/**
 * Run `ps` under a deadline with a locale-independent environment.
 * @param {readonly string[]} args - `ps` arguments.
 * @returns {string} Its stdout; empty when it could not run.
 */
function runPs(args) {
  try {
    const child = boundedSpawnSync("/bin/ps", args, {
      encoding: "utf8",
      env: PS_ENV,
      maxBuffer: PS_MAX_BUFFER,
      stdio: ["ignore", "pipe", "ignore"],
      timeout: PS_TIMEOUT_MS,
    });
    // probe-direction: fail-closed — no rows means no process is selected and
    // no owner is known, so nothing is killed. `ps -p` exits 1 when any listed
    // pid is gone but still prints the rest, so the status is not consulted.
    return child.error ? "" : String(child.stdout ?? "");
  } catch {
    // probe-direction: fail-closed — a killed `ps` selects nothing to kill.
    return "";
  }
}

/**
 * Read one Linux process's stat, or null when it has gone or is unreadable.
 * @param {string} procRoot - Usually `/proc`.
 * @param {number} pid - Process id.
 * @returns {{ppid: number, start: string} | null} Parsed stat.
 */
function linuxStat(procRoot, pid) {
  try {
    return parseLinuxStat(readFileSync(`${procRoot}/${pid}/stat`, "utf8"));
  } catch {
    // probe-direction: fail-closed — an unreadable process is never selected.
    return null;
  }
}

/**
 * One Linux row for a process this user owns, or null.
 * @param {string} procRoot - Usually `/proc`.
 * @param {number} pid - Process id.
 * @param {number | undefined} uid - Current user id.
 * @returns {{pid: number, ppid: number, owner: {pid: number, start: string} | null} | null} Row.
 */
function linuxRow(procRoot, pid, uid) {
  const stat = linuxStat(procRoot, pid);
  if (!stat) return null;
  try {
    const mine =
      uid === undefined || statSync(`${procRoot}/${pid}`).uid === uid;
    const environ = mine
      ? readFileSync(`${procRoot}/${pid}/environ`, "utf8")
      : "";
    return { pid, ppid: stat.ppid, owner: parseLinuxEnviron(environ) };
  } catch {
    // probe-direction: fail-closed — an unreadable environment carries no
    // marker, so the process is kept for ancestry and never killed.
    return { pid, ppid: stat.ppid, owner: null };
  }
}

/**
 * List this user's processes with their parent and owner marker.
 * @param {object} [options] - Platform seams.
 * @param {string} [options.platform] - Defaults to `process.platform`.
 * @param {string} [options.procRoot] - Linux proc mount, defaults to `/proc`.
 * @returns {Array<{pid: number, ppid: number, owner: {pid: number, start: string} | null}>} Rows.
 */
export function listProcesses({
  platform = process.platform,
  procRoot = "/proc",
} = {}) {
  const uid = process.getuid?.();
  if (platform === "linux") {
    return readdirSync(procRoot)
      .filter(name => /^\d+$/u.test(name))
      .map(name => linuxRow(procRoot, Number(name), uid))
      .filter(row => row !== null);
  }
  if (platform !== "darwin") return [];
  const user = uid === undefined ? ["-A"] : ["-U", String(uid)];
  // Arguments first: a process that starts between the two calls is then
  // missing from the arguments map and is spared, never misread.
  const argumentsOnly = runPs(["-ww", ...user, "-o", "pid=,command="]);
  return parseDarwinProcessTable(
    runPs(["-E", "-ww", ...user, "-o", "pid=,ppid=,command="]),
    argumentsOnly
  );
}

/**
 * Read start times for a set of pids.
 * @param {readonly number[]} pids - Process ids to inspect.
 * @param {object} [options] - Platform seams.
 * @param {string} [options.platform] - Defaults to `process.platform`.
 * @param {string} [options.procRoot] - Linux proc mount, defaults to `/proc`.
 * @returns {Map<number, string>} Start time by pid; a missing pid is unknown.
 */
export function processStartTimes(
  pids,
  { platform = process.platform, procRoot = "/proc" } = {}
) {
  const unique = [...new Set(pids)].filter(
    pid => Number.isSafeInteger(pid) && pid > 0
  );
  if (platform === "linux") {
    return new Map(
      unique.flatMap(pid => {
        const stat = linuxStat(procRoot, pid);
        return stat ? [[pid, stat.start]] : [];
      })
    );
  }
  if (platform !== "darwin") return new Map();
  const batches = Array.from(
    { length: Math.ceil(unique.length / PS_BATCH) },
    (_, i) => unique.slice(i * PS_BATCH, (i + 1) * PS_BATCH)
  );
  return new Map(
    batches.flatMap(batch => [
      ...parseDarwinStartTimes(
        runPs(["-p", batch.join(","), "-o", "pid=", "-o", "lstart="])
      ),
    ])
  );
}

/**
 * The marker value a test run started by `pid` should export.
 * @param {number} [pid] - Owner process id, defaults to this process.
 * @returns {string} `<pid>:<start>`, with `0` when the start time is unknown.
 */
export function ownerMarkerFor(pid = process.pid) {
  return formatOwnerMarker(pid, processStartTimes([pid]).get(pid));
}

/**
 * The pid of the sweeper a `LISA_CLEANUP_SWEPT` value names, if it still runs.
 *
 * The value is the sweeper's own `<pid>:<start>`. It proves "already swept"
 * only while that exact process is alive: a dead pid, a reused pid (start
 * time differs) or an unknown start time all mean nobody can vouch for a
 * sweep, so the caller sweeps again — a second sweep is cheap, a silently
 * disabled one is not.
 * @param {unknown} value - The inherited `LISA_CLEANUP_SWEPT` value.
 * @param {object} [lookups] - Liveness and start-time seams.
 * @param {(pid: number) => boolean} [lookups.isAlive] - Liveness check.
 * @param {(pids: number[]) => Map<number, string>} [lookups.startTimesOf] - Start-time lookup.
 * @returns {number | null} The live sweeper's pid, or null.
 */
export function liveSweeper(
  value,
  { isAlive: alive = isAlive, startTimesOf = processStartTimes } = {}
) {
  const sweeper = parseOwnerMarker(value);
  if (!sweeper || sweeper.start === UNKNOWN_START || !alive(sweeper.pid)) {
    return null;
  }
  const current = startTimesOf([sweeper.pid]).get(sweeper.pid);
  return current === sweeper.start ? sweeper.pid : null;
}

/**
 * Whether a pid names a live process. EPERM means alive but not ours.
 * @param {number} pid - Process id.
 * @returns {boolean} True when the process exists.
 */
export function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

/**
 * The sweep's own pid and every ancestor reachable through the table.
 * @param {number} selfPid - The sweeping process.
 * @param {ReadonlyArray<{pid: number, ppid: number}>} rows - Process table.
 * @returns {Set<number>} Pids that must never be signalled.
 */
function lineageOf(selfPid, rows) {
  const parent = new Map(rows.map(row => [row.pid, row.ppid]));
  const spared = new Set();
  addLineage(selfPid, parent, spared);
  addLineage(process.ppid, parent, spared);
  return spared;
}

/**
 * Add a pid and every ancestor the table knows to `spared`.
 * @param {number | undefined} start - First pid of the walk.
 * @param {Map<number, number>} parent - Parent pid by pid.
 * @param {Set<number>} spared - Collector; the walk stops at a pid already in it.
 * @returns {void}
 */
function addLineage(start, parent, spared) {
  for (let pid = start; pid && !spared.has(pid); pid = parent.get(pid)) {
    spared.add(pid);
  }
}

/**
 * Whether an owner is provably gone.
 * @param {{start: string}} owner - Recorded owner.
 * @param {boolean} alive - Whether the owner pid is alive now.
 * @param {string | undefined} current - Its current start time, when known.
 * @returns {boolean} True only when the owner is dead or its pid was reused.
 */
function ownerIsGone(owner, alive, current) {
  if (!alive) return true;
  if (owner.start === UNKNOWN_START || current === undefined) return false;
  return current !== owner.start;
}

/**
 * Select the pids of marked processes whose owning run is gone.
 * @param {ReadonlyArray<{pid: number, ppid: number, owner: {pid: number, start: string} | null}>} rows - Process table.
 * @param {object} seams - Injected lookups.
 * @param {number} seams.selfPid - The sweeping process.
 * @param {(pid: number) => boolean} seams.isAlive - Liveness check.
 * @param {(pids: number[]) => Map<number, string>} seams.startTimesOf - Start-time lookup.
 * @returns {number[]} Orphan pids, in table order.
 */
export function selectOrphans(rows, { selfPid, isAlive: alive, startTimesOf }) {
  const spared = lineageOf(selfPid, rows);
  const marked = rows.filter(row => row.owner && !spared.has(row.pid));
  const owners = [...new Set(marked.map(row => row.owner.pid))];
  const liveOwners = owners.filter(pid => alive(pid));
  const starts = liveOwners.length > 0 ? startTimesOf(liveOwners) : new Map();
  const live = new Set(liveOwners);
  return marked
    .filter(row =>
      ownerIsGone(row.owner, live.has(row.owner.pid), starts.get(row.owner.pid))
    )
    .map(row => row.pid);
}

/**
 * Send one signal, reporting whether it was delivered.
 * @param {(pid: number, signal: string) => void} kill - Signal seam.
 * @param {number} pid - Target.
 * @param {string} signal - Signal name.
 * @param {string[]} errors - Collector for undeliverable signals.
 * @returns {boolean} True when the signal was delivered.
 */
function signal(kill, pid, signal, errors) {
  try {
    kill(pid, signal);
    return true;
  } catch (error) {
    if (error?.code !== "ESRCH")
      errors.push(`could not ${signal} ${pid}: ${error?.code ?? error}`);
    return false;
  }
}

/**
 * Kill every orphaned test process: SIGTERM, a short grace, then SIGKILL.
 * @param {object} [options] - Seams and switches; every one has a real default.
 * @param {number} [options.selfPid] - The sweeping process.
 * @param {() => ReturnType<typeof listProcesses>} [options.listProcesses] - Table source.
 * @param {(pid: number) => boolean} [options.isAlive] - Liveness check.
 * @param {(pids: number[]) => Map<number, string>} [options.startTimesOf] - Start-time lookup.
 * @param {(pid: number, signal: string) => void} [options.kill] - Signal seam.
 * @param {(ms: number) => Promise<unknown>} [options.sleep] - Grace wait.
 * @param {number} [options.graceMs] - SIGTERM-to-SIGKILL grace.
 * @param {boolean} [options.dryRun] - Select but signal nothing.
 * @returns {Promise<{killed: number[], errors: string[]}>} What was terminated.
 */
export async function sweepOrphans(options = {}) {
  const {
    selfPid = process.pid,
    listProcesses: list = listProcesses,
    isAlive: alive = isAlive,
    startTimesOf = processStartTimes,
    kill = (pid, sig) => process.kill(pid, sig),
    sleep = delay,
    graceMs = DEFAULT_GRACE_MS,
    dryRun = false,
  } = options;
  const errors = [];
  let orphans;
  try {
    orphans = selectOrphans(list(), { selfPid, isAlive: alive, startTimesOf });
  } catch (error) {
    return {
      killed: [],
      errors: [`process listing failed: ${error?.message ?? error}`],
    };
  }
  if (dryRun || orphans.length === 0) return { killed: orphans, errors };
  const recorded = startTimesOf(orphans);
  const killed = orphans.filter(pid => signal(kill, pid, "SIGTERM", errors));
  if (killed.length === 0) return { killed, errors };
  await sleep(graceMs);
  const survivors = killed.filter(pid => alive(pid));
  const current = survivors.length > 0 ? startTimesOf(survivors) : new Map();
  // A survivor whose start time changed during the grace is a NEW process
  // that inherited the pid; it gets no SIGKILL. One whose start time was never
  // recorded cannot be proven the same process, so it gets SIGTERM only.
  const samePid = pid =>
    recorded.has(pid) && current.get(pid) === recorded.get(pid);
  for (const pid of survivors.filter(samePid))
    signal(kill, pid, "SIGKILL", errors);
  return { killed, errors };
}
