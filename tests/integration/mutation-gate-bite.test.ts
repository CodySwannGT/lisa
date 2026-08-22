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
 * @module tests/integration/mutation-gate-bite
 */
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { describe, expect, it } from "vitest";

import {
  suitesByGuard,
  suitesReachingGuards,
} from "../../vitest.config.mutation";

const ROOT = path.resolve(__dirname, "..", "..");
const STRYKER = path.join(ROOT, "node_modules", ".bin", "stryker");

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
 * How much output one gate run may produce before Node kills it.
 *
 * Node's default `maxBuffer` for `execFileSync` is 1 MiB. The weakened run
 * exceeds that: withholding a guard's suites turns every one of its mutants
 * into a `[NoCoverage]` entry, and the clear-text reporter prints each with its
 * source diff, so the arm required to FAIL is precisely the arm whose output is
 * largest. Measured at 1,076,523 bytes when `lisa-gates.mjs` grew by ~800
 * lines — just over the cap, and the cap is what it hit.
 *
 * `maxSurvived: 0` below does NOT cap this, and cannot be made to: the
 * clear-text reporter writes every `Survived` and `NoCoverage` mutant in full
 * unconditionally, and `maxSurvived` is not read anywhere in the installed
 * Stryker. Raising the buffer is the fix, not a way around a knob that works.
 *
 * The failure that produced was the exact defect this file exists to catch.
 * Node killed Stryker with SIGTERM, set `status` to `null`, and returned the
 * buffer clipped mid-token. `status ?? 1` then read `null` as `1`, so
 * "the weakened run must fail" PASSED — on a run that never reached a verdict —
 * and the test died one line later on the missing score line instead. A control
 * reporting a failure it did not measure, inside the bite test.
 */
const MAX_GATE_OUTPUT_BYTES = 256 * 1024 * 1024;

/** One gate run that ran to completion, or the reason it did not. */
interface Run {
  /** Stryker's exit code, or `null` if the process was killed. */
  readonly status: number | null;
  readonly output: string;
  /** Set when the process was killed rather than exiting on its own. */
  readonly killedBy?: string;
}

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
    const output = execFileSync(STRYKER, ["run", confPath], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: MAX_GATE_OUTPUT_BYTES,
      env: { ...process.env, LISA_MUTATION_SUITES: suites.join(",") },
    });
    return { status: 0, output };
  } catch (error) {
    const failure = error as {
      status?: number | null;
      signal?: string | null;
      code?: string;
      stdout?: string;
      stderr?: string;
    };
    // `status` is `null` for a killed child, and `?? 1` would read that as
    // "the gate failed". It is the difference between a verdict and a corpse,
    // so it is carried, not defaulted away.
    return {
      status: failure.status ?? null,
      output: `${failure.stdout ?? ""}${failure.stderr ?? ""}`,
      ...(failure.status === null || failure.status === undefined
        ? { killedBy: failure.code ?? failure.signal ?? "unknown signal" }
        : {}),
    };
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

  it(
    "passes intact and fails at the committed floor when a guard's suites are withheld",
    { timeout: 1_800_000 },
    () => {
      const intact = runGate(reaching, ".stryker-tmp/bite-intact");
      const weakened = runGate(
        reaching.filter(suite => !withheld.has(suite)),
        ".stryker-tmp/bite-weakened"
      );

      assertRanToCompletion(intact, "intact");
      assertRanToCompletion(weakened, "weakened");

      expect(intact.status, `intact run output:\n${intact.output}`).toBe(0);
      expect(weakened.status, `weakened run output:\n${weakened.output}`).toBe(
        1
      );

      const whole = reportedBy(intact, PASSED);
      const damaged = reportedBy(weakened, FAILED);

      assertNoSyntheticThreshold(whole.threshold);
      assertNoSyntheticThreshold(damaged.threshold);

      expect(whole.score).toBeGreaterThanOrEqual(committed.thresholds.break);
      expect(damaged.score).toBeLessThan(committed.thresholds.break);
      expect(damaged.score).toBeLessThan(whole.score);
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
    { timeout: 1_800_000 },
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

      expect(alone.score).toBeGreaterThanOrEqual(committed.thresholds.break);
      expect(weakened.score).toBeLessThan(committed.thresholds.break);
      expect(weakened.score).toBeLessThan(alone.score);
    }
  );
});
