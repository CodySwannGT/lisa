/**
 * The Jest shard merge writes the reports Jest itself would (CodySwannGT/lisa#4488).
 *
 * Jest builds its report context with istanbul's default summarizer, `pkg`,
 * and hands each `coverageReporters` entry its own options. The merge used to
 * force `nested`, under which `clover` crashes on a tree with three or more
 * directories that hold only directories: its `onSummary` opens no package for
 * such a node, but `onSummaryEnd` closes one anyway, until the tag stack is
 * empty ("Attempt to close tag undefined when not opened"). So each case here
 * compares the merged reports with a whole, unsharded Jest run of the same
 * project, which is the run a consumer had before sharding.
 */
import * as fs from "node:fs";
import * as path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { mergeJestShards } from "../../src/cli/lisa-test-run-jest-merge.js";
import { readShardReceipts } from "../../src/cli/lisa-test-run-shard.js";
import { useIoLatencyBudget } from "../helpers/io-latency-budget.js";
import {
  coverageFile,
  jestArgv,
  project,
  run,
  shardTwice,
  type CoverageReporter,
  type ProjectOptions,
} from "./lisa-test-run-jest-shards-fixture.js";

// Same fixture weight as lisa-test-run-jest-shards.test.ts, whose budget was
// measured: each case runs Jest three times at about 4s each.
useIoLatencyBudget(25_000);

/**
 * The smallest layout found on which `nested` breaks clover: under the
 * common root `src`, the directories `a`, `a/b` and `a/b/c` each hold two
 * directories and no file, so none is folded away and each one unbalances the
 * tag stack. Two such directories still pass, so this is the floor.
 */
const CLOVER_BREAKER = [
  "index.js",
  "a/x/f.js",
  "a/b/x/f.js",
  "a/b/c/x/f.js",
  "a/b/c/y/f.js",
];

/** The text table, written to a file so the two runs can be compared. */
const TEXT_FILE = "coverage.txt";
const TEXT: CoverageReporter = ["text", { file: TEXT_FILE, maxCols: 120 }];

const directories: string[] = [];

afterEach(() => {
  vi.unstubAllEnvs();
  for (const directory of directories.splice(0))
    fs.rmSync(directory, { recursive: true, force: true });
});

/**
 * A source path long enough that the text table only fits it uncut when the
 * reporter is given Jest's `maxCols`, not istanbul's 80-column fallback.
 */
const LONG_NAME = `${"a-deliberately-long-directory-name/".repeat(3)}f.js`;

/**
 * Run one project whole and the same project as two merged shards.
 * @param reporters - The projects' `coverageReporters`
 * @param overrides - Anything else the projects differ from the default in
 * @returns Both roots, and the merge's exit code
 */
function wholeAndMerged(
  reporters: readonly CoverageReporter[],
  overrides: ProjectOptions = {}
) {
  const options = {
    sources: CLOVER_BREAKER,
    tested: CLOVER_BREAKER.slice(0, 4),
    reporters,
    ...overrides,
  };
  const register = (directory: string) => directories.push(directory);
  const whole = project(register, options);
  const wholeStatus = run(whole, jestArgv(whole));
  const merged = project(register, options);
  const receipts = readShardReceipts(shardTwice(merged), 2);
  const status = mergeJestShards(jestArgv(merged), receipts, merged);
  expect(wholeStatus).toBe(0);
  return { whole, merged, status };
}

/**
 * One report with its fixture root replaced, so two fixtures compare equal.
 * @param root - Fixture root
 * @param name - File name inside `coverage/`
 * @returns The report, root-independent
 */
function portable(root: string, name: string): string {
  return coverageFile(root, name).replaceAll(root, "<root>");
}

/**
 * A clover report with its generation timestamps removed.
 * @param root - Fixture root
 * @returns The report, comparable across runs
 */
function clover(root: string): string {
  return portable(root, "clover.xml").replace(
    /(generated|timestamp)="\d+"/gu,
    '$1=""'
  );
}

/**
 * A json report's coverage, without the per-instrumentation metadata.
 * @param root - Fixture root
 * @returns Coverage data per file; `hash` and `_coverageSchema` identify one
 * instrumentation pass, so two runs of the same code legitimately differ there
 */
function jsonCoverage(root: string): Record<string, unknown> {
  const files = JSON.parse(portable(root, "coverage-final.json")) as Record<
    string,
    Record<string, unknown>
  >;
  return Object.fromEntries(
    Object.entries(files).map(
      ([file, { hash: _hash, _coverageSchema: _schema, ...data }]) => [
        file,
        data,
      ]
    )
  );
}

/**
 * An lcov report's per-file records, in report order.
 * @param root - Fixture root
 * @param base - Directory the report's `SF:` paths are relative to: istanbul
 * resolves them against `process.cwd()`, which is the fixture for the Jest
 * child and this suite's own directory for the in-process merge
 * @returns Each record with its source path made root-independent
 */
function lcovRecords(root: string, base: string): string[] {
  return coverageFile(root, "lcov.info")
    .split("end_of_record\n")
    .filter(record => record !== "")
    .map(record =>
      record
        .replace(
          /^SF:(.*)$/mu,
          (_line, file: string) => `SF:${path.resolve(base, file)}`
        )
        .replaceAll(root, "<root>")
    );
}

/**
 * Order two strings under one fixed locale, so a sort is the same everywhere.
 * @param left - First string
 * @param right - Second string
 * @returns Their order
 */
