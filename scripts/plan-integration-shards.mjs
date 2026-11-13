#!/usr/bin/env node
/**
 * Plan Lisa's sharded integration run from recorded timings (CodySwannGT/lisa#4599).
 *
 * `quality.yml`'s `🧮 Plan Integration-Test Shards` job runs this in Lisa's own
 * CI when `integration_test_shards` is above 1. It finds the newest run that
 * uploaded `test-timings-*-integration*` artifacts (#4592) through the Actions
 * API, reads every file's duration, and assigns files to legs
 * longest-processing-time-first: the longest remaining item goes to the leg
 * with the least planned time. It prints each leg's planned seconds and writes
 * the plan every leg applies through `lisa-test-run` (`LISA_TEST_SHARD_PLAN`,
 * `src/cli/lisa-test-run-shard-files.ts`).
 *
 * The history-scanner suites are one item, so they land in one leg and a
 * sharded run downloads the pinned scanner at most once: their project's
 * global setup runs only in an invocation whose selection holds one of them.
 * The planner still writes a plan when no timings can be found (an expired
 * artifact, a token that cannot read the Actions API). Every file then weighs
 * the same and the group still shares one leg, because Vitest's own
 * `--shard` would run that global setup in every leg.
 *
 * Lisa-only: callers have no timings artifacts, and without this script the
 * plan job hands their legs to the runner's own `--shard=<i>/<n>`.
 *
 * Usage:
 *   node scripts/plan-integration-shards.mjs --shards <n> [--repo owner/name]
 *     [--timings <downloaded artifacts>] [--out <plan.json>] [--github-output <file>]
 * @module plan-integration-shards
 */
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { HISTORY_SCANNER_SUITES } from "./lib/history-scanner-suites.mjs";
import { invokedAsScript } from "./lib/invoked-as-script.mjs";
import { collectTimings } from "./test-timing-report.mjs";

/** The schema token `lisa-test-run` requires of a plan. */
export const SHARD_PLAN_SCHEMA = "lisa.test-shard-plan/v1";

const REPOSITORY = "CodySwannGT/lisa";
const ARTIFACT_NAME = /^test-timings-(\d+)-\d+-integration(?:-shard-\d+)?$/;
const LISTING_JQ =
  ".artifacts[] | {name, runId: .workflow_run.id, createdAt: .created_at, expired}";
const PAGE_SIZE = 100;
const MAX_PAGES = 10;

/**
 * One decimal place, so a plan prints and compares cleanly.
 * @param {number} value - Seconds
 * @returns {number} Rounded seconds
 */
function round(value) {
  return Math.round(value * 10) / 10;
}

/**
 * The median of a list, or `fallback` when it is empty.
 * @param {ReadonlyArray<number>} values - Values
 * @param {number} fallback - Answer for no values
 * @returns {number} Median
 */
