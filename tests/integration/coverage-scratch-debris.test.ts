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
 *
 * A third case arrived with CodySwannGT/lisa#3104, to drive a branch the pair
 * had left unexercised. It costs **190-312ms** — three runs, this repository,
 * 18 cores, 1-min load 17.8, vite's transform cache warm, against 1,119-1,223ms
 * and 559-673ms for the pair in the same three runs. It is the cheapest case
 * here because it spawns no test runner, and that is not a saving so much as
 * the entire reason it works: see {@link expectSweepProvedAKilledRun}.
 * @module tests/integration/coverage-scratch-debris
 */
import { spawn, spawnSync } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { once } from "node:events";
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
 * How long the sweep may take before the case gives up waiting for it.
 *
 * ## What this replaces, and why two previous forms could not work
 *
 * The kill used to land on a **timer**, and the timer was wrong twice over
 * (CodySwannGT/lisa#3095).
 *
 * It was first `ioLatencyBudgetMs(KILL_AFTER_MS)` against a target whose
 * duration was written in a comment as "~14s". That raced two independently
 * scaled quantities: a target that scales with the machine's real throughput,
 * and a kill point that scales with a measured latency multiplier. The target
 * measured **10,578 ms**, the multiplier ran 1.38-1.71x, and the window closed
 * to ~300 ms and flipped sign around 1.76x — so the case failed **when the
 * machine was fast**.
 *
 * The obvious repair — derive the kill point from the target's own measured
 * duration, making the window a ratio — was tried and **is also insufficient**,
 * which is worth recording because it looks correct. Measured under the
 * pre-push gate, where the rest of the integration suite runs alongside:
 *
 * ```
 * calibration run   21,593 ms
 * kill set for      10,797 ms   (0.5 of it)
 * killed run        finished in under 10,797 ms
 * ```
 *
 * **A 2x swing between two consecutive runs of the same target.** Whether that
 * is the calibration warming a cache the second run reuses, or the surrounding
 * suite finishing and freeing the box, a ratio cannot survive it: any timer is
 * a prediction, and this environment does not hold still long enough for one.
 *
 * ## So the kill is no longer on a timer at all
 *
 * The case waits for the **event** it actually cares about — the seeded debris
 * disappearing, which is the sweep — and kills the run the moment it observes
 * it. The window becomes a STATE rather than a duration, and no clock enters
 * the decision.
 *
 * This bound is therefore a liveness bound, not a race: it is the point at
 * which "the sweep has not happened" stops being slow and starts being the
 * defect this case exists to catch. Generous on purpose.
 */
const SWEEP_DEADLINE_MS = 60_000;

/** How often the case looks for the sweep. Cheap: a readdir of one directory. */
const SWEEP_POLL_MS = 50;

/**
 * A process whose entire life is the sweep, and nothing else.
 *
 * It does what the coverage provider's initialisation does — removes the
 * scratch directory and puts it back, the `removed and re-created` arm of the
 * table at the top of this file — and then it is finished, so it exits at
 * ~70-90ms rather than carrying a test runner's shutdown behind it.
 *
 * This exists for exactly one reason: it is the only way found to reach the
 * {@link expectSweepProvedAKilledRun} guard's failing branch. See that
 * function for the two attempts that could not, and the measurements that say
 * why no vitest child ever will.
 */
const SWEEPING_STUB = [
  "-e",
  'const fs = require("node:fs"); const dir = process.argv[1]; fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });',
];

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

/**
 * The seeded debris still present in a reports directory.
 * @param dir - The reports directory
 * @returns Names of the seeded files that survive
 */
function seededRemaining(dir: string): string[] {
  return scratchFiles(dir).filter(name => name.startsWith(SEEDED_PREFIX));
}

/**
 * Wait until the seeded debris is gone, or the deadline passes.
 *
 * Polling a directory rather than timing a process: the sweep is an observable
 * state change, and observing it is what removes the clock from this case.
 * @param dir - The reports directory
 * @returns Milliseconds waited, or null when the sweep never happened
 */
async function waitForSweep(dir: string): Promise<number | null> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < SWEEP_DEADLINE_MS) {
    if (seededRemaining(dir).length === 0) return Date.now() - startedAt;
    await new Promise(resolve => setTimeout(resolve, SWEEP_POLL_MS));
  }
  return null;
}

