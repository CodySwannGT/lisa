/**
 * Exercise the production mutation configuration on focused guard changes.
 * Intact tests must clear the committed floor; weakened tests must fail it.
 * A second real report checks that uncovered guards contribute no kills.
 *
 * The scheduled whole-list score comparison was retired after repeated
 * expensive failures (#4044). These checks do not establish aggregate
 * calibration across every mutation target.
 * @module tests/integration/mutation-gate-bite
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { describe, expect, it } from "vitest";

import { DEFAULT_SANDBOX_ROOT } from "../../src/configs/repo-scan.js";

import type { GateRun } from "../helpers/gate-capture.js";
import { captureGateRun } from "../helpers/gate-capture.js";
import { suitesByGuard } from "../../vitest.config.mutation";
import {
  assertGuardsContributedKills,
  killCounts,
  readReport,
} from "../helpers/mutation-kill-counts.js";

const ROOT = path.resolve(__dirname, "..", "..");
const STRYKER = path.join(ROOT, "node_modules", ".bin", "stryker");

/** Bound each Stryker child below the pull-request job ceiling. */
const GUARD_ALONE_DEADLINE_MS = 1_200_000;

/** Allow child termination, sandbox cleanup and assertions to finish. */
const REPORTING_GRACE_MS = 60_000;

/** Vitest's backstop follows the child deadline. */
const GUARD_ALONE_BUDGET_MS = GUARD_ALONE_DEADLINE_MS + REPORTING_GRACE_MS;

/** The guard exercised by the focused floor and contribution checks. */
const DESTRUCTIVE_GUARD =
  "all/copy-overwrite/scripts/lisa-destructive-guard.mjs";

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

/** A gate run plus the JSON report it wrote, which is where kill counts live. */
interface Attempt {
  readonly run: Run;
  /** Absolute path the run's `jsonReporter.fileName` named. */
  readonly reportPath: string;
}

/**
 * Require that the guards this file withholds were contributing kills.
 *
 * **This is the premise the bite test never checked** (CodySwannGT/lisa#2992).
 * The proof below withholds a guard's suites and requires the score to drop.
 * If a withheld guard's suites killed nothing in the intact run, withholding
 * them removes nothing — the two runs score the same, and the bite test reports
 * that as the gate failing to bite when the truth is that it never had anything
 * to bite with. Removing nothing changes nothing is not a fact about the gate.
 *
 * It reads the INTACT run, because that is the run in which a contribution
 * either exists or does not. Reading the weakened run would measure the
 * withholding rather than what was withheld.
 *
 * Every no-data path raises rather than passing — a missing report, an
 * unparseable one, a guard the run never mutated. A contribution check that
 * shrugged when it could not measure would be a second inert guard added while
 * fixing the first.
 * @param attempt - The intact run and its report
 * @param guards - The guards whose suites the weakened arm withholds
 * @param arm - Which run it was, for the failure text
 */
