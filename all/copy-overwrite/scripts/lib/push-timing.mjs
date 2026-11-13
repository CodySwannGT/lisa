// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/**
 * Per-gate push timing report (CodySwannGT/lisa#4591).
 *
 * A push that is "too slow" is not something anyone can fix until it is
 * measured: which gate took the time, and how loaded the machine was while it
 * ran. Each push run of the gate runner leaves one JSON report under
 * `.lisa/push-timing/`, and `lisa-push-timing-report.mjs` summarises them.
 *
 * The report is a MEASUREMENT, never a verdict. Nothing here may throw into the
 * runner or change its exit code: a report that cannot be written prints one
 * warning and the push proceeds exactly as it would have.
 * @module lib/push-timing
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { availableParallelism, freemem, loadavg } from "node:os";
import { join } from "node:path";

import { boundedSpawnSync } from "./bounded-spawn.mjs";

/** Where reports live, relative to the project root. */
export const TIMING_DIR = ".lisa/push-timing";

/** How many reports to keep; older ones are pruned on every write. */
export const KEEP_REPORTS = 200;

/** A report file name: ISO start, colons replaced, optional collision suffix. */
const REPORT_NAME = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z(?:-\d+)?\.json$/u;

/**
 * @typedef {object} GateTiming
 * @property {string} id Gate id.
 * @property {string|null} level Declared level.
 * @property {string|null} command Command that proved it.
 * @property {string} state PASSED, FAILED, UNPROVABLE, KILLED, SKIPPED or NOT_RUN.
 * @property {number|null} exitCode Exit code, when one exists.
 * @property {string|null} startedAt ISO-8601 start, null when never reached.
 * @property {number} durationMs Time spent; 0 when proved by a sibling's run.
 * @property {string|null} provedBy The gate whose run proved this one.
 */

/**
 * @typedef {object} TimingReport
 * @property {string} startedAt ISO-8601 run start.
 * @property {string} finishedAt ISO-8601 run end.
 * @property {number} wallMs Run wall time.
 * @property {string} moment The moment that ran.
 * @property {number} cores `os.availableParallelism()`.
 * @property {number[]} loadavgStart `os.loadavg()` at start.
 * @property {number[]} loadavgEnd `os.loadavg()` at end.
 * @property {number} freeMemStart `os.freemem()` at start.
 * @property {number} freeMemEnd `os.freemem()` at end.
 * @property {string|null} node Node version.
 * @property {string|null} bun Bun version.
 * @property {string|null} head HEAD commit.
 * @property {string|null} tree HEAD tree.
 * @property {GateTiming[]} gates Per-gate records, in run order.
 */

/**
 * The host's load and free memory right now.
 * @returns {{loadavg: number[], freeMem: number}} One reading.
 */
export function hostReading() {
  return { loadavg: loadavg(), freeMem: freemem() };
}

/**
 * The file name a report started at `startedAtMs` is written under.
 * @param {number} startedAtMs Run start, epoch milliseconds.
 * @returns {string} e.g. `2026-11-02T10-15-03Z.json`.
 */
export function reportFileName(startedAtMs) {
  const iso = new Date(startedAtMs).toISOString();
  return `${iso.slice(0, 19).replaceAll(":", "-")}Z.json`;
}

/**
 * Render milliseconds the way the summary line does: `4m12s`, `1h2m3s`, `9s`.
 * @param {number} ms Duration in milliseconds.
 * @returns {string} The compact duration.
 */
export function formatDuration(ms) {
  const total = Math.round(Math.max(0, ms) / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours) return `${hours}h${minutes}m${seconds}s`;
  if (minutes) return `${minutes}m${seconds}s`;
  return `${seconds}s`;
}

/**
 * One gate's timing record.
 * @param {object} entry A `runGates` result entry (or a pre-gate step).
 * @returns {GateTiming} The record.
 */
function gateRecord(entry) {
  return {
    id: entry.id,
    level: entry.level ?? null,
    command: entry.command ?? null,
    state: String(entry.state ?? "unknown")
      .toUpperCase()
      .replaceAll("-", "_"),
    exitCode: typeof entry.code === "number" ? entry.code : null,
    startedAt: entry.startedAt ?? null,
    durationMs: typeof entry.durationMs === "number" ? entry.durationMs : 0,
    provedBy: entry.provedBy ?? null,
  };
}

/**
 * The whole report for one run.
 * @param {object} options Inputs, all stated so the shape is testable.
 * @param {string} options.moment The moment that ran.
 * @param {number} options.startedAtMs Run start, epoch ms.
 * @param {number} options.finishedAtMs Run end, epoch ms.
 * @param {number} options.cores `os.availableParallelism()`.
 * @param {{loadavg: number[], freeMem: number}} options.start Reading at start.
 * @param {{loadavg: number[], freeMem: number}} options.end Reading at end.
 * @param {{node: string|null, bun: string|null}} options.versions Runtimes.
 * @param {string|null} options.head HEAD commit.
 * @param {string|null} options.tree HEAD tree.
 * @param {{results: object[]}} options.result What `runGates` produced.
 * @param {object[]} [options.preGates] Steps run before the gates, recorded first.
 * @returns {TimingReport} The report document.
 */
export function timingReport({
  moment,
  startedAtMs,
  finishedAtMs,
  cores,
  start,
  end,
  versions,
  head,
  tree,
  result,
  preGates = [],
}) {
  return {
    startedAt: new Date(startedAtMs).toISOString(),
    finishedAt: new Date(finishedAtMs).toISOString(),
    wallMs: Math.max(0, finishedAtMs - startedAtMs),
    moment,
    cores,
    loadavgStart: start.loadavg,
    loadavgEnd: end.loadavg,
    freeMemStart: start.freeMem,
    freeMemEnd: end.freeMem,
    node: versions.node ?? null,
    bun: versions.bun ?? null,
    head: head ?? null,
    tree: tree ?? null,
    gates: [...preGates, ...(result?.results ?? [])].map(gateRecord),
  };
}

/**
 * A load average rendered to one decimal place, without a trailing `.0`.
 * @param {number|undefined} value One-minute load.
 * @returns {string} The rendering.
 */
export function formatLoad(value) {
  return typeof value === "number" ? String(Number(value.toFixed(1))) : "?";
}

/**
 * The one line printed after the runner's own summary.
 * @param {TimingReport} report A `timingReport` document.
 * @param {string} path Where it was written (or a note that it was not).
 * @returns {string} The `⏱` line.
 */
export function formatTimingLine(report, path) {
  const slowest = report.gates.reduce(
    (best, gate) => (!best || gate.durationMs > best.durationMs ? gate : best),
    null
  );
  const slow = slowest
    ? ` · slowest ${slowest.id} ${formatDuration(slowest.durationMs)}`
    : "";
  return (
    `⏱ ${report.moment} ${formatDuration(report.wallMs)} · ` +
    `${report.gates.length} gates${slow} · ` +
    `load ${formatLoad(report.loadavgStart?.[0])}→` +
    `${formatLoad(report.loadavgEnd?.[0])}/${report.cores} cores · ${path}`
  );
}

/**
 * Delete all but the newest `keep` reports. Other files are left alone.
 * @param {string} dir Report directory.
 * @param {number} keep How many to keep.
 */
function prune(dir, keep) {
  const reports = readdirSync(dir)
    .filter(name => REPORT_NAME.test(name))
    .sort();
  for (const name of reports.slice(0, Math.max(0, reports.length - keep))) {
    rmSync(join(dir, name), { force: true });
  }
}

/**
 * Write a report and prune old ones. Never throws.
 * @param {object} report A `timingReport` document.
 * @param {object} [options] Where and how.
 * @param {string} [options.dir] Report directory.
 * @param {number} [options.keep] How many reports to keep.
 * @param {(line: string) => void} [options.warn] Warning sink.
 * @returns {string|null} The written path, or null when nothing was written.
 */
export function writeTimingReport(
  report,
  { dir = TIMING_DIR, keep = KEEP_REPORTS, warn = console.warn } = {}
) {
  try {
    mkdirSync(dir, { recursive: true });
    const base = reportFileName(Date.parse(report.startedAt));
    const stem = base.slice(0, -".json".length);
    const name =
      [
        base,
        ...Array.from({ length: 99 }, (_, i) => `${stem}-${i + 1}.json`),
      ].find(candidate => !existsSync(join(dir, candidate))) ?? base;
    const path = join(dir, name);
    writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`);
    prune(dir, keep);
    return path;
  } catch (err) {
    warn(
      `⚠️  Could not write the push timing report: ${err.message}. ` +
        `The gate verdict is unaffected.`
    );
    return null;
  }
}

/**
 * Ask a command for one line of output, or null.
 * @param {string} command Executable.
 * @param {string[]} args Arguments.
 * @returns {string|null} Trimmed stdout, or null on any failure.
 */
function probe(command, args) {
  try {
    const child = boundedSpawnSync(command, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    // probe-direction: neutral — a recorded field in a timing report; no gate reads it.
    if (child.error || child.status !== 0) return null;
    return String(child.stdout ?? "").trim() || null;
  } catch {
    // probe-direction: neutral — an unknown version or revision is recorded as null.
    return null;
  }
}

/**
 * Build, write, and announce the report for one gate run. Never throws.
 * @param {object} options Inputs.
 * @param {string} options.moment The moment that ran.
 * @param {number} options.startedAtMs When the run began, epoch ms.
 * @param {{loadavg: number[], freeMem: number}} options.start Reading at start.
 * @param {{results: object[]}} options.result What `runGates` produced.
 * @param {object[]} [options.preGates] Steps run before the gates.
 * @param {(line: string) => void} [options.out] Line sink for the `⏱` line.
 * @param {string} [options.dir] Report directory.
 * @returns {string|null} The written path, or null.
 */
export function recordPushTiming({
  moment,
  startedAtMs,
  start,
  result,
  preGates = [],
  out = line => console.log(line),
  dir = TIMING_DIR,
}) {
  try {
    const report = timingReport({
      moment,
      startedAtMs,
      finishedAtMs: Date.now(),
      cores: availableParallelism(),
      start,
      end: hostReading(),
      versions: {
        node: process.versions.node ?? null,
        bun: process.versions.bun ?? probe("bun", ["--version"]),
      },
      head: probe("git", ["rev-parse", "HEAD"]),
      tree: probe("git", ["rev-parse", "HEAD^{tree}"]),
      result,
      preGates,
    });
    const path = writeTimingReport(report, { dir, warn: out });
    out(formatTimingLine(report, path ?? "(report not written)"));
    return path;
  } catch (err) {
    out(
      `⚠️  Could not build the push timing report: ${err.message}. ` +
        `The gate verdict is unaffected.`
    );
    return null;
  }
}
