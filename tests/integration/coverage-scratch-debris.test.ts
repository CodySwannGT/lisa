/**
 * Abandoned coverage scratch files, and what they do and do not cause.
 *
 * ## The report this refutes, and the measurement that refutes it
 *
 * CodySwannGT/lisa#2961 was filed on a real red gate:
 *
 * ```
 * FAILED  required coverage-adequacy — bun run test:cov:unit (exit 1)
 *         — no recognised failure signature
 *    ↳ Serialized Error: { errno: -2, code: 'ENOENT', syscall: 'open',
 *        path: '.../coverage/.tmp/coverage-2.json' }
 * ```
 *
 * and on real debris: **1,554 abandoned scratch files** across local worktrees,
 * the two largest holdings **798** and **747**, both dated two days before and
 * both in worktrees that had been idle since. The diagnosis offered was that
 * the debris accumulates and a later run trips over it, and the remedy proposed
 * was to sweep the directory before a run.
 *
 * Measured here, the debris is real and the diagnosis is not. The coverage
 * provider ALREADY deletes that directory before every run, and it does so
 * during initialisation — before test files are even globbed — so the remedy
 * would have been a second sweep behind an existing one. A scratch file is only
 * ever read back from an in-memory list built during the run that wrote it, so
 * a previous run's files are never read at all.
 *
 * Two numbers say what the 798 files actually are. The unit suite is ~770 test
 * files and the provider writes one scratch file per test file, so **798 is one
 * run's output, not an accumulation across many** — one killed run, in a
 * worktree nothing has run in since.
 *
 * ## What did cause it
 *
 * The ENOENT is a **second coverage run in the same directory**. Its own
 * initialisation `rm`s the scratch directory and re-creates it in the next
 * statement, so the first run's files vanish underneath it. Measured
 * 2026-08-23, one run interfered with at the eight-second mark, twice, the two
 * arms differing only in whether the directory was put back:
 *
 * | scratch directory | what the run printed |
 * |---|---|
 * | removed **and re-created** | `ENOENT … open '…/coverage/.tmp/coverage-0.json'` |
 * | removed and **left absent** | `Something removed the coverage directory … not running multiple Vitests with the same "coverage.reportsDirectory" at the same time` |
 *
 * The provider's own explanation is guarded on the directory being ABSENT, so
 * the one case it was written for is the one case it cannot reach. Recognising
 * the bare form is `lib/gate-failure-diagnosis.mjs`; the cases for it are in
 * `tests/unit/scripts/gate-failure-diagnosis.test.ts`. What is left here is the
 * pair of properties the issue asked for, and they are properties of the tool
 * rather than of Lisa — which is exactly why they are worth buying. They were
 * assumed once already and the assumption was wrong in the other direction. A
 * future coverage provider that stops sweeping before a run would otherwise be
 * discovered as a red coverage gate.
 *
 * ## What they cost, measured
 *
 * **26,748 ms on CI** for the pair, against a 90.9 s integration job — so
 * roughly 29% of that job, most of it the deliberate six-second kill and two
 * child vitest startups. That ratio is a consequence of the job having just
 * lost the 42-minute whole-list mutation case, not of these cases being
 * expensive in absolute terms. If it ever becomes the binding constraint the
 * pair belongs beside that case on the nightly, and the honest number is
 * recorded here so that decision is made against it rather than against a
 * guess.
 * @module tests/integration/coverage-scratch-debris
 */
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ioLatencyBudgetMs } from "../helpers/io-latency-budget.js";

const ROOT = path.resolve(__dirname, "..", "..");
const VITEST = path.join(ROOT, "node_modules", ".bin", "vitest");

/** The largest holding measured in the wild, reproduced exactly. */
const DEBRIS_FILES = 798;

/** How abandoned files are named here, so they cannot be confused with a run's own. */
const SEEDED_PREFIX = "seeded-";

/**
 * A cheap, real coverage run: one source file, one suite, measured at ~1.2s.
 *
 * A floor of 1% rather than 0 on purpose. Zero would be cleared by a run that
 * measured nothing, and the property under test is that the run reaches a
 * VERDICT — so the floor has to be one a broken run could fail.
 */
const CHEAP_RUN = [
  "run",
  "--coverage",
  "--coverage.include=src/utils/fibonacci.ts",
  "--coverage.thresholds.lines=1",
  // Pinned rather than inherited. The banner this case reads is the
  // `text-summary` reporter's, and the default reporter list is not the same
  // everywhere: the run passed on CI and printed a `text` table with no
  // summary line, so the assertion failed on a run that had done exactly what
  // was asked of it. Naming the reporter makes the assertion a statement about
  // the run rather than about the environment's reporter defaults, and it
  // drops the html/clover/json writers this case never reads.
  "--coverage.reporter=text-summary",
  "tests/unit/utils/fibonacci.test.ts",
];

