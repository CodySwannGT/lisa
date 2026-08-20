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
 * And the two named guards are the two largest contributors of kills
 * (`lisa-work-item.mjs` 1,157 and `lisa-gates.mjs` 469 of 2,523), so the margin
 * is the widest obtainable rather than merely sufficient.
 */
const WITHHELD_GUARDS = [
  "all/copy-overwrite/scripts/lisa-work-item.mjs",
  "all/copy-overwrite/scripts/lisa-gates.mjs",
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

/** One completed gate run. */
interface Run {
  readonly status: number;
  readonly output: string;
}

/**
 * Run the real mutation gate with a chosen set of suites.
 *
 * The config is the COMMITTED `stryker.conf.json` with three keys overridden —
 * reporting and the sandbox path, never `mutate` and never `thresholds`. A
 * second copy of the runner's configuration is a second thing to keep in step,
 * and the failure mode is precise: this test would keep passing against
 * settings the real gate no longer uses. It has happened twice already, on
 * `ignorePatterns` and on the break threshold.
 * @param suites - Repo-relative suite paths the run is allowed to use
 * @param tempDirName - Sandbox directory, so the two runs cannot collide
 * @returns The exit status and combined output
 */
const runGate = (suites: readonly string[], tempDirName: string): Run => {
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
    })
  );

  try {
    const output = execFileSync(STRYKER, ["run", confPath], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, LISA_MUTATION_SUITES: suites.join(",") },
    });
    return { status: 0, output };
  } catch (error) {
    const failure = error as {
      status?: number;
      stdout?: string;
      stderr?: string;
    };
    return {
      status: failure.status ?? 1,
      output: `${failure.stdout ?? ""}${failure.stderr ?? ""}`,
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
