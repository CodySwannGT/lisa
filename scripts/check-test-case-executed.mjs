#!/usr/bin/env node
/**
 * Proves that a NAMED test case actually EXECUTED, from a vitest JSON report.
 *
 * ## Why this exists
 *
 * An assertion about a configuration is not an assertion about execution, and
 * CodySwannGT/lisa#3935 is what that gap costs. A 100,000-entry temp-scan
 * benchmark was moved off the pre-push gate on the stated grounds that CI still
 * ran it. It did not: the case is `it.runIf(process.platform === "darwin")` and
 * every CI runner is `ubuntu-latest`, so CI skipped it, and had always skipped
 * it. The check written to guard the move asserted that the pull-request task
 * did not EXCLUDE the file — true, and hollow, because a platform guard one
 * layer down skipped the case anyway. Not excluding a file is not running it.
 *
 * A skipped case is a green case. Nothing in the pipeline reports it, because
 * from the runner's point of view nothing went wrong. That is the whole failure
 * mode: the surface reads as covered while running nothing.
 *
 * So this script asserts the only thing that settles the question — that the
 * case appears in the report, that it PASSED rather than being skipped or
 * todo-ed, and that it consumed real wall-clock time. A lane that runs it is
 * then a lane that can PROVE it ran it, and a platform guard that silently
 * removes the case turns a green job red with the reason on screen.
 *
 * ## Vitest's report vocabulary, as observed
 *
 * Measured on vitest 4.1.9 against a deliberate `it.runIf(false)` probe: a
 * guarded-off case is present in `testResults[].assertionResults[]` with
 * `status: "skipped"` and NO `duration` field, and is counted in
 * `numPendingTests`. A case whose whole FILE was never collected — an
 * `--exclude` glob, a moved file, a typo in the path — is absent from the
 * report entirely. Both are execution failures and both are reported here,
 * separately, because they have different fixes: one is a platform or flag
 * guard, the other is a path or exclusion.
 *
 * `fullName` joins `ancestorTitles` to the title with a SPACE. `vitest list`
 * prints the same case with ` > ` between them, and the two are easy to
 * confuse — measured, both forms, on the same suite. A caller that passes the
 * wrong form gets a case that is absent for a reason having nothing to do with
 * execution, so an ABSENT failure PRINTS the names the report did contain
 * rather than asserting the case was never collected. A gate whose diagnosis is
 * confidently wrong costs more than one that says less.
 *
 * ## Usage
 *
 *   node scripts/check-test-case-executed.mjs \
 *     --report <vitest --reporter=json --outputFile target> \
 *     --name "<full test name>" [--name "<another>"]
 *
 * Exit 0 only when EVERY named case is present, passed, and timed. Any other
 * outcome exits 1 and names which case and which way it failed.
 * @module scripts/check-test-case-executed
 */
import { readFileSync } from "node:fs";

import { invokedAsScript } from "./lib/invoked-as-script.mjs";

/**
 * Statuses vitest reports for a case that did not actually run.
 *
 * A Map rather than an object literal because the key is a status string read
 * out of a JSON file. On an object, a report carrying `"constructor"` or
 * `"toString"` resolves to something inherited from `Object.prototype` and the
 * message below stringifies it as though it were advice — an absurd input, but
 * this gate's whole job is to be right about a file it did not write.
 */
const NON_EXECUTED_STATUS_ADVICE = new Map([
  [
    "skipped",
    "the case was SKIPPED — a platform guard, a `runIf` condition, or an `it.skip` removed it; a skipped case is a green case and proves nothing",
  ],
  ["todo", "the case is marked TODO — it has no body to execute"],
  [
    "failed",
    "the case RAN and FAILED — read the failure above; this gate only reports that it was not a passing execution",
  ],
]);

/**
 * Parse `--report <path>` and one or more `--name <full test name>` flags.
 * @param {readonly string[]} argv - Arguments after the script path
 * @returns {{report: string, names: readonly string[]}} Validated invocation
 */
export function parseArguments(argv) {
  const names = [];
  let report;
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag !== "--report" && flag !== "--name")
      throw new Error(`Unknown argument: ${String(flag)}`);
    if (value === undefined || value.startsWith("--"))
      throw new Error(`${flag} requires a value`);
    if (flag === "--report") report = value;
    else names.push(value);
    index += 1;
  }
  if (report === undefined) throw new Error("--report is required");
  if (names.length === 0) throw new Error("At least one --name is required");
  return { report, names };
}

/**
 * Read every case the report contains, keyed by its full name.
 * @param {string} reportPath - Path to a vitest JSON report
 * @returns {Map<string, {status: string, duration?: number}>} Reported cases
 */
export function reportedCases(reportPath) {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(reportPath, "utf8"));
  } catch (cause) {
    throw new Error(
      `Cannot read the vitest JSON report at ${reportPath}. A missing report means the run never produced one, which is itself proof the case did not execute. Cause: ${cause instanceof Error ? cause.message : String(cause)}`
    );
  }
  const files = Array.isArray(parsed?.testResults) ? parsed.testResults : [];
  return new Map(
    files.flatMap(file =>
      (Array.isArray(file?.assertionResults) ? file.assertionResults : []).map(
        assertion => [
          String(assertion?.fullName),
          {
            status: String(assertion?.status),
            ...(typeof assertion?.duration === "number"
              ? { duration: assertion.duration }
              : {}),
          },
        ]
      )
    )
  );
}

/**
 * Explain why one named case does not count as executed, if it does not.
 * @param {string} name - Full test name the lane claims to run
 * @param {{status: string, duration?: number} | undefined} reported - Its report entry
 * @param {readonly string[]} [available] - Every name the report did contain
 * @returns {string | undefined} Operator-readable failure, or undefined when it ran
 */
export function executionFailure(name, reported, available = []) {
  if (reported === undefined)
    return `"${name}" is ABSENT from the report — nothing in this lane ran it. Either its file was excluded, moved or renamed, or this name is written wrong: vitest's JSON reporter joins suite titles to the case title with a SPACE, while \`vitest list\` prints them with " > ". The report contained ${available.length === 0 ? "no cases at all" : available.map(reportedName => `"${reportedName}"`).join(", ")}.`;
  if (reported.status !== "passed")
    return `"${name}" did not execute: ${NON_EXECUTED_STATUS_ADVICE.get(reported.status) ?? `the runner reported status "${reported.status}"`}.`;
  if (typeof reported.duration !== "number" || reported.duration <= 0)
    return `"${name}" is reported as passed but consumed no measurable time, so there is no evidence it did any work.`;
  return undefined;
}

/**
 * Prove every named case executed, printing the measured time for each.
 * @param {readonly string[]} argv - Arguments after the script path
 * @returns {readonly string[]} Failures, empty when every case executed
 */
export function checkTestCasesExecuted(argv) {
  const { names, report } = parseArguments(argv);
  const cases = reportedCases(report);
  const available = [...cases.keys()];
  return names.flatMap(name => {
    const failure = executionFailure(name, cases.get(name), available);
    if (failure !== undefined) return [failure];
    process.stdout.write(
      `EXECUTED  ${name} — ${(cases.get(name)?.duration ?? 0).toFixed(1)}ms\n`
    );
    return [];
  });
}

if (invokedAsScript(import.meta.url)) {
  try {
    const failures = checkTestCasesExecuted(process.argv.slice(2));
    for (const failure of failures)
      process.stderr.write(`NOT EXECUTED  ${failure}\n`);
    process.exit(failures.length === 0 ? 0 : 1);
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`
    );
    process.exit(1);
  }
}
