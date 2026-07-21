/** Strict transport contract for the console Setup readiness projection. */
/* eslint-disable jsdoc/require-param, jsdoc/require-returns -- typed contract helpers are self-describing */
import {
  summarizeHealthFindings,
  validateHealthResult,
  type HealthFinding,
  type HealthStatus,
} from "../health/contract.js";
import {
  readStrictDenseArray,
  readStrictProperty,
  requireCanonicalUtcTimestamp,
  requireStrictRecord,
} from "../health/strict-validation.js";

/** Stable finding identifiers, in the existing checklist render order. */
export const SETUP_READINESS_CHECKS = [
  "setup.install",
  "setup.sync",
  "setup.agent-ready",
  "setup.standards",
  "setup.tracker",
  "setup.prd-source",
  "setup.github-governance",
  "setup.secrets",
  "setup.automations",
  "setup.exploration",
  "setup.wiki",
  "setup.starter-provenance",
] as const;

/** One of the closed Setup checklist identifiers. */
export type SetupReadinessCheck = (typeof SETUP_READINESS_CHECKS)[number];

/** Setup finding reuses the closed Health finding shape without joining Health. */
export type SetupReadinessFinding = HealthFinding & {
  readonly check: SetupReadinessCheck;
  readonly layer: "deterministic";
};

/** Current, non-persisted Setup readiness response. */
export interface SetupReadinessResult {
  readonly schemaVersion: 1;
  readonly observedAt: string;
  readonly findings: readonly SetupReadinessFinding[];
}

/** Create one operator-readable deterministic Setup finding. */
export function setupFinding(
  check: SetupReadinessCheck,
  status: HealthStatus,
  reason: string
): SetupReadinessFinding {
  return { check, layer: "deterministic", status, reason };
}

/**
 * Validate, detach, and freeze a Setup readiness projection.
 * @param candidate - Untrusted projection
 * @returns Strict schema-v1 result with exactly the twelve checklist findings
 */
export function validateSetupReadinessResult(
  candidate: unknown
): SetupReadinessResult {
  const record = requireStrictRecord(
    candidate,
    ["schemaVersion", "observedAt", "findings"] as const,
    "SetupReadinessResult"
  );
  if (readStrictProperty(record, "schemaVersion") !== 1) {
    throw new Error("Invalid setup readiness schemaVersion: expected 1");
  }
  const observedAt = requireCanonicalUtcTimestamp(
    readStrictProperty(record, "observedAt"),
    "observedAt"
  );
  const rawFindings = readStrictDenseArray(
    readStrictProperty(record, "findings"),
    SETUP_READINESS_CHECKS.length,
    SETUP_READINESS_CHECKS.length,
    "findings"
  );
  const validated = validateHealthResult({
    schemaVersion: 1,
    runId: "setup-readiness-validation",
    mode: "deterministic",
    startedAt: observedAt,
    completedAt: observedAt,
    findings: rawFindings,
    summary: summarizeHealthFindings(rawFindings),
  }).findings;
  const actual = validated.map(finding => finding.check);
  if (SETUP_READINESS_CHECKS.some((check, index) => actual[index] !== check)) {
    throw new Error(
      `Invalid setup readiness checks: expected ${SETUP_READINESS_CHECKS.join(", ")}`
    );
  }
  const findings = validated as readonly SetupReadinessFinding[];
  return Object.freeze({
    schemaVersion: 1,
    observedAt,
    findings: Object.freeze(findings),
  });
}

/* eslint-enable jsdoc/require-param, jsdoc/require-returns -- end typed contract helper exception */
