#!/usr/bin/env node
/**
 * Deterministic gate against orphaned test-fixture process trees (issue #2884).
 *
 * Lisa's own suite shells out to real scripts from temp fixtures. When the
 * runner is killed rather than allowed to finish — which this repository's
 * pre-push gate does under load, exit 143 / 137 — the fixture's *grandchildren*
 * survive: `jq`, `node -e`, and `git`, reparented to PID 1 at ~0% CPU, each
 * still naming a `$TMPDIR/lisa-*` path.
 *
 * This has been cleared by hand twice, months apart, and never gated:
 *
 *   - 2026-08-13: 142 stale trees (recorded in commit 1d815ac5's own body,
 *     which raised the suite timeout 10s -> 60s only after clearing them)
 *   - 2026-08-21: 227 stale trees, elapsed up to 13 hours
 *
 * They are not merely untidy. They live in the shared `$TMPDIR`, so they are
 * one of the things *growing* the directory whose saturation makes a single
 * `mkdtemp` cost 23,349 ms (#2883). The leak feeds the flakiness that hides it.
 *
 * Detection is deliberately narrow, because a gate that fires on processes it
 * should not read is its own outage:
 *
 *   - only processes whose command line names one of the Lisa test temp
 *     prefixes below, so a developer's unrelated `jq` is never matched;
 *   - only PPID 1, i.e. genuinely orphaned. A fixture process with a live
 *     parent is a *running test*, not a leak, and is never reported;
 *   - only past a minimum age, so a run in flight during the check — its
 *     worker mid-restart — cannot produce a false positive.
 *
 * Determinism: Node built-ins only, no network, no Math.random. `Date` is used
 * solely to age stale temp directories, and the threshold is injectable so the
 * unit test is reproducible.
 *
 * CLI:
 *   node scripts/check-orphan-test-processes.mjs [--json] [--reap]
 *                                                [--min-age-seconds <n>]
 *
 * Exit codes (mirroring the sibling check-* scripts):
 *   0 — no orphaned fixture process trees.
 *   1 — >=1 orphaned fixture process tree (or, with --reap, some survived).
 *   2 — operational/usage error: unknown flag, a flag missing its value, or
 *       `ps` being unavailable.
 *
 * @module scripts/check-orphan-test-processes
 */
import { execFileSync } from "node:child_process";
import process from "node:process";
import { fileURLToPath } from "node:url";

/**
 * Temp-directory prefixes used by Lisa's own test fixtures. A process is only
 * ever a candidate if its command line names one of these.
 */
export const FIXTURE_PREFIXES = ["lisa-self-postinstall-", "lisa-test-"];

/**
 * Minimum orphan age before it is reported, in seconds. Anything younger may
 * belong to a run that is still starting up.
 */
const DEFAULT_MIN_AGE_SECONDS = 120;

/** Init's pid. An orphan is a process reparented here. */
const INIT_PID = 1;

/**
 * Maximum reap passes. Killing an orphan reparents its own children to PID 1,
 * so a single pass exposes the next generation rather than finishing the job.
 * Fixture trees are only a few levels deep; this bounds a pathological case.
 */
const MAX_REAP_PASSES = 8;

/** Longest command excerpt one report line carries. */
const MAX_COMMAND = 100;

/** How much of that budget the head keeps; the rest goes to the tail. */
const EXCERPT_HEAD = 40;

/**
 * A bounded command excerpt that always keeps the END of the command line.
 *
 * A plain head-of-string cut looked fine and was wrong, and this gate's own
 * bite test is what caught it. A fixture path is
 * `$TMPDIR/lisa-scratch/run-<pid>-<epoch-ms>-<hash>/lisa-self-postinstall-<rand>/…`
 * once the per-process scratch redirection nests it, and the first 100
 * characters of that are consumed by the run root — so the report named no
 * fixture at all, which is the one thing a reader needs to act. Measured: the
 * planted-orphan case reported `1 orphaned … process tree(s)` and a path
 * ending at the run-root hash, with the `lisa-self-postinstall-` segment cut
 * off.
 *
 * The identifying part of a path is its tail, so the tail is what survives.
 * @param {string} command - Full command line from ps.
 * @returns {string} The command, or head + ellipsis + tail within the budget.
 */
