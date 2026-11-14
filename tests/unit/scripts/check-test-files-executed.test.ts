/**
 * Unit tests for scripts/check-test-files-executed.mjs (CodySwannGT/lisa#4896).
 *
 * The nightly slow-test lane runs files every other run excludes. An excluded
 * or renamed file is absent from Vitest's report rather than failed, so the
 * lane's green means nothing until each named file is shown to have run and
 * passed. These cases pin each way a file can fail to count.
 * @module tests/unit/scripts/check-test-files-executed
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  checkTestFilesExecuted,
  parseArguments,
  unexecutedFiles,
} from "../../../scripts/check-test-files-executed.mjs";
import { NIGHTLY_SLOW_SUITES } from "../../../scripts/lib/nightly-slow-suites.mjs";

const ROOT = "/home/runner/work/lisa/lisa";
const FILE = "tests/integration/a.test.ts";
const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0))
    fs.rmSync(directory, { recursive: true, force: true });
});

/**
 * A vitest JSON report holding one file.
 * @param status - The file's status
 * @param cases - Its cases' statuses
 * @returns Parsed report
 */
const report = (status: string, cases: readonly string[]) => ({
  testResults: [
    {
      name: `${ROOT}/${FILE}`,
      status,
      assertionResults: cases.map(entry => ({ status: entry })),
    },
  ],
});

describe("unexecutedFiles", () => {
  it("accepts a file that passed with a passing case", () => {
    expect(unexecutedFiles(report("passed", ["passed"]), [FILE], ROOT)).toEqual(
      []
    );
  });

  it("names a file absent from the report", () => {
    const [failure] = unexecutedFiles(
      report("passed", ["passed"]),
      ["tests/integration/missing.test.ts"],
      ROOT
    );
    expect(failure).toContain("tests/integration/missing.test.ts is ABSENT");
  });

  it("names a file that failed", () => {
    const [failure] = unexecutedFiles(
      report("failed", ["failed"]),
      [FILE],
      ROOT
    );
    expect(failure).toContain(`${FILE} did not pass`);
  });

  it("names a file whose every case was skipped", () => {
    const [failure] = unexecutedFiles(
      report("passed", ["skipped", "skipped"]),
      [FILE],
      ROOT
    );
    expect(failure).toContain("no passing case");
  });

  it("treats a report with no results as every file absent", () => {
    expect(unexecutedFiles({}, [FILE], ROOT)).toHaveLength(1);
  });
});

describe("parseArguments", () => {
  it("requires a report and a file list", () => {
    expect(() => parseArguments(["--file", FILE])).toThrow("--report");
    expect(() => parseArguments(["--report", "r.json"])).toThrow("--file");
    expect(() => parseArguments(["--bogus", "x"])).toThrow("Unknown");
    expect(() => parseArguments(["--report"])).toThrow("requires a value");
  });
});

describe("checkTestFilesExecuted", () => {
  it("reads the file list from a module export, as the nightly lane does", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "lisa-files-ran-"));
    directories.push(directory);
    const reportPath = path.join(directory, "report.json");
    const repoRoot = path.resolve(import.meta.dirname, "../../..");
    fs.writeFileSync(
      reportPath,
      JSON.stringify({
        testResults: NIGHTLY_SLOW_SUITES.slice(1).map(file => ({
          name: path.join(repoRoot, file),
          status: "passed",
          assertionResults: [{ status: "passed" }],
        })),
      })
    );

    const failures = await checkTestFilesExecuted([
      "--report",
      reportPath,
      "--root",
      repoRoot,
      "--list",
      "scripts/lib/nightly-slow-suites.mjs#NIGHTLY_SLOW_SUITES",
    ]);

    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain(`${NIGHTLY_SLOW_SUITES[0]} is ABSENT`);
  });
});
