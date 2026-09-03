// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/**
 * Say WHICH thing failed, from a failed gate's own output.
 *
 * ## Why a bare exit code is a defect and not just terse
 *
 * `coverage-adequacy — bun run test:cov (exit 1)` is the same sentence whether
 * the suite measured 84% against a floor of 86%, or whether four
 * subprocess-heavy tests were starved of CPU and hit their wall-clock budget
 * while every assertion in the run passed. Those are opposite facts: one is a
 * regression that must block, the other is the machine being busy.
 *
 * Measured across six sightings, every one was the second kind — always a
 * timeout, never a coverage number below threshold — and every one was
 * answered by a retry, because re-running is genuinely cheaper than
 * investigating a bare exit code. That reflex is rational, and it is also why a
 * real coverage regression would currently be invisible: it renders as the same
 * line the operator has been trained to re-run.
 *
 * ## Precedence: an incomplete run is not a measurement
 *
 * A run whose tests timed out still prints coverage numbers, and those numbers
 * will be low, because the code the dead tests would have exercised went
 * unexercised. Reading a threshold error off such a run reports the *effect* of
 * the timeout as though it were the cause. So a timeout outranks a threshold
 * reading, and a failed assertion outranks it too — coverage is only a
 * measurement when the suite that produced it finished.
 * @module lib/gate-failure-diagnosis
 */
import { availableParallelism, loadavg } from "node:os";

/** Default load-average source for {@link machineLoad}. */
const osLoadavg = () => loadavg();

/** Default core-count source for {@link machineLoad}. */
const osCores = () => availableParallelism();

/** What a failed gate's output was recognised as. */
export const DIAGNOSIS = Object.freeze({
  /** One or more tests or hooks exceeded their wall-clock budget. */
  TIMEOUT: "timeout",
  /** Tests ran to completion and failed. */
  ASSERTION: "assertion",
  /** Every test finished and passed; a coverage floor was not met. */
  THRESHOLD: "threshold",
  /** The command was terminated by a signal; nothing it says can be trusted. */
  KILLED: "killed",
  /** Another process destroyed this run's scratch files while it was running. */
  INTERFERENCE: "interference",
  /** The runner executed zero test files, so nothing it printed is a measurement. */
  NO_TESTS_RAN: "no-tests-ran",
  /** Output was read and matched nothing this module knows. */
  UNDIAGNOSED: "undiagnosed",
  /** No output was available to read, so nothing can be said. */
  UNCAPTURED: "uncaptured",
});

/** `Test timed out in 60000ms.` / `Hook timed out in 60000ms.` from vitest. */
const TIMEOUT_PATTERN = /(Test|Hook) timed out in (\d+)ms/g;

/**
 * `ERROR: Coverage for statements (85.1%) does not meet global threshold (86%)`
 * — vitest's own wording, `global` or a quoted glob in the scope position.
 */
const THRESHOLD_PATTERN =
  /Coverage for (\S+) \(([\d.]+)%\) does not meet (\S+) threshold \(([\d.]+)%\)/g;

/** vitest's tally line: `Tests  4 failed | 14272 passed (14276)`. */
const TALLY_PATTERN = /Tests\s+(\d+) failed/;

/**
 * A coverage scratch file the run could not open: `coverage/.tmp/coverage-7.json`.
 *
 * Keyed on the FILENAME rather than on the directory, because the directory is
 * configurable (`coverage.reportsDirectory`) and the filename is not — the
 * coverage provider names every scratch file `coverage-<n>.json` and nothing
 * else in a gate transcript is called that.
 *
 * The quotes are how both lines that carry the path print it, measured:
 * `open '/abs/coverage/.tmp/coverage-0.json'` in the error and
 * `path: '/abs/coverage/.tmp/coverage-0.json'` in the serialized copy. A form
 * without them falls through to `undiagnosed`, which now also reports NOT
 * PROVED — so an unmatched shape degrades to a weaker true statement rather
 * than to a false one.
 *
 * Horizontal-only `[^\n]` for the same reason {@link FAIL_PATTERN} uses it:
 * this parses a multi-megabyte transcript inside a git hook.
 */
