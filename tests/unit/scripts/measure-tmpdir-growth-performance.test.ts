/**
 * Real 100k-entry command-route performance measurement.
 *
 * This is a BENCHMARK, not a contract test. Its assertions are wall-clock — six
 * real command runs, each of which must finish inside
 * `TMPDIR_GROWTH_COMMAND_BUDGET_MS` — and the only property it establishes is
 * that scanning a root of `TMPDIR_GROWTH_ENTRY_COUNT` entries stays bounded at
 * that scale. Shrinking the corpus would not make it cheaper to run, it would
 * make it prove nothing: a 1,000-entry root finishing inside five seconds says
 * nothing about a 100,000-entry one.
 *
 * So it is separated by FILE rather than scaled down, and excluded from the
 * pre-push task while remaining in the full suite CI runs — the same treatment,
 * for the same reason, that the mutation performance and gate-bite suites
 * already receive through `test:integration:push`. Building three independent
 * 100,000-entry roots writes 300,000 real entries into the shared platform temp
 * root, which on a machine running many concurrent agents is not merely slow
 * but is itself a load spike every other lane pays for.
 *
 * Everything else about the command — including the entry-cap refusal branch,
 * which now proves itself on a 501-entry root — stays in the unit suite next to
 * it and still runs on every push.
 */
import * as fs from "node:fs";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ioLatencyBudgetMs } from "../../helpers/io-latency-budget.js";
import { darwinTmpdirGrowthPerformance } from "../../helpers/tmpdir-growth-darwin-performance.js";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");
const SCRIPT = path.join(REPO_ROOT, "scripts/measure-tmpdir-growth.mjs");
/** Wall-clock room for building three real 100,000-entry corpora. */
const REAL_CORPUS_BASE_MS = 300_000;
/** Wall-clock room for recursively removing those same corpora. */
const REAL_FIXTURE_CLEANUP_BASE_MS = 120_000;
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { force: true, recursive: true });
  }
}, ioLatencyBudgetMs(REAL_FIXTURE_CLEANUP_BASE_MS));

describe("temp growth command-route performance", () => {
  it.runIf(process.platform === "darwin")(
    "records real 100k command-route timings across three independent roots",
    () => {
      const trace = darwinTmpdirGrowthPerformance(SCRIPT, directory => {
        temporaryDirectories.push(directory);
      });
      const tracePath = path.join(
        temporaryDirectories[0] as string,
        "perf-trace.json"
      );
      fs.writeFileSync(
        tracePath,
        `${JSON.stringify(trace, null, 2)}\n`,
        "utf8"
      );
      const warmupReport = JSON.parse(trace.warmup.stdout);
      expect(trace.warmup).toEqual({
        root: {
          rootIndex: 0,
          canonicalPath: expect.any(String),
          dev: expect.any(Number),
          ino: expect.any(Number),
        },
        trial: 0,
        commandElapsedMs: expect.any(Number),
        budgetMs: 5_000,
        count: 100_000,
        created: 0,
        removed: 0,
        unreclaimed: 0,
        reportElapsedMs: null,
        rateEntriesPerDay: null,
        topPrefixes: [{ prefix: "entry-*", count: 100_000 }],
        ownership: {
          total: 0,
          owned: 0,
          live: 0,
          unowned: 0,
          created: 0,
          removed: 0,
          unreclaimed: 0,
          newlyUnowned: 0,
        },
        violations: [],
        artifact: {
          path: expect.any(String),
          snapshotCount: 1,
          latestEntryCount: 100_000,
          report: warmupReport,
        },
        status: 0,
        stdout: expect.any(String),
        stderr: "",
      });
      expect(trace.warmup.commandElapsedMs).toBeLessThanOrEqual(5_000);
      expect(warmupReport).toEqual(trace.warmup.artifact.report);
      expect(trace.measuredRootSchedule).toEqual([0, 1, 2, 0, 1]);
      expect(trace.trials).toHaveLength(5);
      expect(new Set(trace.trials.map(trial => trial.root.rootIndex))).toEqual(
        new Set([0, 1, 2])
      );
      expect(trace.trials.every(trial => trial.commandElapsedMs <= 5_000)).toBe(
        true
      );
      expect(
        trace.trials.every(
          trial =>
            trial.count === 100_000 &&
            trial.status === 0 &&
            trial.stderr === "" &&
            trial.artifact.latestEntryCount === 100_000
        )
      ).toBe(true);
      expect(JSON.parse(fs.readFileSync(tracePath, "utf8"))).toEqual(trace);
    },
    ioLatencyBudgetMs(REAL_CORPUS_BASE_MS)
  );
});