export function excerptCommand(command) {
  if (command.length <= MAX_COMMAND) return command;
  const tail = command.slice(-(MAX_COMMAND - EXCERPT_HEAD - 1));
  return `${command.slice(0, EXCERPT_HEAD)}…${tail}`;
}

/**
 * Parse an `etime` field (`[[dd-]hh:]mm:ss`) into seconds.
 * @param {string} etime - Elapsed-time field from ps.
 * @returns {number} Elapsed seconds, or 0 when unparseable.
 */
export function parseEtimeSeconds(etime) {
  const match = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/.exec(etime.trim());
  if (!match) return 0;
  const [, days, hours, minutes, seconds] = match;
  return (
    Number(days ?? 0) * 86400 +
    Number(hours ?? 0) * 3600 +
    Number(minutes) * 60 +
    Number(seconds)
  );
}

/**
 * Parse `ps -eo pid,ppid,etime,command` output into records.
 * @param {string} psOutput - Raw ps output including its header line.
 * @returns {{pid:number,ppid:number,etimeSeconds:number,command:string}[]} Rows.
 */
export function parsePsOutput(psOutput) {
  return (
    psOutput
      .split("\n")
      .slice(1)
      // Split on whitespace rather than matching: a `(\d+)\s+(\d+)\s+(\S+)\s+(.*)`
      // pattern over an arbitrarily long command line backtracks super-linearly.
      .map(line => line.trim().split(/\s+/))
      .filter(
        fields =>
          fields.length >= 4 &&
          /^\d+$/.test(fields[0]) &&
          /^\d+$/.test(fields[1])
      )
      .map(fields => ({
        command: fields.slice(3).join(" "),
        etimeSeconds: parseEtimeSeconds(fields[2]),
        pid: Number(fields[0]),
        ppid: Number(fields[1]),
      }))
  );
}

/**
 * Select the orphaned fixture processes from a set of ps records.
 * @param {{pid:number,ppid:number,etimeSeconds:number,command:string}[]} rows -
 *   Parsed ps records.
 * @param {number} minAgeSeconds - Minimum age before a row is reported.
 * @returns {{pid:number,ppid:number,etimeSeconds:number,command:string}[]}
 *   Orphans, oldest first.
 */
export function selectOrphans(rows, minAgeSeconds) {
  return rows
    .filter(row => row.ppid === INIT_PID)
    .filter(row => row.etimeSeconds >= minAgeSeconds)
    .filter(row =>
      FIXTURE_PREFIXES.some(prefix => row.command.includes(prefix))
    )
    .sort((a, b) => b.etimeSeconds - a.etimeSeconds);
}

/**
 * Read the process table.
 * @returns {string} Raw `ps` output.
 */
