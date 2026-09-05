/** Real Darwin command-route performance, batching, and over-cap harness. */
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { expect } from "vitest";

import {
  measuredTmpdirTrial,
  populatedTmpdirRoot,
  timedTmpdirMeasurement,
  TMPDIR_GROWTH_COMMAND_BUDGET_MS,
  TMPDIR_GROWTH_ENTRY_COUNT,
} from "./tmpdir-growth-command-harness.js";
import {
  type DarwinBirthBatchingTrace,
  type TmpdirGrowthPerformanceTrace,
} from "./tmpdir-growth-performance-types.js";

const { env: PROCESS_ENVIRONMENT } = process;
/** Predeclared from prior real command trials 169.97/170.94/527.62ms. */
const CALIBRATION_MS = [169.97, 170.94, 527.62] as const;
const MEASURED_ROOT_SCHEDULE = [0, 1, 2, 0, 1] as const;
const PERF_PREFIX = "LISA_TMPDIR_GROWTH_PERF_TRACE=";
const BATCH_PREFIX = "LISA_TMPDIR_GROWTH_BATCH_TRACE=";

/** Production-default snapshot runner used behind a forwarding ps shim. */
const DARWIN_BATCH_RUNNER = `
import { pathToFileURL } from "node:url";
const script = process.env.LISA_BATCH_SCRIPT;
if (!script) throw new Error("Batching module path is unavailable");
const { processBirthFingerprintSnapshot } = await import(pathToFileURL(script).href);
const pids = Array.from({ length: 1025 }, (_, index) => index + 100000);
process.stdout.write(JSON.stringify([...processBirthFingerprintSnapshot(pids)]));
`;

/** Raw command and log paths for one real-ps batching observation. */
interface DarwinBatchCommand {
  readonly log: string;
  readonly result: SpawnSyncReturns<string>;
}

/**
 * Install the forwarding ps shim and run the production-default snapshot.
 * @param script - Public measurement module
 * @param register - Test cleanup registry
 * @returns Raw child result and exact batch log
 */
function runDarwinBatchCommand(
  script: string,
  register: (directory: string) => void
): DarwinBatchCommand {
  const container = fs.mkdtempSync(
    path.join(os.tmpdir(), "tmp-growth-ps-shim-")
  );
  const shim = path.join(container, "ps");
  const log = path.join(container, "batches.log");
  const environment = {
    ...PROCESS_ENVIRONMENT,
    LISA_BATCH_SCRIPT: script,
    LISA_PS_BATCH_LOG: log,
    PATH: `${container}:${PROCESS_ENVIRONMENT.PATH ?? ""}`,
  };
  register(container);
  fs.writeFileSync(
    shim,
    `#!/bin/sh
set -eu
printf '%s\\n' "$*" >> "$LISA_PS_BATCH_LOG"
/bin/ps "$@" || true
old_ifs=$IFS
IFS=,
for pid in $2; do printf '%s Mon Jan 01 00:00:00 2024\\n' "$pid"; done
IFS=$old_ifs
`,
    "utf8"
  );
  fs.chmodSync(shim, 0o700);
  return {
    log,
    result: spawnSync(
      process.execPath,
      ["--input-type=module", "--eval", DARWIN_BATCH_RUNNER],
      {
        encoding: "utf8",
        env: environment,
        killSignal: "SIGKILL",
        maxBuffer: 64 * 1024 * 1024,
        timeout: TMPDIR_GROWTH_COMMAND_BUDGET_MS,
      }
    ),
  };
}

/**
 * Run one warm-up total and five measured trials across three real 100k roots.
 * @param script - Public measurement command
 * @param register - Test cleanup registry
 * @returns Complete host profile and measured command trace
 */
export function darwinTmpdirGrowthPerformance(
  script: string,
  register: (directory: string) => void
): TmpdirGrowthPerformanceTrace {
  const startedAt = new Date().toISOString();
  const loadAverageBefore = os.loadavg();
  const roots = [0, 1, 2].map(rootIndex =>
    populatedTmpdirRoot(
      TMPDIR_GROWTH_ENTRY_COUNT,
      rootIndex,
      "tmp-growth-perf-",
      register
    )
  );
  const warmupPaths = roots[0] as (typeof roots)[number];
  const warmup = measuredTmpdirTrial(
    warmupPaths,
    0,
    timedTmpdirMeasurement(
      script,
      warmupPaths.root,
      warmupPaths.artifact,
      1_000
    )
  );
  const trials = MEASURED_ROOT_SCHEDULE.map((rootIndex, index) => {
    const paths = roots[rootIndex] as (typeof roots)[number];
    return measuredTmpdirTrial(
      paths,
      index + 1,
      timedTmpdirMeasurement(script, paths.root, paths.artifact, 2_000 + index)
    );
  });
  const trace: TmpdirGrowthPerformanceTrace = {
    schema: "lisa-tmpdir-growth-performance-v1",
    platform: process.platform,
    arch: process.arch,
    cpuCount: os.cpus().length,
    totalMemoryBytes: os.totalmem(),
    loadAverageBefore,
    loadAverageAfter: os.loadavg(),
    hostname: os.hostname(),
    release: os.release(),
    cpuModel: os.cpus()[0]?.model ?? "unknown",
    entryCount: TMPDIR_GROWTH_ENTRY_COUNT,
    budgetMs: TMPDIR_GROWTH_COMMAND_BUDGET_MS,
    calibrationMs: CALIBRATION_MS,
    fixtureCreationExcluded: true,
    timeoutBehavior: "not-established",
    startedAt,
    finishedAt: new Date().toISOString(),
    warmup,
    measuredRootSchedule: MEASURED_ROOT_SCHEDULE,
    trials,
  };
  process.stdout.write(`${PERF_PREFIX}${JSON.stringify(trace)}\n`);
  return trace;
}

/**
 * Route 1,025 inputs through production batching and a real-ps forwarder.
 * @param script - Public measurement module exporting the production snapshot
 * @param register - Test cleanup registry
 * @param liveOwnerBirth - Separate real live-owner identity control
 * @returns Exact input/output counts, live-owner control, and bounded batches
 */
export function darwinBirthBatchingEvidence(
  script: string,
  register: (directory: string) => void,
  liveOwnerBirth: string
): DarwinBirthBatchingTrace {
  const { log, result } = runDarwinBatchCommand(script, register);
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) expect(result.status, result.stderr).toBe(0);
  const observations = JSON.parse(result.stdout) as readonly (readonly [
    number,
    string | undefined,
  ])[];
  const batchSizes = fs
    .readFileSync(log, "utf8")
    .trim()
    .split("\n")
    .map(line => {
      const match = /^-p ([^ ]+) -o pid= -o lstart=$/u.exec(line);
      if (match === null)
        throw new Error("Forwarded ps batch log is malformed");
      return match?.[1]?.split(",").length ?? 0;
    });
  const trace: DarwinBirthBatchingTrace = {
    inputCount: 1_025,
    observedCount: observations.filter(([, birth]) => birth !== undefined)
      .length,
    batchSizes,
    liveOwnerBirth,
  };
  process.stdout.write(`${BATCH_PREFIX}${JSON.stringify(trace)}\n`);
  return trace;
}