const COVERAGE_SCRATCH_ENOENT =
  /ENOENT[^\n]+?['"]([^'"\n]+coverage-\d+\.json)['"]/g;

/**
 * The coverage provider's own words for the same event, when it manages to say
 * them: `Something removed the coverage directory "…" Vitest created earlier`.
 *
 * It is a better sentence than anything this module could reconstruct, and it
 * names the cause outright. It is also SUPPRESSED in the case that actually
 * happens — see {@link interferenceVerdict} — which is why the pattern above
 * exists as well.
 */
const COVERAGE_DIR_REMOVED =
  /Something removed the coverage directory "([^"\n]+)"/g;

/**
 * A failing suite header: ` FAIL  tests/unit/foo.test.ts > does a thing`.
 *
 * Horizontal whitespace only, never `\s`. Under the `m` flag `^\s*` can consume
 * newline after newline before failing, which is super-linear backtracking on
 * exactly the input this module is fed: a multi-megabyte suite transcript. The
 * shipped ruleset refuses it, and this is a parser reading untrusted-sized
 * output inside a git hook, so the refusal is right.
 */
const FAIL_PATTERN = /^[ \t]*FAIL[ \t]+(\S+)/gm;

/**
 * Vitest's own line when the run executed nothing.
 *
 * Horizontal whitespace only, for the super-linear-backtracking reason given
 * for `FAIL_PATTERN` — same parser, same multi-megabyte input.
 */
const NO_TESTS_PATTERN = /^[ \t]*No test files found/m;

/**
 * Vitest's run-summary line, present whenever a run reached a verdict.
 *
 * Required ABSENT before a transcript is called a zero-file run. A suite that
 * captures a nested runner's output can carry a child's `No test files found`
 * inside a transcript whose own 826 files ran perfectly well, and calling that
 * a non-measurement would be this module's own defect in mirror image.
 */
const SUMMARY_PATTERN = /^[ \t]*Test Files[ \t]+/m;

/**
 * Prefixes a tool uses to say why it stopped, rather than what it measured.
 *
 * Matched by string comparison rather than by a regex. The shipped ruleset
 * refuses a pattern whose runtime can go super-linear on this module's input,
 * and it is right to: this is a parser reading a multi-megabyte transcript
 * inside a git hook. A prefix test over already-split lines cannot backtrack.
 */
const REASON_PREFIXES = Object.freeze(["Error:", "ERROR:", "error:"]);

/**
 * Lines the transcript offered as a reason.
 * @param {string} output The command's combined output.
 * @returns {string[]} Trimmed reason lines, in the order they appeared.
 */
function findReasons(output) {
  return output
    .split("\n")
    .map(line => line.trim())
    .filter(line => REASON_PREFIXES.some(prefix => line.startsWith(prefix)));
}

/**
 * The verdict for a run that executed zero test files.
 *
 * This is the shape #2883's Arm B run 8 arrived in, and it is the last place
 * this module could still call a non-measurement a measurement. When a guard
 * refuses to start a run, vitest prints `No test files found`, then a complete
 * coverage report with EVERY file at 0%, and only then the reason. Fed that
 * transcript, this module used to answer `threshold — coverage is below the
 * declared floor on 4 metric(s)`: a coverage regression, reported off a run in
 * which no line of code was ever executed. Measured on a real 416-line refusal
 * rather than constructed.
 *
 * So zero-files outranks every content signature below it, for exactly the
 * reason a kill does: a coverage floor is a measurement only when a suite
 * produced it, and here none did. It stays out of `ATTRIBUTION` for the same
 * reason — nothing was measured, so nothing may be attributed, and the run
 * reports NOT PROVED rather than a verdict on somebody's property.
 *
 * The evidence quoted is whatever the transcript offered as a REASON, because
 * for this shape the reason is the one line the reader needs and it is
 * hundreds of lines below the verdict.
 * @param {string} output The command's combined output.
 * @returns {Diagnosis} The verdict.
 */
