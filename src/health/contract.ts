/** Strict executable contract for Health v1 results and scheduling. */
import {
  hasUnsafeTextCharacter,
  readStrictDenseArray,
  readStrictProperty as read,
  requireBoundedMachineId,
  requireCanonicalUtcTimestamp,
  requireClosedString as requireEnum,
  requireStrictRecord as requireRecord,
} from "./strict-validation.js";

export const HEALTH_SCHEDULE_VALUES = ["off", "daily", "weekly"] as const;
/** Supported unattended health-run cadence. */
export type HealthSchedule = (typeof HEALTH_SCHEDULE_VALUES)[number];
/** Origin of one health finding. */
export type HealthLayer = "deterministic" | "agentic";
/** Outcome of one health check. */
export type HealthStatus = "pass" | "warn" | "fail";
/** Scope executed by a health run. */
export type HealthMode = "deterministic" | "full";
/** Canonical aggregate health verdict. */
export type HealthVerdict = "in band" | "drift detected";

/** One bounded, attributable health-check result. */
export interface HealthFinding {
  readonly check: string;
  readonly layer: HealthLayer;
  readonly status: HealthStatus;
  readonly reason: string;
}

/** Derived zero-filled counts and verdict. */
export interface HealthSummary {
  readonly verdict: HealthVerdict;
  readonly counts: Readonly<{ pass: number; warn: number; fail: number }>;
}

/** Complete immutable Health v1 result envelope. */
export interface HealthResult {
  readonly schemaVersion: 1;
  readonly runId: string;
  readonly mode: HealthMode;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly findings: readonly HealthFinding[];
  readonly summary: HealthSummary;
}

const RESULT_FIELDS = [
  "schemaVersion",
  "runId",
  "mode",
  "startedAt",
  "completedAt",
  "findings",
  "summary",
] as const;
const FINDING_FIELDS = ["check", "layer", "status", "reason"] as const;
const SUMMARY_FIELDS = ["verdict", "counts"] as const;
const COUNT_FIELDS = ["pass", "warn", "fail"] as const;
const MAX_FINDINGS = 200;
const MAX_ID_BYTES = 128;
const MAX_REASON_BYTES = 2_000;

/**
 * Validate a health schedule value.
 * @param value - Untrusted schedule candidate
 * @returns Validated closed schedule value
 */
export function validateHealthSchedule(value: unknown): HealthSchedule {
  if (!HEALTH_SCHEDULE_VALUES.includes(value as HealthSchedule)) {
    throw new Error("Invalid health.schedule: expected off, daily, or weekly");
  }
  return value as HealthSchedule;
}

/**
 * Derive zero-filled counts and the canonical verdict.
 * @param findings - Untrusted finding collection
 * @returns Frozen canonical summary
 */
export function summarizeHealthFindings(findings: unknown): HealthSummary {
  const validated = requireFindings(findings);
  const counts = validated.reduce(
    (current, finding) => ({
      ...current,
      [finding.status]: current[finding.status] + 1,
    }),
    { pass: 0, warn: 0, fail: 0 }
  );
  return Object.freeze({
    verdict: counts.fail > 0 ? "drift detected" : "in band",
    counts: Object.freeze(counts),
  });
}

/**
 * Validate untrusted data into a detached, deeply frozen Health v1 result.
 * @param candidate - Untrusted result envelope
 * @returns Frozen validated Health v1 result
 */
export function validateHealthResult(candidate: unknown): HealthResult {
  const input = requireRecord(candidate, RESULT_FIELDS, "HealthResult");
  if (read(input, "schemaVersion") !== 1) {
    throw new Error("Invalid schemaVersion: expected 1");
  }
  const runId = requireBoundedMachineId(
    read(input, "runId"),
    "runId",
    MAX_ID_BYTES
  );
  const mode = requireEnum(
    read(input, "mode"),
    ["deterministic", "full"] as const,
    "mode"
  );
  const startedAt = requireCanonicalUtcTimestamp(
    read(input, "startedAt"),
    "startedAt"
  );
  const completedAt = requireCanonicalUtcTimestamp(
    read(input, "completedAt"),
    "completedAt"
  );
  if (completedAt < startedAt) {
    throw new Error("Invalid completedAt: precedes startedAt");
  }
  const findings = requireFindings(read(input, "findings"));
  const supplied = requireSummary(read(input, "summary"));
  const derived = summarizeHealthFindings(findings);
  assertModeLayers(mode, findings);
  if (
    supplied.verdict !== derived.verdict ||
    COUNT_FIELDS.some(key => supplied.counts[key] !== derived.counts[key])
  ) {
    throw new Error("Invalid summary: verdict or counts do not match findings");
  }
  return Object.freeze({
    schemaVersion: 1,
    runId,
    mode,
    startedAt,
    completedAt,
    findings: Object.freeze(findings),
    summary: derived,
  });
}

