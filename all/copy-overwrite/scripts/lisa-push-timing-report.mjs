#!/usr/bin/env node
// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/**
 * Summarise the push timing reports the gate runner writes
 * (CodySwannGT/lisa#4591).
 *
 * Usage: `node scripts/lisa-push-timing-report.mjs [--last <N>]` (default 10).
 *
 * Prints, per gate, the median and max duration and how many of the selected
 * runs recorded it; then, per run, the total wall time with the one-minute
 * load at start and end. A missing or empty `.lisa/push-timing/` exits 1 with
 * one line saying so, because "no data" must not read as "nothing was slow".
 * @module lisa-push-timing-report
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { invokedAsScript } from "./lib/invoked-as-script.mjs";
import { formatDuration, formatLoad, TIMING_DIR } from "./lib/push-timing.mjs";

const DEFAULT_LAST = 10;

/**
 * The median of a non-empty list of numbers.
 * @param {number[]} values The values.
 * @returns {number} The median.
 */
export function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Per-gate and per-run figures for a list of reports, oldest first.
 * @param {object[]} reports Parsed timing reports.
 * @returns {{gates: Array<{id: string, count: number, medianMs: number, maxMs: number}>, runs: object[]}} The summary.
 */
export function summariseReports(reports) {
  const durations = new Map();
  for (const report of reports) {
    for (const gate of report.gates ?? []) {
      durations.set(gate.id, [
        ...(durations.get(gate.id) ?? []),
        gate.durationMs ?? 0,
      ]);
    }
  }
  const gates = [...durations.entries()]
    .map(([id, values]) => ({
      id,
      count: values.length,
      medianMs: median(values),
      maxMs: Math.max(...values),
    }))
    .sort((a, b) => b.medianMs - a.medianMs || a.id.localeCompare(b.id));
  const runs = reports.map(report => ({
    startedAt: report.startedAt,
    wallMs: report.wallMs ?? 0,
    loadStart: report.loadavgStart?.[0],
    loadEnd: report.loadavgEnd?.[0],
    cores: report.cores,
    gates: (report.gates ?? []).length,
  }));
  return { gates, runs };
}

/**
 * Read `--last <N>` or `--last=<N>`.
 * @param {string[]} argv Arguments.
 * @returns {number|null} N, or null when given but not a positive integer.
 */
function readLast(argv) {
  const at = argv.findIndex(
    arg => arg === "--last" || arg.startsWith("--last=")
  );
  if (at === -1) return DEFAULT_LAST;
  const raw = argv[at].includes("=") ? argv[at].split("=")[1] : argv[at + 1];
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : null;
}

/**
 * CLI entry point.
 * @param {string[]} [argv] Arguments after the script name.
 * @param {object} [io] Injected for tests.
 * @param {string} [io.dir] Report directory.
 * @param {(line: string) => void} [io.out] Output sink.
 * @param {(line: string) => void} [io.err] Error sink.
 * @returns {number} Exit code.
 */
export function main(
  argv = process.argv.slice(2),
  {
    dir = TIMING_DIR,
    out = line => console.log(line),
    err = line => console.error(line),
  } = {}
) {
  const last = readLast(argv);
  if (last === null) {
    err(
      "usage: lisa-push-timing-report.mjs [--last <N>] (N a positive integer)"
    );
    return 1;
  }
  const names = existsSync(dir)
    ? readdirSync(dir)
        .filter(name => name.endsWith(".json"))
        .sort()
    : [];
  if (names.length === 0) {
    err(
      `No push timing reports in ${dir}/ — they are written by the pre-push ` +
        `gate runner, so push (or run the push gates) at least once first.`
    );
    return 1;
  }
  const reports = names.slice(-last).flatMap(name => {
    try {
      return [JSON.parse(readFileSync(join(dir, name), "utf8"))];
    } catch {
      return [];
    }
  });
  const { gates, runs } = summariseReports(reports);

  out(`Push timing — last ${runs.length} run(s) from ${dir}/`);
  out("");
  out(`  ${"gate".padEnd(30)}${"count".padEnd(7)}${"median".padEnd(10)}max`);
  for (const gate of gates) {
    out(
      `  ${gate.id.padEnd(30)}${String(gate.count).padEnd(7)}` +
        `${formatDuration(gate.medianMs).padEnd(10)}${formatDuration(gate.maxMs)}`
    );
  }
  out("");
  for (const run of runs) {
    out(
      `  ${run.startedAt}  ${formatDuration(run.wallMs).padEnd(9)}` +
        `${run.gates} gates  load ${formatLoad(run.loadStart)}→` +
        `${formatLoad(run.loadEnd)}/${run.cores} cores`
    );
  }
  return 0;
}

if (invokedAsScript(import.meta.url)) {
  process.exit(main());
}