/**
 * A run long enough to still be going when the kill lands.
 *
 * How long it takes is deliberately NOT written down here any more. The number
 * that was — "~14s" — was measured under contention, drifted to 10,578 ms, and
 * the drift is what broke the case (CodySwannGT/lisa#3095). {@link measureTarget}
 * reads it from the machine the case is running on instead, and
 * {@link KILL_FRACTION} places the kill inside it as a ratio.
 *
 * Both edges still fail by name rather than as a mystery: a kill that never
 * landed is asserted directly, and a kill that landed before the sweep is one of
 * the two causes the surviving-debris message spells out.
 */
const SLOW_RUN = [
  "run",
  "--coverage",
  "--coverage.thresholds.lines=1",
  "tests/unit/core/",
];

/**
 * Where in the target's own run the kill lands, as a FRACTION of it.
 *
 * ## What this replaces, and why the previous form could not work
 *
 * This was `KILL_AFTER_MS = 6_000`, scaled through `ioLatencyBudgetMs` at every
 * use, and the reasoning beside it was:
 *
 * > A slower machine widens the window far more at the top than at the bottom,
 * > and scaling moves the kill point out under exactly the load that pushes
 * > initialisation later.
 *
 * **Measured, that is backwards** (CodySwannGT/lisa#3095). The top edge is a
 * FIXED amount of real work — the target measured **10,578 ms**, not the ~14s
 * the old comment recorded — while the kill point scaled with the machine up to
 * **8x**. Load moved the kill point *away* from the target rather than toward
 * it:
 *
 * | multiplier seen in one session | kill point | target |
 * |---|---|---|
 * | 1.38x | 8,280 ms | 10,578 ms |
 * | 1.69x | 10,140 ms | 10,578 ms |
 * | 1.71x | 10,260 ms | 10,578 ms |
 *
 * The window had closed to ~300 ms and flipped sign at about 1.76x, so the case
 * failed **when the machine was fast** — the target finishing before the kill
 * landed. Standalone it failed 1 run in 2; through the pre-push gate, 2 of 2.
 *
 * ## Why a ratio removes the class rather than widening it
 *
 * The old form raced two independently-scaled quantities: a target that scales
 * with the machine's real throughput, and a kill point that scales with a
 * measured latency multiplier. Nothing tied them together, so "the window" was
 * an accident of how those two happened to move.
 *
 * The kill point is now derived from **this machine's own measured target
 * duration**, so both edges scale together by construction and no latency
 * multiplier enters it at all. A machine twice as slow has a target twice as
 * long and a kill point twice as late.
 *
 * ## Why 0.5
 *
 * Measured on this repository: vitest writes its first scratch file ~3s into a
 * 10,578 ms run — a ratio of **0.28**. Half-way therefore sits above the lower
 * edge with ~1.8x of margin, and that margin holds on any machine where
 * initialisation and total work scale together, which is the same vitest doing
 * both.
 *
 * **Raising this is the wrong repair and always was.** The obvious fix — push
 * the kill point later — moves it further past the target and makes the failure
 * MORE likely. The assertion message used to suggest exactly that; it no longer
 * does.
 */
const KILL_FRACTION = 0.5;

/** Bound on the cheap run, generous enough that only a hang can reach it. */
const CHEAP_BUDGET_MS = 120_000;

const created: string[] = [];

/**
 * A temporary directory that `afterEach` will remove.
 *
 * The registration happens inside here so callers can treat the whole thing as
 * a definition. Pushing at the call site would put a side effect ahead of the
 * definitions that follow it, and reordering to satisfy that would leave the
 * directory untracked across the call that can throw.
 * @param prefix - mkdtemp prefix
 * @returns The created directory
 */
function trackedTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  created.push(dir);
  return dir;
}

/**
 * How long the target takes on THIS machine, to completion.
 *
 * Run against a throwaway reports directory rather than the seeded one: this
 * run finishes, so it would sweep the debris the case is about to look for.
 *
 * It is a real run of the real target, not an estimate. That is the whole point
 * — the previous form estimated it once, wrote "~14s" in a comment, and the
 * comment went stale while continuing to be trusted.
 * @returns Wall-clock milliseconds for one uninterrupted target run
 */
