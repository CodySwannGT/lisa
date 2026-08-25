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
 * which a scheduled workflow sets and no pull request does. Nothing was deleted
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
import { WITHHELD_GUARDS as SHARED_WITHHELD_GUARDS } from "../helpers/mutation-gate-arms.js";
import {
  assertGuardsContributedKills,
  killCounts,
  readReport,
} from "../helpers/mutation-kill-counts.js";

const ROOT = path.resolve(__dirname, "..", "..");
const STRYKER = path.join(ROOT, "node_modules", ".bin", "stryker");

/**
 * Wall-clock budget for the INTACT pass of the whole-list gate, in ms.
 *
 * ## Why there are two numbers and not one
 *
 * A single case used to run the gate twice — intact, then weakened — under one
 * budget, and the pairing is what made that budget undeclarable. Its own
 * docstring worked the arithmetic out to a contradiction and said so: passing a
 * healthy run needed more than 53.5 min, being observable before the job
 * ceiling needed 33.5 or less, and no value satisfies both. What shipped, 56
 * min, was documented honestly as a best-effort late detector rather than a
 * bound, and it had already been outrun once at 57.02.
 *
 * Splitting the case measured why one number could not work, and the answer was
 * not the predicted one. Run `32641083727`, the first scheduled run of the
 * split:
 *
 * | pass | `32641083727` | `32644060066` | `32647323151` |
 * |---|---|---|---|
 * | intact | 3,089,099 ms = **51.5 min** | 3,246,315 ms = **54.1 min** | 3,524,043 ms = **58.7 min** |
 * | weakened | 418,896 ms = **7.0 min** | 484,819 ms = **8.1 min** | 449,112 ms = **7.5 min** |
 *
 * **88 / 12, and the INTACT pass is the expensive one.** The prediction here was
 * the opposite: a mutant that SURVIVES runs every test covering it to
 * completion while a killed one stops at the first failure, so weakening ought
 * to cost more. It costs 7x less, because withholding a guard's suites turns
 * most of its mutants into NoCoverage and **Stryker never executes an uncovered
 * mutant at all**. Uncovered mutants are free.
 *
 * That is what makes one number impossible. Against a combined 54.1 min with
 * 51.5 of it in the intact pass, the 56-minute pair budget left the weakened
 * pass **4.5 minutes** — and the weakened pass measures 7.0. The pair budget was
 * `intact + nothing`: the weakened pass had no bound of its own, and any growth
 * in it fired a timeout naming "the case", sending the reader to the wrong one.
 *
 * ## The numbers
 *
 * 65 min is **1.11x** the worst of those three samples. The docstring shipped with
 * this constant said 1.26x, against the first sample alone; the second arrived
 * an hour later at 54.1 and the number is corrected here rather than left to
 * flatter itself.
 *
 * ## It is still climbing, and it is deliberately not being raised
 *
 * The combined figure before the split went 47.51, 50.75, 53.54, 53.00, 54.1;
 * the intact pass since the split has gone 51.5, 54.1, **58.7** — up 5.0% then
 * 8.5%. At **1.11x** this budget has roughly one increment of headroom and will
 * breach within one or two more nightlies at that rate.
 *
 * Raising it is the move this file has already recorded going wrong: the
 * previous budget was raised to 45, outrun, raised to 56, outrun at 57.02, and
 * each raise ate ceiling that does not come back. It is not being raised again.
 * The deadline is now a real bound with a real cost — see the note below on
 * what that costs — so **if it fires, that is the runtime having moved, which
 * is the signal CodySwannGT/lisa#2944 wanted.** The runtime itself is owned by
 * CodySwannGT/lisa#2989, where the 117 per-run mutant timeouts live.
 *
 * ## Re-derive these from the scheduled run, not from an integration job
 *
 * The case runs on `.github/workflows/weekly-mutation-wholelist-bite.yml` and
 * no longer on the pull-request path, so that workflow's per-case durations are
 * the only distribution these describe. A number re-derived from an integration
 * job would be sized against a distribution that no longer contains this work.
 *
 * ## The ceiling arithmetic, which is the repair
 *
 * That workflow allows 180 minutes. Both budgets together are 122 min, so BOTH
 * can fire and still be reported rather than swallowed by an anonymous job
 * cancellation. Under the old single budget the report arrived at best once and
 * said only "the case".
 *
 * ## What the split does NOT do
 *
 * **It removes no work** — the same mutants over the same mutate list with the
 * same suites, in both shapes. CodySwannGT/lisa#2944's runtime question is not
 * answered by this.
 *
 * Whether it costs *wall clock* is a different claim, it was asserted here
 * without measurement, and **it is still unmeasured.** Every sample available
 * is time-ordered, so none of them can isolate the split's overhead from
 * anything else changing over the same hours. Keeping the working, because two
 * wrong readings of it are more instructive than the numbers:
 *
 * | # | shape | whole-case / whole-file |
 * |---|---|---|
 * | 1-5 | combined | 47.51, 50.75, 53.54, 53.00, 54.10 min |
 * | 6 | split | 59.1 min |
 * | 7 | split | 62.8 min |
 * | 8 | split | 66.8 min |
 *
 * **First wrong reading: "the split costs 8-15%."** Samples 6 and 7 sat above
 * every combined sample, which looked like a cost. It is confounded — every
 * split sample was taken later than every combined one, so *"split totals
 * exceed combined totals"* is also just what a rising series looks like when it
 * is cut at a point in time. The shape was the new thing, so the shape got
 * blamed, while the simpler explanation — the regression this file exists to
 * track — was already on the table.
 *
 * **Second wrong reading: "so the split costs nothing."** That does not follow
 * either. The rise is present inside the split samples alone, where the shape
 * is constant (the intact pass went 51.5, 54.1, 58.7 min), so a trend exists
 * that needs no help from the shape — but a confounded series cannot show the
 * absence of an effect any more than it can show its presence. **The honest
 * statement is that these samples cannot determine whether splitting changes
 * wall-clock time at all**, and the split is neither implicated nor exonerated.
 *
 * Settling it needs a controlled comparison — both shapes interleaved on one
 * commit, on one runner class, in one window — and nobody has run one. Until
 * then this is an open question with a known method, which is a better thing to
 * leave behind than either of the two confident answers above.
 *
 * And on its own it does not restore preemption. {@link runGate} captures a
 * SYNCHRONOUS child, so the callback never yields and no timer can interrupt
 * it. Vitest still reports an overrun — 4.1.9's `withTimeout` compares elapsed
 * against the budget after a synchronous body returns, deliberately, so a body
 * that never yielded is not waved through — but only AFTER the fact. That is
 * measured, not inferred: in both runs above the intact pass overran a 35-min
 * budget — by 16.5 and 19.1 minutes — and was reported at the end each time,
 * having spent the whole of it anyway.
 *
 * That is why this number is now a BACKSTOP rather than the bound. The bound is
 * the deadline `captureGateRun` gives the child itself — see
 * {@link REPORTING_GRACE_MS} for the ordering and why it is that way round
 * (CodySwannGT/lisa#2943).
 *
 * ## What that costs, said plainly
 *
 * A bound is a bound. Before, a healthy-but-slow run finished and was reported
 * late; now a run past this number is KILLED and reported as killed. That is
 * the whole difference between a number that describes and a number that
 * decides, and it is half the reason the multiple over the measurement is
 * 1.70x rather than something tighter — the cost of being wrong has changed
 * from a confusing message to a dead run. The other half is the cadence,
 * above.
 */
