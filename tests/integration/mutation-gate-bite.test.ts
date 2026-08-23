/**
 * The bite test for the mutation gate itself.
 *
 * A gate that cannot fail is the exact defect this gate was built to catch, so
 * asserting its wiring is not enough — something has to weaken a guard's tests
 * and watch the gate go red. That is what this does: it runs the gate that
 * actually guards pull requests, twice — once with every suite, and once with a
 * guard's suites withheld — and requires the first to pass and the second to
 * fail.
 *
 * **It runs the COMMITTED configuration, and overrides no threshold.** An
 * earlier draft mutated a single guard against a threshold of 45 invented for
 * the occasion. It went red, which looked like proof and was not: the withheld
 * run scored 36.27, and 36.27 passes the real floor of 32. The test failed only
 * because of the substituted number, so it proved the gate could fail in a
 * world that does not exist — a bite test that cannot bite, inside the gate
 * built to find those. Hence {@link assertNoSyntheticThreshold}: the threshold
 * Stryker reports back is compared against the committed one on every run, so
 * reintroducing an override fails this test by name instead of quietly
 * restoring the illusion.
 *
 * The weakening is withholding suites rather than editing assertions on disk,
 * for two reasons. It is the same thing mechanically — a test that no longer
 * runs cannot kill a mutant, which is what a gutted assertion amounts to — and
 * it cannot leave the working tree modified if the process dies mid-run.
 *
 * WHICH suites is not a fixed list; see {@link WITHHELD_GUARDS} for why a
 * hardcoded filename went stale the moment a guard's coverage improved.
 *
 * **The whole-list pass is OFF on the pull-request path.** It was 99.9% of the
 * integration job and it is now gated behind `LISA_WHOLE_LIST_MUTATION_BITE`,
 * which a nightly workflow sets and no pull request does. Nothing was deleted
 * and no assertion was weakened; see {@link WHOLE_LIST_BITE_ENABLED} for the
 * numbers, for what still runs per-PR in its place, and for how to run it here.
 * @module tests/integration/mutation-gate-bite
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { describe, expect, it } from "vitest";

import type { GateRun } from "../helpers/gate-capture.js";
import { captureGateRun } from "../helpers/gate-capture.js";
import {
  suitesByGuard,
  suitesReachingGuards,
} from "../../vitest.config.mutation";

const ROOT = path.resolve(__dirname, "..", "..");
const STRYKER = path.join(ROOT, "node_modules", ".bin", "stryker");

/**
 * Wall-clock budget for ONE pass of the whole-list gate, in ms.
 *
 * ## What this replaces, and why one number could not be written
 *
 * A single case used to run the gate TWICE — intact, then weakened — under one
 * budget, and the pairing is what made that budget undeclarable. Its own
 * docstring worked the arithmetic out to a contradiction: passing a healthy run
 * needed more than 53.5 min, and being observable before the job ceiling needed
 * 33.5 or less. No value satisfies both, so the number that shipped (56 min)
 * was documented, honestly, as a best-effort late detector rather than a bound.
 *
 * Splitting the case dissolves that by changing the quantity being bounded
 * rather than by changing the number.
 *
 * ## Measured
 *
 * The combined case on a hosted runner, after CodySwannGT/lisa#2962 bounded six
 * fixture spawns and took `lisa-work-item.mjs` from 237 mutant timeouts to 37 —
 * run `32632558547`, job `97177401609`:
 *
 * | case | elapsed |
 * |---|---|
 * | both passes, one `it` | 2,502,502 ms = **41.71 min** |
 * | the single-guard case | 28,849 ms |
 *
 * A pass is therefore **~20.9 min** on average. The two are not equal, and the
 * weakened one is the expensive one: a mutant that SURVIVES runs every test
 * covering it to completion, while a killed one stops at the first failure —
 * and weakening is precisely what converts kills into survivors. At a 60/40
 * split the slow pass is ~25 min.
 *
 * 35 minutes is **1.4x** that. Against the worst combined sample ever recorded
 * (53.54 min, pre-#2962) the implied slow pass is ~32.1 min, so it is still
 * 1.09x the worst pass this file has ever produced.
 *
 * The distribution it is sized against is now a NIGHTLY one — the case runs on
 * `.github/workflows/nightly-mutation-wholelist-bite.yml` and no longer on the
 * pull-request path — so re-measure it from that workflow's per-case durations,
 * not from an integration job that no longer contains it.
 *
 * ## The ceiling arithmetic, which is the actual repair
 *
 * That workflow allows 90 minutes. Two passes at this budget is 70, so BOTH
 * budgets can fire and still be reported rather than swallowed by an anonymous
 * job cancellation. Under the old single budget the report arrived at best once
 * and said only "the case" — never which pass.
 *
 * ## What the split does NOT do
 *
 * It does not remove a single mutant of work. Both passes still run and the
 * gate still costs what it costs; CodySwannGT/lisa#2944's runtime question is
 * not answered by this.
 *
 * And it does not restore preemption. {@link runGate} captures a SYNCHRONOUS
 * child, so the callback never yields and no timer can interrupt it. The
 * overrun is still reported — vitest 4.1.9's `withTimeout` compares elapsed
 * against the budget after a synchronous body returns, deliberately, so that a
 * body which never yielded is not waved through — but it is reported AFTER the
 * fact. This is a detector at a call boundary, never a bound during the run.
 * Splitting the case halves the distance to the next call boundary; giving the
 * child its own `timeout:` is what would make it a bound, and that is
 * CodySwannGT/lisa#2943.
 */
