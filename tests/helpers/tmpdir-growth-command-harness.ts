/** Shared real-command mechanics for Darwin temp-growth evidence. */
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { performance } from "node:perf_hooks";

import { expect } from "vitest";

import {
  type TmpdirGrowthArtifactRecord,
  type TmpdirGrowthReportRecord,
  type TmpdirGrowthRootIdentity,
  type TmpdirGrowthTrial,
} from "./tmpdir-growth-performance-types.js";

export const TMPDIR_GROWTH_ENTRY_COUNT = 100_000;
export const TMPDIR_GROWTH_COMMAND_BUDGET_MS = 5_000;
const { env: PROCESS_ENVIRONMENT } = process;

/** Paths and immutable identity for one independently populated root. */
export interface PopulatedTmpdirRoot {
  readonly container: string;
  readonly root: string;
  readonly artifact: string;
  readonly identity: TmpdirGrowthRootIdentity;
}

/** One command result and command-only elapsed time. */
export interface TimedTmpdirMeasurement {
  readonly elapsedMs: number;
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly error?: Error;
}

/** Complete parsed command and rolling-artifact evidence for one trial. */
interface ParsedTmpdirTrialEvidence {
  readonly report: TmpdirGrowthReportRecord;
  readonly artifact: TmpdirGrowthArtifactRecord;
}

/**
 * Create an isolated platform root, excluding population from command timing.
 * @param count - Exact entry count to populate
 * @param rootIndex - Stable root identity in the trial schedule
 * @param prefix - Direct platform-temp basename prefix
 * @param register - Test cleanup registry
 * @returns Populated root paths and pinned filesystem identity
 */
export function populatedTmpdirRoot(
  count: number,
  rootIndex: number,
  prefix: string,
  register: (directory: string) => void
): PopulatedTmpdirRoot {
  const container = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const root = path.join(container, "root");
  const describeRoot = (): PopulatedTmpdirRoot => {
    const stat = fs.lstatSync(root);
    return {
      container,
      root,
      artifact: path.join(container, "artifact.json"),
      identity: {
        rootIndex,
        canonicalPath: fs.realpathSync(root),
        dev: stat.dev,
        ino: stat.ino,
      },
    };
  };
  fs.mkdirSync(root);
  register(container);
  for (const index of Array.from(
    { length: count },
    (_value, offset) => offset
  )) {
    fs.closeSync(
      fs.openSync(
        path.join(root, `entry-${String(index).padStart(6, "0")}`),
        "wx"
      )
    );
  }
  return describeRoot();
}

/**
 * Execute the real public command and measure only its process duration.
 * @param script - Public measurement command
 * @param root - Exact platform temp root selected before process start
 * @param artifact - Rolling artifact path
 * @param nowMs - Deterministic observation time
 * @param args - Node arguments overriding the default direct CLI invocation
 * @returns Command transport and timing facts
 */
export function timedTmpdirMeasurement(
  script: string,
  root: string,
  artifact: string,
  nowMs: number,
  args?: readonly string[]
): TimedTmpdirMeasurement {
  const started = performance.now();
  const result = spawnSync(
    process.execPath,
    args ?? [
      script,
      "--root",
      root,
      "--artifact",
      artifact,
      "--now-ms",
      String(nowMs),
    ],
    {
      encoding: "utf8",
      killSignal: "SIGKILL",
      maxBuffer: 64 * 1024 * 1024,
      timeout: TMPDIR_GROWTH_COMMAND_BUDGET_MS,
      env: { ...PROCESS_ENVIRONMENT, TMPDIR: root, TMP: root, TEMP: root },
    }
  );
  return {
    elapsedMs: performance.now() - started,
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    ...(result.error === undefined ? {} : { error: result.error }),
  };
}

/**
 * Validate the complete command, report, and rolling-artifact evidence.
 * @param result - Real command result
 * @param evidence - Parsed public report and bounded artifact summary
 */
