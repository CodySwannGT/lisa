import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { boundedSpawnSync } from "../../helpers/io-latency-budget.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../..");
const CHECKER = path.join(
  REPO_ROOT,
  "expo/copy-overwrite/scripts/check-lighthouse-details.mjs"
);
const EXAMPLE_URL = "http://localhost/example.html";

/**
 * Create a host-shaped fixture with Lighthouse result files.
 * @param reports - LHR payloads to write
 * @param maximum - Optional forced-reflow ceiling
 * @returns Temporary project root
 */
function projectWithReports(
  reports: readonly Record<string, unknown>[],
  maximum?: number
): string {
  const project = mkdtempSync(path.join(tmpdir(), "lisa-lighthouse-details-"));
  const reportDirectory = path.join(project, ".lighthouseci");
  mkdirSync(reportDirectory);
  reports.forEach((report, index) => {
    writeFileSync(
      path.join(reportDirectory, `lhr-${index}.json`),
      JSON.stringify(report)
    );
  });
  if (maximum !== undefined) {
    writeFileSync(
      path.join(project, "lighthouserc-config.json"),
      JSON.stringify({
        assertions: {
          forcedReflowInsight: { maxNumericValue: maximum },
        },
      })
    );
  }
  return project;
}

/**
 * Build one minimal forced-reflow Lighthouse result.
 * @param score - Lighthouse audit score
 * @param reflowTimes - Detail-table measurements
 * @returns LHR-shaped object
 */
function report(score: number, reflowTimes: readonly number[] = []) {
  return {
    finalUrl: EXAMPLE_URL,
    audits: {
      "forced-reflow-insight": {
        score,
        details: {
          type: "list",
          items: [
            {
              type: "table",
              items: reflowTimes.map(reflowTime => ({ reflowTime })),
            },
          ],
        },
      },
    },
  };
}

/**
 * Build a result with both Lighthouse forced-reflow detail tables.
 * @param reflowTime - Measurement repeated by both views
 * @returns LHR-shaped object
 */
function reportWithDuplicateTables(reflowTime: number) {
  const table = {
    type: "table",
    headings: [{ key: "reflowTime" }],
    items: [{ reflowTime }],
  };
  return {
    finalUrl: EXAMPLE_URL,
    audits: {
      "forced-reflow-insight": {
        score: 0,
        details: { type: "list", items: [table, table] },
      },
    },
  };
}

/**
 * Run the shipped checker inside one fixture project.
 * @param project - Fixture project root
 * @returns Bounded child-process result
 */
function run(project: string) {
  return boundedSpawnSync({
    label: "check-lighthouse-details.mjs",
    command: process.execPath,
    args: [CHECKER],
    cwd: project,
  });
}

describe("Lighthouse detail budget", () => {
  it("passes measured reflows at or below the configured millisecond ceiling", () => {
    const result = run(
      projectWithReports([report(0, [25, 50]), report(1)], 75)
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("forced reflow <= 75 ms (max 75.0 ms)");
  });

  it("does not double-count the top-function and bottom-up detail tables", () => {
    const result = run(
      projectWithReports([reportWithDuplicateTables(75)], 100)
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("forced reflow <= 100 ms (max 75.0 ms)");
  });

  it("fails when one run exceeds the configured ceiling", () => {
    const result = run(projectWithReports([report(0, [60, 41])], 100));

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("101.0 ms exceeds 100 ms");
  });

  it("fails closed when an aggregate contains a negative measurement", () => {
    const result = run(projectWithReports([report(1, [60, -50])], 100));

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("has no non-negative finite reflowTime");
  });

  it("fails closed when a failed audit has no measurable detail", () => {
    const result = run(projectWithReports([report(0)]));

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "failed without measurable reflowTime evidence"
    );
  });

  it("fails closed when a passing audit omits detail evidence", () => {
    const missingDetails = report(1);
    delete missingDetails.audits["forced-reflow-insight"].details;

    const result = run(projectWithReports([missingDetails]));

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "forced-reflow details are missing or malformed"
    );
  });

  it("fails closed when detail evidence has no aggregate table", () => {
    const noAggregate = report(1);
    noAggregate.audits["forced-reflow-insight"].details.items = [];

    const result = run(projectWithReports([noAggregate]));

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "forced-reflow details contain no aggregate table"
    );
  });

  it("fails closed when the forced-reflow audit is missing", () => {
    const result = run(
      projectWithReports([{ finalUrl: EXAMPLE_URL, audits: {} }])
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("missing forced-reflow-insight audit");
  });

  it("fails closed when Lighthouse produced no reports", () => {
    const project = mkdtempSync(path.join(tmpdir(), "lisa-lighthouse-empty-"));
    mkdirSync(path.join(project, ".lighthouseci"));

    const result = run(project);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("contains no Lighthouse result JSON");
  });

  it("ships the score override and the detail checker in one forced script", () => {
    const packageTemplate = JSON.parse(
      readFileSync(
        path.join(REPO_ROOT, "expo/package-lisa/package.lisa.json"),
        "utf8"
      )
    );
    const command = packageTemplate.force.scripts["lighthouse:check"];
    const lighthouseConfig = readFileSync(
      path.join(REPO_ROOT, "expo/create-only/lighthouserc.js"),
      "utf8"
    );

    expect(command).toContain("--assert.assertions.forced-reflow-insight=off");
    expect(command).toContain("node scripts/check-lighthouse-details.mjs");
    expect(lighthouseConfig).toContain('"forced-reflow-insight": "off"');
  });
});