/**
 * Validate and detach a non-empty finding list.
 * @param value - Untrusted finding collection
 * @returns Detached validated findings
 */
function requireFindings(value: unknown): readonly HealthFinding[] {
  const findings = readStrictDenseArray(value, 1, MAX_FINDINGS, "findings").map(
    (candidate, index) => requireFinding(candidate, index)
  );
  const checks = findings.map(finding => finding.check);
  if (new Set(checks).size !== checks.length) {
    throw new Error("Invalid findings: check identifiers must be unique");
  }
  return findings;
}

/**
 * Validate one finding.
 * @param candidate - Untrusted finding candidate
 * @param index - Finding index used in validation messages
 * @returns Frozen validated finding
 */
function requireFinding(candidate: unknown, index: number): HealthFinding {
  const input = requireRecord(candidate, FINDING_FIELDS, `findings[${index}]`);
  const reason = read(input, "reason");
  if (
    typeof reason !== "string" ||
    reason.trim() !== reason ||
    reason.length === 0 ||
    Buffer.byteLength(reason, "utf8") > MAX_REASON_BYTES ||
    hasUnsafeTextCharacter(reason)
  ) {
    throw new Error(
      `Invalid findings[${index}].reason: expected readable text`
    );
  }
  return Object.freeze({
    check: requireBoundedMachineId(
      read(input, "check"),
      `findings[${index}].check`,
      MAX_ID_BYTES
    ),
    layer: requireEnum(
      read(input, "layer"),
      ["deterministic", "agentic"] as const,
      `findings[${index}].layer`
    ),
    status: requireEnum(
      read(input, "status"),
      ["pass", "warn", "fail"] as const,
      `findings[${index}].status`
    ),
    reason,
  });
}

/**
 * Validate supplied summary shape and scalar values before comparison.
 * @param value - Untrusted summary candidate
 * @returns Frozen validated supplied summary
 */
function requireSummary(value: unknown): HealthSummary {
  const summary = requireRecord(value, SUMMARY_FIELDS, "summary");
  const counts = requireRecord(
    read(summary, "counts"),
    COUNT_FIELDS,
    "summary.counts"
  );
  const normalizedCounts = Object.fromEntries(
    COUNT_FIELDS.map(field => {
      const count = read(counts, field);
      if (!Number.isSafeInteger(count) || (count as number) < 0) {
        throw new Error(
          `Invalid summary.counts.${field}: expected a non-negative integer`
        );
      }
      return [field, count];
    })
  ) as { pass: number; warn: number; fail: number };
  return Object.freeze({
    verdict: requireEnum(
      read(summary, "verdict"),
      ["in band", "drift detected"] as const,
      "summary.verdict"
    ),
    counts: Object.freeze(normalizedCounts),
  });
}

/**
 * Enforce mode meaning rather than treating it as decorative metadata.
 * @param mode - Validated run mode
 * @param findings - Validated run findings
 */
function assertModeLayers(
  mode: HealthMode,
  findings: readonly HealthFinding[]
): void {
  const layers = new Set(findings.map(finding => finding.layer));
  if (
    mode === "deterministic" &&
    (layers.size !== 1 || !layers.has("deterministic"))
  ) {
    throw new Error(
      "Invalid findings: deterministic mode permits deterministic findings only"
    );
  }
  if (
    mode === "full" &&
    (!layers.has("deterministic") || !layers.has("agentic"))
  ) {
    throw new Error(
      "Invalid findings: full mode requires both deterministic and agentic findings"
    );
  }
}