const PASS_BUDGET_MS = 2_100_000;

/**
 * Wall-clock budget for the single-guard case, in ms.
 *
 * It shared the whole-list budget until now, which meant 56 minutes over a case
 * measured at 28,849 ms and 38,134 ms — 88x its cost, and 93% of the 60-minute
 * ceiling on the pull-request job that still runs it. A budget that large
 * inside a ceiling that close cannot fire before the job is cancelled: the same
 * defect the whole-list budget had, left on the one heavy case a pull request
 * still pays for.
 *
 * 20 minutes is 31x the worse of the two measurements. That is far more
 * headroom than the work needs, deliberately: this repository has measured 20x
 * tails on a contended box — `/usr/bin/git` at 20,727 ms against a median of 24
 * — so a budget sized at a small multiple of a quiet-box reading is a flake
 * generator rather than a detector. What changed is the relationship to the
 * ceiling, not the relationship to the work: 20 min is 3x UNDER the job's 60,
 * so an overrun is reported by this case, by name.
 */
const GUARD_ALONE_BUDGET_MS = 1_200_000;

/**
 * Whether the whole-list pass runs. **Off by default, and deliberately so.**
 *
 * ## The measurement
 *
 * Run `32632558547`: this ONE case cost **2,531,359 ms of a 2,533,560 ms**
 * integration job — **99.9%** of it. All **68** other integration files
 * together totalled roughly **2 seconds**. At **42.6 min** the job was the
 * critical path of the entire pipeline; the next slowest job anywhere in it was
 * **7.3 min**. Every pull request paid that, on every push.
 *
 * It costs that because it runs the full committed gate TWICE — intact, then
 * with {@link WITHHELD_GUARDS}' suites withheld — over ~6,286 mutants. **The
 * gate that actually guards pull requests is diff-only and takes 7.3 min**, so
 * this case cost roughly SIX TIMES the gate it proves, to prove a gate shape no
 * pull request ever runs.
 *
 * ## What is NOT deferred
 *
 * Nothing here was deleted, narrowed, or relaxed. The cases below carry every
 * assertion the single case did, and every threshold it read. What changed is
 * that the two passes are now separately named and separately budgeted
 * (CodySwannGT/lisa#2944), so an overrun says WHICH pass overran.
 *
 * Three things still run on every pull request and are what make this a
 * deferral rather than a deletion:
 *
 * - the {@link WITHHELD_GUARDS} conformance case above, which is the thing that
 *   goes stale — a guard leaving the mutate list, or losing its suites, fails
 *   it in milliseconds, so the deferred case cannot rot unnoticed between
 *   scheduled runs;
 * - `mutation gate bite: the destructive guard alone`, measured at **23.15 s**,
 *   which proves the COMMITTED configuration can still go red on a single-file
 *   diff — the shape a pull request actually has;
 * - `tests/integration/mutation-gate-diff-bite`, **8 s**, which proves the
 *   shipped `lisa-mutation.mjs` selects, runs, and fails for real.
 *
 * ## Something still runs this
 *
 * `.github/workflows/nightly-mutation-wholelist-bite.yml` sets this variable on
 * a nightly schedule, and files an issue when the run goes red.
 * `tests/unit/config/wholelist-mutation-bite-scheduled.test.ts` fails if that
 * workflow stops setting it, stops running this file, or disappears — a gate
 * nothing runs is not deferred, it is deleted.
 *
 * ## Running it here
 *
 * ```sh
 * LISA_WHOLE_LIST_MUTATION_BITE=1 bun run test \
 *   tests/integration/mutation-gate-bite.test.ts
 * ```
 *
 * Budget an hour. The deferred work is now three cases rather than one — a
 * pass, a pass, and the comparison between them — so a `-t` filter that names
 * only one of them runs half the gate and leaves the comparison with nothing to
 * read. Run the file.
 *
 * ## Temporary
 *
 * CodySwannGT/lisa#2966 defers it; CodySwannGT/lisa#2944 owns the cause — this
 * gate ran in **1m13s** three days before those samples. When #2944's runtime
 * work lands, the cases are cheap again and this variable should go with them,
 * not outlive them. Splitting the passes is NOT that: it makes the budget
 * meaningful and the failure attributable, and removes no work at all.
 */
