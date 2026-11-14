#!/usr/bin/env node
/**
 * Per-file test timing report for Lisa's own CI (CodySwannGT/lisa#4592).
 *
 * Reads the `test-timings-<run>-<attempt>-<job>` artifacts that
 * `.github/workflows/quality.yml` uploads from the unit job, every unit shard
 * leg and the integration job, and prints per scope: file count, test count,
 * summed file time, the slowest files with their share, and the cumulative
 * share of the top 10, 100 and 200 files. `--json` emits the same data plus
 * every file's timing, for shard balancing and slow-test audits.
 *
 * Usage:
 *   node scripts/test-timing-report.mjs --dir <downloaded artifacts> [--top N] [--json]
 *   node scripts/test-timing-report.mjs --run <run-id> [--top N] [--json]
 *
 * A scope with no timings exits 1 naming it: a missing file is not a zero.
 *
 * File time is the span Vitest's json reporter records for the file, from its
 * first test's start to its last test's end. It excludes the file's import and
 * collection time, so it can sit below the per-file duration the default
 * reporter prints.
 *
 * The same file can arrive more than once: the unit job's merged report
 * repeats every shard's files, and a failed-jobs rerun uploads under a new
 * attempt beside the first. One record per file is kept — an executed record
 * over a fully skipped one, then the latest attempt.
 * @module test-timing-report
 */
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { invokedAsScript } from "./lib/invoked-as-script.mjs";
import { TEST_TIMINGS_SCOPES } from "./lib/test-timings-reporter.mjs";

const REPOSITORY = "CodySwannGT/lisa";
const DEFAULT_TOP = 20;
const CUTOFFS = Object.freeze([10, 100, 200]);
const SKIPPED = new Set(["skipped", "pending", "todo", "disabled"]);

/**
 * @typedef {object} FileTiming
 * @property {string} file - Repository-relative test file
 * @property {number} seconds - Time the file's tests spanned
 * @property {number} tests - Test count
 */

/**
 * Every file under a directory, recursively.
 * @param {string} directory - Directory to walk
 * @returns {ReadonlyArray<string>} File paths
 */
function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

/**
 * The run attempt an artifact directory names, or 0.
 * @param {string} file - Timing file path
 * @returns {number} Attempt number
 */
function attemptOf(file) {
  const match = /^test-timings-\d+-(\d+)-/.exec(
    path.basename(path.dirname(file))
  );
  return match ? Number(match[1]) : 0;
}

/**
 * Drop the checkout prefix so files read as repository paths: the current
 * directory for a local run, the GitHub runner's workspace for a CI one.
 * @param {string} name - Absolute path Vitest recorded
 * @returns {string} Repository-relative path when the prefix is recognised
 */