function byText(left: string, right: string): number {
  return left.localeCompare(right, "en");
}

/**
 * The html index's coverage classes, which the watermarks decide.
 * @param root - Fixture root
 * @returns Every `high` / `medium` / `low` class, in page order
 */
function watermarkClasses(root: string): string[] {
  return [
    ...coverageFile(root, "index.html").matchAll(
      /class="[^"]*\b(high|medium|low)\b/gu
    ),
  ].map(([, band]) => band ?? "");
}

describe("Jest shard merge reports", () => {
  it("writes a complete clover report on a tree nested deep enough to break it", () => {
    const { whole, merged, status } = wholeAndMerged([
      "json",
      "lcov",
      "clover",
    ]);

    expect(status).toBe(0);
    expect(clover(merged)).toBe(clover(whole));
    expect(clover(merged).trimEnd().endsWith("</coverage>")).toBe(true);
  });

  it("leaves every file's coverage identical to the whole run", () => {
    // Control: per-file coverage does not depend on the summarizer, so it
    // matched before the fix as well. It pins that the fix changed only how
    // the files are grouped and ordered.
    const { whole, merged, status } = wholeAndMerged(["json", "lcov"]);

    expect(status).toBe(0);
    expect(jsonCoverage(merged)).toEqual(jsonCoverage(whole));
    expect([...lcovRecords(merged, process.cwd())].sort(byText)).toEqual(
      [...lcovRecords(whole, whole)].sort(byText)
    );
  });

  it("summarises like Jest, by package, when the project names no summarizer", () => {
    const { whole, merged, status } = wholeAndMerged([TEXT, "lcov"]);

    expect(status).toBe(0);
    // lcov writes its records in summarizer-tree order.
    expect(lcovRecords(merged, process.cwd())).toEqual(
      lcovRecords(whole, whole)
    );
    expect(coverageFile(merged, TEXT_FILE)).toBe(
      coverageFile(whole, TEXT_FILE)
    );
    expect(coverageFile(merged, TEXT_FILE)).toContain(" src/a/b/c/x ");
  });

  it("honours a summarizer and column limit the project's reporter options name", () => {
    // LONG_NAME is wider than 120 columns leave for the name, so the table
    // only matches when the reporter's own maxCols beats Jest's default.
    const flat: CoverageReporter = [
      "text",
      { file: TEXT_FILE, maxCols: 120, summarizer: "flat" },
    ];
    const { whole, merged, status } = wholeAndMerged([flat], {
      sources: [...CLOVER_BREAKER, LONG_NAME],
      tested: [...CLOVER_BREAKER.slice(0, 4), LONG_NAME],
    });

    expect(status).toBe(0);
    expect(coverageFile(merged, TEXT_FILE)).toBe(
      coverageFile(whole, TEXT_FILE)
    );
    expect(coverageFile(merged, TEXT_FILE)).toContain(" a/b/c/x/f.js ");
  });
  it("sets the watermarks from a floor of 0, as Jest does", () => {
    // Jest raises a bound whenever the floor is defined, so 0 gives [50, 0].
    // istanbul checks the low bound first, so files under 50% stay "low" and
    // only the "medium" band disappears: the 66.67% files read "high" here
    // but "medium" under istanbul's [50, 80].
    const { whole, merged, status } = wholeAndMerged(["html"]);

    expect(status).toBe(0);
    expect(watermarkClasses(merged)).toEqual(watermarkClasses(whole));
  });

  it.each([
    // Jest 30.5 gives the table a numeric COLUMNS first, else 80 when CI or
    // GITHUB_ACTIONS is exactly "true", else no limit. Every arm runs on every
    // machine, so a merge that matches Jest in only one environment fails here
    // rather than first in CI. One arm per branch: 100 columns differs from
    // both 80 and none, GitHub Actions alone is still CI, and CI=1 is not.
    // The terminal-width branch needs a real TTY on both sides, which a piped
    // fixture cannot give it, and the merge never runs inside a Jest worker.
    ["on CI", { CI: "true", GITHUB_ACTIONS: "true", COLUMNS: "" }],
    ["off CI", { CI: "", GITHUB_ACTIONS: "", COLUMNS: "" }],
    [
      "with COLUMNS=100 on CI",
      { CI: "true", GITHUB_ACTIONS: "true", COLUMNS: "100" },
    ],
    [
      "on GitHub Actions alone",
      { CI: undefined, GITHUB_ACTIONS: "true", COLUMNS: "" },
    ],
    ["with CI=1", { CI: "1", GITHUB_ACTIONS: "", COLUMNS: "" }],
  ] as const)(
    "hands the reporters Jest's watermarks and column limit %s",
    (_where, environment) => {
      // A floor of 50 turns the 66.67% files "high" instead of "medium", and the
      // long path shows whether the table was cut, and where.
      for (const [name, value] of Object.entries(environment))
        vi.stubEnv(name, value);
      const { whole, merged, status } = wholeAndMerged(
        ["html", ["text", { file: TEXT_FILE }]],
        {
          floor: 50,
          sources: [...CLOVER_BREAKER, LONG_NAME],
          tested: [...CLOVER_BREAKER.slice(0, 4), LONG_NAME],
        }
      );

      expect(status).toBe(0);
      expect(watermarkClasses(merged)).toEqual(watermarkClasses(whole));
      expect(watermarkClasses(merged)).toContain("high");
      expect(coverageFile(merged, TEXT_FILE)).toBe(
        coverageFile(whole, TEXT_FILE)
      );
    }
  );
});
