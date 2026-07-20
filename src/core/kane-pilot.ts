/** Manifest validation and execution for the Kane longitudinal pilot. */
import { appendFile, readFile } from "node:fs/promises";
import * as path from "node:path";
import { runKane, type KaneOutcome, type KaneRunResult } from "./kane-cli.js";
import {
  buildKanePilotReport,
  DEFAULT_KANE_PILOT_THRESHOLDS,
} from "./kane-pilot-report.js";
import type {
  KanePilotApplication,
  KanePilotCase,
  KanePilotManifest,
  KanePilotPolicyReview,
  KanePilotRecord,
  KanePilotReport,
} from "./kane-pilot-types.js";

export { buildKanePilotReport, DEFAULT_KANE_PILOT_THRESHOLDS };
export type {
  KanePilotApplication,
  KanePilotCase,
  KanePilotManifest,
  KanePilotPolicyReview,
  KanePilotRecord,
  KanePilotReport,
  KanePilotVerdict,
} from "./kane-pilot-types.js";

/**
 * Validate an optional exterior policy review.
 * @param value - Untrusted policy-review value
 * @returns Valid review or undefined
 */
function parsePolicyReview(value: unknown): KanePilotPolicyReview | undefined {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Kane pilot policyReview must be an object");
  }
  const review = value as Record<string, unknown>;
  if (
    typeof review.reviewedAt !== "string" ||
    Number.isNaN(Date.parse(review.reviewedAt))
  ) {
    throw new Error(
      "Kane pilot policyReview.reviewedAt must be an ISO timestamp"
    );
  }
  if (!Number.isInteger(review.incidents) || Number(review.incidents) < 0) {
    throw new Error(
      "Kane pilot policyReview.incidents must be a non-negative integer"
    );
  }
  return {
    reviewedAt: review.reviewedAt,
    incidents: Number(review.incidents),
  };
}

/**
 * Validate one pilot case.
 * @param value - Untrusted case value
 * @returns Valid pilot case
 */
function parsePilotCase(value: unknown): KanePilotCase {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Kane pilot case must be an object");
  }
  const record = value as Record<string, unknown>;
  for (const field of ["id", "objective", "url"] as const) {
    if (typeof record[field] !== "string" || record[field].length === 0) {
      throw new Error(`Kane pilot case ${field} must be a string`);
    }
  }
  if (
    record.baselineSeconds !== undefined &&
    (typeof record.baselineSeconds !== "number" || record.baselineSeconds <= 0)
  ) {
    throw new Error("Kane pilot baselineSeconds must be positive");
  }
  return {
    id: record.id as string,
    objective: record.objective as string,
    url: record.url as string,
    ...(record.baselineSeconds === undefined
      ? {}
      : { baselineSeconds: record.baselineSeconds as number }),
  };
}

/**
 * Validate one pilot application.
 * @param value - Untrusted application value
 * @returns Valid pilot application
 */
function parsePilotApplication(value: unknown): KanePilotApplication {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Kane pilot application must be an object");
  }
  const record = value as Record<string, unknown>;
  for (const field of ["name", "projectRoot", "environment"] as const) {
    if (typeof record[field] !== "string" || record[field].length === 0) {
      throw new Error(`Kane pilot application ${field} must be a string`);
    }
  }
  if (!Array.isArray(record.cases) || record.cases.length === 0) {
    throw new Error("Kane pilot application must define cases");
  }
  return {
    name: record.name as string,
    projectRoot: record.projectRoot as string,
    environment: record.environment as string,
    cases: record.cases.map(parsePilotCase),
  };
}

/**
 * Validate an untrusted pilot manifest.
 * @param value - Parsed manifest value
 * @returns Valid pilot manifest
 */
export function parseKanePilotManifest(value: unknown): KanePilotManifest {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Kane pilot manifest must be an object");
  }
  const record = value as Record<string, unknown>;
  const policyReview = parsePolicyReview(record.policyReview);
  if (record.version !== 1) throw new Error("Kane pilot version must be 1");
  if (
    typeof record.startedAt !== "string" ||
    Number.isNaN(Date.parse(record.startedAt))
  ) {
    throw new Error("Kane pilot startedAt must be an ISO timestamp");
  }
  if (
    typeof record.resultsFile !== "string" ||
    record.resultsFile.length === 0 ||
    path.isAbsolute(record.resultsFile) ||
    record.resultsFile.split(/[\\/]/u).includes("..")
  ) {
    throw new Error("Kane pilot resultsFile must be a safe relative path");
  }
  if (!Array.isArray(record.applications) || record.applications.length < 2) {
    throw new Error("Kane pilot requires at least two applications");
  }
  if (
    record.maximumCreditsPerRun !== undefined &&
    (typeof record.maximumCreditsPerRun !== "number" ||
      record.maximumCreditsPerRun <= 0)
  ) {
    throw new Error("maximumCreditsPerRun must be a positive number");
  }
  return {
    version: 1,
    startedAt: record.startedAt,
    resultsFile: record.resultsFile,
    applications: record.applications.map(parsePilotApplication),
    ...(policyReview === undefined ? {} : { policyReview }),
    ...(record.maximumCreditsPerRun === undefined
      ? {}
      : { maximumCreditsPerRun: record.maximumCreditsPerRun }),
  };
}

