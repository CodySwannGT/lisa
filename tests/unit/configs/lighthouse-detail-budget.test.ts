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
const REPORT_DIRECTORY = ".lighthouseci";
const EXAMPLE_URL = "http://localhost/example.html";
const OTHER_URL = "http://localhost/privacy-policy.html";

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
  const reportDirectory = path.join(project, REPORT_DIRECTORY);
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
 * @param url - Audited URL
 * @returns LHR-shaped object
 */
function report(
  score: number,
  reflowTimes: readonly number[] = [],
  url: string = EXAMPLE_URL
) {
  return {
    finalUrl: url,
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
 * Build one Lighthouse result per run total, as LHCI writes them.
 * A zero total is a run whose audit passed with no measurable reflow, which is
 * the common shape — most runs of most URLs report nothing at all.
 * @param totals - Per-run forced-reflow totals
 * @param url - Audited URL
 * @returns LHR-shaped objects, one per run
 */
function runs(totals: readonly number[], url: string = EXAMPLE_URL) {
  return totals.map(total =>
    total === 0 ? report(1, [], url) : report(0, [total], url)
  );
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
      projectWithReports(
        [
          report(0, [25, 50]),
          report(0, [25, 50]),
          report(0, [25, 50]),
          report(1),
        ],
        75
      )
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(
      "forced reflow median <= 75 ms (largest median 75.0 ms)"
    );
  });

  it("does not double-count the top-function and bottom-up detail tables", () => {
    const result = run(
      projectWithReports(
        [
          reportWithDuplicateTables(75),
          reportWithDuplicateTables(75),
          reportWithDuplicateTables(75),
        ],
        100
      )
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(
      "forced reflow median <= 100 ms (largest median 75.0 ms)"
    );
  });

  it("passes a URL whose only run above the ceiling is a cold warmup spike", () => {
    const result = run(projectWithReports(runs([105.2, 0, 0, 0, 0]), 100));

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(
      "forced reflow median <= 100 ms (largest median 0.0 ms)"
    );
  });

  it("fails a URL whose runs are consistently above the ceiling", () => {
    const result = run(
      projectWithReports(runs([105, 110, 120, 108, 115]), 100)
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("median 110.0 ms of 5 runs exceeds 100 ms");
  });

  it("fails a URL with too few runs to take a median, naming the run count", () => {
    const result = run(projectWithReports(runs([0, 0]), 100));

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("2 runs is fewer than the 3 needed");
    expect(result.stderr).toContain(
      "raise collect.numberOfRuns in lighthouserc-config.json to at least 3"
    );
  });

  it("refuses to assert a maximum under the name of a median at one run per URL", () => {
    const result = run(projectWithReports(runs([105]), 100));

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("1 run is fewer than the 3 needed");
    expect(result.stderr).toContain("collect.numberOfRuns");
    expect(result.stderr).not.toContain("exceeds 100 ms");
  });

  it("asserts each URL against its own median", () => {
    const result = run(
      projectWithReports(
        [
          ...runs([105, 0, 0], EXAMPLE_URL),
          ...runs([120, 120, 120], OTHER_URL),
        ],
        100
      )
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      `${OTHER_URL}: median 120.0 ms of 3 runs exceeds 100 ms`
    );
    expect(result.stderr).not.toContain(EXAMPLE_URL);
  });

  it("honors a host threshold above Lisa's shipped default", () => {
    const result = run(projectWithReports(runs([120, 120, 120]), 150));

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(
      "forced reflow median <= 150 ms (largest median 120.0 ms)"
    );
  });

  it("applies the shipped 100 ms default when the host configures nothing", () => {
    const result = run(projectWithReports(runs([120, 120, 120])));

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("median 120.0 ms of 3 runs exceeds 100 ms");
  });

  it("groups runs by finalDisplayedUrl when finalUrl is absent", () => {
    const reports = runs([120, 120, 120]).map(entry => {
      const { finalUrl, ...rest } = entry;
      return { ...rest, finalDisplayedUrl: finalUrl };
    });

    const result = run(projectWithReports(reports, 100));

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      `${EXAMPLE_URL}: median 120.0 ms of 3 runs exceeds 100 ms`
    );
  });

  it("fails closed when a report names no URL to group runs by", () => {
    const reports = runs([0, 0, 0]).map(entry => {
      const { finalUrl, ...rest } = entry;
      return rest;
    });

    const result = run(projectWithReports(reports, 100));

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("no URL to group runs by");
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

  it("collects a malformed JSON report without masking later report failures", () => {
    const project = projectWithReports([report(1), {}], 100);
    writeFileSync(
      path.join(project, REPORT_DIRECTORY, "lhr-1-malformed.json"),
      "{not-json",
      "utf8"
    );

    const result = run(project);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "lhr-1-malformed.json is not a valid Lighthouse result"
    );
    expect(result.stderr).toContain(
      "lhr-1.json: missing forced-reflow-insight audit"
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
    mkdirSync(path.join(project, REPORT_DIRECTORY));

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

  it("collects at least the runs per URL the checker needs for a median", () => {
    const shippedConfig = JSON.parse(
      readFileSync(
        path.join(REPO_ROOT, "expo/create-only/lighthouserc-config.json"),
        "utf8"
      )
    );

    expect(shippedConfig.collect.numberOfRuns).toBeGreaterThanOrEqual(3);
  });
});