const INTACT_DEADLINE_MS = 6_000_000;

/**
 * Deadline for the WEAKENED pass, in ms.
 *
 * 20 min is 2.47x the worst of the three samples above (8.1 min), generous for
 * the same weekly-cadence reason as {@link INTACT_DEADLINE_MS}. A generous
 * multiple of a small absolute cost is cheap anyway: the whole pass is ~11% of
 * the case.
 */
const WEAKENED_DEADLINE_MS = 1_200_000;

/**
 * Deadline for the single-guard case, in ms.
 *
 * It shared the whole-list budget until now, which meant 56 minutes over a case
 * measured at 28,849 ms, 36,291 ms, 37,582 ms and 38,134 ms — and 93% of the
 * 60-minute ceiling on the pull-request job that still runs it. A budget that large
 * inside a ceiling that close cannot fire before the job is cancelled: the same
 * defect the whole-list budget had, left on the one heavy case a pull request
 * still pays for.
 *
 * Those are all scheduled-runner readings. **On the pull-request job — the one
 * this case actually runs in — it measured 72,050 ms** (run `32641178145`),
 * roughly twice the worst of them. That gap is exactly why the budget is not a
 * small multiple of a quiet-box number: this repository has measured 20x tails
 * on a contended box — `/usr/bin/git` at 20,727 ms against a median of 24 — so
 * a tight multiple is a flake generator rather than a detector.
 *
 * 20 minutes is **16.6x** the pull-request reading and 31x the scheduled ones.
 * What changed is the relationship to the ceiling, not the relationship to the
 * work: 20 min is 3x UNDER the job's 60, so an overrun is reported by this
 * case, by name, rather than as an anonymous cancellation.
 */
const GUARD_ALONE_DEADLINE_MS = 1_200_000;