function median(values, fallback) {
  if (values.length === 0) return fallback;
  const sorted = values.toSorted((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[middle] ?? fallback)
    : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

/**
 * Assign timed files and groups to shards, longest first.
 * @param {object} input - Inputs
 * @param {number} input.total - Shard count
 * @param {ReadonlyArray<{ file: string, seconds: number }>} input.timings - Per-file seconds
 * @param {ReadonlyArray<ReadonlyArray<string>>} input.groups - Files that share one leg
 * @returns {{ schema: string, total: number, assignments: Record<string, number>, seconds: number[], defaultSeconds: number, groups: Array<{ files: string[], shard: number }> }} Plan
 */
export function planShards({ total, timings, groups }) {
  const seconds = new Map(timings.map(entry => [entry.file, entry.seconds]));
  const defaultSeconds = round(
    median(
      timings.map(entry => entry.seconds),
      1
    )
  );
  const grouped = new Set(groups.flat());
  const items = [
    ...groups.map((files, index) => ({
      key: `group ${index}`,
      group: index,
      files: [...files],
      seconds: files.reduce(
        (sum, file) => sum + (seconds.get(file) ?? defaultSeconds),
        0
      ),
    })),
    ...timings
      .filter(entry => !grouped.has(entry.file))
      .map(entry => ({
        key: entry.file,
        group: -1,
        files: [entry.file],
        seconds: entry.seconds,
      })),
  ].toSorted((a, b) => b.seconds - a.seconds || a.key.localeCompare(b.key));
  const loads = Array.from({ length: total }, () => 0);
  const assignments = {};
  const groupShards = groups.map(() => 1);
  for (const item of items) {
    const index = loads.indexOf(Math.min(...loads));
    loads[index] = (loads[index] ?? 0) + item.seconds;
    if (item.group >= 0) groupShards[item.group] = index + 1;
    for (const file of item.files)
      if (seconds.has(file)) assignments[file] = index + 1;
  }
  return {
    schema: SHARD_PLAN_SCHEMA,
    total,
    assignments,
    seconds: loads.map(round),
    defaultSeconds,
    groups: groups.map((files, index) => ({
      files: [...files],
      shard: groupShards[index] ?? 1,
    })),
  };
}

/**
 * One line per shard: planned files and seconds.
 * @param {ReturnType<typeof planShards>} plan - Plan
 * @returns {string[]} Lines
 */
export function formatPlan(plan) {
  return plan.seconds.map((seconds, index) => {
    const files = Object.values(plan.assignments).filter(
      shard => shard === index + 1
    ).length;
    return `shard ${index + 1}/${plan.total}: ${files} planned file${files === 1 ? "" : "s"}, ${seconds.toFixed(1)} s planned`;
  });
}

/**
 * The newest run that uploaded unexpired integration timings.
 * @param {string} repo - owner/name
 * @param {{ run: (command: string, args: ReadonlyArray<string>) => string }} deps - Command runner
 * @returns {string | undefined} Run id
 */
export function findTimingsRun(repo, deps) {
  const found = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const output = deps.run("gh", [
      "api",
      `repos/${repo}/actions/artifacts?per_page=${PAGE_SIZE}&page=${page}`,
      "--jq",
      LISTING_JQ,
    ]);
    const lines = output.split("\n").filter(line => line.trim() !== "");
    found.push(
      ...lines
        .map(line => JSON.parse(line))
        .filter(
          entry =>
            entry.expired !== true && ARTIFACT_NAME.test(entry.name ?? "")
        )
    );
    if (found.length > 0 || lines.length < PAGE_SIZE) break;
  }
  const newest = found.toSorted((a, b) =>
    String(b.createdAt).localeCompare(String(a.createdAt))
  )[0];
  return newest === undefined ? undefined : String(newest.runId);
}

/**
 * Parse the arguments, or return a usage error.
 * @param {ReadonlyArray<string>} argv - Arguments after the script name
 * @returns {{ shards: number, repo: string, timings?: string, out?: string, githubOutput?: string } | { error: string }} Options
 */
export function parseArgs(argv) {
  const value = flag => {
    const at = argv.indexOf(flag);
    return at === -1 ? undefined : argv[at + 1];
  };
  const shards = Number(value("--shards"));
  if (!Number.isInteger(shards) || shards < 2 || shards > 20)
    return { error: "--shards needs a whole number from 2 to 20" };
  return {
    shards,
    repo: value("--repo") ?? REPOSITORY,
    timings: value("--timings"),
    out: value("--out"),
    githubOutput: value("--github-output"),
  };
}

/**
 * Read the integration timings: from `--timings`, or downloaded from the
 * newest run that has them. Never throws: no timings is an answer.
 * @param {{ repo: string, timings?: string }} options - Options
 * @param {Deps} deps - Effects
 * @returns {{ timings: ReadonlyArray<{ file: string, seconds: number }>, source: string }} Timings
 */
function readTimings(options, deps) {
  if (options.timings !== undefined)
    return {
      timings: collectTimings(options.timings).integration,
      source: options.timings,
    };
  const into = fs.mkdtempSync(path.join(os.tmpdir(), "lisa-shard-timings-"));
  try {
    const runId = findTimingsRun(options.repo, deps);
    if (runId === undefined)
      return { timings: [], source: "no run with integration timings" };
    deps.run("gh", [
      "run",
      "download",
      runId,
      "-R",
      options.repo,
      "-p",
      "test-timings-*-integration*",
      "-D",
      into,
    ]);
    return {
      timings: collectTimings(into).integration,
      source: `run ${runId}`,
    };
  } catch (error) {
    return {
      timings: [],
      source: `the Actions API refused: ${error instanceof Error ? error.message : String(error)}`,
    };
  } finally {
    fs.rmSync(into, { recursive: true, force: true });
  }
}

/**
 * @typedef {object} Deps
 * @property {(command: string, args: ReadonlyArray<string>) => string} run - Run a command, return stdout; throws on failure
 * @property {(line: string) => void} out - Standard output
 * @property {(line: string) => void} err - Standard error
 * @property {(file: string) => boolean} exists - Whether a repository file still exists
 */

/**
 * CLI entry.
 * @param {ReadonlyArray<string>} argv - Arguments after the script name
 * @param {Deps} deps - Effects
 * @returns {number} Exit code
 */
export function main(argv, deps) {
  const options = parseArgs(argv);
  if ("error" in options) {
    deps.err(`plan-integration-shards: ${options.error}.`);
    return 2;
  }
  const read = readTimings(options, deps);
  // A file deleted since the timings were recorded would only skew the loads.
  const timings = read.timings.filter(entry => deps.exists(entry.file));
  const plan = planShards({
    total: options.shards,
    timings,
    groups: [[...HISTORY_SCANNER_SUITES]],
  });
  if (timings.length === 0) {
    deps.out(
      `::notice title=No integration timings::Found no integration timings (${read.source}), so every file weighs the same; the history-scanner suites still share one leg.`
    );
  } else {
    deps.out(
      `Assigned ${timings.length} timed files longest-processing-time-first from ${read.source}; untimed files weigh ${plan.defaultSeconds} s each.`
    );
  }
  for (const line of formatPlan(plan)) deps.out(line);
  const json = JSON.stringify(plan);
  if (options.out !== undefined) fs.writeFileSync(options.out, `${json}\n`);
  if (options.githubOutput !== undefined)
    fs.appendFileSync(options.githubOutput, `mode=files\nplan=${json}\n`);
  return 0;
}

if (invokedAsScript(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2), {
    run: (command, args) =>
      execFileSync(command, [...args], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        maxBuffer: 64 * 1024 * 1024,
      }),
    out: line => console.log(line),
    err: line => console.error(line),
    exists: file => fs.existsSync(file),
  });
}