const WHOLE_LIST_BITE_ENABLED =
  process.env["LISA_WHOLE_LIST_MUTATION_BITE"] === "1";

/**
 * The guards whose suites are withheld to weaken the gate.
 *
 * This used to name one file, `tests/unit/scripts/lisa-gates.test.ts`, chosen
 * because withholding it took the whole gate from 32.14 to 28.72 against a
 * floor of 32. That 3.42-point margin was the widest available at the time and
 * it still was not enough: the comment beside it said an *ordinary* improvement
 * could not lift the weakened run back over the line, and then a large one did.
 * Raising `lisa-work-item.mjs` from 6.10 to ~54 took the intact gate to ~54, and
 * the weakened run — the one required to FAIL — scored 50.31 and passed. The
 * bite test stopped biting, silently, as a side effect of the suite improving.
 *
 * So the weakening is no longer a filename. It is a RULE: withhold every suite
 * that reaches a named guard. Three things follow, and the third is the point.
 *
 * It models the real failure. `vitest.config.mutation.ts` exists because a guard
 * whose suites drop out of the run reports its mutants as uncovered and
 * contributes nothing but denominator. Withholding a guard's suites IS that
 * event, staged deliberately.
 *
 * It is self-maintaining. A suite added for either guard joins the withheld set
 * on its own, so the margin grows with that guard's coverage instead of being
 * eroded by it — which is exactly how the single-filename version went stale.
 *
 * And the first two named guards are the two largest contributors of kills
 * (`lisa-work-item.mjs` 1,157 and `lisa-gates.mjs` 469 of 2,523), so the margin
 * is the widest obtainable rather than merely sufficient.
 *
 * `lisa-mutation.mjs` — the diff-only gate script itself — joined the mutate
 * list and this set in the same change, and the second half is not optional. A
 * new, well-covered target raises BOTH runs: its kills land in the intact run
 * and, unless its suites are withheld, in the weakened one too. That is exactly
 * the erosion recorded above, arriving from the other direction. Withholding a
 * guard's suites can only ever REMOVE kills, so every guard added here moves the
 * weakened score down and the margin up; adding a mutate target WITHOUT adding
 * it here is the move that needs justifying.
 *
 * `lisa-destructive-guard.mjs` joined for the second reason rather than the
 * first. It was not added to the mutate list — it was already there, scoring
 * 19.61 because two of its three suites reached it through a runtime `import()`
 * the module graph cannot see. Converting them to static imports took it to
 * 96.08 (#2844), which is ~117 additional kills landing in BOTH runs: exactly
 * the erosion recorded above, arriving from a raised target instead of a new
 * one. Withholding its suites keeps those kills out of the weakened run.
 */
const WITHHELD_GUARDS = [
  "all/copy-overwrite/scripts/lisa-work-item.mjs",
  "all/copy-overwrite/scripts/lisa-gates.mjs",
  "typescript/copy-overwrite/scripts/lisa-mutation.mjs",
  "all/copy-overwrite/scripts/lisa-destructive-guard.mjs",
];

/** How Stryker reports a score at or above the threshold: score, threshold. */
const PASSED =
  /score of ([\d.]+) is greater than or equal to break threshold ([\d.]+)/;

/** How Stryker reports a score below it: score, threshold. */
const FAILED = /score ([\d.]+) under breaking threshold ([\d.]+)/;