function measureTarget(): number {
  const dir = trackedTempDir("lisa-cov-calib-");
  const startedAt = Date.now();
  const run = spawnSync(
    VITEST,
    [...SLOW_RUN, `--coverage.reportsDirectory=${dir}`],
    {
      cwd: ROOT,
      encoding: "utf-8",
      killSignal: "SIGKILL",
      // Generous, and never the thing that decides: a calibration run that is
      // itself killed measures the bound rather than the target, so it is
      // refused below rather than used.
      timeout: ioLatencyBudgetMs(CHEAP_BUDGET_MS / 2),
    }
  );
  const elapsed = Date.now() - startedAt;
  expect(
    run.signal,
    `the calibration run was killed (${run.signal}) rather than finishing, so its duration is a property of the bound and not of the target; nothing downstream of it can be trusted`
  ).toBeNull();
  return elapsed;
}

/**
 * A scratch reports directory holding one killed run's worth of debris.
 *
 * Outside the repository deliberately. Seeding the repository's own `coverage/`
 * would make this suite the second concurrent writer of that directory — the
 * exact collision it exists to describe.
 * @returns The reports directory, with `.tmp` already populated
 */
function seededReportsDir(): string {
  const dir = trackedTempDir("lisa-cov-debris-");
  const scratch = path.join(dir, ".tmp");
  fs.mkdirSync(scratch);
  for (let index = 0; index < DEBRIS_FILES; index += 1)
    fs.writeFileSync(path.join(scratch, `${SEEDED_PREFIX}${index}.json`), "{}");
  return dir;
}

/**
 * Whatever is in a reports directory's scratch subdirectory now.
 * @param dir - The reports directory
 * @returns File names, or an empty list when the directory is gone
 */
function scratchFiles(dir: string): string[] {
  const scratch = path.join(dir, ".tmp");
  return fs.existsSync(scratch) ? fs.readdirSync(scratch) : [];
}

afterEach(() => {
  for (const dir of created.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("coverage scratch debris", () => {
  it(
    "reaches a coverage verdict with a killed run's debris already there",
    { timeout: ioLatencyBudgetMs(CHEAP_BUDGET_MS) },
    () => {
      const dir = seededReportsDir();
      expect(scratchFiles(dir)).toHaveLength(DEBRIS_FILES);

      const run = spawnSync(
        VITEST,
        [...CHEAP_RUN, `--coverage.reportsDirectory=${dir}`],
        {
          cwd: ROOT,
          encoding: "utf-8",
          killSignal: "SIGKILL",
          timeout: ioLatencyBudgetMs(CHEAP_BUDGET_MS / 2),
        }
      );

      expect(
        run.signal,
        `the coverage run was killed (${run.signal}) rather than finishing, so this proves nothing about debris:\n${run.stdout}${run.stderr}`
      ).toBeNull();
      expect(
        run.status,
        `coverage run output:\n${run.stdout}${run.stderr}`
      ).toBe(0);
      expect(`${run.stdout}${run.stderr}`).toContain("Coverage summary");
      expect(
        scratchFiles(dir).filter(name => name.startsWith(SEEDED_PREFIX))
      ).toEqual([]);
    }
  );

  it(
    "sweeps the debris even when the run that sweeps it is killed",
    { timeout: ioLatencyBudgetMs(CHEAP_BUDGET_MS) },
    () => {
      // The discriminating case. A sweep AFTER a run cannot run when the run is
      // killed — which is the only case that produces debris in the first
      // place — so an after-sweep would leave these 798 files exactly where
      // they are. They are gone, therefore the sweep happens before.
      // Calibrate against THIS machine before racing it. The kill point is a
      // fraction of the target's own duration, so both edges of the window
      // scale together and no latency multiplier enters it.
      const targetMs = measureTarget();
      const killAtMs = Math.round(targetMs * KILL_FRACTION);
      const dir = seededReportsDir();

      const run = spawnSync(
        VITEST,
        [...SLOW_RUN, `--coverage.reportsDirectory=${dir}`],
        {
          cwd: ROOT,
          encoding: "utf-8",
          killSignal: "SIGKILL",
          timeout: killAtMs,
        }
      );
      const remaining = scratchFiles(dir);

      expect(
        run.signal,
        `the target finished before the kill landed, so nothing was killed and this case proves nothing. It was measured at ${targetMs}ms on this machine and the kill was set for ${killAtMs}ms; the target varying that much between two consecutive runs is the thing to investigate, NOT KILL_FRACTION — raising it moves the kill further past the target and makes this worse`
      ).toBe("SIGKILL");
      expect(
        remaining.filter(name => name.startsWith(SEEDED_PREFIX)),
        `the killed run left the abandoned files in place. Either the sweep now runs AFTER a run rather than before it — the defect this case exists to catch — or the kill landed at ${killAtMs}ms of a ${targetMs}ms target, before initialisation had swept, in which case LOWER KILL_FRACTION is wrong and the target is too short to contain a sweep`
      ).toEqual([]);
    }
  );
});
