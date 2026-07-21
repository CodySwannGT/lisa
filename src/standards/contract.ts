/** Strict, agent-neutral contract for one standards-conformance proof. */
import type { ProjectType } from "../core/config.js";
import {
  hasUnsafeTextCharacter,
  readStrictDenseArray,
  readStrictProperty as read,
  requireBoundedMachineId,
  requireCanonicalUtcTimestamp,
  requireClosedString,
  requireStrictRecord,
} from "../health/strict-validation.js";

export const STANDARDS_PROOF_PATH = ".lisa/standards/latest.json";
export const STANDARDS_PROOF_ARTIFACT = "lisa-standards-proof";
export const STANDARDS_PROOF_SCHEMA_VERSION = 1;

export const STANDARDS_CHECK_CATEGORIES = [
  "lint",
  "static-analysis",
  "test",
  "guardrail",
  "threshold",
] as const;
/** Closed category names accepted in standards proof results. */
export type StandardsCheckCategory =
  (typeof STANDARDS_CHECK_CATEGORIES)[number];

/** One successful bounded check, without stdout, stderr, or environment data. */
export interface StandardsProofResult {
  readonly check: string;
  readonly category: StandardsCheckCategory;
  readonly status: "pass";
  readonly startedAt: string;
  readonly completedAt: string;
}

/** Git artifact identity established by a standards run. */
export interface StandardsRepositoryProof {
  readonly identity: string;
  readonly head: string;
  readonly tree: string;
}

/** Complete immutable proof envelope. */
export interface StandardsProof {
  readonly schemaVersion: 1;
  readonly artifact: typeof STANDARDS_PROOF_ARTIFACT;
  readonly lisaVersion: string;
  readonly registryDigest: string;
  readonly configDigest: string;
  readonly repository: StandardsRepositoryProof;
  readonly projectTypes: readonly ProjectType[];
  readonly applicableChecks: readonly string[];
  readonly capturedAt: string;
  readonly results: readonly StandardsProofResult[];
}

const PROOF_FIELDS = [
  "schemaVersion",
  "artifact",
  "lisaVersion",
  "registryDigest",
  "configDigest",
  "repository",
  "projectTypes",
  "applicableChecks",
  "capturedAt",
  "results",
] as const;
const REPOSITORY_FIELDS = ["identity", "head", "tree"] as const;
const RESULT_FIELDS = [
  "check",
  "category",
  "status",
  "startedAt",
  "completedAt",
] as const;
const PROJECT_TYPES = [
  "typescript",
  "npm-package",
  "harper-fabric",
  "phaser",
  "expo",
  "nestjs",
  "cdk",
  "rails",
] as const satisfies readonly ProjectType[];
const MAX_CHECKS = 64;
const SHA = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u;
const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const REPOSITORY_IDENTITY = /^[a-z\d.-]+(?::\d+)?\/[a-z\d._/-]+$/u;

/**
 * Validate untrusted proof data into a detached, deeply frozen envelope.
 * Timestamps are audit metadata only: they must be ordered and not in the
 * future, but proof freshness is established by recomputed bound inputs.
 * @param candidate - Untrusted proof candidate
 * @param now - Observation time used only to reject future timestamps
 * @returns Strict immutable proof
 */
// eslint-disable-next-line max-lines-per-function -- exact closed-field validation remains one auditable transaction
export function validateStandardsProof(
  candidate: unknown,
  now: Date = new Date()
): StandardsProof {
  const input = requireStrictRecord(candidate, PROOF_FIELDS, "StandardsProof");
  if (read(input, "schemaVersion") !== STANDARDS_PROOF_SCHEMA_VERSION) {
    throw new Error("Invalid standards proof schemaVersion: expected 1");
  }
  if (read(input, "artifact") !== STANDARDS_PROOF_ARTIFACT) {
    throw new Error("Invalid standards proof artifact identity");
  }
  const lisaVersion = requireText(
    read(input, "lisaVersion"),
    "lisaVersion",
    64
  );
  const registryDigest = requireDigest(
    read(input, "registryDigest"),
    "registryDigest"
  );
  const configDigest = requireDigest(
    read(input, "configDigest"),
    "configDigest"
  );
  const repository = requireRepository(read(input, "repository"));
  const projectTypes = readStrictDenseArray(
    read(input, "projectTypes"),
    1,
    PROJECT_TYPES.length,
    "projectTypes"
  ).map((value, index) =>
    requireClosedString(value, PROJECT_TYPES, `projectTypes[${index}]`)
  );
  if (new Set(projectTypes).size !== projectTypes.length) {
    throw new Error("Invalid projectTypes: entries must be unique");
  }
  const applicableChecks = readStrictDenseArray(
    read(input, "applicableChecks"),
    1,
    MAX_CHECKS,
    "applicableChecks"
  ).map((value, index) =>
    requireBoundedMachineId(value, `applicableChecks[${index}]`, 128)
  );
  if (new Set(applicableChecks).size !== applicableChecks.length) {
    throw new Error("Invalid applicableChecks: entries must be unique");
  }
  const capturedAt = requireCanonicalUtcTimestamp(
    read(input, "capturedAt"),
    "capturedAt"
  );
  if (capturedAt > now.toISOString()) {
    throw new Error("Invalid capturedAt: standards proof is from the future");
  }
  const results = readStrictDenseArray(
    read(input, "results"),
    1,
    MAX_CHECKS,
    "results"
  ).map((value, index) => requireResult(value, index, capturedAt));
  if (
    results.length !== applicableChecks.length ||
    results.some((result, index) => result.check !== applicableChecks[index])
  ) {
    throw new Error(
      "Invalid standards proof results: checks must exactly match applicableChecks"
    );
  }
  return Object.freeze({
    schemaVersion: 1,
    artifact: STANDARDS_PROOF_ARTIFACT,
    lisaVersion,
    registryDigest,
    configDigest,
    repository,
    projectTypes: Object.freeze(projectTypes),
    applicableChecks: Object.freeze(applicableChecks),
    capturedAt,
    results: Object.freeze(results),
  });
}