/** The committed gate configuration — the one that guards pull requests. */
const committed = JSON.parse(
  fs.readFileSync(path.join(ROOT, "stryker.conf.json"), "utf8")
) as { readonly thresholds: { readonly break: number } };

/**
 * One gate run that ran to completion, or the reason it did not.
 *
 * The buffer and the refusal to report a truncated capture as a status both
 * live in {@link captureGateRun}, along with the reasoning that used to sit
 * here. Two things moved them there.
 *
 * The sibling `mutation-gate-diff-bite` still carried the original capture —
 * no `maxBuffer`, `failure.status ?? 1` — reading `.status` exactly the way
 * this file does, so the fix had to be somewhere both could use.
 *
 * And the in-place version keyed the detection on a MISSING status, which is
 * only one of the two shapes an overflow arrives in: measured 2026-08-22, node
 * v22.22.0 reports `code: ENOBUFS` with a **real `status: 1`** when the child
 * exits before the overflow is noticed, while bun reports `status: null,
 * signal: SIGTERM` for the same event. On the Node shape a null-status check
 * does not fire, `killedBy` stays unset, and the weakened run's truncated
 * capture is accepted as the status 1 the assertion below is looking for. So
 * the check is now on `code === "ENOBUFS"`, ahead of the status.
 */
type Run = GateRun;

/**
 * Require that a run reached a verdict of its own rather than being killed.
 *
 * Without this, every assertion downstream is reading a corpse: a killed child
 * has an exit code chosen by whatever killed it, and an output truncated
 * wherever the kill landed. Both look like evidence and are not.
 * @param run - A completed gate run
 * @param arm - Which arm it is, for the failure message
 */
const assertRanToCompletion = (run: Run, arm: string): void => {
  expect(
    run.killedBy,
    `the ${arm} run was killed (${run.killedBy}) rather than reaching a verdict; its exit code and output are artefacts of the kill, not measurements of the gate`
  ).toBeUndefined();
};

/**
 * Run the real mutation gate with a chosen set of suites.
 *
 * The config is the COMMITTED `stryker.conf.json` with three keys overridden —
 * reporting and the sandbox path — and never `thresholds`. A second copy of the
 * runner's configuration is a second thing to keep in step, and the failure
 * mode is precise: this test would keep passing against settings the real gate
 * no longer uses. It has happened twice already, on `ignorePatterns` and on the
 * break threshold.
 *
 * `mutate` is narrowable, for the per-guard block at the bottom of this file
 * and for nothing else. Narrowing it models what the diff-only gate does on a
 * single-file branch, and it can only ever REMOVE mutants from the run, so it
 * cannot turn a failing gate green. `thresholds` stays off-limits either way,
 * and {@link assertNoSyntheticThreshold} is asserted on every run in this file.
 * @param suites - Repo-relative suite paths the run is allowed to use
 * @param tempDirName - Sandbox directory, so the two runs cannot collide
 * @param mutate - Narrowed mutate list; omitted means the committed one
 * @returns The exit status and combined output
 */
const runGate = (
  suites: readonly string[],
  tempDirName: string,
  mutate?: readonly string[]
): Run => {
  const confPath = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "lisa-mutation-bite-")),
    "stryker.conf.json"
  );
  fs.writeFileSync(
    confPath,
    JSON.stringify({
      ...committed,
      reporters: ["clear-text"],
      clearTextReporter: { maxTestsToLog: 0, logTests: false, maxSurvived: 0 },
      tempDirName,
      ...(mutate ? { mutate } : {}),
    })
  );

  try {
    return captureGateRun({
      label: tempDirName,
      command: STRYKER,
      args: ["run", confPath],
      cwd: ROOT,
      env: { ...process.env, LISA_MUTATION_SUITES: suites.join(",") },
    });
  } finally {
    // `cleanTempDir: "always"` in the committed config already covers this;
    // belt and braces, because a sandbox is a full second copy of the tree and
    // one left behind costs the next `lint:slow` 1191 parse errors.
    fs.rmSync(path.join(ROOT, tempDirName), { recursive: true, force: true });
  }
};

/**
 * Read the score and the threshold Stryker judged it against.
 * @param run - A completed run
 * @param pattern - The reporter line to read them from
 * @returns The reported score and threshold
 */
