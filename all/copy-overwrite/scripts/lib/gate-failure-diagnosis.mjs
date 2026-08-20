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

/** What a failed gate's output was recognised as. */
export const DIAGNOSIS = Object.freeze({
  /** One or more tests or hooks exceeded their wall-clock budget. */
  TIMEOUT: "timeout",
  /** Tests ran to completion and failed. */
  ASSERTION: "assertion",
  /** Every test finished and passed; a coverage floor was not met. */
  THRESHOLD: "threshold",
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
 * `undiagnosed` and `uncaptured` are deliberately absent. Nothing was
 * recognised, so nothing may be attributed; the failure stays where it landed.
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
 * Classify why a gate command failed, from the output it produced.
 *
 * Ordered deliberately, and the order is the content of this function: a
 * timeout outranks an assertion failure outranks a threshold miss, because
 * coverage read off a run that did not finish measures the interruption rather
 * than the code. Getting that backwards is the defect being fixed — it is what
 * printed "coverage-adequacy failed" six times for a machine under load.
 * @param {string|null|undefined} output The command's combined output, or null
 *   when the runner could not capture it.
 * @returns {object} What the failure was, before it is attributed.
 */
function classify(output) {
  if (typeof output !== "string" || output.length === 0) {
    return {
      kind: DIAGNOSIS.UNCAPTURED,
      summary:
        "no output was captured, so this failure has no diagnosis " +
        "(set LISA_GATES_CAPTURE=1 and re-run to get one)",
      evidence: [],
    };
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
 * @returns {Diagnosis} What the failure was, and whose it was.
 */
export function diagnoseFailure(output) {
  const verdict = classify(output);
  return { ...verdict, proves: ATTRIBUTION[verdict.kind] ?? null };
}
