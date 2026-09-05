/**
 * The filesystem proxy that deletion-dominated budgets scale on.
 *
 * CodySwannGT/lisa#3936. Spawn latency was standing in for general I/O
 * contention on hooks whose entire cost is `fs.rmSync` over a corpus, and for
 * that job it UNDER-SCALES: measured across nine paired samples on this box,
 * the real deletion cost swung 2.64x while the spawn-derived factor moved
 * 1.43x, reading exactly 1.00 — a quiet box, no widening at all — in five of
 * the eight, one of them with the real deletion running 71% above its cheapest
 * reading.
 *
 * Three layers here, and the middle one is the point. The arithmetic is tested
 * purely, because a guard whose verdict depends on how busy the box is cannot
 * be tested by making the box busy. The PROXY is tested empirically, because
 * "this measurement stands for that operation" is a claim about the world and
 * the only way to check it is to measure both. And the WIRING is tested by
 * reading the call sites, because a calibrator nothing calls is a calibrator
 * that fixed nothing.
 * @module tests/unit/helpers/fs-latency-budget
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  fsBudgetDerivation,
  fsLatencyBudgetMs,
  fsSlowdownFactorFrom,
  MAX_FS_SLOWDOWN,
  measureUnlinkLatencyUs,
  QUIET_UNLINK_LATENCY_US,
  workerFsSlowdown,
} from "../../helpers/fs-latency-budget.js";
import {
  slowdownFactorFrom,
  useIoLatencyBudget,
} from "../../helpers/io-latency-budget.js";

// One case here deletes a real corpus, which is the only honest way to check
// that the probe stands for the operation it claims to. Measured at 1.1s with
// 1 sibling vitest process live and a 1-minute load average of 19.2 on 18
// cores.
useIoLatencyBudget();

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

/**
 * The corpus the empirical case deletes, in entries.
 *
 * 2,000 rather than the 5,000 the recorded figures were taken against: it is
 * 100x the probe, which is enough for the fixed `mkdtemp`/`rmdir` ends to stop
 * mattering, and it keeps the case near a second on a contended box.
 */
const REAL_CORPUS_ENTRIES = 2_000;

/**
 * How far the probe may sit from the operation it stands for.
 *
 * Measured agreement across nine paired samples was a 0.56-1.15 ratio. 4x
 * either way is deliberately far looser than that, because this case must not
 * flake — and it is still tight enough to fail the thing it is guarding
 * against: a spawn median of 14.7-25.8ms over the same window is a per-entry
 * equivalent roughly 500x the probe's, which no tolerance of this shape
 * admits.
 */
const AGREEMENT_TOLERANCE = 4;

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

/**
 * Build a directory of small files, registered for teardown.
 * @param entries - Number of files to create.
 * @returns The directory path.
 */
const buildCorpus = (entries: number): string => {
  const directory = mkdtempSync(path.join(tmpdir(), "lisa-fs-corpus-"));
  temporaryDirectories.push(directory);
  Array.from({ length: entries }, (_unused, index) => {
    writeFileSync(path.join(directory, `entry-${index}`), "x");
    return index;
  });
  return directory;
};

/**
 * Time only the recursive deletion of a prepared corpus.
 * @param entries - Number of files the corpus holds.
 * @returns Per-entry deletion cost in microseconds.
 */
const timeRealDeletionUs = (entries: number): number => {
  const directory = buildCorpus(entries);
  const startedAt = performance.now();
  rmSync(directory, { force: true, recursive: true });
  return ((performance.now() - startedAt) / entries) * 1000;
};