const reportedBy = (
  run: Run,
  pattern: RegExp
): { readonly score: number; readonly threshold: number } => {
  const match = pattern.exec(run.output);
  if (!match) throw new Error(`no verdict in gate output:\n${run.output}`);
  return { score: Number(match[1]), threshold: Number(match[2]) };
};

/**
 * Require that the run was judged against the committed floor.
 *
 * This is the assertion that keeps the proof honest. Stryker echoes the
 * threshold it used, so comparing it against `stryker.conf.json` catches any
 * future override at the only place it could hide.
 * @param threshold - The threshold Stryker reported using
 */
/**
 * The floor a score is being judged against, named and valued.
 *
 * There are two candidate floors in this repository and they do not agree:
 * `stryker.conf.json` `thresholds.break` is what Stryker ENFORCES, and
 * `.lisa.config.json` `quality.mutation.strykerThresholds.break` is the value
 * the sync registry believes it writes there. While two numbers exist, "clears
 * the floor" has two answers and a report can pick the flattering one without
 * saying anything false. CodySwannGT/lisa#2968 owns reconciling them; until it
 * does, every verdict this file prints says which floor it used and what the
 * number was, so the ambiguity cannot survive being read.
 * @returns The enforced floor, spelled out
 */
const floorNamed = (): string =>
  `the committed floor (stryker.conf.json thresholds.break = ${committed.thresholds.break})`;

const assertNoSyntheticThreshold = (threshold: number): void => {
  expect(
    threshold,
    "the gate must be judged against the committed thresholds.break, never a number invented for this test"
  ).toBe(committed.thresholds.break);
};

describe("mutation gate bite", () => {
  const reaching = suitesReachingGuards();
  const byGuard = suitesByGuard();
  const withheld = new Set(
    WITHHELD_GUARDS.flatMap(guard => byGuard.get(guard) ?? [])
  );

  it("withholds suites the gate actually runs, and not all of them", () => {
    for (const guard of WITHHELD_GUARDS) {
      expect(
        byGuard.get(guard),
        `${guard} must be a mutate target with suites of its own`
      ).toBeTruthy();
    }
    expect(withheld.size).toBeGreaterThan(0);
    for (const suite of withheld) expect(reaching).toContain(suite);
    // A weakening that removes EVERY suite would prove nothing about the gate:
    // with no tests at all the run is trivially red for reasons that have
    // nothing to do with a mutant surviving.
    expect(withheld.size).toBeLessThan(reaching.length);
  });

  // What each pass scored, so the comparison between them can be a case of its
  // own rather than the tail of whichever pass ran second. Written once by the
  // pass that produced it and read once by the comparison; a pass that never
  // reached a verdict leaves its slot undefined, which the comparison names
  // rather than treating as a number.
  const intactScore: { current: number | undefined } = { current: undefined };
  const weakenedScore: { current: number | undefined } = { current: undefined };

  it.runIf(WHOLE_LIST_BITE_ENABLED)(
    "passes intact over the whole mutate list",
    { timeout: PASS_BUDGET_MS },
    () => {
      const intact = runGate(reaching, ".stryker-tmp/bite-intact");

      assertRanToCompletion(intact, "intact");
      expect(intact.status, `intact run output:\n${intact.output}`).toBe(0);

      const whole = reportedBy(intact, PASSED);

      assertNoSyntheticThreshold(whole.threshold);
      expect(
        whole.score,
        `the intact run scored ${whole.score} against ${floorNamed()}`
      ).toBeGreaterThanOrEqual(committed.thresholds.break);

      intactScore.current = whole.score;
    }
  );

  it.runIf(WHOLE_LIST_BITE_ENABLED)(
    "fails at the committed floor when a guard's suites are withheld",
    { timeout: PASS_BUDGET_MS },
    () => {
      const weakened = runGate(
        reaching.filter(suite => !withheld.has(suite)),
        ".stryker-tmp/bite-weakened"
      );

      assertRanToCompletion(weakened, "weakened");
      expect(weakened.status, `weakened run output:\n${weakened.output}`).toBe(
        1
      );

      const damaged = reportedBy(weakened, FAILED);

      assertNoSyntheticThreshold(damaged.threshold);
      expect(
        damaged.score,
        `the weakened run scored ${damaged.score} against ${floorNamed()}, and had to be under it`
      ).toBeLessThan(committed.thresholds.break);

      weakenedScore.current = damaged.score;
    }
  );

  it.runIf(WHOLE_LIST_BITE_ENABLED)(
    "scores lower with a guard's suites withheld than with them present",
    () => {
      // Clearing and missing the floor is not on its own proof that WITHHOLDING
      // did it — two runs could straddle the line for unrelated reasons. The
      // ordering is the part that says the weakening is what moved the score,
      // and it is asserted here rather than inside either pass so that it is
      // not silently skipped when one of them is the thing that failed.
      const intact = intactScore.current ?? Number.NaN;
      const weakened = weakenedScore.current ?? Number.NaN;

      expect(
        Number.isFinite(intact) && Number.isFinite(weakened),
        `a pass reached no verdict, so there is nothing to compare: intact=${String(intactScore.current)}, weakened=${String(weakenedScore.current)}. Read that pass's own failure above; this case is downstream of it`
      ).toBe(true);
      expect(weakened).toBeLessThan(intact);
    }
  );
});

