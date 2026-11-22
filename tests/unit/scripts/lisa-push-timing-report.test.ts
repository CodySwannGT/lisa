/**
 * `lisa-push-timing-report.mjs --last <N>` summarises push timing reports
 * across runs (CodySwannGT/lisa#4591): median and max duration per gate, and
 * wall time with load per run. A missing or empty directory exits 1 with one
 * line saying why.
 * @module tests/unit/scripts/lisa-push-timing-report
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  main,
  median,
  summariseReports,
} from "../../../all/copy-overwrite/scripts/lisa-push-timing-report.mjs";
import { sink } from "./lisa-run-gates-fixtures.js";

const TESTS = "test-correctness";
const TYPES = "type-correctness";
const FLAKY = "tests/unit/flaky.test.ts";
const STEADY = "tests/unit/steady.test.ts";
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

/**
 * One report as the runner writes it, trimmed to the fields read here.
 * @param day - Day of month, used for ordering
 * @param testsMs - Duration of the test gate
 * @returns The report
 */
function report(day: number, testsMs: number) {
  return {
    startedAt: `2026-11-0${day}T10:00:00.000Z`,
    wallMs: testsMs + 10_000,
    moment: "push",
    cores: 18,
    loadavgStart: [day, 0, 0],
    loadavgEnd: [day + 1, 0, 0],
    gates: [
      { id: TESTS, state: "PASSED", durationMs: testsMs },
      { id: TYPES, state: "PASSED", durationMs: 10_000 },
    ],
  };
}

/**
 * A directory holding the given reports under runner-style names.
 * @param reports - Reports to write
 * @returns The directory
 */
function reportDir(reports: ReturnType<typeof report>[]): string {
  const root = mkdtempSync(path.join(tmpdir(), "lisa-push-timing-report-"));
  roots.push(root);
  const dir = path.join(root, "push-timing");
  mkdirSync(dir);
  for (const entry of reports) {
    const name = `${entry.startedAt.slice(0, 19).replaceAll(":", "-")}Z.json`;
    writeFileSync(path.join(dir, name), JSON.stringify(entry));
  }
  return dir;
}

describe("median", () => {
  it("takes the middle value, or the mean of the two middle values", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });
});

describe("summariseReports", () => {
  it("computes median, max, and count per gate", () => {
    const summary = summariseReports([
      report(1, 60_000),
      report(2, 180_000),
      report(3, 120_000),
    ]);
    expect(summary.gates).toContainEqual({
      id: TESTS,
      count: 3,
      medianMs: 120_000,
      maxMs: 180_000,
    });
    expect(summary.runs).toHaveLength(3);
  });

  it("counts, per test file, how many runs it failed in", () => {
    const failing = (day: number, files: string[], truncated = false) => ({
      ...report(day, 60_000),
      gates: [
        {
          id: TESTS,
          state: "FAILED",
          durationMs: 1,
          failingTestFiles: files,
          failingTestFilesTruncated: truncated,
        },
        // A sibling proved by the same run repeats the list; one run is one count.
        {
          id: "coverage-adequacy",
          state: "FAILED",
          durationMs: 0,
          failingTestFiles: files,
        },
      ],
    });
    const summary = summariseReports([
      failing(1, [FLAKY, STEADY]),
      failing(2, [FLAKY], true),
      report(3, 60_000),
      // An older report written before the field existed reads as none.
      { ...report(4, 60_000), gates: [{ id: TESTS, state: "FAILED" }] },
    ]);
    expect(summary.failingFiles).toEqual([
      { file: FLAKY, count: 2 },
      { file: STEADY, count: 1 },
    ]);
    expect(summary.truncatedRuns).toBe(1);
  });

  it("reports no failing files when every run passed", () => {
    const summary = summariseReports([report(1, 1), report(2, 1)]);
    expect(summary.failingFiles).toEqual([]);
    expect(summary.truncatedRuns).toBe(0);
  });
});

describe("main", () => {
  it("prints per-gate median/max and per-run wall time for the last N", () => {
    const dir = reportDir([
      report(1, 999_000),
      report(2, 60_000),
      report(3, 120_000),
      report(4, 180_000),
    ]);
    const { lines, out } = sink();
    const code = main(["--last", "3"], { dir, out, err: out });
    expect(code).toBe(0);
    const text = lines.join("\n");
    expect(text).toMatch(/test-correctness\s+3\s+2m0s\s+3m0s/u);
    expect(text).toMatch(/load 2→3\/18 cores/u);
    expect(text).not.toMatch(/load 1→2/u);
    expect(text).toMatch(/3m10s/u);
  });

  it("lists how often each test file failed across the selected runs", () => {
    const failed = {
      ...report(2, 60_000),
      gates: [
        {
          id: TESTS,
          state: "FAILED",
          durationMs: 60_000,
          failingTestFiles: [FLAKY],
        },
      ],
    };
    const dir = reportDir([report(1, 60_000), failed]);
    const { lines, out } = sink();
    expect(main([], { dir, out, err: out })).toBe(0);
    const text = lines.join("\n");
    expect(text).toMatch(/failing test files/iu);
    expect(text).toMatch(/1\/2 runs\s+tests\/unit\/flaky\.test\.ts/u);
  });

  it("prints no failing-files section when nothing failed", () => {
    const dir = reportDir([report(1, 60_000)]);
    const { lines, out } = sink();
    main([], { dir, out, err: out });
    expect(lines.join("\n")).not.toMatch(/failing test files/iu);
  });

  it("defaults to the last 10 reports", () => {
    const dir = reportDir([report(1, 60_000)]);
    const { lines, out } = sink();
    expect(main([], { dir, out, err: out })).toBe(0);
    expect(lines.join("\n")).toMatch(/1 run/u);
  });

  it("exits 1 with one line when the directory is missing", () => {
    const { lines, out } = sink();
    const code = main([], {
      dir: path.join(tmpdir(), "lisa-push-timing-absent-dir"),
      out,
      err: out,
    });
    expect(code).toBe(1);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/no push timing reports/iu);
  });

  it("exits 1 when the directory holds no reports", () => {
    const { lines, out } = sink();
    expect(main([], { dir: reportDir([]), out, err: out })).toBe(1);
    expect(lines).toHaveLength(1);
  });

  it("refuses a --last that is not a positive integer", () => {
    const { lines, out } = sink();
    expect(
      main(["--last", "zero"], { dir: reportDir([]), out, err: out })
    ).toBe(1);
    expect(lines[0]).toMatch(/--last/u);
  });
});