function noTestsVerdict(output) {
  // The coverage-threshold lines are dropped from the evidence rather than
  // ranked below it. They ARE the artefact this verdict exists to explain, and
  // there are four of them against an evidence cap of five — left in, they push
  // the one line the reader needs off the end of the list.
  const fabricated = new RegExp(THRESHOLD_PATTERN.source);
  const reasons = findReasons(output).filter(line => !fabricated.test(line));
  return {
    kind: DIAGNOSIS.NO_TESTS_RAN,
    summary:
      "the runner executed ZERO test files, so nothing it printed is a " +
      "measurement — a coverage report from this run reads 0% because no " +
      "code was executed, NOT because coverage regressed. Whatever stopped " +
      "the run from starting is the failure",
    evidence: capped(reasons.length > 0 ? reasons : tailLines(output)),
  };
}

/**
 * Which gate's property each kind of failure actually belongs to.
 *
 * Saying WHICH failure it was is half the repair. The other half is saying
 * WHOSE it was, because the two gates involved legitimately share one prover:
 * a coverage-instrumented suite proves `test-correctness` by passing and
 * `coverage-adequacy` by clearing its floor, and one exit code cannot say
 * which of the two it failed on. Reporting it against both is how a starved
 * test suite rendered as a coverage regression — and it is also why a real
 * coverage regression could not be told from that flake.
 *
 * `undiagnosed`, `uncaptured`, `killed` and `interference` are deliberately
 * absent. Nothing was measured, so nothing may be attributed; the failure stays
 * where it landed. `killed` is the most important to leave out: a terminated
 * command measured NOTHING, so attributing it to `test-correctness` would print
 * a verdict about a property no run ever reached.
 *
 * Absent from here is only half of it. A kind that measured nothing must also
 * not report as FAILED, or the gate still asserts a verdict on a property no
 * run reached — see `MEASURED_NOTHING` in `lisa-run-gates.mjs`, which maps
 * these to NOT PROVED. That gate still blocks; it just stops naming a cause it
 * does not have.
 *
 * The runner applies this only when the named gate is itself declared on the
 * same command at the same moment, so a phrase in some unrelated tool's output
 * can never invent an attribution.
 */
export const ATTRIBUTION = Object.freeze({
  timeout: "test-correctness",
  assertion: "test-correctness",
  threshold: "coverage-adequacy",
});

/** How many named examples a summary carries before it says "and N more". */
const MAX_EVIDENCE = 5;

/** Longest tail line quoted back when nothing else is recognised. */
const MAX_TAIL = 200;

/**
 * How many trailing lines an unrecognised failure quotes back.
 *
 * Three rather than one, measured on this runner's own output: the last line
 * of a failing task-runner chain is the runner's own `exited with code 1`,
 * which says nothing the exit code did not. The line naming the artifact to
 * rebuild was two above it.
 */
const TAIL_LINES = 3;

/**
 * One classified failure: the kind, a clause an operator can read, and the
 * concrete lines that back it.
 * @typedef {object} Diagnosis
 * @property {string} kind One of `DIAGNOSIS`.
 * @property {string} summary A single operator-readable clause.
 * @property {string[]} evidence Concrete names or lines supporting the summary.
 * @property {string|null} proves The gate whose property this failure belongs
 *   to, from `ATTRIBUTION`, or null when nothing was recognised.
 */

/**
 * Trim a list to `MAX_EVIDENCE`, saying how many were dropped.
 * @param {string[]} items Every item found.
 * @returns {string[]} At most `MAX_EVIDENCE + 1` lines.
 */
function capped(items) {
  const unique = [...new Set(items)];
  if (unique.length <= MAX_EVIDENCE) return unique;
  return [
    ...unique.slice(0, MAX_EVIDENCE),
    `…and ${unique.length - MAX_EVIDENCE} more`,
  ];
}

/**
 * Every timeout the output reports, with the budget each one blew.
 * @param {string} output The gate command's combined output.
 * @returns {{count: number, budgets: number[]}} What was found.
 */
function findTimeouts(output) {
  const budgets = [...output.matchAll(TIMEOUT_PATTERN)].map(match =>
    Number(match[2])
  );
  return { count: budgets.length, budgets };
}

