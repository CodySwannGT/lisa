#!/usr/bin/env node
// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/**
 * Enforce performance budgets whose measurements Lighthouse CI cannot assert.
 *
 * `forced-reflow-insight` exposes its useful duration only in a nested detail
 * table. Its score is effectively binary, so a score floor makes unchanged
 * pages alternate between green and red as runner timing changes. LHCI writes
 * the measurement into each LHR; this checker applies a real millisecond
 * ceiling to that evidence.
 *
 * The ceiling is asserted against the **median of a URL's runs**, not against
 * any single run. A forced-reflow regression is deterministic — code that
 * reads layout inside a loop does so on every load — so it moves the median.
 * A single cold run does not: the first Lighthouse run of a URL, immediately
 * after the runs of the previous URL, routinely reports a warmup spike that no
 * later run of the same URL reproduces. Asserting a maximum made that spike
 * indistinguishable from a regression, so the gate's verdict was uncorrelated
 * with the change under review.
 * @module scripts/check-lighthouse-details
 */

import fs from "node:fs";
import path from "node:path";

const AUDIT_ID = "forced-reflow-insight";
const CONFIG_FILE = "lighthouserc-config.json";
const REPORT_DIRECTORY = ".lighthouseci";
const REPORT_PATTERN = /^lhr-.*\.json$/;
const DEFAULT_MAX_FORCED_REFLOW_MS = 100;
const RUN_COUNT_SETTING = "collect.numberOfRuns";

/**
 * Fewest runs per URL that a median can absorb a warmup spike from.
 *
 * With two samples the median is their mean, so one cold spike still drags the
 * statistic halfway to itself — the defect survives, attenuated. Three is the
 * smallest count at which a single outlier cannot move the median at all.
 */
const MINIMUM_SAMPLES_PER_URL = 3;

/**
 * LHR fields naming the audited page, best first.
 *
 * Lighthouse renamed `finalUrl` to `finalDisplayedUrl` and reports differ by
 * version, so grouping cannot depend on any single one of them.
 */
const URL_FIELDS = [
  "finalUrl",
  "finalDisplayedUrl",
  "requestedUrl",
  "mainDocumentUrl",
];

/**
 * Read the bottom-up aggregate table from one forced-reflow audit.
 * Lighthouse may prepend a top-level-function table derived from the same
 * events, then appends the bottom-up aggregate. Summing every nested table
 * would count those events twice.
 * @param {unknown} details - Forced-reflow audit details
 * @returns {number[]} Per-source aggregate measurements
 */
function readAggregateMeasurements(details) {
  if (details === null || typeof details !== "object") {
    throw new Error("forced-reflow details are missing or malformed");
  }
  if (details.type !== "table" && !Array.isArray(details.items)) {
    throw new Error("forced-reflow details are missing or malformed");
  }
  const tables =
    details.type === "table"
      ? [details]
      : details.items.filter(
          item =>
            item !== null && typeof item === "object" && item.type === "table"
        );
  const aggregate = tables.at(-1);
  if (!aggregate) {
    throw new Error("forced-reflow details contain no aggregate table");
  }
  if (!Array.isArray(aggregate.items)) {
    throw new Error("forced-reflow aggregate table is malformed");
  }
  return aggregate.items.map((item, index) => {
    const measurement = item?.reflowTime;
    if (
      typeof measurement !== "number" ||
      !Number.isFinite(measurement) ||
      measurement < 0
    ) {
      throw new Error(
        `forced-reflow aggregate row ${index + 1} has no non-negative finite reflowTime`
      );
    }
    return measurement;
  });
}

/**
 * Identify which page one Lighthouse result measured.
 * Samples are grouped by this value, so an unidentifiable report is a hard
 * failure rather than a group of its own — a report grouped alone would be
 * reported as a run-count shortfall, which names the wrong remedy.
 * @param {Record<string, unknown>} report - Parsed LHR
 * @returns {string} Audited URL
 */
function readReportUrl(report) {
  for (const field of URL_FIELDS) {
    const value = report?.[field];
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }
  throw new Error(
    `no URL to group runs by; expected one of ${URL_FIELDS.join(", ")}`
  );
}

/**
 * Middle value of a sample set, averaging the two middles when even.
 * @param {readonly number[]} values - Non-empty sample set
 * @returns {number} Median
 */