/**
 * The destructive-operation guard, on its own.
 *
 * The whole-list block above proves the gate can go red. It could not have
 * caught what #2844 found, because an aggregate hides a single file: the
 * whole-list score was 53.62 against a floor of 32 while
 * `lisa-destructive-guard.mjs` sat at 19.61, with 120 of its 153 mutants
 * reported uncovered — two of its three suites reached it through `import()` of
 * a URL built at runtime, which Vite's module graph cannot see, so the gate ran
 * without them and said nothing.
 *
 * The diff-only gate mutates only what a branch changed, so a branch touching
 * just this guard is judged on just this guard's score. That is the run pinned
 * here: intact it must clear the committed floor on its own, and with its suites
 * withheld — mechanically what gutting their assertions amounts to — it must go
 * red against that same floor.
 */
describe("mutation gate bite: the destructive guard alone", () => {
  const GUARD = "all/copy-overwrite/scripts/lisa-destructive-guard.mjs";
  const guardSuites = suitesByGuard().get(GUARD) ?? [];
  // All but one. Withholding EVERY suite does not weaken the gate, it stops
  // it: Stryker's `vitest.related` filter finds nothing to run and exits with
  // a ConfigError before computing a score, which is a different — and much
  // louder — event than a score under the floor. Keeping one suite reproduces
  // the state #2844 found, where a single statically-imported suite was all
  // the gate could see.
  //
  // A rule, not a roster: the bite test above records what a hardcoded
  // filename costs. If that one suite ever grows strong enough to carry the
  // guard over the floor alone, this goes RED and someone looks — the
  // direction a stale bite test has to be wrong in.
  const weakenedSuites = guardSuites.slice(0, 1);

  it("has several suites reaching it, all of them statically", () => {
    // The regression this pins: two of its suites reached the guard through
    // `import()` of a runtime URL, so the gate ran without them. The exact
    // count is asserted in `mutation-gate-wiring`; here it only has to be more
    // than one, or withholding them would prove nothing.
    expect(guardSuites.length).toBeGreaterThan(1);
    expect(weakenedSuites).toHaveLength(1);
  });

  it(
    "clears the committed floor alone, and fails alone when its suites are withheld",
    { timeout: GUARD_ALONE_BUDGET_MS },
    () => {
      const intact = runGate(guardSuites, ".stryker-tmp/bite-guard-intact", [
        GUARD,
      ]);
      const gutted = runGate(weakenedSuites, ".stryker-tmp/bite-guard-gutted", [
        GUARD,
      ]);

      assertRanToCompletion(intact, "intact");
      assertRanToCompletion(gutted, "gutted");

      expect(intact.status, `intact run output:\n${intact.output}`).toBe(0);
      expect(gutted.status, `gutted run output:\n${gutted.output}`).toBe(1);

      const alone = reportedBy(intact, PASSED);
      const weakened = reportedBy(gutted, FAILED);

      assertNoSyntheticThreshold(alone.threshold);
      assertNoSyntheticThreshold(weakened.threshold);

      expect(
        alone.score,
        `the guard scored ${alone.score} alone against ${floorNamed()}`
      ).toBeGreaterThanOrEqual(committed.thresholds.break);
      expect(
        weakened.score,
        `the gutted guard scored ${weakened.score} against ${floorNamed()}, and had to be under it`
      ).toBeLessThan(committed.thresholds.break);
      expect(weakened.score).toBeLessThan(alone.score);
    }
  );
});