/**
 * Every coverage floor the output reports as unmet.
 * @param {string} output The gate command's combined output.
 * @returns {string[]} One `metric measured% < required% (scope)` per miss.
 */
function findThresholdMisses(output) {
  return [...output.matchAll(THRESHOLD_PATTERN)].map(
    match => `${match[1]} ${match[2]}% < ${match[4]}% (${match[3]})`
  );
}

/**
 * The suites the output names as failing, and the tally if one was printed.
 * @param {string} output The gate command's combined output.
 * @returns {{tally: number|null, suites: string[]}} What was found.
 */
function findFailures(output) {
  const tally = TALLY_PATTERN.exec(output);
  return {
    tally: tally ? Number(tally[1]) : null,
    suites: [...output.matchAll(FAIL_PATTERN)].map(match => match[1]),
  };
}

/**
 * The last lines that carry anything, for a failure nothing else recognised.
 * @param {string} output The gate command's combined output.
 * @returns {string[]} Up to `TAIL_LINES` trimmed lines, oldest first.
 */
function tailLines(output) {
  return output
    .split("\n")
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .slice(-TAIL_LINES)
    .map(line => line.slice(0, MAX_TAIL));
}

/**
 * A timeout verdict, worded so it can never be mistaken for a coverage miss.
 * @param {{count: number, budgets: number[]}} timeouts What was found.
 * @param {string[]} suites Suites the output named as failing.
 * @returns {Diagnosis} The verdict.
 */
function timeoutVerdict(timeouts, suites) {
  const budget = Math.max(...timeouts.budgets);
  return {
    kind: DIAGNOSIS.TIMEOUT,
    summary:
      `${timeouts.count} test(s)/hook(s) exceeded the ${budget}ms budget, ` +
      `so the suite did not finish — this is NOT a coverage shortfall`,
    evidence: capped(suites),
  };
}

/**
 * Every coverage scratch file the run named as missing.
 * @param {string} output The gate command's combined output.
 * @returns {string[]} One path per distinct file, plus any directory the
 *   provider named outright.
 */
function findInterference(output) {
  return [
    ...[...output.matchAll(COVERAGE_DIR_REMOVED)].map(
      match => `${match[1]} (the coverage provider named this directory itself)`
    ),
    ...[...output.matchAll(COVERAGE_SCRATCH_ENOENT)].map(match => match[1]),
  ];
}

/**
 * The verdict for a run whose own scratch files were deleted underneath it.
 *
 * ## Measured, both arms, 2026-08-23, vitest 4.1.9
 *
 * A coverage run writes one `coverage-<n>.json` per test file as that file
 * finishes and reads them all back at the end, so everything between the first
 * write and the read is a window in which another process can delete them. Two
 * runs, identical except for what was done to the directory at the eight-second
 * mark:
 *
 * | what happened to the scratch directory | what the run printed |
 * |---|---|
 * | removed **and re-created** | `ENOENT … open '…/coverage/.tmp/coverage-0.json'` — nothing else |
 * | removed and **left absent** | `Something removed the coverage directory "…" … not running multiple Vitests with the same "coverage.reportsDirectory" at the same time` |
 *
 * The provider's own explanation is guarded on the directory being ABSENT. A
 * second coverage run in the same directory removes it and re-creates it in
 * consecutive statements, so by the time the first run looks, the directory is
 * back and the guard does not fire. **The one case the message was written for
 * is the one case it cannot reach**, and what reaches the operator instead is a
 * bare `ENOENT` on a path nobody recognises — which is how it arrived at
 * CodySwannGT/lisa#2961 filed as a coverage-gate failure.
 *
 * ## What this is NOT
 *
 * It is not stale debris. Seeded with 798 abandoned scratch files from a killed
 * run — the largest holding measured in the wild — a coverage run completes and
 * reports a verdict, because the provider deletes that directory before every
 * run. `tests/integration/coverage-scratch-debris.test.ts` pins that.
 * @param {string[]} paths What {@link findInterference} found.
 * @returns {Diagnosis} The verdict.
 */