describe("fsSlowdownFactorFrom", () => {
  it("reports the quiet reference as exactly 1", () => {
    expect(fsSlowdownFactorFrom(QUIET_UNLINK_LATENCY_US)).toBe(1);
  });

  it("never returns a factor below 1, so a budget can only widen", () => {
    expect(fsSlowdownFactorFrom(1)).toBe(1);
    expect(fsSlowdownFactorFrom(QUIET_UNLINK_LATENCY_US / 10)).toBe(1);
  });

  it("scales linearly between the floor and the ceiling", () => {
    expect(fsSlowdownFactorFrom(QUIET_UNLINK_LATENCY_US * 2)).toBe(2);
    expect(fsSlowdownFactorFrom(QUIET_UNLINK_LATENCY_US * 3.5)).toBe(3.5);
  });

  it("clamps at the ceiling, so a pathological box cannot buy silence", () => {
    expect(fsSlowdownFactorFrom(QUIET_UNLINK_LATENCY_US * 1_000)).toBe(
      MAX_FS_SLOWDOWN
    );
  });

  it("treats an unusable reading as no information rather than as fast", () => {
    expect(fsSlowdownFactorFrom(0)).toBe(1);
    expect(fsSlowdownFactorFrom(-5)).toBe(1);
    expect(fsSlowdownFactorFrom(Number.NaN)).toBe(1);
    expect(fsSlowdownFactorFrom(Number.POSITIVE_INFINITY)).toBe(1);
  });
});

describe("fsLatencyBudgetMs", () => {
  it("never derives a budget below its quiet-box base", () => {
    expect(fsLatencyBudgetMs(120_000)).toBeGreaterThanOrEqual(120_000);
  });

  it("stays under the base times the ceiling", () => {
    expect(fsLatencyBudgetMs(120_000)).toBeLessThanOrEqual(
      120_000 * MAX_FS_SLOWDOWN
    );
  });

  it("is the base times this worker's measured filesystem slowdown", () => {
    expect(fsLatencyBudgetMs(1_000)).toBe(
      Math.round(1_000 * workerFsSlowdown())
    );
  });

  it("remembers the measurement rather than re-probing on every call", () => {
    expect(workerFsSlowdown()).toBe(workerFsSlowdown());
  });
});

describe("measureUnlinkLatencyUs", () => {
  it("returns a positive finite per-entry cost", () => {
    const measured = measureUnlinkLatencyUs(3);

    expect(Number.isFinite(measured)).toBe(true);
    expect(measured).toBeGreaterThan(0);
  });
});

describe("the probe stands for the operation it is a proxy for", () => {
  /**
   * The empirical claim, and the one that separates this proxy from the spawn
   * one it replaces at these call sites. A proxy is only a proxy if it moves
   * with the thing it stands for; measuring both in the same window is the
   * only way to check that, and a fixed expected value would be a property of
   * whichever box recorded it.
   */
  it("agrees with a real corpus deletion measured in the same window", () => {
    const probeUs = measureUnlinkLatencyUs();
    const realUs = timeRealDeletionUs(REAL_CORPUS_ENTRIES);
    const ratio = probeUs / realUs;

    expect(ratio).toBeGreaterThan(1 / AGREEMENT_TOLERANCE);
    expect(ratio).toBeLessThan(AGREEMENT_TOLERANCE);
  });
});

/**
 * One paired observation, recorded rather than re-measured.
 *
 * Taken 2026-09-05 on an 18-core arm64 box at a 1-minute load average of 16.36
 * with `ps aux | grep -c '[v]itest'` = 1: a `node -e ""` spawn median, a
 * 20-entry probe, and a real 5,000-entry `rmSync`, timed in that order in the
 * same instant.
 *
 * Hard-coded because the CLAIM is about this observation. Re-measuring here
 * would test whichever box the suite happens to run on, and the failure this
 * pins is not reproducible on demand — the load-bearing evidence in
 * CodySwannGT/lisa#3936 is a budget blown at a 1-minute load average of 19.5,
 * which is what rules out "the box was simply busy" and makes the under-scaling
 * claim falsifiable rather than a story about contention.
 */
const OBSERVED = {
  loadAverage1: 16.36,
  spawnMedianMs: 22.81,
  probePerEntryUs: 57.7,
  realPerEntryUs: 103.9,
} as const;

/** How slow the filesystem actually was: 103.9us against a 30us reference. */
const OBSERVED_FILESYSTEM_SLOWDOWN = 3.46;