const assertWithheldGuardsContributed = (
  attempt: Attempt,
  guards: readonly string[],
  arm: string
): void => {
  assertGuardsContributedKills(
    killCounts(readReport(attempt.reportPath, arm), arm),
    guards,
    arm
  );
};

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
 * `deadlineMs` is required rather than defaulted. `captureGateRun` HAS a
 * default and it is two hours — above the 90-minute ceiling of the job this
 * runs in, so a call site that inherits it holds a deadline that cannot fire
 * before the job is cancelled. That is the defect this file has now recorded
 * three times over, and the only form of the rule a call site cannot miss is
 * one that will not compile without it.
 *
 * The `json` reporter is added for the same reason `thresholds` is not: the
 * contribution check reads per-file kill counts, and the only two places they
 * exist are that report and the clear-text directory tree. It writes to a FILE
 * in the same temporary directory as the config, so it adds a single INFO line
 * to the captured stdout — it cannot re-arm the 1 MiB `maxBuffer` trap that
 * reading per-case `covered N` lines would (CodySwannGT/lisa#2943). See
 * {@link tests/helpers/mutation-kill-counts} for why the JSON report and not
 * the clear-text table.
 * @param suites - Repo-relative suite paths the run is allowed to use
 * @param tempDirName - Sandbox directory, so the two runs cannot collide
 * @param deadlineMs - When the harness kills the child; see {@link REPORTING_GRACE_MS}
 * @param mutate - Narrowed mutate list; omitted means the committed one
 * @returns The exit status and output, and where the JSON report was written
 */
/** Monotonic epoch stamps, so two arms in the same millisecond cannot collide. */
let lastSandboxStamp = 0;

/**
 * A sandbox path the gate's own sweeper can reclaim if this run is killed.
 *
 * These arms used FIXED names — `.stryker-tmp/bite-intact` and friends — and
 * the `finally` in {@link runGate} covers neither consequence.
 *
 * First, a fixed name is a collision between two concurrent runs, which is the
 * defect run-scoped naming was introduced to fix one directory over (#2961):
 * the obvious repair for a leftover would delete the other run's working
 * directory. Second, `reclaimAbandonedSandboxes` reclaims only
 * `run-<pid>-<epoch>` directories and deliberately leaves everything else
 * untouched — naming these arms exactly that way brings them under the existing
 * sweeper, with its liveness check intact, rather than widening what that
 * sweeper is willing to delete. The fence stays where it is; these directories
 * move to the correct side of it.
 *
 * The arm's readable name does NOT go in the path: `RUN_SANDBOX_PATTERN` is
 * exactly `run-<digits>-<digits>`, and a suffix would put the directory back
 * outside the sweeper — the precise defect being fixed. It travels as the run's
 * reporting label instead, so a reader still sees which arm failed.
 *
 * The `finally` remains as the fast path and is not sufficient alone: it cannot
 * run in exactly the case that creates the mess — a SIGTERM from a saturated
 * box, an OOM reap, a Ctrl-C — which is the case that left 42 MB behind and
 * failed an unrelated basename scan on a later run (CodySwannGT/lisa#3653).
 * @returns A project-relative, run-scoped sandbox path
 */
const biteSandbox = (): string => {
  lastSandboxStamp = Math.max(Date.now(), lastSandboxStamp + 1);
  return `${DEFAULT_SANDBOX_ROOT}/run-${process.pid}-${lastSandboxStamp}`;
};

const runGate = (
  suites: readonly string[],
  label: string,
  deadlineMs: number,
  mutate?: readonly string[]
): Attempt => {
  const tempDirName = biteSandbox();
  const confDir = fs.mkdtempSync(path.join(os.tmpdir(), "lisa-mutation-bite-"));
  const confPath = path.join(confDir, "stryker.conf.json");
  const reportPath = path.join(confDir, "mutation-report.json");
  fs.writeFileSync(
    confPath,
    JSON.stringify({
      ...committed,
      reporters: ["clear-text", "json"],
      jsonReporter: { fileName: reportPath },
      clearTextReporter: { maxTestsToLog: 0, logTests: false, maxSurvived: 0 },
      tempDirName,
      ...(mutate ? { mutate } : {}),
    })
  );

  try {
    return {
      run: captureGateRun({
        label,
        command: STRYKER,
        args: ["run", confPath],
        cwd: ROOT,
        env: { ...process.env, LISA_MUTATION_SUITES: suites.join(",") },
        timeoutMs: deadlineMs,
      }),
      reportPath,
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

/**
 * A change touching only this guard is judged on this guard's score.
 * Withholding some suites must make it fail the same committed floor.
 */
describe("mutation gate bite: the destructive guard alone", () => {
  const GUARD = DESTRUCTIVE_GUARD;
  const guardSuites = suitesByGuard().get(GUARD) ?? [];
  // All but one. Withholding EVERY suite does not weaken the gate, it stops
  // it: Stryker's `vitest.related` filter finds nothing to run and exits with
  // a ConfigError before computing a score, which is a different — and much
  // louder — event than a score under the floor. Keeping one suite reproduces
  // the state #2844 found, where a single statically-imported suite was all
  // the gate could see.
  //
  // Derive the weakened suite from the current roster. If it becomes strong
  // enough to clear the floor alone, this test fails and needs reassessment.
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
      const attempt = runGate(
        guardSuites,
        "bite-guard-intact",
        GUARD_ALONE_DEADLINE_MS,
        [GUARD]
      );
      const intact = attempt.run;
      const gutted = runGate(
        weakenedSuites,
        "bite-guard-gutted",
        GUARD_ALONE_DEADLINE_MS,
        [GUARD]
      ).run;

      assertRanToCompletion(intact, "intact");
      assertRanToCompletion(gutted, "gutted");

      // Reuse the intact report to verify that this guard contributed kills.
      assertWithheldGuardsContributed(attempt, [GUARD], "intact");

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

/**
 * The contribution check, biting, on real Stryker output.
 *
 * ## What this proves that a unit test cannot
 *
 * `tests/unit/helpers/mutation-kill-counts.test.ts` pins the parser against a
 * transcribed real report, which proves it reads Stryker's shape. It cannot
 * prove that the shape it was transcribed from is the shape Stryker still
 * writes — a fixture is a recording, and a recording does not notice the tool
 * moving under it. This case runs the COMMITTED configuration, reads the report
 * that run actually wrote, and requires the check to fail on a starved guard
 * and pass on a contributing one **in the same report**.
 *
 * ## The shape, and why it is cheap
 *
 * Two mutate targets, and only the first one's suites. The second is therefore
 * entirely uncovered — 0 killed — which is precisely the state
 * CodySwannGT/lisa#2992 describes and the state that must make the check fail.
 * Stryker does not execute uncovered mutants, keeping this control bounded.
 *
 * ## Neither guard is hardcoded twice
 *
 * The contributor is {@link DESTRUCTIVE_GUARD}, whose suites the block above
 * already runs. The starved one is derived: the smallest mutate target that is
 * not the contributor. Smallest because its mutants are all uncovered and so
 * cost nothing either way, and derived because a hardcoded second filename is
 * the staleness this file has recorded twice — a guard leaving the mutate list
 * would otherwise turn this case into a run of one file, which cannot starve
 * anything.
 *
 * ## The exit status is deliberately not asserted
 *
 * A run whose second file is entirely uncovered may score above or below the
 * committed floor depending on how many mutants that file has, and this case is
 * about kill counts rather than about the verdict. Asserting the status would
 * couple it to an arithmetic it does not test. That the run reached a verdict
 * at all IS asserted, because a killed child's report is a corpse.
 */
describe("mutation gate bite: the contribution check itself", () => {
  const byGuard = suitesByGuard();
  const contributorSuites = byGuard.get(DESTRUCTIVE_GUARD) ?? [];
  const starved = [...byGuard.keys()]
    .filter(guard => guard !== DESTRUCTIVE_GUARD)
    .sort(
      (left, right) =>
        fs.statSync(path.join(ROOT, left)).size -
        fs.statSync(path.join(ROOT, right)).size
    )[0];

  it("has a contributor and a second guard to starve", () => {
    expect(contributorSuites.length).toBeGreaterThan(0);
    expect(
      starved,
      "the mutate list must hold a second guard, or nothing can be starved"
    ).toBeTruthy();
    expect(starved).not.toBe(DESTRUCTIVE_GUARD);
  });

  it(
    "fails a starved guard and passes a contributing one, in one real report",
    { timeout: GUARD_ALONE_BUDGET_MS },
    () => {
      const attempt = runGate(
        contributorSuites,
        "bite-contribution",
        GUARD_ALONE_DEADLINE_MS,
        [DESTRUCTIVE_GUARD, starved ?? DESTRUCTIVE_GUARD]
      );

      assertRanToCompletion(attempt.run, "contribution");

      const counts = killCounts(
        readReport(attempt.reportPath, "contribution"),
        "contribution"
      );

      // The negative control, first. Without it a check that failed everything
      // would satisfy the case below and read as a working guard.
      expect(counts.get(DESTRUCTIVE_GUARD)?.killed ?? 0).toBeGreaterThan(0);
      expect(() =>
        assertGuardsContributedKills(
          counts,
          [DESTRUCTIVE_GUARD],
          "contribution"
        )
      ).not.toThrow();

      // The bite. This guard's suites never ran, so it killed nothing, so
      // withholding them would remove nothing — and the check has to say so.
      expect(counts.get(starved ?? "")?.killed).toBe(0);
      expect(() =>
        assertGuardsContributedKills(counts, [starved ?? ""], "contribution")
      ).toThrow(/killed 0 of its \d+ mutants in the contribution run/);
    }
  );
});