function assertValidTmpdirTrial(
  result: TimedTmpdirMeasurement,
  evidence: ParsedTmpdirTrialEvidence
): void {
  const { artifact, report } = evidence;
  expect(result.error).toBeUndefined();
  expect(result.status, result.stderr).toBe(0);
  expect(result.elapsedMs).toBeLessThanOrEqual(TMPDIR_GROWTH_COMMAND_BUDGET_MS);
  expect(
    Object.keys(report).toSorted((left, right) => left.localeCompare(right))
  ).toEqual([
    "created",
    "delta",
    "elapsedMs",
    "namespace",
    "rateEntriesPerDay",
    "removed",
    "topPrefixes",
    "total",
    "unreclaimed",
    "violations",
  ]);
  expect(report.total).toBe(TMPDIR_GROWTH_ENTRY_COUNT);
  expect([report.created, report.removed, report.unreclaimed]).toEqual([
    0, 0, 0,
  ]);
  expect(report.violations).toEqual([]);
  expect(report.delta === null || report.delta === 0).toBe(true);
  expect(report.elapsedMs === null || report.elapsedMs > 0).toBe(true);
  expect(
    report.rateEntriesPerDay === null || report.rateEntriesPerDay === 0
  ).toBe(true);
  expect(report.topPrefixes).toEqual([
    { prefix: "entry-*", count: TMPDIR_GROWTH_ENTRY_COUNT },
  ]);
  expect(report.namespace).toEqual({
    total: 0,
    owned: 0,
    live: 0,
    unowned: 0,
    created: 0,
    removed: 0,
    unreclaimed: 0,
    newlyUnowned: 0,
  });
  expect(artifact.report).toEqual(report);
  expect(artifact.latestEntryCount).toBe(TMPDIR_GROWTH_ENTRY_COUNT);
}

/**
 * Parse complete command and rolling-artifact records for one trial.
 * @param paths - Pinned root and rolling-artifact path
 * @param result - Real command result containing the public JSON report
 * @returns Parsed report and bounded artifact summary
 */
function parsedTmpdirTrialEvidence(
  paths: PopulatedTmpdirRoot,
  result: TimedTmpdirMeasurement
): ParsedTmpdirTrialEvidence {
  const report = JSON.parse(result.stdout) as TmpdirGrowthReportRecord;
  const stored = JSON.parse(fs.readFileSync(paths.artifact, "utf8")) as {
    readonly report: TmpdirGrowthReportRecord;
    readonly snapshots: readonly { readonly entryNames: readonly string[] }[];
  };
  return {
    report,
    artifact: {
      path: paths.artifact,
      snapshotCount: stored.snapshots.length,
      latestEntryCount: stored.snapshots.at(-1)?.entryNames.length ?? -1,
      report: stored.report,
    },
  };
}

/**
 * Build the stable transport record after report and artifact validation.
 * @param paths - Pinned independently populated root
 * @param trial - Stable trial identity, zero for the sole warm-up
 * @param result - Validated real command result
 * @param evidence - Validated report and artifact facts
 * @returns Complete command, report, and rolling-artifact record
 */
function tmpdirTrialRecord(
  paths: PopulatedTmpdirRoot,
  trial: number,
  result: TimedTmpdirMeasurement,
  evidence: ParsedTmpdirTrialEvidence
): TmpdirGrowthTrial {
  const { artifact, report } = evidence;
  return {
    root: paths.identity,
    trial,
    commandElapsedMs: result.elapsedMs,
    budgetMs: TMPDIR_GROWTH_COMMAND_BUDGET_MS,
    count: report.total,
    created: report.created,
    removed: report.removed,
    unreclaimed: report.unreclaimed,
    reportElapsedMs: report.elapsedMs,
    rateEntriesPerDay: report.rateEntriesPerDay,
    topPrefixes: report.topPrefixes,
    ownership: report.namespace,
    violations: report.violations,
    artifact,
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

/**
 * Validate and retain one complete measured or warm-up trial.
 * @param paths - Pinned independently populated root
 * @param trial - Stable trial identity, zero for the sole warm-up
 * @param result - Real command result
 * @returns Complete command, report, and rolling-artifact record
 */
export function measuredTmpdirTrial(
  paths: PopulatedTmpdirRoot,
  trial: number,
  result: TimedTmpdirMeasurement
): TmpdirGrowthTrial {
  const evidence = parsedTmpdirTrialEvidence(paths, result);
  assertValidTmpdirTrial(result, evidence);
  return tmpdirTrialRecord(paths, trial, result, evidence);
}