/**
 * How much longer vitest waits than the child's own deadline, in ms.
 *
 * **The child deadline is the bound; the case budget is the backstop, in that
 * order and never the other way round.**
 *
 * A synchronous child cannot be interrupted by a timer, so a case budget can
 * only ever notice an overrun once the child has finished anyway — measured
 * above at 51.5 and 54.1 min under a 35-min budget. The `timeoutMs` handed to
 * `captureGateRun` — which reaches the child as `execFileSync`'s own `timeout`
 * — is a real bound because it KILLS it, so every deadline here sits UNDER its
 * case budget: the child dies at the deadline, control returns, and the message
 * names the harness, the pass and the number, instead of vitest saying "timed
 * out" about work that already completed.
 *
 * It also has to be this way round, not merely better this way round. If the
 * case budget were the tighter of the two, vitest would report first and the
 * child would keep running — a budget that fires while the thing it bounds is
 * still going.
 *
 * A minute covers the kill, the sandbox removal in {@link runGate}'s `finally`,
 * and the assertion, and is small enough that the pair still fits the job
 * ceiling: 100 + 20 + two graces is 122 min against 180.
 */
const REPORTING_GRACE_MS = 60_000;

/** Vitest's backstop for the intact pass. See {@link REPORTING_GRACE_MS}. */
const INTACT_BUDGET_MS = INTACT_DEADLINE_MS + REPORTING_GRACE_MS;

/** Vitest's backstop for the weakened pass. See {@link REPORTING_GRACE_MS}. */
const WEAKENED_BUDGET_MS = WEAKENED_DEADLINE_MS + REPORTING_GRACE_MS;

/** Vitest's backstop for the single-guard case. See {@link REPORTING_GRACE_MS}. */
const GUARD_ALONE_BUDGET_MS = GUARD_ALONE_DEADLINE_MS + REPORTING_GRACE_MS;

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
 * `.github/workflows/weekly-mutation-wholelist-bite.yml` sets this variable on
 * a WEEKLY schedule, and files an issue when the run goes red.
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
 * meaningful and the failure attributable, and removes no work. Whether it
 * changes wall clock is unmeasured and needs a controlled comparison — see
 * {@link INTACT_DEADLINE_MS}.
 */
const WHOLE_LIST_BITE_ENABLED =
  process.env["LISA_WHOLE_LIST_MUTATION_BITE"] === "1";

/**
 * The guards whose suites are withheld to weaken the gate.
 *
 * The roster, and the whole of the reasoning that shaped it, live in
 * {@link tests/helpers/mutation-gate-arms} — `mutation-sigterm-control` runs
 * the same weakened arm on a hosted runner, and a second copy of this list is
 * precisely the staleness the reasoning there records happening twice.
 */
const WITHHELD_GUARDS = SHARED_WITHHELD_GUARDS;

/**
 * The guard the per-guard blocks below run on its own.
 *
 * Module-level because three blocks now name it — the guard-alone bite, the
 * contribution check's live bite, and its negative control — and a second copy
 * of a guard path is the exact staleness {@link WITHHELD_GUARDS} records
 * happening twice.
 */
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
const runGate = (
  suites: readonly string[],
  tempDirName: string,
  deadlineMs: number,
  mutate?: readonly string[]
): Attempt => {
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
        label: tempDirName,
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
    { timeout: INTACT_BUDGET_MS },
    () => {
      const attempt = runGate(
        reaching,
        ".stryker-tmp/bite-intact",
        INTACT_DEADLINE_MS
      );
      const intact = attempt.run;

      assertRanToCompletion(intact, "intact");
      expect(intact.status, `intact run output:\n${intact.output}`).toBe(0);

      // The premise of the weakened pass below, checked in the only run that
      // can answer it. A guard here with zero kills makes the comparison
      // vacuous; see {@link assertWithheldGuardsContributed}.
      assertWithheldGuardsContributed(attempt, WITHHELD_GUARDS, "intact");

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
    { timeout: WEAKENED_BUDGET_MS },
    () => {
      const weakened = runGate(
        reaching.filter(suite => !withheld.has(suite)),
        ".stryker-tmp/bite-weakened",
        WEAKENED_DEADLINE_MS
      ).run;

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
  const GUARD = DESTRUCTIVE_GUARD;
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
      const attempt = runGate(
        guardSuites,
        ".stryker-tmp/bite-guard-intact",
        GUARD_ALONE_DEADLINE_MS,
        [GUARD]
      );
      const intact = attempt.run;
      const gutted = runGate(
        weakenedSuites,
        ".stryker-tmp/bite-guard-gutted",
        GUARD_ALONE_DEADLINE_MS,
        [GUARD]
      ).run;

      assertRanToCompletion(intact, "intact");
      assertRanToCompletion(gutted, "gutted");

      // The contribution check on the PULL-REQUEST path. This guard is one of
      // the four in WITHHELD_GUARDS, and its intact run already exists here, so
      // checking it costs nothing and no pull request waits on the whole-list
      // arm to learn that this guard stopped contributing.
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
 * Measured 2026-08-24 at **9.2 s**: uncovered mutants are free, because Stryker
 * never executes one (the same finding that made the whole-list weakened pass
 * 7x cheaper than the intact one — see {@link INTACT_DEADLINE_MS}).
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
        ".stryker-tmp/bite-contribution",
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