/**
 * Whether a spawned run is still alive, read at the moment the sweep is seen.
 *
 * A named function rather than an inline expression on purpose: the arm that
 * drives the {@link expectSweepProvedAKilledRun} guard has to read liveness
 * through the SAME code the real case reads it through. An arm that recomputed
 * the expression would be exercising its own copy and proving nothing about
 * this one.
 * @param child - The spawned coverage run
 * @returns True when the run has neither exited nor been signalled
 */
function observedLiveness(child: ChildProcess): boolean {
  return child.exitCode === null && child.signalCode === null;
}

/**
 * The discrimination the killed-run case exists to make: was anything killed?
 *
 * Liveness is read BEFORE the kill. If the run had already exited on its own,
 * the sweep proves nothing about a killed run, and that has to be caught rather
 * than papered over by a kill that lands on a corpse.
 *
 * ## This branch had never executed, and what it took to drive it
 *
 * The `stillRunning === false` path shipped unexercised (CodySwannGT/lisa#3104).
 * Two deliberate attempts to reach it both failed, and the reason recorded at
 * the time — "vitest startup outlasts the ~320ms observation" — has the number
 * right and the mechanism wrong. That matters, because the wrong mechanism
 * invites a third attempt of the same shape.
 *
 * Measured 2026-08-25, this repository, 18 cores, 1-min load 14.4-14.5, vite's
 * transform cache warm, three runs per arm, this file's own 50ms poll grain:
 *
 * | target | sweep observed | exits on its own | margin |
 * |---|---|---|---|
 * | attempt 1: the cheap target | 316-336ms | 565-589ms | **229-270ms** |
 * | attempt 2: no test files at all | 262-324ms | 1,705-1,790ms | **1,443-1,469ms** |
 *
 * The sweep lands at ~320ms in BOTH arms, because it is coverage-provider
 * initialisation and that work does not depend on which test files were named.
 * Removing the work therefore does not move the observation earlier — it moves
 * the EXIT later: vitest's "no test files found" path takes ~1.5s to shut down,
 * where actually running one trivial test takes ~250ms. **Attempt 2 was
 * strictly further from succeeding than attempt 1**, so the lever was not
 * merely too weak, it was pointing the wrong way. A third pull on it is worth
 * nothing.
 *
 * Cold, the same shape at a different scale: the session's first cheap run
 * swept at 10,136ms and exited at 10,649ms under 1-min load 19.5 — 513ms of
 * margin sitting behind ten seconds of startup.
 *
 * So the floor is not startup. It is that **every vitest process stays alive
 * for hundreds of milliseconds after its own sweep**, while the sweep is
 * observed within one 50ms poll of happening. Nothing built from a vitest child
 * can be dead at the moment its own sweep is seen, no matter how little it is
 * asked to do.
 *
 * The arm that drives this branch is therefore not a vitest child at all: it is
 * {@link SWEEPING_STUB}, a process whose whole life is the sweep. It reaches
 * this function through {@link observedLiveness} and the real
 * {@link waitForSweep}, so what it exercises is this code rather than a
 * restatement of it.
 *
 * **This guard is not dead code.** It was, and it is not any more.
 * @param stillRunning - Liveness read before the kill, from {@link observedLiveness}
 * @param sweptAfterMs - What {@link waitForSweep} returned, reported in the message
 */
