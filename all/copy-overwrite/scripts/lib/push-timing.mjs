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
import { join, sep } from "node:path";

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
 * @property {string} state PASSED, CACHED, FAILED, UNPROVABLE, KILLED, SKIPPED or NOT_RUN.
 * @property {number|null} exitCode Exit code, when one exists.
 * @property {string|null} startedAt ISO-8601 start, null when never reached.
 * @property {number} durationMs Time spent; 0 when proved by a sibling's run.
 * @property {string|null} provedBy The gate whose run proved this one.
 * @property {string[]} failingTestFiles Repo-relative test files the gate's
 *   output named as failing; empty unless the gate failed (#4896).
 * @property {boolean} failingTestFilesTruncated True when that list was capped.
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

/** The most failing test files one gate records (#4896). */
export const MAX_FAILING_TEST_FILES = 200;

/** Terminal colour and cursor sequences, which Vitest wraps its FAIL badge in. */
// eslint-disable-next-line no-control-regex -- matching the ESC byte is the point
const ANSI_SEQUENCE = /\u001b\[[0-9;?]*[ -/]*[@-~]/gu;

/**
 * A runner's per-file failure header, at the start of a line:
 * - Vitest: ` FAIL  |project| path/to/file.test.ts > suite > case`
 * - Jest:   `FAIL path/to/file.test.ts (5.1 s)`
 * The project tag is optional in both. A `FAIL` anywhere else in a line is prose.
 */
const FAIL_HEADER = /^\s*FAIL\s+(?:\|[^|\n]*\|\s+)?(\S+)/u;

/**
 * A path without its trailing slashes. A loop rather than `/\/+$/`, which the
 * shipped ReDoS rule flags: an anchored `+` before `$` backtracks on a long run
 * of slashes followed by anything else.
 * @param {string} path A POSIX path.
 * @returns {string} The path with trailing `/` characters removed.
 */
function trimTrailingSlashes(path) {
  let end = path.length;
  while (end > 0 && path[end - 1] === "/") end -= 1;
  return path.slice(0, end);
}

/** A token that is plausibly a file path: path characters plus an extension. */
const FILE_TOKEN = /^[\w@.+\-/\\]+\.[A-Za-z0-9]+$/u;

/**
 * A FAIL token as a repo-relative POSIX path, or null when it is not one.
 *
 * Only repo-relative paths are kept: an absolute path inside `root` is made
 * relative, and anything outside it — or climbing out with `..` — is dropped,
 * because a report that names files from somewhere else is not about this repo.
 * @param {string} token The first token after `FAIL`.
 * @param {string|null} root The project root, or null to keep relative paths only.
 * @returns {string|null} The path, or null.
 */
function repoRelative(token, root) {
  if (!FILE_TOKEN.test(token)) return null;
  const posix = token.replaceAll("\\", "/");
  const base = root
    ? `${trimTrailingSlashes(root.replaceAll(sep, "/"))}/`
    : null;
  const absolute = posix.startsWith("/") || /^[A-Za-z]:\//u.test(posix);
  const inRoot = absolute && base && posix.startsWith(base);
  if (absolute && !inRoot) return null;
  const relative = (inRoot ? posix.slice(base.length) : posix).replace(
    /^(?:\.\/)+/u,
    ""
  );
  const segments = relative.split("/");
  if (segments.some(part => part === ".." || part === "")) return null;
  return relative;
}

/**
 * The test files a failed gate's output names as failing (CodySwannGT/lisa#4896).
 *
 * The push timing report records pass or fail per gate, which cannot say WHICH
 * test file failed — so a slow file that never catches anything and a slow file
 * that catches regressions every week look the same. This reads each runner's
 * per-file failure header out of the captured diagnostic tail (Vitest's summary
 * repeats every failed file there, so the tail is enough).
 *
 * Diagnostics only: anything unexpected — a non-string, binary noise, a format
 * this does not know — yields an empty list. It never throws, so it can never
 * change a gate verdict or fail a push.
 * @param {unknown} output A gate's captured output.
 * @param {object} [options] Bounds.
 * @param {string|null} [options.root] Project root, for relativising absolute paths.
 * @param {number} [options.max] Cap on the number of files.
 * @returns {{files: string[], truncated: boolean}} Deduped files in first-seen order.
 */
export function failingTestFiles(
  output,
  { root = null, max = MAX_FAILING_TEST_FILES } = {}
) {
  try {
    if (typeof output !== "string") return { files: [], truncated: false };
    const unique = [
      ...new Set(
        output
          .replace(ANSI_SEQUENCE, "")
          .split(/\r?\n/u)
          .map(line => FAIL_HEADER.exec(line)?.[1])
          .filter(token => typeof token === "string")
          .map(token => repoRelative(token, root))
          .filter(path => path !== null)
      ),
    ];
    return { files: unique.slice(0, max), truncated: unique.length > max };
  } catch {
    // probe-direction: neutral — a diagnostic list; no gate reads it.
    return { files: [], truncated: false };
  }
}

/** States under which a gate's run did not prove its property. */
const UNPROVED_STATES = new Set(["FAILED", "UNPROVABLE", "KILLED"]);

/**
 * The failing-file fields of one gate record. A gate that did not fail records
 * none, whatever its entry carries, and a malformed list reads as none.
 * @param {string} state The record's state.
 * @param {unknown} failingTests The entry's `{files, truncated}`, if any.
 * @returns {{failingTestFiles: string[], failingTestFilesTruncated: boolean}} The fields.
 */
function failingFields(state, failingTests) {
  const files = UNPROVED_STATES.has(state) ? failingTests?.files : null;
  const valid =
    Array.isArray(files) && files.every(file => typeof file === "string");
  return {
    failingTestFiles: valid ? [...files] : [],
    failingTestFilesTruncated: valid && failingTests.truncated === true,
  };
}

/**
 * One gate's timing record.
 * @param {object} entry A `runGates` result entry (or a pre-gate step).
 * @returns {GateTiming} The record.
 */
function gateRecord(entry) {
  // A remembered pass (#4594) did not run, so it is reported as CACHED
  // rather than as a PASSED gate that happened to take no time.
  const state =
    entry.cached === true
      ? "CACHED"
      : String(entry.state ?? "unknown")
          .toUpperCase()
          .replaceAll("-", "_");
  return {
    id: entry.id,
    level: entry.level ?? null,
    command: entry.command ?? null,
    state,
    exitCode: typeof entry.code === "number" ? entry.code : null,
    startedAt: entry.startedAt ?? null,
    durationMs: typeof entry.durationMs === "number" ? entry.durationMs : 0,
    provedBy: entry.provedBy ?? null,
    ...failingFields(state, entry.failingTests),
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