/**
 * Validate one result row and its bounded, ordered timestamps.
 * @param candidate - Untrusted result candidate
 * @param index - Result position used in validation messages
 * @param capturedAt - Proof capture timestamp that bounds completion
 * @returns Strict immutable result row
 */
function requireResult(
  candidate: unknown,
  index: number,
  capturedAt: string
): StandardsProofResult {
  const input = requireStrictRecord(
    candidate,
    RESULT_FIELDS,
    `results[${index}]`
  );
  const startedAt = requireCanonicalUtcTimestamp(
    read(input, "startedAt"),
    `results[${index}].startedAt`
  );
  const completedAt = requireCanonicalUtcTimestamp(
    read(input, "completedAt"),
    `results[${index}].completedAt`
  );
  if (completedAt < startedAt || completedAt > capturedAt) {
    throw new Error(`Invalid results[${index}] timestamp order`);
  }
  return Object.freeze({
    check: requireBoundedMachineId(
      read(input, "check"),
      `results[${index}].check`,
      128
    ),
    category: requireClosedString(
      read(input, "category"),
      STANDARDS_CHECK_CATEGORIES,
      `results[${index}].category`
    ),
    status: requireClosedString(
      read(input, "status"),
      ["pass"] as const,
      `results[${index}].status`
    ),
    startedAt,
    completedAt,
  });
}

/**
 * Validate the normalized remote identity and exact Git object IDs.
 * @param candidate - Untrusted repository proof candidate
 * @returns Strict immutable repository proof
 */
function requireRepository(candidate: unknown): StandardsRepositoryProof {
  const input = requireStrictRecord(candidate, REPOSITORY_FIELDS, "repository");
  const identity = requireText(
    read(input, "identity"),
    "repository.identity",
    512
  );
  if (!REPOSITORY_IDENTITY.test(identity) || identity.endsWith(".git")) {
    throw new Error(
      "Invalid repository.identity: expected normalized remote identity"
    );
  }
  const head = requireSha(read(input, "head"), "repository.head");
  const tree = requireSha(read(input, "tree"), "repository.tree");
  return Object.freeze({ identity, head, tree });
}

/**
 * Require one SHA-1 or SHA-256 Git object identifier.
 * @param value - Candidate object identifier
 * @param field - Field name used in validation messages
 * @returns Validated object identifier
 */
function requireSha(value: unknown, field: string): string {
  if (typeof value !== "string" || !SHA.test(value)) {
    throw new Error(`Invalid ${field}: expected a Git object identifier`);
  }
  return value;
}

/**
 * Require one prefixed SHA-256 digest.
 * @param value - Candidate digest
 * @param field - Field name used in validation messages
 * @returns Validated digest
 */
function requireDigest(value: unknown, field: string): string {
  if (typeof value !== "string" || !DIGEST.test(value)) {
    throw new Error(`Invalid ${field}: expected sha256 digest`);
  }
  return value;
}

/**
 * Require compact printable scalar text.
 * @param value - Candidate scalar
 * @param field - Field name used in validation messages
 * @param maximumBytes - Maximum UTF-8 byte length
 * @returns Validated text
 */
function requireText(
  value: unknown,
  field: string,
  maximumBytes: number
): string {
  if (
    typeof value !== "string" ||
    value.trim() !== value ||
    value.length === 0 ||
    Buffer.byteLength(value, "utf8") > maximumBytes ||
    hasUnsafeTextCharacter(value)
  ) {
    throw new Error(`Invalid ${field}: expected bounded text`);
  }
  return value;
}