function repositoryPath(name) {
  const local = `${process.cwd()}${path.sep}`;
  if (name.startsWith(local)) return name.slice(local.length);
  return name.replace(/^.*?\/work\/[^/]+\/[^/]+\//, "");
}

/**
 * Parse one Vitest json report, or `undefined` when it is not one.
 * @param {string} file - Report path
 * @returns {ReadonlyArray<{ file: string, seconds: number, tests: number, executed: boolean }> | undefined} Entries
 */
function readReport(file) {
  const parsed = (() => {
    try {
      return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      return undefined;
    }
  })();
  if (!parsed || !Array.isArray(parsed.testResults)) return undefined;
  return parsed.testResults
    .filter(result => typeof result?.name === "string")
    .map(result => {
      const assertions = Array.isArray(result.assertionResults)
        ? result.assertionResults
        : [];
      const span =
        typeof result.startTime === "number" &&
        typeof result.endTime === "number"
          ? result.endTime - result.startTime
          : assertions.reduce((sum, a) => sum + (a?.duration ?? 0), 0);
      return {
        file: repositoryPath(result.name),
        seconds: Math.max(0, span) / 1000,
        tests: assertions.length,
        executed: assertions.some(a => !SKIPPED.has(a?.status)),
      };
    });
}

/**
 * Whether a candidate record should replace the one already kept.
 * @param {{ executed: boolean, attempt: number }} candidate - New record
 * @param {{ executed: boolean, attempt: number } | undefined} kept - Current record
 * @returns {boolean} True to replace
 */
function outranks(candidate, kept) {
  if (kept === undefined) return true;
  if (candidate.executed !== kept.executed) return candidate.executed;
  return candidate.attempt > kept.attempt;
}

/**
 * Gather one record per file, per scope, from a directory of artifacts.
 * @param {string} directory - Downloaded artifacts (any depth)
 * @returns {Readonly<Record<string, ReadonlyArray<FileTiming>>>} Timings by scope
 */
export function collectTimings(directory) {
  const reports = walk(directory).flatMap(file => {
    const scope = path.basename(file, ".json");
    if (!file.endsWith(".json") || !TEST_TIMINGS_SCOPES.includes(scope))
      return [];
    const entries = readReport(file) ?? [];
    const attempt = attemptOf(file);
    return entries.map(entry => ({ ...entry, scope, attempt }));
  });
  const kept = reports.reduce((acc, record) => {
    const key = `${record.scope}\u0000${record.file}`;
    return outranks(record, acc[key]) ? { ...acc, [key]: record } : acc;
  }, /** @type {Record<string, (typeof reports)[number]>} */ ({}));
  return Object.fromEntries(
    TEST_TIMINGS_SCOPES.map(scope => [
      scope,
      Object.values(kept)
        .filter(record => record.scope === scope)
        .map(({ file, seconds, tests }) => ({ file, seconds, tests }))
        .toSorted(
          (a, b) => b.seconds - a.seconds || a.file.localeCompare(b.file)
        ),
    ])
  );
}

/**
 * Summarise one scope.
 * @param {ReadonlyArray<FileTiming>} files - Files, any order
 * @param {number} top - How many slowest files to list
 * @returns {{ files: number, tests: number, seconds: number, top: ReadonlyArray<{ file: string, seconds: number, share: number }>, concentration: Readonly<Record<string, number>>, all: ReadonlyArray<FileTiming> }} Summary
 */
export function summarize(files, top) {
  const all = files.toSorted(
    (a, b) => b.seconds - a.seconds || a.file.localeCompare(b.file)
  );
  const seconds = all.reduce((sum, file) => sum + file.seconds, 0);
  const share = value => (seconds === 0 ? 0 : value / seconds);
  const sumOf = count =>
    all.slice(0, count).reduce((sum, file) => sum + file.seconds, 0);
  return {
    files: all.length,
    tests: all.reduce((sum, file) => sum + file.tests, 0),
    seconds,
    top: all.slice(0, top).map(file => ({
      file: file.file,
      seconds: file.seconds,
      share: share(file.seconds),
    })),
    concentration: Object.fromEntries(
      CUTOFFS.map(count => [`top${count}`, share(sumOf(count))])
    ),
    all,
  };
}

/**
 * A ratio as a percentage with one decimal.
 * @param {number} ratio - 0..1
 * @returns {string} Percentage text
 */
function percent(ratio) {
  return (ratio * 100).toFixed(1);
}

/**
 * Render summaries as text.
 * @param {Readonly<Record<string, ReturnType<typeof summarize>>>} summaries - By scope
 * @returns {string} Report text
 */
export function formatReport(summaries) {
  return Object.entries(summaries)
    .map(([scope, summary]) => {
      const rows = summary.top.map(
        (file, index) =>
          `  ${String(index + 1).padStart(3)}. ${file.seconds.toFixed(2).padStart(8)}s ${percent(file.share).padStart(6)}%  ${file.file}`
      );
      const shares = CUTOFFS.map(count => {
        const key = `top${count}`;
        const ratio = summary.concentration[key];
        return `top ${count}: ${percent(ratio)}%`;
      }).join("  ");
      const fewer =
        summary.files < Math.max(...CUTOFFS)
          ? [
              `  (only ${summary.files} file${summary.files === 1 ? "" : "s"}; a larger cutoff covers them all)`,
            ]
          : [];
      return [
        `${scope}: ${summary.files} files, ${summary.tests} tests, ${summary.seconds.toFixed(1)}s summed file time`,
        `  top ${summary.top.length} files by time:`,
        ...rows,
        `  ${shares}`,
        ...fewer,
      ].join("\n");
    })
    .join("\n\n");
}

/**
 * Download a run's timing artifacts with `gh`.
 * @param {string} runId - Workflow run id
 * @param {string} into - Destination directory
 */
function downloadRun(runId, into) {
  execFileSync(
    "gh",
    [
      "run",
      "download",
      runId,
      "-R",
      REPOSITORY,
      "-p",
      "test-timings-*",
      "-D",
      into,
    ],
    { stdio: ["ignore", "ignore", "inherit"] }
  );
}

/**
 * Parse the arguments, or return a usage error.
 * @param {ReadonlyArray<string>} argv - Arguments after the script name
 * @returns {{ dir?: string, run?: string, top: number, json: boolean } | { error: string }} Options
 */
export function parseArgs(argv) {
  const value = flag => {
    const at = argv.indexOf(flag);
    return at === -1 ? undefined : (argv[at + 1] ?? "");
  };
  const dir = value("--dir");
  const run = value("--run");
  const topText = value("--top");
  const top = topText === undefined ? DEFAULT_TOP : Number(topText);
  if ((dir === undefined) === (run === undefined))
    return { error: "pass exactly one of --dir <directory> or --run <run-id>" };
  if (dir === "" || run === "" || (run !== undefined && !/^\d+$/.test(run)))
    return { error: "--dir needs a directory and --run a numeric run id" };
  if (!Number.isInteger(top) || top < 1)
    return { error: "--top needs a positive whole number" };
  return { dir, run, top, json: argv.includes("--json") };
}

/**
 * Report on a directory of artifacts.
 * @param {string} directory - Artifacts directory
 * @param {{ top: number, json: boolean, source: string }} options - Output options
 * @param {{ stdout: (line: string) => void, stderr: (line: string) => void }} io - Output sinks
 * @returns {number} Exit code
 */
function report(directory, options, io) {
  if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) {
    io.stderr(`test-timing-report: ${directory} is not a directory.`);
    return 1;
  }
  const timings = collectTimings(directory);
  const missing = TEST_TIMINGS_SCOPES.filter(
    scope => timings[scope].length === 0
  );
  if (missing.length > 0) {
    io.stderr(
      `test-timing-report: missing timings for scope${missing.length === 1 ? "" : "s"} ${missing.join(", ")} in ${options.source}. ` +
        "Each scope needs a test-timings artifact holding <scope>.json; a missing file is not reported as zero."
    );
    return 1;
  }
  const summaries = Object.fromEntries(
    TEST_TIMINGS_SCOPES.map(scope => [
      scope,
      summarize(timings[scope], options.top),
    ])
  );
  io.stdout(
    options.json
      ? JSON.stringify(
          { schema: 1, source: options.source, scopes: summaries },
          null,
          2
        )
      : formatReport(summaries)
  );
  return 0;
}