function readProcessTable() {
  // eslint-disable-next-line sonarjs/no-os-command-from-path -- fixed executable and argv
  return execFileSync("ps", ["-eo", "pid,ppid,etime,command"], {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
}

/**
 * Format the human-readable report.
 * @param {{pid:number,etimeSeconds:number,command:string}[]} orphans - Orphans.
 * @returns {string} Report text.
 */
export function humanReport(orphans) {
  if (orphans.length === 0) {
    return "✅ No orphaned Lisa test-fixture process trees.";
  }
  const lines = orphans.map(
    orphan =>
      `  pid ${String(orphan.pid)}  ${String(
        Math.round(orphan.etimeSeconds / 60)
      )}m  ${excerptCommand(orphan.command)}`
  );
  return [
    `❌ ${String(orphans.length)} orphaned Lisa test-fixture process tree(s) (PPID 1):`,
    ...lines,
    "",
    "These are fixture grandchildren that outlived a killed test runner.",
    "They occupy the shared $TMPDIR and feed its saturation (#2883).",
    "Reap them with: node scripts/check-orphan-test-processes.mjs --reap",
  ].join("\n");
}

/**
 * Kill the listed orphans.
 * @param {{pid:number}[]} orphans - Orphans to kill.
 * @returns {number} Count actually signalled.
 */
export function reapOrphans(orphans) {
  return orphans.filter(orphan => {
    try {
      process.kill(orphan.pid, "SIGKILL");
      return true;
    } catch {
      // ESRCH: already gone between listing and killing.
      return false;
    }
  }).length;
}

/**
 * Reap orphans repeatedly until none surface or the pass budget is spent.
 *
 * One pass is not enough: killing an orphan reparents its children to PID 1,
 * which makes them orphans in turn.
 * @param {number} minAgeSeconds - Minimum age before a process is reaped.
 * @returns {number} Total processes signalled across all passes.
 */
export function reapUntilSettled(minAgeSeconds) {
  return Array.from({ length: MAX_REAP_PASSES }).reduce(total => {
    const orphans = selectOrphans(
      parsePsOutput(readProcessTable()),
      minAgeSeconds
    );
    if (orphans.length === 0) return total;
    return total + reapOrphans(orphans);
  }, 0);
}

/**
 * Parse CLI arguments.
 * @param {string[]} argv - Arguments after the script name.
 * @returns {{json:boolean,reap:boolean,minAgeSeconds:number}} Parsed options.
 */
export function parseArgs(argv) {
  const KNOWN = new Set(["--json", "--reap", "--min-age-seconds"]);
  const ageIndex = argv.indexOf("--min-age-seconds");
  if (ageIndex !== -1 && argv[ageIndex + 1] === undefined) {
    throw new Error("--min-age-seconds requires a value");
  }
  // Guard the -1 case: without the option, `ageIndex + 1` is 0 and would skip
  // the first argument as though it were that option's value.
  const valueIndex = ageIndex === -1 ? -1 : ageIndex + 1;
  const unknown = argv.find(
    (arg, index) => index !== valueIndex && !KNOWN.has(arg)
  );
  if (unknown !== undefined) {
    throw new Error(`unknown flag: ${unknown}`);
  }
  return {
    json: argv.includes("--json"),
    minAgeSeconds:
      ageIndex === -1 ? DEFAULT_MIN_AGE_SECONDS : Number(argv[ageIndex + 1]),
    reap: argv.includes("--reap"),
  };
}

/**
 * Parse arguments without throwing.
 * @param {string[]} argv - Arguments after the script name.
 * @returns {{ok:true,opts:object}|{ok:false,message:string}} Parse outcome.
 */
function tryParseArgs(argv) {
  try {
    return { ok: true, opts: parseArgs(argv) };
  } catch (error) {
    return { message: String(error.message), ok: false };
  }
}

/**
 * Read the process table without throwing.
 * @returns {{ok:true,table:string}|{ok:false,message:string}} Read outcome.
 */
function tryReadProcessTable() {
  try {
    return { ok: true, table: readProcessTable() };
  } catch (error) {
    return {
      message: `failed to read the process table: ${String(error.message)}`,
      ok: false,
    };
  }
}

/**
 * Entry point.
 * @param {string[]} argv - Arguments after the script name.
 * @param {NodeJS.WritableStream} out - Output stream.
 * @returns {number} Process exit code.
 */
export function main(argv, out = process.stdout) {
  const parsed = tryParseArgs(argv);
  if (!parsed.ok) {
    out.write(`${parsed.message}\n`);
    return 2;
  }

  const read = tryReadProcessTable();
  if (!read.ok) {
    out.write(`${read.message}\n`);
    return 2;
  }

  const orphans = selectOrphans(
    parsePsOutput(read.table),
    parsed.opts.minAgeSeconds
  );

  if (parsed.opts.reap) {
    const total = reapUntilSettled(parsed.opts.minAgeSeconds);
    const remaining = selectOrphans(
      parsePsOutput(readProcessTable()),
      parsed.opts.minAgeSeconds
    ).length;
    out.write(`reaped ${String(total)}; ${String(remaining)} still present\n`);
    return remaining === 0 ? 0 : 1;
  }

  out.write(
    `${
      parsed.opts.json
        ? JSON.stringify({ orphans }, null, 2)
        : humanReport(orphans)
    }\n`
  );
  return orphans.length === 0 ? 0 : 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  // exitCode (not process.exit): when stdout is a pipe, writes are async and
  // process.exit() truncates the report mid-flush.
  process.exitCode = main(process.argv.slice(2));
}
