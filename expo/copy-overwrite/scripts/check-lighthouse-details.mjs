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
 * ceiling to every collected run.
 * @module scripts/check-lighthouse-details
 */

import fs from "node:fs";
import path from "node:path";

const AUDIT_ID = "forced-reflow-insight";
const CONFIG_FILE = "lighthouserc-config.json";
const REPORT_DIRECTORY = ".lighthouseci";
const REPORT_PATTERN = /^lhr-.*\.json$/;
const DEFAULT_MAX_FORCED_REFLOW_MS = 100;

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
    return [];
  }
  const tables =
    details.type === "table"
      ? [details]
      : Array.isArray(details.items)
        ? details.items.filter(
            item =>
              item !== null && typeof item === "object" && item.type === "table"
          )
        : [];
  const aggregate = tables.at(-1);
  if (!aggregate || !Array.isArray(aggregate.items)) {
    return [];
  }
  return aggregate.items.map((item, index) => {
    const measurement = item?.reflowTime;
    if (typeof measurement !== "number" || !Number.isFinite(measurement)) {
      throw new Error(
        `forced-reflow aggregate row ${index + 1} has no finite reflowTime`
      );
    }
    return measurement;
  });
}

/**
 * Read the host threshold, falling back to Lisa's shipped default.
 * @param {string} projectRoot - Host project root
 * @returns {number} Maximum forced-reflow duration per Lighthouse run
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

/** Run the detail budget against the current project. */
function main() {
  const projectRoot = process.cwd();
  const maximum = readMaximum(projectRoot);
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

  const failures = [];
  let observedMaximum = 0;
  for (const reportPath of reportPaths) {
    const report = readReport(reportPath);
    const audit = report?.audits?.[AUDIT_ID];
    if (audit === null || typeof audit !== "object") {
      failures.push(`${path.basename(reportPath)}: missing ${AUDIT_ID} audit`);
      continue;
    }
    let measurements;
    try {
      measurements = readAggregateMeasurements(audit.details);
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
    observedMaximum = Math.max(observedMaximum, total);
    if (total > maximum) {
      failures.push(
        `${report.finalUrl ?? path.basename(reportPath)}: ${total.toFixed(1)} ms exceeds ${maximum} ms`
      );
    }
  }

  if (failures.length > 0) {
    throw new Error(
      `forced-reflow detail budget failed:\n${failures.map(failure => `- ${failure}`).join("\n")}`
    );
  }
  console.log(
    `lighthouse detail budget passed: ${reportPaths.length} report(s), forced reflow <= ${maximum} ms (max ${observedMaximum.toFixed(1)} ms)`
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