function interferenceVerdict(paths) {
  return {
    kind: DIAGNOSIS.INTERFERENCE,
    summary:
      `this run's own coverage scratch files were deleted while it was still ` +
      `running, so it never produced a coverage number — another run sharing ` +
      `the same coverage.reportsDirectory did that, and it is NOT a coverage ` +
      `shortfall. Re-run it on its own`,
    evidence: capped(paths),
  };
}

/**
 * Exit codes a POSIX shell reports for a command killed by a signal.
 *
 * `128 + signal`. Enumerated rather than treated as a range, because the
 * message has to NAME the signal — "killed by SIGTERM" is actionable and
 * "terminated by signal 15" is a second lookup — and because a broad
 * `code > 128` rule would swallow the handful of tools that use high exit codes
 * to mean something else. These seven are the ones that actually terminate a
 * gate on this fleet: an operator's Ctrl-C, an out-of-memory reap, a CPU-time
 * limit, and the SIGTERM a saturated box hands out.
 */
const SIGNAL_EXITS = Object.freeze({
  129: "SIGHUP",
  130: "SIGINT",
  131: "SIGQUIT",
  137: "SIGKILL",
  139: "SIGSEGV",
  143: "SIGTERM",
  152: "SIGXCPU",
});

/**
 * Whether an exit code says the command was terminated rather than answered.
 *
 * `null` and `undefined` are NOT the same answer here, and conflating them
 * would be a fresh instance of this module's own defect. The runner's
 * `normaliseExec` yields a number or `null`, and `null` is what it produces for
 * a child killed by a signal — it already calls that "terminated". `undefined`
 * means the caller passed no code at all, which is no information, not a kill.
 * @param {number|null|undefined} code The command's exit code, `null` when the
 *   runner obtained none, `undefined` when the caller supplied none.
 * @returns {boolean} Whether this was a termination.
 */
function wasKilled(code) {
  if (code === undefined) return false;
  return code === null || SIGNAL_EXITS[code] !== undefined;
}

/**
 * The verdict for a command that was terminated rather than answered.
 *
 * This exists because `exit 143` and `exit 1` were the same sentence. 143 is
 * `128 + 15`: SIGTERM. On a saturated box a contention kill reads identically
 * to a real gate failure, so the runner said "N test(s) exceeded the budget" or
 * "no recognised failure signature" about a command that never reached a
 * verdict at all — and the transcript it read to say so was a TRUNCATED one,
 * whose `FAIL` lines are whatever happened to have been printed before the
 * kill. That is manufactured evidence for a false diagnosis, and re-running is
 * a rational response to it, which is exactly why the real cause never gets
 * looked at.
 *
 * So a kill outranks every content signature, including the ones it may be
 * sitting on top of. Nothing the output says is a verdict once the run was
 * terminated.
 * @param {number|null} code The exit code, or null when none was obtained.
 * @param {LoadReading|null} [load] The machine's load at diagnosis time, from
 *   {@link machineLoad}. Omitted or null when it could not be read.
 * @returns {Diagnosis} The verdict.
 */
function killedVerdict(code, load) {
  const named = SIGNAL_EXITS[code];
  const cause =
    named === undefined
      ? "a signal, and the runner obtained no exit code for it"
      : `${named} — exit ${code} is 128 + ${code - 128}`;
  return {
    kind: DIAGNOSIS.KILLED,
    summary:
      `the command was KILLED by ${cause}. It was terminated, NOT failed: it ` +
      `reached no verdict, and its output is a truncated transcript rather ` +
      `than a result. Re-run it on a quieter machine before reading anything ` +
      `into what it printed`,
    evidence: loadEvidence(load ?? null),
  };
}

/**
 * The machine's run-queue pressure, or `null` when it cannot be read.
 * @typedef {object} LoadReading
 * @property {number} load1 One-minute load average.
 * @property {number} cores Logical cores available to this process.
 * @property {number} ratio `load1 / cores` — runnable work per core.
 */

/**
 * Read the machine's current run-queue pressure.
 *
 * Injected rather than called inline so a test can state a load instead of
 * inheriting whatever the test machine happened to be doing, which would make
 * the assertion a coin flip on a busy box — the very condition this reading
 * exists to describe.
 * @param {() => number[]} [readLoadavg] Load-average source.
 * @param {() => number} [readCores] Core-count source.
 * @returns {LoadReading|null} The reading, or null when either source fails.
 */
