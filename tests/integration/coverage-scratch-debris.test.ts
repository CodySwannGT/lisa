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
 * Measured on this repository: vitest writes its first scratch file ~3s in and
 * this target finishes at ~14s, so {@link KILL_AFTER_MS} sits inside a window
 * whose lower bound is startup and whose upper bound is the whole run. A slower
 * machine widens the window far more at the top than at the bottom, and both
 * edges fail by name rather than as a mystery: a kill that never landed is
 * asserted directly, and a kill that landed before the sweep is one of the two
 * causes the surviving-debris message spells out.

 * 6s rather than the 3s a bare shell run needs, because this child is started
 * from inside a vitest worker and pays that startup twice.
 */
const SLOW_RUN = [
  "run",
  "--coverage",
  "--coverage.thresholds.lines=1",
  "tests/unit/core/",
];

/**
 * Where in that window the kill lands, on a quiet box.
 *
 * Scaled through {@link ioLatencyBudgetMs} at every use. The binding risk here
 * is the LOWER edge — a kill landing before initialisation has swept — and
 * scaling moves the kill point out under exactly the load that pushes
 * initialisation later, which is the direction that keeps it inside the window.
 */
const KILL_AFTER_MS = 6_000;

/** Bound on the cheap run, generous enough that only a hang can reach it. */
const CHEAP_BUDGET_MS = 120_000;

const created: string[] = [];

/**
 * A scratch reports directory holding one killed run's worth of debris.
 *
 * Outside the repository deliberately. Seeding the repository's own `coverage/`
 * would make this suite the second concurrent writer of that directory — the
 * exact collision it exists to describe.
 * @returns The reports directory, with `.tmp` already populated
 */
function seededReportsDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lisa-cov-debris-"));
  const scratch = path.join(dir, ".tmp");
  created.push(dir);
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
      const dir = seededReportsDir();

      const run = spawnSync(
        VITEST,
        [...SLOW_RUN, `--coverage.reportsDirectory=${dir}`],
        {
          cwd: ROOT,
          encoding: "utf-8",
          killSignal: "SIGKILL",
          timeout: ioLatencyBudgetMs(KILL_AFTER_MS),
        }
      );
      const remaining = scratchFiles(dir);

      expect(
        run.signal,
        "the target finished before the kill landed, so nothing was killed and this case proves nothing — give SLOW_RUN a larger target or raise KILL_AFTER_MS"
      ).toBe("SIGKILL");
      expect(
        remaining.filter(name => name.startsWith(SEEDED_PREFIX)),
        "the killed run left the abandoned files in place. Either the sweep now runs AFTER a run rather than before it — the defect this case exists to catch — or the kill landed before initialisation finished, in which case raise KILL_AFTER_MS"
      ).toEqual([]);
    }
  );
});