function expectSweepProvedAKilledRun(
  stillRunning: boolean,
  sweptAfterMs: number | null
): void {
  expect(
    stillRunning,
    `the target finished on its own before the sweep was observed (${String(sweptAfterMs)}ms), so nothing was killed and this case proves nothing about a killed run. That is a real finding rather than a flake: the sweep is supposed to happen early in a run that lasts much longer`
  ).toBe(true);
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
    async () => {
      // The discriminating case. A sweep AFTER a run cannot run when the run is
      // killed — which is the only case that produces debris in the first
      // place — so an after-sweep would leave these 798 files exactly where
      // they are.
      //
      // The kill is triggered by OBSERVING the sweep, not by a timer. Every
      // timer tried here was a prediction about a machine that does not hold
      // still: see SWEEP_DEADLINE_MS for the two that failed and their numbers.
      const dir = seededReportsDir();
      const child = spawn(
        VITEST,
        [...SLOW_RUN, `--coverage.reportsDirectory=${dir}`],
        { cwd: ROOT, stdio: "ignore" }
      );

      const sweptAfterMs = await waitForSweep(dir);
      // Read liveness BEFORE killing. Why, and what happens when it comes back
      // false, is on expectSweepProvedAKilledRun.
      const stillRunning = observedLiveness(child);
      child.kill("SIGKILL");
      const [, signal] = (await once(child, "exit")) as [
        number | null,
        NodeJS.Signals | null,
      ];

      expect(
        sweptAfterMs,
        `the seeded debris was still there after ${SWEEP_DEADLINE_MS}ms, so no sweep happened while the run was alive. Either the sweep now runs AFTER a run rather than before it — the defect this case exists to catch — or the run never got far enough to sweep`
      ).not.toBeNull();
      expectSweepProvedAKilledRun(stillRunning, sweptAfterMs);
      expect(
        signal,
        "the run did not die by the kill, so it was not still going when the sweep was observed"
      ).toBe("SIGKILL");
      expect(
        seededRemaining(dir),
        "the killed run left the abandoned files in place after the kill, having swept them before it"
      ).toEqual([]);
    }
  );

  it(
    "reports that nothing was killed when the sweep is observed after the target has already exited",
    { timeout: ioLatencyBudgetMs(CHEAP_BUDGET_MS) },
    async () => {
      // The arm that drives the branch above. Two attempts using a vitest child
      // could not, and expectSweepProvedAKilledRun records both with the
      // measurements that say why none ever will.
      const dir = seededReportsDir();
      const child = spawn(
        process.execPath,
        [...SWEEPING_STUB, path.join(dir, ".tmp")],
        { stdio: "ignore" }
      );

      // Wait for the stub to be gone before observing, rather than racing it.
      // Left to itself the stub does win — measured, it exits 11-35ms ahead of
      // the observation, five runs of five — but that margin is an artifact of
      // the 50ms poll grain rather than a guarantee, and the case that proves a
      // guard must not be the flakiest one in the file. Forcing the order
      // produces exactly the state the guard names, with no clock in it: a
      // sweep that really happened, observed after the process that did it is
      // really dead.
      await once(child, "exit");

      const sweptAfterMs = await waitForSweep(dir);
      const stillRunning = observedLiveness(child);
      // Lands on a corpse. That is the whole point: this is the kill the guard
      // refuses to let stand in for a kill that interrupted something.
      child.kill("SIGKILL");

      expect(
        sweptAfterMs,
        "the stub did not sweep, so this arm never reached the condition it exists to produce"
      ).not.toBeNull();
      expect(
        stillRunning,
        "the stub was still running after its own exit event, so the liveness read is not reading what it claims to"
      ).toBe(false);
      expect(() => {
        expectSweepProvedAKilledRun(stillRunning, sweptAfterMs);
      }, "the guard passed a run that had already exited, which is the failure it exists to prevent").toThrowError(
        /proves nothing about a killed run/
      );
      expect(
        seededRemaining(dir),
        "the stub did not leave the scratch directory swept"
      ).toEqual([]);
    }
  );
});