export function machineLoad(readLoadavg = osLoadavg, readCores = osCores) {
  try {
    const load1 = readLoadavg()[0];
    const cores = readCores();
    if (!Number.isFinite(load1) || !Number.isFinite(cores) || cores <= 0) {
      return null;
    }
    return { load1, cores, ratio: load1 / cores };
  } catch {
    return null;
  }
}

/**
 * Turn a load reading into the one line an operator needs beside a kill.
 *
 * A kill that says only "the machine was busy" is still prose. What decides
 * whether to re-run or to investigate is the NUMBER, and the number cuts both
 * ways on purpose: an oversubscribed box says re-run, and a quiet one says the
 * saturation story does not hold here, go and find the real killer. Reporting
 * only the first case would make this a rubber stamp for "not my change".
 *
 * The reading is taken when the failure is diagnosed, which is after the kill,
 * so it lags — load is falling by then. The line says so rather than implying a
 * precision it does not have.
 * @param {LoadReading|null} load The reading, or null when unavailable.
 * @returns {string[]} Zero or one evidence line.
 */
function loadEvidence(load) {
  if (load === null) return [];
  const ratio = load.ratio.toFixed(1);
  const where = `load1 ${load.load1.toFixed(1)} across ${load.cores} core(s), ${ratio}x per core`;
  return load.ratio >= SATURATED_RATIO
    ? [
        `machine at diagnosis (after the kill, so this is a floor): ${where}. ` +
          `A box at this level terminates processes to survive; read this as ` +
          `saturation, not as a defect in the change.`,
      ]
    : [
        `machine at diagnosis (after the kill, so this is a floor): ${where}. ` +
          `That is not saturation, so contention does not explain this kill — ` +
          `look for a timeout, an OOM, or an operator interrupt.`,
      ];
}

/**
 * Runnable work per core above which the box is treated as saturated.
 *
 * Two, not one. A load average equal to the core count is a machine that is
 * fully used, which is what a test suite is supposed to do; twice that is a
 * machine where every runnable thread is waiting behind another one. The
 * sighting behind this issue was 21x, and the state after the fleet had already
 * been asked to throttle was 8.3x, so the boundary is not close to either arm.
 */
const SATURATED_RATIO = 2;

/**
 * The verdict for a failure whose transcript never reached this module.
 *
 * `null`/`undefined` output is the runner reporting that it HAS no transcript
 * to offer, so the repair is a capability one and the summary names every way
 * capture can be off.
 * @returns {Diagnosis} The verdict.
 */
function unavailableVerdict() {
  return {
    kind: DIAGNOSIS.UNCAPTURED,
    summary:
      "no output was captured, so this failure has no diagnosis. Capture " +
      "is on by default; it is off when LISA_GATES_CAPTURE=0 is set, when " +
      "the shell has no `tee`, or when a temporary directory could not be " +
      "created. Restore capture capability before re-running",
    evidence: [],
  };
}

/**
 * The verdict for a failure whose transcript arrived and was empty.
 *
 * Separated from {@link unavailableVerdict} because the two ask for opposite
 * repairs and the module used to answer both with the capture-capability one.
 * An empty string is a transcript that WAS captured — capture worked — and
 * telling an operator to "restore capture capability" sends them to fix a
 * facility that is already working while the real signal, a command that
 * exited nonzero without printing a word, goes unmentioned. That signature
 * belongs to the wrapper or the shell around the tool rather than to the tool,
 * so the sentence has to point there.
 *
 * The KIND stays `uncaptured`: both states leave this module with nothing to
 * read, and `uncaptured` is deliberately outside `MEASURED_NOTHING` in
 * `lisa-run-gates.mjs` because a gate that exited nonzero did measure
 * something. Only the sentence differs, because only the repair differs.
 * @returns {Diagnosis} The verdict.
 */
