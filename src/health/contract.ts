/* eslint-disable jsdoc/require-jsdoc, jsdoc/require-param, jsdoc/require-returns, max-lines -- the strict executable schema is kept together for auditable field relationships */
/** Strict executable contract for Health v1 results and scheduling. */
import { isProxy } from "node:util/types";

export const HEALTH_SCHEDULE_VALUES = ["off", "daily", "weekly"] as const;
export type HealthSchedule = (typeof HEALTH_SCHEDULE_VALUES)[number];
export type HealthLayer = "deterministic" | "agentic";
export type HealthStatus = "pass" | "warn" | "fail";
export type HealthMode = "deterministic" | "full";
export type HealthVerdict = "in band" | "drift detected";

export interface HealthFinding {
  readonly check: string;
  readonly layer: HealthLayer;
  readonly status: HealthStatus;
  readonly reason: string;
}

export interface HealthSummary {
  readonly verdict: HealthVerdict;
  readonly counts: Readonly<{ pass: number; warn: number; fail: number }>;
}

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
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const MACHINE_ID = /^[a-z0-9]+(?:[._:-][a-z0-9]+)*$/u;
const MAX_FINDINGS = 200;
const MAX_ID_BYTES = 128;
const MAX_REASON_BYTES = 2_000;

/** Validate a health schedule value. */
export function validateHealthSchedule(value: unknown): HealthSchedule {
  if (!HEALTH_SCHEDULE_VALUES.includes(value as HealthSchedule)) {
    throw new Error("Invalid health.schedule: expected off, daily, or weekly");
  }
  return value as HealthSchedule;
}

/** Derive zero-filled counts and the canonical verdict. */
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

/** Validate untrusted data into a detached, deeply frozen Health v1 result. */
export function validateHealthResult(candidate: unknown): HealthResult {
  const input = requireRecord(candidate, RESULT_FIELDS, "HealthResult");
  if (read(input, "schemaVersion") !== 1) {
    throw new Error("Invalid schemaVersion: expected 1");
  }
  const runId = requireMachineId(read(input, "runId"), "runId");
  const mode = requireEnum(
    read(input, "mode"),
    ["deterministic", "full"] as const,
    "mode"
  );
  const startedAt = requireTimestamp(read(input, "startedAt"), "startedAt");
  const completedAt = requireTimestamp(
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

/** Require a strict accessor-free object with exactly the expected fields. */
function requireRecord<TField extends string>(
  value: unknown,
  fields: readonly TField[],
  label: string
): Readonly<Record<TField, PropertyDescriptor>> {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    isProxy(value)
  ) {
    throw new Error(`Invalid ${label}: expected a plain object`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error(`Invalid ${label}: expected a plain object prototype`);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value) as Record<
    string,
    PropertyDescriptor
  >;
  const keys = Reflect.ownKeys(descriptors);
  if (
    keys.length !== fields.length ||
    keys.some(key => typeof key !== "string" || !fields.includes(key as TField))
  ) {
    throw new Error(
      `Invalid ${label} fields: expected exactly ${fields.join(", ")}`
    );
  }
  fields.forEach(field => {
    const descriptor = descriptors[field];
    if (descriptor === undefined || !("value" in descriptor)) {
      throw new Error(`Invalid ${label}.${field}: accessors are not allowed`);
    }
  });
  return descriptors as Readonly<Record<TField, PropertyDescriptor>>;
}

/** Read a descriptor-backed data property without invoking accessors. */
function read<TField extends string>(
  descriptors: Readonly<Record<TField, PropertyDescriptor>>,
  field: TField
): unknown {
  return descriptors[field].value as unknown;
}

/** Require a bounded stable machine identifier. */
function requireMachineId(value: unknown, field: string): string {
  if (
    typeof value !== "string" ||
    value.trim() !== value ||
    !MACHINE_ID.test(value) ||
    Buffer.byteLength(value, "utf8") > MAX_ID_BYTES
  ) {
    throw new Error(`Invalid ${field}: expected a bounded machine identifier`);
  }
  return value;
}

/** Require one value from a closed string vocabulary. */
function requireEnum<TValue extends string>(
  value: unknown,
  allowed: readonly TValue[],
  field: string
): TValue {
  if (typeof value !== "string" || !allowed.includes(value as TValue)) {
    throw new Error(`Invalid ${field}: expected ${allowed.join(" or ")}`);
  }
  return value as TValue;
}

/** Require canonical UTC millisecond precision. */
function requireTimestamp(value: unknown, field: string): string {
  if (
    typeof value !== "string" ||
    !ISO_UTC.test(value) ||
    Number.isNaN(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  ) {
    throw new Error(
      `Invalid ${field}: expected canonical UTC YYYY-MM-DDTHH:mm:ss.sssZ`
    );
  }
  return value;
}

/** Validate and detach a non-empty finding list. */
function requireFindings(value: unknown): readonly HealthFinding[] {
  if (isProxy(value) || !Array.isArray(value)) {
    throw new Error(`Invalid findings: expected 1-${MAX_FINDINGS} entries`);
  }
  if (Object.getPrototypeOf(value) !== Array.prototype) {
    throw new Error("Invalid findings: expected a plain array prototype");
  }
  const descriptors = Object.getOwnPropertyDescriptors(value) as Record<
    string,
    PropertyDescriptor
  >;
  const lengthDescriptor = descriptors.length;
  const length = lengthDescriptor?.value as unknown;
  if (
    typeof length !== "number" ||
    !Number.isSafeInteger(length) ||
    length < 1 ||
    length > MAX_FINDINGS
  ) {
    throw new Error(`Invalid findings: expected 1-${MAX_FINDINGS} entries`);
  }
  const expectedKeys = [
    ...Array.from({ length }, (_unused, index) => String(index)),
    "length",
  ];
  const keys = Reflect.ownKeys(descriptors);
  if (
    keys.length !== expectedKeys.length ||
    keys.some(key => typeof key !== "string" || !expectedKeys.includes(key))
  ) {
    throw new Error("Invalid findings: expected a dense extra-free array");
  }
  const findings = Array.from({ length }, (_unused, index) => {
    const descriptor = descriptors[String(index)];
    if (descriptor === undefined || !("value" in descriptor)) {
      throw new Error(`Invalid findings[${index}]: accessors are not allowed`);
    }
    return requireFinding(descriptor.value as unknown, index);
  });
  const checks = findings.map(finding => finding.check);
  if (new Set(checks).size !== checks.length) {
    throw new Error("Invalid findings: check identifiers must be unique");
  }
  return findings;
}

/** Validate one finding. */
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
    check: requireMachineId(read(input, "check"), `findings[${index}].check`),
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

/** Detect controls and bidirectional formatting characters in operator text. */
function hasUnsafeTextCharacter(value: string): boolean {
  return Array.from(value).some(character => {
    const codePoint = character.codePointAt(0) ?? 0;
    return (
      codePoint <= 0x1f ||
      (codePoint >= 0x7f && codePoint <= 0x9f) ||
      (codePoint >= 0x202a && codePoint <= 0x202e) ||
      (codePoint >= 0x2066 && codePoint <= 0x2069)
    );
  });
}

/** Validate supplied summary shape and scalar values before comparison. */
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

/** Enforce mode meaning rather than treating it as decorative metadata. */
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
/* eslint-enable jsdoc/require-jsdoc, jsdoc/require-param, jsdoc/require-returns, max-lines -- restore repository defaults */
