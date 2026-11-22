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
import {
  fsyncSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statfsSync,
  statSync,
} from "node:fs";
import { cpus, loadavg, release, tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  fillProbeDirectory,
  FS_PROBE_ENTRIES,
  fsBudgetDerivation,
  fsLatencyBudgetMs,
  fsSlowdownFactorFrom,
  MAX_FS_SLOWDOWN,
  measureUnlinkLatencyUs,
  PROBE_FILE_BYTES,
  QUIET_UNLINK_LATENCY_US,
  workerFsSlowdown,
} from "../../helpers/fs-latency-budget.js";
import { pairedAgreement } from "../../helpers/fs-probe-diagnostic.js";
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
 * The corpus each paired reading deletes, in entries.
 *
 * Ten times the probe. The hosted decomposition of CodySwannGT/lisa#5066 put
 * the cost a removal pays once (its `mkdtemp`/`rmdir` ends) at 0.06-0.48ms on
 * ubuntu-24.04 and ubuntu-26.04, against 122-127us per entry, so at 200
 * entries the fixed ends are under 2% of the reading and the per-entry figure
 * is the one a 100,000-entry teardown pays. Five pairs of 200 write about the
 * 1,000 synced files the single corpus used to, keeping the case near a
 * second on a hosted runner.
 */
const REAL_CORPUS_ENTRIES = 200;

/**
 * Paired readings the agreement case takes; the verdict is their median,
 * as the probe's own figure is a median of five cycles.
 */
const AGREEMENT_PAIRS = 5;

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
 * Build a corpus written exactly as the probe writes its files, registered
 * for teardown. A corpus of a different kind of file would compare the probe
 * with an operation it does not claim to stand for.
 * @param entries - Number of files to create.
 * @returns The directory path.
 */
const buildCorpus = (entries: number): string => {
  const directory = fillProbeDirectory(entries);
  temporaryDirectories.push(directory);
  return directory;
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

describe("the probe's files hold real blocks (CodySwannGT/lisa#4636)", () => {
  /**
   * Measured on hosted run 43251544381: one-byte files freed before they were
   * synced sent the device no discards at all, and the probe read 0.25-0.28 of
   * a real removal. Allocated, synced files read 0.94-1.12 of it.
   */
  it("writes each entry as a full 4 KiB block", () => {
    const directory = buildCorpus(FS_PROBE_ENTRIES);

    const sizes = readdirSync(directory).map(
      name => statSync(path.join(directory, name)).size
    );

    expect(PROBE_FILE_BYTES).toBe(4096);
    expect(sizes).toEqual(Array.from({ length: 20 }, () => 4096));
  });

  // The default sync is the real `fsyncSync`: the 4 KiB case above runs it.
  // Whether a synced block is what makes removal pay its discard is a fact
  // about the hosted device, so the hosted diagnostic is the real check of it.
  it("syncs every entry before handing the directory to the timed removal", () => {
    const synced: number[] = [];

    const directory = fillProbeDirectory(FS_PROBE_ENTRIES, fd => {
      fsyncSync(fd);
      synced.push(fd);
    });
    temporaryDirectories.push(directory);

    expect(synced).toHaveLength(FS_PROBE_ENTRIES);
    expect(readdirSync(directory)).toHaveLength(FS_PROBE_ENTRIES);
  });
});

describe("a probe fill that fails", () => {
  it("removes its directory before rethrowing", () => {
    const root = mkdtempSync(path.join(tmpdir(), "lisa-fs-probe-root-"));
    temporaryDirectories.push(root);

    expect(() =>
      fillProbeDirectory(
        FS_PROBE_ENTRIES,
        () => {
          throw new Error("EIO: i/o error, fsync");
        },
        root
      )
    ).toThrow(/EIO/);
    expect(readdirSync(root)).toEqual([]);
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
   *
   * "The same window" is taken literally (CodySwannGT/lisa#5066). This case
   * once took the probe's five cycles, then wrote a 1,000-file corpus, then
   * timed its removal: two windows a few hundred milliseconds apart. Unit
   * shard 1/10 of run 44503175637 (ubuntu-26.04) read the probe at 1166us
   * per entry and the real removal at 122us, a 9.5 ratio. The hosted
   * diagnostic on that image puts the quiet probe at 126-140us and the real
   * removal at 125-171us, with no fixed cost to speak of, so the real reading
   * was the quiet one and the probe's had taken a stall of about 20ms in at
   * least three of its five 2.6ms cycles. A stall that lands in one window and
   * not the other is not disagreement between the probe and the operation.
   * Each pair now times one probe cycle and one real removal back to back.
   */
  it("agrees with a real corpus deletion measured in the same window", () => {
    const machine = {
      startedAt: new Date().toISOString(),
      runtime: process.version,
      platform: process.platform,
      release: release(),
      arch: process.arch,
      cpuModel: cpus()[0]?.model ?? null,
      cpuCount: cpus().length,
      tmpdir: tmpdir(),
      tmpFilesystemType: statfsSync(tmpdir()).type,
      loadBefore: loadavg(),
    };
    const agreement = pairedAgreement(AGREEMENT_PAIRS, REAL_CORPUS_ENTRIES);
    const observation = JSON.stringify({
      ...agreement,
      machine,
      loadAfter: loadavg(),
      completedAt: new Date().toISOString(),
    });

    expect(agreement.probeUs).toHaveLength(AGREEMENT_PAIRS);
    expect(agreement.ratio, observation).toBeGreaterThan(
      1 / AGREEMENT_TOLERANCE
    );
    expect(agreement.ratio, observation).toBeLessThan(AGREEMENT_TOLERANCE);
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
   * assertion that fails against the pre-fix tree: the first three of these
   * teardowns were scaled by `ioLatencyBudgetMs` there. The fourth already
   * used this proxy; its row pins that its budget stays this proxy at the
   * unchanged 30 s base (CodySwannGT/lisa#4548).
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
    [
      // Its base stays 30 s: the corpus it removes got smaller instead
      // (CodySwannGT/lisa#4548).
      "the packed-host owned-root teardown",
      "tests/integration/shared-runtime-packed-hosts.test.ts",
      "}, fsLatencyBudgetMs(30_000));",
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
