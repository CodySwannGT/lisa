/**
 * Unit tests for scripts/lib/test-timings-reporter.mjs (CodySwannGT/lisa#4592):
 * which runs write a per-file timings file, where, and that appending the
 * reporter keeps every reporter the run already resolved.
 */
import * as path from "node:path";

import { describe, expect, it } from "vitest";

import {
  testTimingsReporter,
  testTimingsScope,
  withTestTimingsReporter,
} from "../../../scripts/lib/test-timings-reporter.mjs";

const ROOT = path.join(path.sep, "repo");
const UNIT_FILE = path.join(ROOT, "tmp", "test-timings", "unit.json");

describe("testTimingsScope", () => {
  it("is unit on CI for the unit coverage scope", () => {
    expect(testTimingsScope({ CI: "true", LISA_COVERAGE_SCOPE: "unit" })).toBe(
      "unit"
    );
  });

  it("is integration on CI when the integration scope is declared", () => {
    expect(
      testTimingsScope({ CI: "1", LISA_TEST_TIMINGS_SCOPE: "integration" })
    ).toBe("integration");
  });

  it.each([
    ["no CI", { LISA_COVERAGE_SCOPE: "unit" }],
    ["CI=false", { CI: "false", LISA_COVERAGE_SCOPE: "unit" }],
    ["CI=0", { CI: "0", LISA_COVERAGE_SCOPE: "unit" }],
    ["empty CI", { CI: "", LISA_COVERAGE_SCOPE: "unit" }],
    ["no scope", { CI: "true" }],
    ["an unknown scope", { CI: "true", LISA_TEST_TIMINGS_SCOPE: "e2e" }],
    [
      "a nested run spawned by a test",
      { CI: "true", LISA_COVERAGE_SCOPE: "unit", VITEST_WORKER_ID: "3" },
    ],
  ])("records nothing with %s", (_label, env) => {
    expect(testTimingsScope(env)).toBeUndefined();
  });
});

describe("testTimingsReporter", () => {
  it("writes <root>/tmp/test-timings/<scope>.json", () => {
    expect(
      testTimingsReporter({ CI: "true", LISA_COVERAGE_SCOPE: "unit" }, ROOT)
    ).toEqual(["json", { outputFile: UNIT_FILE }]);
  });

  it("is absent off CI, so local runs are unchanged", () => {
    expect(
      testTimingsReporter({ LISA_COVERAGE_SCOPE: "unit" }, ROOT)
    ).toBeUndefined();
  });
});

describe("withTestTimingsReporter", () => {
  const ci = { CI: "true", LISA_COVERAGE_SCOPE: "unit" };

  it("appends beside the resolved reporters, including a shard's blob", () => {
    const resolved = [["blob", { outputFile: "/x/blob-1-2.json" }]];
    expect(withTestTimingsReporter(resolved, ci, ROOT)).toEqual([
      ["blob", { outputFile: "/x/blob-1-2.json" }],
      ["json", { outputFile: UNIT_FILE }],
    ]);
  });

  it("keeps the default and github-actions reporters", () => {
    const resolved = [
      ["default", {}],
      ["github-actions", {}],
    ];
    expect(withTestTimingsReporter(resolved, ci, ROOT)).toEqual([
      ...resolved,
      ["json", { outputFile: UNIT_FILE }],
    ]);
  });

  it("appends once across every project's hook", () => {
    const once = withTestTimingsReporter([["default", {}]], ci, ROOT);
    expect(withTestTimingsReporter(once, ci, ROOT)).toEqual(once);
  });

  it("returns the reporters untouched off CI", () => {
    const resolved = [["default", {}]];
    expect(withTestTimingsReporter(resolved, {}, ROOT)).toBe(resolved);
  });
});