/**
 * Convert one adapter result into a longitudinal record.
 * @param application - Pilot application
 * @param testCase - Pilot journey
 * @param result - Normalized adapter result
 * @returns Durable pilot record
 */
function toPilotRecord(
  application: KanePilotApplication,
  testCase: KanePilotCase,
  result: KaneRunResult
): KanePilotRecord {
  return {
    timestamp: new Date().toISOString(),
    application: application.name,
    caseId: testCase.id,
    outcome: result.outcome,
    ...(result.terminal?.duration === undefined
      ? {}
      : { durationSeconds: result.terminal.duration }),
    ...(testCase.baselineSeconds === undefined
      ? {}
      : { baselineSeconds: testCase.baselineSeconds }),
    ...(result.terminal?.credits === undefined
      ? {}
      : { credits: result.terminal.credits }),
    evidenceCaptured: result.evidencePack !== undefined,
    evidenceComplete:
      result.evidencePack !== undefined &&
      result.terminal?.test_url !== undefined,
    policyIncident: false,
  };
}

/**
 * Parse one stored record fail-closed.
 * @param value - Parsed JSONL value
 * @returns Valid pilot record
 */
function parseStoredRecord(value: unknown): KanePilotRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Kane pilot record must be an object");
  }
  const record = value as Record<string, unknown>;
  const outcomes: readonly KaneOutcome[] = [
    "passed",
    "product_failed",
    "tool_failed",
    "timed_out",
  ];
  if (
    typeof record.timestamp !== "string" ||
    Number.isNaN(Date.parse(record.timestamp)) ||
    typeof record.application !== "string" ||
    typeof record.caseId !== "string" ||
    !outcomes.includes(record.outcome as KaneOutcome) ||
    typeof record.evidenceComplete !== "boolean" ||
    typeof record.policyIncident !== "boolean"
  ) {
    throw new Error("Kane pilot record has an invalid required field");
  }
  for (const field of [
    "durationSeconds",
    "baselineSeconds",
    "credits",
  ] as const) {
    if (record[field] !== undefined && typeof record[field] !== "number") {
      throw new Error(`Kane pilot record ${field} must be numeric`);
    }
  }
  if (
    record.evidenceCaptured !== undefined &&
    typeof record.evidenceCaptured !== "boolean"
  ) {
    throw new Error("Kane pilot record evidenceCaptured must be boolean");
  }
  return value as KanePilotRecord;
}

/**
 * Read validated JSONL records, treating an absent file as empty.
 * @param resultsPath - Absolute results path
 * @returns Validated records
 */
async function readRecords(
  resultsPath: string
): Promise<readonly KanePilotRecord[]> {
  try {
    return (await readFile(resultsPath, "utf8"))
      .split(/\r?\n/u)
      .filter(line => line.trim().length > 0)
      .map(line => parseStoredRecord(JSON.parse(line) as unknown));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

/**
 * Execute each configured case once and append immutable records.
 * @param manifestPath - Pilot manifest path
 * @param runner - Injectable adapter runner
 * @returns Current pilot report
 */
export async function executeKanePilot(
  manifestPath: string,
  runner: typeof runKane = runKane
): Promise<KanePilotReport> {
  const absoluteManifest = path.resolve(manifestPath);
  const manifest = parseKanePilotManifest(
    JSON.parse(await readFile(absoluteManifest, "utf8")) as unknown
  );
  const manifestDirectory = path.dirname(absoluteManifest);
  const resultsPath = path.resolve(manifestDirectory, manifest.resultsFile);
  if (!resultsPath.startsWith(`${manifestDirectory}${path.sep}`)) {
    throw new Error("Kane pilot resultsFile escapes the manifest directory");
  }
  const cases = manifest.applications.flatMap(application =>
    application.cases.map(testCase => ({ application, testCase }))
  );
  const records = await cases.reduce<Promise<readonly KanePilotRecord[]>>(
    async (previous, entry) => {
      const existing = await previous;
      const result = await runner({
        projectRoot: path.resolve(
          manifestDirectory,
          entry.application.projectRoot
        ),
        environment: entry.application.environment,
        mutation: "full",
        objective: entry.testCase.objective,
        url: entry.testCase.url,
      });
      return [
        ...existing,
        toPilotRecord(entry.application, entry.testCase, result),
      ];
    },
    Promise.resolve([])
  );
  await appendFile(
    resultsPath,
    `${records.map(record => JSON.stringify(record)).join("\n")}\n`,
    "utf8"
  );
  return await readKanePilotReport(absoluteManifest);
}

/**
 * Read accumulated JSONL records and evaluate the adoption gates.
 * @param manifestPath - Pilot manifest path
 * @returns Current pilot report
 */
export async function readKanePilotReport(
  manifestPath: string
): Promise<KanePilotReport> {
  const absoluteManifest = path.resolve(manifestPath);
  const manifest = parseKanePilotManifest(
    JSON.parse(await readFile(absoluteManifest, "utf8")) as unknown
  );
  const resultsPath = path.resolve(
    path.dirname(absoluteManifest),
    manifest.resultsFile
  );
  return buildKanePilotReport(
    manifest,
    await readRecords(resultsPath),
    new Date()
  );
}