describe("the shape the ticket was filed on", () => {
  /**
   * The whole defect in one assertion: a deletion-dominated cost running 3.46x
   * slow, against a spawn-derived factor that called the box 1.27x — generous
   * enough that the budget it derives is the one that gets blown. Pure over a
   * recorded observation, so it cannot flake and cannot be re-derived from
   * whichever machine runs it.
   */
  it("the spawn factor under-reports a slow filesystem and the probe does not", () => {
    const spawnFactor = slowdownFactorFrom(OBSERVED.spawnMedianMs);
    const probeFactor = fsSlowdownFactorFrom(OBSERVED.probePerEntryUs);

    expect(spawnFactor).toBeCloseTo(1.27, 2);
    expect(probeFactor).toBeCloseTo(1.92, 2);
    // The spawn proxy is off by more than a factor of two against what the
    // filesystem was actually doing; the probe is inside a factor of two.
    expect(OBSERVED_FILESYSTEM_SLOWDOWN / spawnFactor).toBeGreaterThan(2.5);
    expect(OBSERVED_FILESYSTEM_SLOWDOWN / probeFactor).toBeLessThan(2);
  });

  it("derives the wider budget for the same base, at that observation", () => {
    const spawnBudgetMs = Math.round(
      120_000 * slowdownFactorFrom(OBSERVED.spawnMedianMs)
    );
    const probeBudgetMs = Math.round(
      120_000 * fsSlowdownFactorFrom(OBSERVED.probePerEntryUs)
    );

    expect(probeBudgetMs).toBeGreaterThan(spawnBudgetMs);
    // Not merely wider: wider by more than half again, which is the difference
    // between a budget the teardown fits in and one it does not.
    expect(probeBudgetMs / spawnBudgetMs).toBeGreaterThan(1.5);
  });

  it("records the machine state the observation was taken under", () => {
    // A timing figure without its conditions is the failure the sibling module
    // opens by describing. If this constant is ever re-recorded, its load
    // average moves with it.
    expect(OBSERVED.loadAverage1).toBeGreaterThan(0);
    expect(OBSERVED.realPerEntryUs / QUIET_UNLINK_LATENCY_US).toBeCloseTo(
      OBSERVED_FILESYSTEM_SLOWDOWN,
      2
    );
  });
});

describe("the derivation cites what it was measured from", () => {
  it("names the measured cost, the quiet reference, and the ceiling", () => {
    const derivation = fsBudgetDerivation();

    expect(derivation).toContain("filesystem slowdown");
    expect(derivation).toContain("per unlinked entry");
    expect(derivation).toContain(`${QUIET_UNLINK_LATENCY_US}us`);
    expect(derivation).toContain(`${MAX_FS_SLOWDOWN}x`);
  });
});

describe("the deletion-dominated call sites are wired to it", () => {
  /**
   * The wiring check. A calibrator nothing calls fixes nothing, and this is the
   * assertion that fails against the pre-fix tree: all three of these teardowns
   * were scaled by `ioLatencyBudgetMs` there.
   */
  it.each([
    [
      "the live 100k-entry teardown",
      "tests/unit/scripts/measure-tmpdir-growth-performance.test.ts",
      "}, fsLatencyBudgetMs(REAL_FIXTURE_CLEANUP_BASE_MS));",
    ],
    [
      "the unit teardown whose corpus was shrunk instead",
      "tests/unit/scripts/measure-tmpdir-growth.test.ts",
      "}, fsLatencyBudgetMs(REAL_FIXTURE_CLEANUP_BASE_MS));",
    ],
    [
      "the packed-bin scratch-tree teardown",
      "tests/integration/lisa-test-run-packed-bin.test.ts",
      "}, fsLatencyBudgetMs(TEARDOWN_BASE_MS));",
    ],
  ])("%s scales on the filesystem proxy", (_label, relative, expected) => {
    const source = readFileSync(path.join(REPO_ROOT, relative), "utf-8");

    expect(source).toContain(expected);
  });

  it("leaves the spawn-dominated cases in those files on the spawn proxy", () => {
    const source = readFileSync(
      path.join(
        REPO_ROOT,
        "tests/integration/lisa-test-run-packed-bin.test.ts"
      ),
      "utf-8"
    );

    expect(source).toContain("}, ioLatencyBudgetMs(90_000));");
  });
});
