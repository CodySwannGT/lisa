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
import { readdirSync, readFileSync, statSync } from "node:fs";
import { availableParallelism, loadavg, tmpdir } from "node:os";

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
  /** The OS refused the run a process, descriptor, or page it asked for. */
  RESOURCE_REFUSED: "resource-refused",
  /** Another process destroyed this run's scratch files while it was running. */
  INTERFERENCE: "interference",
  /** The runner executed zero test files, so nothing it printed is a measurement. */
  NO_TESTS_RAN: "no-tests-ran",
  /** A doc comment ended early, so everything below it was parsed as code. */
  COMMENT_TERMINATED: "comment-terminated",
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
 * A removal that lost a race with a concurrent writer, inside managed scratch.
 *
 * Three conditions, all required, and the third is what keeps this honest.
 *
 * 1. **An errno a concurrent writer produces.** `ENOTEMPTY`, `EBUSY` and
 *    `EPERM` are what a removal reports when something else is holding or
 *    filling the directory. A plain `ENOENT` is deliberately absent: it is
 *    already the coverage-deletion signature above, and on its own it is more
 *    often a genuine missing-file bug.
 * 2. **A removal syscall.** `rmdir`, `unlink` or `rename` — the operations that
 *    can lose to a writer. Without this the pattern would swallow an `EPERM`
 *    from an ordinary permission defect.
 * 3. **A path inside the MANAGED SCRATCH namespace.** This is the grounding
 *    clause. A failure about some other directory is a fact about the code, and
 *    a diagnosis that claimed it was the machine would be this module's own
 *    defect: an environment excuse issued over a real bug.
 *
 * Measured on CodySwannGT/lisa#3877, in a test unreachable from the branch that
 * was pushing:
 *
 * ```
 * ENOTEMPTY: directory not empty, rmdir
 *   '…/lisa-scratch/run-35247-…/worker-14451-…/lisa-test-ylEKHM/.git'
 * ```
 *
 * The point of naming it is not to excuse it — an INTERFERENCE verdict blocks
 * the push exactly as FAILED does. The point is that the author can tell an
 * environment-sensitive failure from a code failure WITHOUT spending a second
 * ten-minute cycle to find out, and that the retry which used to be the only
 * way to answer the question is itself the load that caused it.
 *
 * Horizontal-only `[^\n]` for the reason {@link FAIL_PATTERN} gives: this
 * parses a multi-megabyte transcript inside a git hook.
 */
