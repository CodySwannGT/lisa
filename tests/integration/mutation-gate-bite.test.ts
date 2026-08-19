/**
 * The bite test for the mutation gate itself.
 *
 * A gate that cannot fail is the exact defect this gate was built to catch, so
 * asserting its wiring is not enough — something has to weaken a guard's tests
 * and watch the gate go red. That is what this does: it runs the real gate over
 * one guard script twice, once with every suite that reaches it and once with a
 * suite withheld, and requires the first to pass and the second to fail.
 *
 * The weakening is withholding a suite rather than editing assertions on disk,
 * for two reasons. It is the same thing mechanically — a test that no longer
 * runs cannot kill a mutant, which is what a gutted assertion amounts to — and
 * it cannot leave the working tree modified if the process dies mid-run.
 *
 * The three scores are asserted in relation to each other, not just the two exit
 * codes. If someone strengthens the remaining suites until the weakened run
 * clears the threshold, this test must fail loudly rather than keep passing
 * while proving nothing.
 * @module tests/integration/mutation-gate-bite
 */
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { describe, expect, it } from "vitest";

import { suitesByGuard } from "../../vitest.config.mutation";

const ROOT = path.resolve(__dirname, "..", "..");
const STRYKER = path.join(ROOT, "node_modules", ".bin", "stryker");

/** The guard the bite test mutates — several suites reach it, so one can go. */
const GUARD = "all/copy-overwrite/scripts/lisa-run-gates.mjs";

/** The suite withheld to weaken the guard's tests. */
const WITHHELD = "tests/unit/scripts/lisa-run-gates.test.ts";

/**
 * Break threshold for both runs.
 *
 * Chosen to sit between the two measured scores (48.59 with every suite, 36.27
 * with {@link WITHHELD} gone) so the same threshold passes one run and fails the
 * other. The assertions below re-derive that ordering from the live scores, so a
 * shift in either direction reports itself instead of quietly disarming this.
 */
const BREAK = 45;

/** How Stryker reports a score at or above the threshold. */
const PASSED = /score of ([\d.]+) is greater than or equal to break threshold/;

/** How Stryker reports a score below it. */
const FAILED = /score ([\d.]+) under breaking threshold/;

/** One completed gate run. */
interface Run {
  readonly status: number;
  readonly output: string;
}

/**
 * Run the real mutation gate over {@link GUARD} with a chosen set of suites.
 * @param suites - Repo-relative suite paths the run is allowed to use
 * @param tempDirName - Sandbox directory. Nested under `.stryker-tmp/`, which
 *   Stryker always ignores, so one run’s sandbox can never be copied into the
 *   next one’s.
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
      testRunner: "vitest",
      vitest: { configFile: "vitest.config.mutation.ts" },
      reporters: ["clear-text"],
      clearTextReporter: { maxTestsToLog: 0, logTests: false, maxSurvived: 0 },
      coverageAnalysis: "perTest",
      ignoreStatic: true,
      timeoutMS: 60_000,
      tempDirName,
      mutate: [GUARD],
      thresholds: { high: 100, low: 0, break: BREAK },
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
  }
};

/**
 * Pull the reported mutation score out of a gate run.
 * @param run - A completed run
 * @param pattern - The reporter line to read it from
 * @returns The score Stryker reported
 */
const scoreFrom = (run: Run, pattern: RegExp): number => {
  const match = pattern.exec(run.output);
  if (!match) throw new Error(`no score in gate output:\n${run.output}`);
  return Number(match[1]);
};

describe("mutation gate bite", () => {
  const reaching = suitesByGuard().get(GUARD) ?? [];

  it("has more than one suite reaching the guard it weakens", () => {
    expect(reaching).toContain(WITHHELD);
    expect(reaching.length).toBeGreaterThan(1);
  });

  it(
    "passes intact and fails when a guard suite is withheld",
    { timeout: 900_000 },
    () => {
      const intact = runGate(reaching, ".stryker-tmp/bite-intact");
      const weakened = runGate(
        reaching.filter(suite => suite !== WITHHELD),
        ".stryker-tmp/bite-weakened"
      );

      expect(intact.status, `intact run output:\n${intact.output}`).toBe(0);
      expect(weakened.status, `weakened run output:\n${weakened.output}`).toBe(
        1
      );

      const intactScore = scoreFrom(intact, PASSED);
      const weakenedScore = scoreFrom(weakened, FAILED);

      expect(intactScore).toBeGreaterThanOrEqual(BREAK);
      expect(weakenedScore).toBeLessThan(BREAK);
      expect(weakenedScore).toBeLessThan(intactScore);
    }
  );
});
