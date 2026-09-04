/**
 * The execution prover, tested for BITE rather than for happy path.
 *
 * `scripts/check-test-case-executed.mjs` exists because a green suite is
 * compatible with a case having been skipped (CodySwannGT/lisa#3935). A test
 * suite that only proved it accepts a passing case would repeat the original
 * mistake one level up: it would show the prover RAN, not that it BITES. So
 * every way a case can fail to execute gets its own case here, and the report
 * shapes are the ones vitest 4.1.9 actually emits — a skipped case carries
 * `status: "skipped"` and NO `duration`, measured against a real
 * `it.runIf(false)` probe rather than assumed.
 * @module tests/unit/scripts/check-test-case-executed
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  checkTestCasesExecuted,
  executionFailure,
  parseArguments,
  reportedCases,
} from "../../../scripts/check-test-case-executed.mjs";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0))
    rmSync(directory, { force: true, recursive: true });
});

/**
 * Write a vitest-shaped JSON report to a throwaway file.
 * @param assertionResults - Case records exactly as vitest emits them
 * @returns Path to the written report
 */
const reportFile = (assertionResults: readonly unknown[]): string => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "exec-prover-"));
  temporaryDirectories.push(directory);
  const file = path.join(directory, "report.json");
  writeFileSync(
    file,
    JSON.stringify({ testResults: [{ assertionResults }] }),
    "utf8"
  );
  return file;
};

const PASSED = {
  fullName: "suite runs the thing",
  status: "passed",
  duration: 12.5,
};
/** Exactly what vitest emits for `it.runIf(false)`: no duration key at all. */
const SKIPPED = { fullName: "suite is guarded off", status: "skipped" };

describe("parseArguments", () => {
  it("reads a report path and one or more case names", () => {
    expect(
      parseArguments(["--report", "r.json", "--name", "a", "--name", "b"])
    ).toEqual({ report: "r.json", names: ["a", "b"] });
  });

  it("refuses an invocation with no report", () => {
    expect(() => parseArguments(["--name", "a"])).toThrow("--report");
  });

  it("refuses an invocation naming no case", () => {
    // A prover asked to prove nothing exits 0 and proves nothing — the exact
    // shape of vacuous coverage this whole change is about.
    expect(() => parseArguments(["--report", "r.json"])).toThrow("--name");
  });

  it("refuses a flag whose value was swallowed by the next flag", () => {
    expect(() => parseArguments(["--report", "--name", "a"])).toThrow(
      "--report requires a value"
    );
  });

  it("refuses an unknown argument rather than ignoring it", () => {
    expect(() => parseArguments(["--repot", "r.json"])).toThrow("Unknown");
  });
});

describe("reportedCases", () => {
  it("keys every reported case by its full name", () => {
    expect([...reportedCases(reportFile([PASSED, SKIPPED])).keys()]).toEqual([
      "suite runs the thing",
      "suite is guarded off",
    ]);
  });

  it("treats an unreadable report as proof the case did not run", () => {
    // A run that produced no report ran nothing worth reading. Reporting that
    // as "no failures found" would be the fail-open this gate refuses.
    expect(() => reportedCases("/nonexistent/report.json")).toThrow(
      "Cannot read the vitest JSON report"
    );
  });
});

describe("executionFailure", () => {
  it("passes a case that ran and took measurable time", () => {
    expect(executionFailure(PASSED.fullName, PASSED)).toBeUndefined();
  });

  it("fails a SKIPPED case, naming the guard as the cause", () => {
    // The #3935 defect itself. A platform guard removed the case and every
    // surface stayed green.
    const failure = executionFailure(SKIPPED.fullName, SKIPPED);
    expect(failure).toContain("SKIPPED");
    expect(failure).toContain("proves nothing");
  });

  it("fails a TODO case", () => {
    expect(executionFailure("t", { status: "todo", duration: 1 })).toContain(
      "TODO"
    );
  });

  it("fails a case that failed", () => {
    expect(executionFailure("t", { status: "failed", duration: 1 })).toContain(
      "RAN and FAILED"
    );
  });

  it("fails a case ABSENT from the report, distinctly from a skip", () => {
    // Different cause, different fix: an exclusion or a moved file, not a
    // platform guard. Collapsing the two would send the next reader to the
    // wrong layer.
    const failure = executionFailure("t", undefined);
    expect(failure).toContain("ABSENT");
    expect(failure).not.toContain("SKIPPED");
  });

  it("names what the report DID contain, rather than diagnosing confidently", () => {
    // The other way a name goes absent is a caller who wrote it wrong: the JSON
    // reporter joins suite title to case title with a SPACE, while `vitest
    // list` prints " > " — measured, both forms, on the same suite. Asserting
    // "the case was never collected" would send the reader to the exclusion
    // list for a typo. So the failure hands over the names it saw and says
    // which separator is which.
    const failure = executionFailure("suite > runs the thing", undefined, [
      PASSED.fullName,
    ]);
    expect(failure).toContain(`"${PASSED.fullName}"`);
    expect(failure).toContain("SPACE");
  });

  it("says so plainly when the report contained nothing at all", () => {
    expect(executionFailure("t", undefined, [])).toContain("no cases at all");
  });

  it("fails a case reported as passed with no duration", () => {
    expect(executionFailure("t", { status: "passed" })).toContain(
      "no measurable time"
    );
  });

  it("fails a case reported as passed in zero time", () => {
    expect(executionFailure("t", { status: "passed", duration: 0 })).toContain(
      "no measurable time"
    );
  });
});

describe("checkTestCasesExecuted", () => {
  it("reports no failures when every named case executed", () => {
    expect(
      checkTestCasesExecuted([
        "--report",
        reportFile([PASSED]),
        "--name",
        PASSED.fullName,
      ])
    ).toEqual([]);
  });

  it("reports the skipped case even when the report is otherwise green", () => {
    // The report below has a passing case in it and `success` would be true.
    // Suite-level greenness is exactly the signal that failed us.
    const failures = checkTestCasesExecuted([
      "--report",
      reportFile([PASSED, SKIPPED]),
      "--name",
      SKIPPED.fullName,
    ]);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("SKIPPED");
  });

  it("reports every named case that did not execute, not just the first", () => {
    expect(
      checkTestCasesExecuted([
        "--report",
        reportFile([PASSED, SKIPPED]),
        "--name",
        SKIPPED.fullName,
        "--name",
        "suite never written",
      ])
    ).toHaveLength(2);
  });
});