/**
 * CLI entry.
 * @param {ReadonlyArray<string>} argv - Arguments after the script name
 * @param {{ stdout: (line: string) => void, stderr: (line: string) => void, download?: (runId: string, into: string) => void }} io - Output sinks and downloader
 * @returns {number} Exit code
 */
export function main(argv, io) {
  const options = parseArgs(argv);
  if ("error" in options) {
    io.stderr(`test-timing-report: ${options.error}.`);
    return 2;
  }
  if (options.dir !== undefined)
    return report(
      path.resolve(options.dir),
      { ...options, source: options.dir },
      io
    );
  const into = fs.mkdtempSync(path.join(os.tmpdir(), "lisa-test-timings-"));
  try {
    try {
      (io.download ?? downloadRun)(options.run, into);
    } catch (error) {
      io.stderr(
        `test-timing-report: could not download test-timings-* artifacts of run ${options.run} from ${REPOSITORY}: ${error instanceof Error ? error.message : String(error)}`
      );
      return 1;
    }
    return report(into, { ...options, source: `run ${options.run}` }, io);
  } finally {
    fs.rmSync(into, { recursive: true, force: true });
  }
}

if (invokedAsScript(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2), {
    stdout: line => console.log(line),
    stderr: line => console.error(line),
  });
}