const SCRATCH_REMOVAL_RACE =
  /\b(?:ENOTEMPTY|EBUSY|EPERM)\b[^\n]*?\b(?:rmdir|unlink|rename)\b[^\n]*?(lisa-scratch[^'"\n]*)/g;

/**
 * Every removal-race line this transcript carries.
 * @param {string} output The command's combined output.
 * @returns {string[]} The scratch paths named, deduplicated, in order.
 */
function findScratchRaces(output) {
  return [
    ...new Set([...output.matchAll(SCRATCH_REMOVAL_RACE)].map(hit => hit[1])),
  ];
}

/**
 * The verdict for a run whose own cleanup lost a race with a concurrent writer.
 *
 * A sibling of {@link interferenceVerdict} rather than the same sentence: there
 * the other process DELETED files this run needed, here it CREATED one inside a
 * directory this run was removing. Same family, opposite direction, and an
 * operator handed the coverage sentence for this would go looking for a second
 * coverage run that does not exist.
 *
 * The remedy names the durable fix rather than "re-run it", because re-running
 * is what makes this expensive: the retry costs another full cycle and adds the
 * load that raises the chance a DIFFERENT load-sensitive test fails instead —
 * measured as two attempts failing on two different files.
 * @param {string[]} paths The scratch paths the race named.
 * @returns {Diagnosis} The verdict.
 */
function scratchRaceVerdict(paths) {
  return {
    kind: DIAGNOSIS.INTERFERENCE,
    summary:
      `a removal inside this run's managed scratch lost a race with a ` +
      `concurrent writer, so a cleanup hook threw and the test it belonged to ` +
      `was reported as failing. That is a fact about machine I/O contention, ` +
      `NOT about the code under test — the failing file need not be reachable ` +
      `from your diff at all. Removal helpers take maxRetries for exactly this ` +
      `errno set; a helper that omits it fails on the first collision`,
    evidence: capped(paths),
  };
}

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
 * Did this transcript come from a run that executed no test files at all?
 *
 * Exported because the caller needs it on the path this module cannot see.
 * Everything else here runs only once a command has already failed, which is
 * exactly the wrong side for the defect in CodySwannGT/lisa#3715: a runner
 * invoked with `--passWithNoTests` collects nothing and exits **0**, so the
 * runner reports success and the diagnosis below is never reached. The gate
 * then records PASSED for a suite that ran nothing.
 *
 * Both halves are load-bearing, and the second one is why this is a shared
 * predicate rather than a bare `includes`. A transcript that captures a nested
 * runner can carry a child's `No test files found` while its own 826 files ran
 * perfectly well; requiring the summary line to be ABSENT is what stops this
 * being the same non-measurement defect in mirror image.
 * @param {string} output The command's combined output.
 * @returns {boolean} True when the transcript states it ran nothing and reached no verdict.
 */
export function ranNoTests(output) {
  return NO_TESTS_PATTERN.test(output) && !SUMMARY_PATTERN.test(output);
}

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
function capped(items, limit = MAX_EVIDENCE) {
  const unique = [...new Set(items)];
  if (unique.length <= limit) return unique;
  return [...unique.slice(0, limit), `…and ${unique.length - limit} more`];
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
 *
 * Carries the shared temp root's population, because a blown wall-clock budget
 * is the one signature that gives no hint of its own cause. A saturated
 * platform temp root makes every `mkdtemp` on the box slow, and the lane that
 * pays is whichever one happened to create fixtures — so it presents as a
 * single flaky-looking test in a suite that has nothing to do with the
 * producer. The reading is attached here and nowhere else for that reason: on
 * an assertion failure or a coverage miss it would be noise.
 * @param {{count: number, budgets: number[]}} timeouts What was found.
 * @param {string[]} suites Suites the output named as failing.
 * @param {TempRootReading|null} [tempRoot] The temp root's population at
 *   diagnosis time. Omitted or null when it could not be read.
 * @returns {Diagnosis} The verdict.
 */
function timeoutVerdict(timeouts, suites, tempRoot) {
  const budget = Math.max(...timeouts.budgets);
  // Reserve the temp-root line's slot BEFORE capping the suites, so this
  // verdict carries the same MAX_EVIDENCE + 1 ceiling as every other one.
  // Appending after the cap made this the only verdict that could reach
  // MAX_EVIDENCE + 2, and the cap test could not see it because that test
  // suppresses the reading.
  const tempEvidence = tempRootEvidence(tempRoot ?? null);
  return {
    kind: DIAGNOSIS.TIMEOUT,
    summary:
      `${timeouts.count} test(s)/hook(s) exceeded the ${budget}ms budget, ` +
      `so the suite did not finish — this is NOT a coverage shortfall`,
    evidence: [
      ...capped(suites, MAX_EVIDENCE - tempEvidence.length),
      ...tempEvidence,
    ],
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
 * Ways the kernel says "no" when it has run out of something.
 *
 * Deliberately anchored to the syscall or the tool that failed, never to the
 * bare errno text. `Operation not permitted` on its own is a permissions
 * message that a hundred honest tests print; `setpgid(…): Operation not
 * permitted` is the process table being full. The narrow form is what keeps a
 * real assertion failure from being excused as machine noise, which is the one
 * way this whole module can do harm.
 */
const RESOURCE_REFUSAL_PATTERNS = Object.freeze([
  /\bchild setpgid\s*\(\d+\s+to\s+\d+\):\s*Operation not permitted/,
  /\bfork:\s*Resource temporarily unavailable/,
  /\bposix_spawn\b[^\n]*\b(?:EAGAIN|ENOMEM|EMFILE)\b/,
  /\bspawn\b[^\n]*\b(?:EAGAIN|ENOMEM|EMFILE)\b/,
]);

/**
 * The lines in which the kernel refused this run a resource.
 * @param {string} output The command's combined output.
 * @returns {string[]} Matching lines, in order, deduplicated.
 */
function findResourceRefusals(output) {
  const hits = output
    .split("\n")
    .filter(line => RESOURCE_REFUSAL_PATTERNS.some(rx => rx.test(line)))
    .map(line => line.trim());
  return [...new Set(hits)];
}

/**
 * The verdict for a run the machine refused a resource to.
 *
 * The third rendering of saturation, and the nastiest, because unlike the other
 * two it arrives wearing a real failure's clothes. A kill announces itself in
 * the exit code; a timeout announces itself by leaving the streams empty. This
 * one announces nothing: the OS declines to create a process group, the shell
 * prints one line about it, the tool carries on and produces the WRONG OUTPUT,
 * and the suite reports a specific, plausible, entirely fictional content
 * mismatch. Measured on this repository: `/bin/echo: child setpgid (38941 to
 * 38941): Operation not permitted` surfaced as an assertion that a string
 * should have been `"wor ld"`. An agent reading that goes and debugs a test
 * that is completely fine, and the retry adds the load that caused it.
 *
 * So this outranks every content signature for the same reason a kill does: the
 * transcript describes a machine that ran out, not code that is wrong.
 * @param {string[]} refusals The refusal lines found.
 * @param {LoadReading|null} load The machine's load at diagnosis time.
 * @returns {Diagnosis} The verdict.
 */
function resourceRefusedVerdict(refusals, load) {
  return {
    kind: DIAGNOSIS.RESOURCE_REFUSED,
    summary:
      `the OS refused this run a resource it asked for (${refusals.length} ` +
      `line(s) below). It was NOT a content failure: whatever the command ` +
      `printed afterwards, including any assertion it reported, describes a ` +
      `machine that ran out rather than code that is wrong. Re-run it on a ` +
      `quieter machine before changing anything`,
    evidence: [...capped(refusals), ...loadEvidence(load)],
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
 * List the platform temp root's direct children.
 *
 * Deliberately NOT recursive. The cost being measured is the width of one
 * directory — what `mkdtemp` and every `readdir` on that path must walk — and
 * descending into tens of thousands of entries to diagnose a failure would
 * itself be the expensive operation this line exists to warn about.
 * @returns {string[]} Direct children of the platform temp root.
 */
function defaultTempRootEntries() {
  return readdirSync(tmpdir());
}

/**
 * Read the platform temp root's own inode size.
 * @returns {number} Size in bytes of the directory inode itself.
 */
function defaultTempRootInodeBytes() {
  return statSync(tmpdir()).size;
}

/**
 * How crowded the shared platform temp root is, or `null` when unreadable.
 * @typedef {object} TempRootReading
 * @property {number} entries Direct children of the platform temp root.
 * @property {number} inodeBytes Size of the directory's own inode.
 */

/**
 * Measure the shared platform temp root.
 *
 * Both numbers are taken because they answer different questions and only one
 * of them is repairable by deleting things. The ENTRY COUNT is the current
 * population. The INODE SIZE is what that population did to the directory, and
 * a directory inode does not shrink when its entries are removed — so a root
 * that once held tens of thousands of names stays expensive to walk after a
 * prune, and a report that showed only the count would say "cleaned up" about
 * a directory that is still slow.
 *
 * Injected for the same reason {@link machineLoad} is: a test must be able to
 * state a population rather than inherit whatever the test machine's temp root
 * happened to contain, which is shared with every other process on the box.
 * @param {() => string[]} [readEntries] Lists the temp root's children.
 * @param {() => number} [readInodeBytes] Reads the temp root's own inode size.
 * @returns {TempRootReading|null} The reading, or null when either source fails.
 */
export function tempRootPopulation(
  readEntries = defaultTempRootEntries,
  readInodeBytes = defaultTempRootInodeBytes
) {
  try {
    const entries = readEntries().length;
    const inodeBytes = readInodeBytes();
    if (!Number.isFinite(entries) || !Number.isFinite(inodeBytes)) return null;
    return { entries, inodeBytes };
  } catch {
    return null;
  }
}

/**
 * Turn a temp-root reading into the line that lets an operator rule crowding
 * in or out.
 *
 * REPORTS, NEVER JUDGES — and that is a measured decision rather than caution.
 * A crowded platform temp root makes `mkdtemp` pathologically slow, which
 * surfaces as one slow test in an unrelated lane and never as "the filesystem
 * is the problem", so the number belongs beside a timeout. But the threshold
 * at which it starts costing anything is NOT KNOWN: 16.5k entries measured at
 * a 1.0x `mkdtemp` penalty against a nested directory — i.e. none at all — on
 * the same platform where ~46k was reported harmful. Nothing measured in
 * between.
 *
 * Guessing a boundary in that gap would produce a detector that fires on the
 * ordinary state of a busy workstation, and a check that cries wolf on a
 * healthy machine is worse than no check: it trains its own readers to skip
 * the line. So this prints what it saw and names both calibration points,
 * leaving the reader to decide — and accumulates the evidence a later change
 * can set a real threshold from.
 * @param {TempRootReading|null} tempRoot The reading, or null when unavailable.
 * @returns {string[]} Zero or one evidence line.
 */
function tempRootEvidence(tempRoot) {
  if (tempRoot === null) return [];
  const kb = Math.round(tempRoot.inodeBytes / 1024);
  return [
    `shared temp root at diagnosis: ${tempRoot.entries} entries, ` +
      `${kb} KB directory inode. A crowded platform temp root slows every ` +
      `mkdtemp on the box and shows up as one slow test in an unrelated ` +
      `lane, so this is a candidate cause to rule in or out — not a verdict. ` +
      `No threshold is asserted because none is known: ~16.5k entries ` +
      `measured NO penalty and ~46k was reported harmful, with nothing ` +
      `measured between. The inode size is the part a prune does not fix.`,
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
function classify(output, code, load, read, tempRoot) {
  if (wasKilled(code)) return killedVerdict(code ?? null, load);

  if (typeof output !== "string") return unavailableVerdict();

  if (output.length === 0) return emptyTranscriptVerdict();

  // Directly below a kill and above everything else, because it is the same
  // event one rung earlier: the machine ran out, and the difference is only
  // whether it took the process away or declined to give it another one. The
  // transcript below this line is not evidence about the code.
  const refusals = findResourceRefusals(output);
  if (refusals.length > 0) return resourceRefusedVerdict(refusals, load);

  // Above every content signature, and directly below a kill, for the same
  // reason a kill outranks them: the run was interfered with from outside, so
  // whatever it printed describes the interference rather than the code. A
  // timeout or a failing assertion in such a transcript may well be real, but
  // it is not what stopped the run, and the gate whose verdict is missing is
  // the coverage one either way.
  const interference = findInterference(output);
  if (interference.length > 0) return interferenceVerdict(interference);

  // Beside coverage interference and above every content signature, for the
  // same reason: the run was interfered with from outside, so the assertion
  // the transcript reports describes the interference rather than the code.
  // Below it rather than above only because coverage deletion is the more
  // specific claim when a transcript somehow carries both.
  const races = findScratchRaces(output);
  if (races.length > 0) return scratchRaceVerdict(races);

  // Directly below interference and above every measurement signature: a run
  // that executed no test files measured nothing, so its timeouts, its FAIL
  // lines and above all its coverage numbers are artefacts of not having run.
  if (ranNoTests(output)) {
    return noTestsVerdict(output);
  }

  // Above every signature read out of the transcript, and below the three
  // above it, for opposite reasons. A killed or interfered-with run is a fact
  // about the machine, so its transcript describes the interruption rather
  // than the code and nothing in the files it named can be trusted to be the
  // cause. A doc comment that ends early is the other way round: it is read
  // from the FILE rather than inferred from the output, and where it is
  // present every error the transcript reports below it — the missing names,
  // the arithmetic on identifiers, the unterminated template literal — is a
  // consequence of it. Measured: the true cause sat ~25 lines ABOVE the first
  // reported error, so the natural search direction walks away from it.
  const terminated = findTerminatedComments(output, read);
  if (terminated.length > 0) return commentTerminatedVerdict(terminated);

  const timeouts = findTimeouts(output);
  const failures = findFailures(output);
  const misses = findThresholdMisses(output);

  if (timeouts.count > 0)
    return timeoutVerdict(
      timeouts,
      failures.suites,
      // Resolved HERE and nowhere else: this is the only consumer, and it is
      // the last point at which `undefined` (measure it) and `null` (suppress
      // it) are still distinguishable. Do not "simplify" this to `??` — that
      // collapses the two and makes every suppressed test read the real box.
      tempRoot === undefined ? tempRootPopulation() : tempRoot
    );

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
 * How many files named by a transcript are opened looking for a broken block.
 *
 * A cap rather than no limit, because the transcript is untrusted input: a
 * pathological one could otherwise name thousands of paths and turn a
 * diagnosis into a filesystem walk.
 */
const MAX_SCANNED_FILES = 20;

/** Largest file this scan will read, so one huge generated file cannot stall it. */
const MAX_SCANNED_BYTES = 2_000_000;

/**
 * Everything a path cannot contain, which is therefore what separates one.
 *
 * Splitting on the delimiters rather than matching the path is deliberate. A
 * pattern of the obvious shape — a repeated class that itself contains `.`,
 * followed by a literal `.` and an extension — is ambiguous about where the
 * extension begins, which is polynomial backtracking on adversarial input and
 * is reported as such by `sonarjs/slow-regex`. A transcript is untrusted
 * input, so this reads it with one non-ambiguous split and a suffix test.
 *
 * Splitting also handles all four tools at once, which spell the location
 * differently: `tsc` writes `src/a.ts(90,9)`, ESLint prints the bare path on
 * its own line, `oxlint` writes `,-[src/a.ts:90:9]`, and vite's oxc transform
 * writes a boxed `file:line:col`. Every one of those frames is delimiters
 * around a path.
 */
const PATH_DELIMITER = /[^\w./@-]+/;

/**
 * Shed trailing sentence punctuation before a token is tested as a path.
 *
 * A scan rather than `/\.+$/`, which is the `(a+)$` shape `sonarjs/slow-regex`
 * reports: on a token of many dots the anchored quantifier retries from every
 * position. The transcript is untrusted input, so a linear walk is both the
 * safe answer and the plainer one.
 * @param {string} token One token split out of the transcript.
 * @returns {string} The token with any trailing dots removed.
 */
function withoutTrailingDots(token) {
  let end = token.length;
  while (end > 0 && token[end - 1] === ".") end -= 1;
  return token.slice(0, end);
}

/** Extensions this scan will open. Anything else is not source it can read. */
const SOURCE_EXTENSIONS = Object.freeze([
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
]);

/**
 * Every token in a transcript shaped like a path to a source file.
 * @param {string} output The gate command's combined output.
 * @returns {string[]} Candidate paths, de-duplicated, order preserved.
 */
function candidatePaths(output) {
  const candidates = output
    .split(PATH_DELIMITER)
    .map(withoutTrailingDots)
    .filter(token =>
      SOURCE_EXTENSIONS.some(extension => token.endsWith(extension))
    );
  return [...new Set(candidates)];
}

/** The remedy, named once because the summary and the evidence both cite it. */
const TERMINATOR_REMEDY =
  "write the example so it cannot contain the terminator — `sandbox-<id>/` rather than a glob";

/**
 * Doc comments in this source that end before their author meant them to.
 *
 * ## What is being matched, and why not simply "a terminator inside a comment"
 *
 * The terminator is legitimate; every block comment has one. What marks the
 * defect is that the block **continues** after it: the following lines are
 * still ` * ` prose and there is a later, real terminator further down. So an
 * ordinary block — whose first terminator is the last thing on its line — is
 * never matched, and neither is `/** … *<slash> const x = 1;`, whose next line
 * is code rather than prose.
 *
 * ## Why this reads TEXT and is not a lint rule
 *
 * Measured on the reproduction: the file does not parse. ESLint reports
 * `Parsing error: ';' expected` and runs **zero** rules on it; `oxlint` and
 * vite's oxc transform report a parse error too. A rule that lives inside a
 * parser is therefore absent in exactly the case that motivates it. Lexing the
 * lines needs no parse and so still works on the wreckage.
 *
 * Exported so the shape can be asserted against fixture text with no
 * filesystem and no compiler.
 * @param {string} source The file's full text.
 * @returns {{endsAt: number, opensAt: number, realEndsAt: number, line: string}[]}
 *   One entry per broken block: 1-based lines for where it opened, where it
 *   actually ended, and where its author's terminator sits.
 */
export function terminatedDocComments(source) {
  const lines = String(source ?? "").split("\n");
  const broken = [];
  // A `while` rather than a `for`, because a block is consumed WHOLE: the
  // cursor jumps past the terminator this block actually ended on, so the
  // prose inside one comment can never be mistaken for the opener of another.
  // Reassigning a `for` counter to do that is `sonarjs/updated-loop-counter`,
  // and rightly — the loop header would then be lying about its own stride.
  let index = 0;
  while (index < lines.length) {
    if (!DOC_OPENER.test(lines[index])) {
      index += 1;
      continue;
    }
    const block = readDocBlock(lines, index);
    // No terminator anywhere below this opener, so no block after it can end
    // early either. Nothing further to find.
    if (block === null) break;
    if (block.broken !== null) broken.push(block.broken);
    index = block.resumeAt + 1;
  }
  return broken;
}

/** A JSDoc block opening at the start of a line — never one inside an expression. */
const DOC_OPENER = /^\s*\/\*\*/;

/** A line that is still comment prose: leading whitespace, then an asterisk. */
const DOC_CONTINUATION = /^\s*\*/;

/**
 * Read one block comment and say whether it ends where its author meant.
 * @param {string[]} lines Every line of the file.
 * @param {number} start Index of the line the block opens on.
 * @returns {{broken: object|null, resumeAt: number}|null} What was found.
 */
function readDocBlock(lines, start) {
  const opener = lines[start].indexOf("/**");
  const ends = firstTerminator(lines, start, opener + 3);
  if (ends === null) return null;
  // Nothing after the terminator on its line: an ordinary block, whether that
  // is ` *<slash>` on its own line or a one-line `/** … *<slash>`.
  if (lines[ends.line].slice(ends.column + 2).trim() === "")
    return { broken: null, resumeAt: ends.line };
  const real = realTerminator(lines, ends.line);
  if (real === null) return { broken: null, resumeAt: ends.line };
  return {
    broken: {
      endsAt: ends.line + 1,
      line: lines[ends.line].trim(),
      opensAt: start + 1,
      realEndsAt: real + 1,
    },
    resumeAt: real,
  };
}

/**
 * Where a block comment's first terminator sits.
 * @param {string[]} lines Every line of the file.
 * @param {number} start Index of the line the block opens on.
 * @param {number} from Column to start looking from on that first line.
 * @returns {{column: number, line: number}|null} Its position, or null.
 */
function firstTerminator(lines, start, from) {
  for (let index = start; index < lines.length; index += 1) {
    const column = lines[index].indexOf("*/", index === start ? from : 0);
    if (column !== -1) return { column, line: index };
  }
  return null;
}

/**
 * The terminator the author meant, found by following the prose that keeps
 * going after the block has already ended.
 *
 * Returns null the moment a line stops being prose, which is what keeps an
 * intentional `/** … *<slash> code` off this path.
 * @param {string[]} lines Every line of the file.
 * @param {number} after Index of the line the block actually ended on.
 * @returns {number|null} Index of the author's terminator, or null.
 */
function realTerminator(lines, after) {
  for (let index = after + 1; index < lines.length; index += 1) {
    if (!DOC_CONTINUATION.test(lines[index])) return null;
    if (lines[index].includes("*/")) return index;
  }
  return null;
}

/**
 * Every existing source file a transcript names, capped and de-duplicated.
 * @param {string} output The gate command's combined output.
 * @param {(path: string) => string|null} read Reads a file, or returns null.
 * @returns {{path: string, source: string}[]} What could actually be read.
 */
function namedSources(output, read) {
  const paths = candidatePaths(output);
  const sources = [];
  for (const path of paths) {
    if (sources.length >= MAX_SCANNED_FILES) break;
    const source = read(path);
    if (source !== null) sources.push({ path, source });
  }
  return sources;
}

/**
 * Read a file for the scan, treating every failure as "nothing to say".
 *
 * A diagnosis that throws is worse than one that stays quiet: it would replace
 * the real failure with its own.
 * @param {string} path Path named by the transcript.
 * @returns {string|null} The text, or null when it cannot be read.
 */
function readSourceFile(path) {
  try {
    const source = readFileSync(path, "utf8");
    return source.length > MAX_SCANNED_BYTES ? null : source;
  } catch {
    return null;
  }
}

/**
 * The verdict for a doc comment that ended early.
 * @param {{path: string, broken: object}[]} found Broken blocks, with files.
 * @returns {Diagnosis} A verdict naming the comment and the line it ended on.
 */
function commentTerminatedVerdict(found) {
  const first = found[0];
  return {
    kind: DIAGNOSIS.COMMENT_TERMINATED,
    summary:
      `a doc comment in ${first.path} ends early, on line ${first.broken.endsAt} — ` +
      `every error reported below that line is downstream of it, not a fault of its own`,
    evidence: capped([
      ...found.map(
        entry =>
          `${entry.path}:${entry.broken.endsAt} — the block opened on line ${entry.broken.opensAt} ends at the terminator INSIDE this line, not on line ${entry.broken.realEndsAt}`
      ),
      `line ${first.broken.endsAt} reads: ${first.broken.line}`,
      TERMINATOR_REMEDY,
    ]),
  };
}

/**
 * Look for a doc comment that ended early in the files this transcript names.
 *
 * Grounded on purpose: it only opens files the failing command itself
 * mentioned, so it can never invent a cause from a file the run never touched.
 * @param {string} output The gate command's combined output.
 * @param {(path: string) => string|null} read Reads a file, or returns null.
 * @returns {{path: string, broken: object}[]} Every broken block found.
 */
function findTerminatedComments(output, read) {
  const found = [];
  for (const { path, source } of namedSources(output, read)) {
    for (const broken of terminatedDocComments(source))
      found.push({ broken, path });
  }
  return found;
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
 * @param {(path: string) => string|null} [read] Reads a source file the
 *   transcript named, returning null when it cannot be read. Defaults to the
 *   real filesystem; injected by tests so a fixture needs no files on disk.
 * @param {TempRootReading|null} [tempRoot] The shared temp root's population,
 *   for a timeout's evidence line. OMIT to measure this machine — but the
 *   measurement is taken lazily, only on the timeout path that consumes it.
 *   Pass `null` to suppress the line, or a fixed reading to make output
 *   deterministic.
 *
 *   This is deliberately NOT a default parameter. A default is evaluated on
 *   every call that omits the argument, so `tempRoot = tempRootPopulation()`
 *   ran a `readdirSync` plus a `statSync` over the shared temp root for every
 *   assertion failure, coverage miss and kill — none of which use the reading.
 *   On a box whose temp root holds tens of thousands of entries that is not
 *   free, and the irony is total: this was added by the change about temp-root
 *   churn. Nothing in the suite could catch it, because cost is not asserted.
 *
 *   Making the default lazier does NOT work, and that is the trap: a default
 *   parameter cannot distinguish OMITTED from EXPLICITLY NULL, because both
 *   arrive as `undefined`/`null` at different points and only `undefined`
 *   triggers a default. `null` is the documented suppression that keeps test
 *   output deterministic, so it must survive. Hence the resolution moved to
 *   the single consuming call site, where the two are still distinguishable.
 * @returns {Diagnosis} What the failure was, and whose it was.
 */
export function diagnoseFailure(
  output,
  code,
  load = machineLoad(),
  read = readSourceFile,
  tempRoot
) {
  const verdict = classify(output, code, load, read, tempRoot);
  return { ...verdict, proves: ATTRIBUTION[verdict.kind] ?? null };
}