function emptyTranscriptVerdict() {
  return {
    kind: DIAGNOSIS.UNCAPTURED,
    summary:
      "the command's output was captured and is empty, so this failure has " +
      "no diagnosis. Capture itself is working — there was nothing to read. " +
      "A command that exits nonzero without printing anything usually failed " +
      "before the tool it wraps ever ran, so check the command line and the " +
      "shell that invokes it rather than capture",
    evidence: [],
  };
}

/**
 * Classify why a gate command failed, from the output it produced.
 *
 * Ordered deliberately, and the order is the content of this function: a
 * kill outranks everything, then outside interference with the run's own
 * scratch files, then a run that executed no test files at all, then a
 * timeout outranks an assertion failure
 * outranks a threshold miss, because
 * coverage read off a run that did not finish measures the interruption rather
 * than the code. Getting that backwards is the defect being fixed — it is what
 * printed "coverage-adequacy failed" six times for a machine under load.
 * @param {string|null|undefined} output The command's combined output, or null
 *   when the runner could not capture it.
 * @param {number|null|undefined} code The command's exit code, or null when the
 *   runner could not obtain one.
 * @param {LoadReading|null} load The machine's load at diagnosis time.
 * @returns {object} What the failure was, before it is attributed.
 */
function classify(output, code, load) {
  if (wasKilled(code)) return killedVerdict(code ?? null, load);

  if (typeof output !== "string") return unavailableVerdict();

  if (output.length === 0) return emptyTranscriptVerdict();

  // Above every content signature, and directly below a kill, for the same
  // reason a kill outranks them: the run was interfered with from outside, so
  // whatever it printed describes the interference rather than the code. A
  // timeout or a failing assertion in such a transcript may well be real, but
  // it is not what stopped the run, and the gate whose verdict is missing is
  // the coverage one either way.
  const interference = findInterference(output);
  if (interference.length > 0) return interferenceVerdict(interference);

  // Directly below interference and above every measurement signature: a run
  // that executed no test files measured nothing, so its timeouts, its FAIL
  // lines and above all its coverage numbers are artefacts of not having run.
  if (NO_TESTS_PATTERN.test(output) && !SUMMARY_PATTERN.test(output)) {
    return noTestsVerdict(output);
  }

  const timeouts = findTimeouts(output);
  const failures = findFailures(output);
  const misses = findThresholdMisses(output);

  if (timeouts.count > 0) return timeoutVerdict(timeouts, failures.suites);

  if ((failures.tally ?? 0) > 0 || failures.suites.length > 0) {
    const count = failures.tally ?? failures.suites.length;
    return {
      kind: DIAGNOSIS.ASSERTION,
      summary: `${count} test(s) ran and failed`,
      evidence: capped(failures.suites),
    };
  }

  if (misses.length > 0) {
    return {
      kind: DIAGNOSIS.THRESHOLD,
      summary: `coverage is below the declared floor on ${misses.length} metric(s)`,
      evidence: capped(misses),
    };
  }

  return {
    kind: DIAGNOSIS.UNDIAGNOSED,
    summary: "no recognised failure signature; the command's last lines follow",
    evidence: capped(tailLines(output)),
  };
}

/**
 * Classify a failure and say whose property it belongs to.
 *
 * Attribution is separated from classification on purpose. Reading a
 * transcript is a fact about a tool's output; deciding which gate that fact
 * indicts is a fact about the registry, and only the caller knows whether the
 * indicted gate is part of the run at all.
 * @param {string|null|undefined} output The command's combined output, or null
 *   when the runner could not capture it.
 * @param {number|null|undefined} [code] The command's exit code. Omitted by a
 *   caller that has none; a caller that HAS one must pass it, because a kill is
 *   only legible in the exit code and never in the output.
 * @param {LoadReading|null} [load] The machine's load, for a kill's evidence
 *   line. Defaults to reading this machine; pass `null` to suppress the line,
 *   or a fixed reading to make the output deterministic.
 * @returns {Diagnosis} What the failure was, and whose it was.
 */
export function diagnoseFailure(output, code, load = machineLoad()) {
  const verdict = classify(output, code, load);
  return { ...verdict, proves: ATTRIBUTION[verdict.kind] ?? null };
}