function median(values) {
  const sorted = [...values].sort((first, second) => first - second);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

/**
 * Read the host threshold, falling back to Lisa's shipped default.
 * @param {string} projectRoot - Host project root
 * @returns {number} Maximum median forced-reflow duration per URL
 */
function readMaximum(projectRoot) {
  const configPath = path.join(projectRoot, CONFIG_FILE);
  if (!fs.existsSync(configPath)) {
    return DEFAULT_MAX_FORCED_REFLOW_MS;
  }
  let config;
  try {
    config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch (error) {
    throw new Error(
      `${CONFIG_FILE} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  const configured =
    config?.assertions?.forcedReflowInsight?.maxNumericValue ??
    DEFAULT_MAX_FORCED_REFLOW_MS;
  if (
    typeof configured !== "number" ||
    !Number.isFinite(configured) ||
    configured < 0
  ) {
    throw new Error(
      `${CONFIG_FILE} assertions.forcedReflowInsight.maxNumericValue must be a finite number at least 0`
    );
  }
  return configured;
}

/**
 * Load one Lighthouse result without allowing malformed evidence to pass.
 * @param {string} reportPath - LHR path
 * @returns {Record<string, unknown>} Parsed LHR
 */
function readReport(reportPath) {
  try {
    return JSON.parse(fs.readFileSync(reportPath, "utf8"));
  } catch (error) {
    throw new Error(
      `${path.basename(reportPath)} is not a valid Lighthouse result: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

/**
 * List the Lighthouse result files, refusing to pass on absent evidence.
 * @param {string} projectRoot - Host project root
 * @returns {string[]} LHR paths, sorted
 */
function readReportPaths(projectRoot) {
  const reportDirectory = path.join(projectRoot, REPORT_DIRECTORY);
  if (!fs.existsSync(reportDirectory)) {
    throw new Error(
      `${REPORT_DIRECTORY} is missing; Lighthouse produced no evidence`
    );
  }
  const reportPaths = fs
    .readdirSync(reportDirectory)
    .filter(file => REPORT_PATTERN.test(file))
    .sort()
    .map(file => path.join(reportDirectory, file));
  if (reportPaths.length === 0) {
    throw new Error(`${REPORT_DIRECTORY} contains no Lighthouse result JSON`);
  }
  return reportPaths;
}

/**
 * Total the forced-reflow evidence in every report, grouped by audited URL.
 * Evidence-integrity problems are collected rather than thrown so that one
 * malformed report names itself instead of masking the rest.
 * @param {readonly string[]} reportPaths - LHR paths
 * @returns {{ samplesByUrl: Map<string, number[]>, failures: string[] }} Totals and integrity failures
 */
function collectSamples(reportPaths) {
  const samplesByUrl = new Map();
  const failures = [];
  for (const reportPath of reportPaths) {
    const report = readReport(reportPath);
    const audit = report?.audits?.[AUDIT_ID];
    if (audit === null || typeof audit !== "object") {
      failures.push(`${path.basename(reportPath)}: missing ${AUDIT_ID} audit`);
      continue;
    }
    let measurements;
    let url;
    try {
      measurements = readAggregateMeasurements(audit.details);
      url = readReportUrl(report);
    } catch (error) {
      failures.push(
        `${path.basename(reportPath)}: ${error instanceof Error ? error.message : String(error)}`
      );
      continue;
    }
    if (audit.score === 0 && measurements.length === 0) {
      failures.push(
        `${path.basename(reportPath)}: ${AUDIT_ID} failed without measurable reflowTime evidence`
      );
      continue;
    }
    const total = measurements.reduce(
      (sum, measurement) => sum + measurement,
      0
    );
    const samples = samplesByUrl.get(url);
    if (samples) {
      samples.push(total);
    } else {
      samplesByUrl.set(url, [total]);
    }
  }
  return { samplesByUrl, failures };
}

/**
 * Assert the configured ceiling against each URL's median.
 * A URL with too few runs fails rather than falling back to a maximum, because
 * the median of one sample is that sample: without this, `numberOfRuns: 1`
 * would silently restore a per-run maximum under the name of a median.
 * @param {Map<string, number[]>} samplesByUrl - Per-URL run totals
 * @param {number} maximum - Configured millisecond ceiling
 * @returns {{ failures: string[], largestMedian: number }} Budget failures and the largest median seen
 */
function assertMedians(samplesByUrl, maximum) {
  const failures = [];
  let largestMedian = 0;
  for (const [url, samples] of samplesByUrl) {
    if (samples.length < MINIMUM_SAMPLES_PER_URL) {
      failures.push(
        `${url}: ${samples.length} run${samples.length === 1 ? "" : "s"} is fewer than the ${MINIMUM_SAMPLES_PER_URL} needed for a median; raise ${RUN_COUNT_SETTING} in ${CONFIG_FILE} to at least ${MINIMUM_SAMPLES_PER_URL}`
      );
      continue;
    }
    const middle = median(samples);
    largestMedian = Math.max(largestMedian, middle);
    if (middle > maximum) {
      failures.push(
        `${url}: median ${middle.toFixed(1)} ms of ${samples.length} runs exceeds ${maximum} ms`
      );
    }
  }
  return { failures, largestMedian };
}

/** Run the detail budget against the current project. */
function main() {
  const projectRoot = process.cwd();
  const maximum = readMaximum(projectRoot);
  const reportPaths = readReportPaths(projectRoot);

  const { samplesByUrl, failures: evidenceFailures } =
    collectSamples(reportPaths);
  if (evidenceFailures.length > 0) {
    throw new Error(
      `forced-reflow detail budget failed:\n${evidenceFailures.map(failure => `- ${failure}`).join("\n")}`
    );
  }

  const { failures, largestMedian } = assertMedians(samplesByUrl, maximum);
  if (failures.length > 0) {
    throw new Error(
      `forced-reflow detail budget failed:\n${failures.map(failure => `- ${failure}`).join("\n")}`
    );
  }

  console.log(
    `lighthouse detail budget passed: ${reportPaths.length} report(s) across ${samplesByUrl.size} URL(s), forced reflow median <= ${maximum} ms (largest median ${largestMedian.toFixed(1)} ms)`
  );
}

try {
  main();
} catch (error) {
  console.error(
    `lighthouse detail budget failed: ${error instanceof Error ? error.message : String(error)}`
  );
  process.exitCode = 1;
}
