/**
 * @file doctor-nightly-e2e-guard-contract.ts
 * @description Shared bounds and data contracts for active nightly guard proof
 * @module cli/doctor-nightly-e2e-guard-contract
 */
import * as path from "node:path";

/** Canonical destination installed into host projects. */
export const NIGHTLY_GUARD_CANONICAL_TARGET =
  "scripts/check-nightly-e2e-health.mjs";
/** Canonical guard inside an installed Lisa package. */
export const NIGHTLY_GUARD_SHIPPED_TARGET =
  "typescript/copy-overwrite/scripts/check-nightly-e2e-health.mjs";
/** Workflow inventory root inspected by doctor. */
export const NIGHTLY_GUARD_WORKFLOWS = ".github/workflows";
/** Maximum workflow files inspected by one doctor run. */
export const MAX_NIGHTLY_GUARD_FILES = 256;
/** Maximum active root-to-guard call paths inspected by one doctor run. */
export const MAX_NIGHTLY_GUARD_CALLERS = 64;
/** Maximum distinct scripts proven by one doctor run. */
export const MAX_NIGHTLY_GUARD_TARGETS = 8;
/** Maximum bytes read from any workflow or target file. */
export const MAX_NIGHTLY_GUARD_FILE_BYTES = 1024 * 1024;
/** Maximum workflow bytes read across discovery. */
export const MAX_NIGHTLY_GUARD_TOTAL_BYTES = 8 * 1024 * 1024;
/** Maximum local reusable call depth. */
export const MAX_NIGHTLY_GUARD_LOCAL_DEPTH = 8;
/** Maximum UTF-8 bytes in one workflow filename attribution identifier. */
export const MAX_NIGHTLY_GUARD_WORKFLOW_ID_BYTES = 255;
/** Maximum ASCII bytes in one GitHub job mapping identifier. */
export const MAX_NIGHTLY_GUARD_JOB_ID_BYTES = 100;
/** Maximum bytes retained across all caller-attribution fields. */
export const MAX_NIGHTLY_GUARD_ATTRIBUTION_BYTES = 3 * 1024;
/** Maximum bytes emitted in this doctor row's human/JSON detail. */
export const MAX_NIGHTLY_GUARD_DETAIL_BYTES = 4 * 1024;
/** Maximum time allocated to one static target proof. */
export const NIGHTLY_GUARD_TARGET_TIMEOUT_MS = 2_000;
/** Maximum time allocated to discovery, proof, and remediation together. */
export const NIGHTLY_GUARD_OPERATION_TIMEOUT_MS = 15_000;

/** One active root-to-job path and the literal script it executes. */
export interface NightlyGuardCaller {
  /** Leaf workflow that contains the executable guard job. */
  readonly workflow: string;
  /** Leaf job identifier, which participates in the check context. */
  readonly job: string;
  /** Full root-to-leaf attribution retained even for shared reusables. */
  readonly callPath: string;
  /** Whether the leaf calls Lisa's endpoint or invokes Node itself. */
  readonly kind: "official-reusable" | "direct";
  /** Literal project-relative JavaScript target. */
  readonly target: string;
}

/** One reason discovery could not produce a trustworthy answer. */
export interface NightlyGuardScanFailure {
  /** Workflow involved, or the workflow directory for inventory failures. */
  readonly workflow: string;
  /** Bounded operator-readable refusal. */
  readonly reason: string;
}

/** Discovery distinguishes an examined zero from unavailable evidence. */
export type NightlyGuardScanResult =
  | { readonly state: "ok"; readonly callers: readonly NightlyGuardCaller[] }
  | {
      readonly state: "unavailable";
      readonly failures: readonly NightlyGuardScanFailure[];
    };

/** Parsed workflow retained with its deterministic display path. */
export interface NightlyGuardWorkflowRecord {
  /** Repo-relative path used in findings. */
  readonly file: string;
  /** Basename used by supported local reusable references. */
  readonly name: string;
  /** Parsed YAML mapping. */
  readonly document: Readonly<Record<string, unknown>>;
}

/** Successful trusted contract evidence or a reason no verdict exists. */
export type NightlyGuardProbeResult =
  | { readonly state: "compatible"; readonly version: string }
  | {
      readonly state: "failure";
      readonly reason: string;
      readonly version?: string;
    };

/**
 * Narrow unknown values to YAML-style mappings.
 * @param value - Parsed YAML value
 * @returns Mapping values only; arrays and scalars are refused
 */
export const nightlyGuardObject = (
  value: unknown
): Readonly<Record<string, unknown>> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;

/**
 * Return trimmed YAML strings while refusing coercion.
 * @param value - Parsed YAML value
 * @returns Trimmed literal string or an empty sentinel
 */
export const nightlyGuardText = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

/**
 * Sort ASCII identifiers without locale-dependent ordering.
 * @param values - Identifiers copied before ordering
 * @returns Deterministically ordered copy
 */
export const orderNightlyGuardStrings = <T extends string>(
  values: readonly T[]
): T[] =>
  [...values].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));

const JOB_ID = /^[A-Za-z_][A-Za-z0-9_-]*$/u;

/**
 * Validate the documented GitHub job-id alphabet and Lisa's 100-byte ceiling.
 * @param jobId - YAML `jobs` mapping key used in check attribution
 * @returns Whether the identifier can enter a bounded caller path
 */
export const isNightlyGuardJobId = (jobId: string): boolean =>
  Buffer.byteLength(jobId) <= MAX_NIGHTLY_GUARD_JOB_ID_BYTES &&
  JOB_ID.test(jobId);

/**
 * Count retained attribution bytes, including separators between fields.
 * @param caller - Active caller about to enter doctor output
 * @returns Exact UTF-8 bytes charged to the aggregate attribution budget
 */
export const nightlyGuardCallerAttributionBytes = (
  caller: NightlyGuardCaller
): number =>
  Buffer.byteLength(
    [caller.workflow, caller.job, caller.callPath, caller.target].join("\0")
  );

const TARGET = /^(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+\.(?:js|mjs|cjs)$/u;

/**
 * Normalize a supported literal target without resolving through the host FS.
 * @param candidate - Workflow-provided path token
 * @returns Normalized project-relative path, or undefined for unsupported input
 */
export function normalizeNightlyGuardTarget(
  candidate: string
): string | undefined {
  const relative = candidate.startsWith("./") ? candidate.slice(2) : candidate;
  if (!TARGET.test(relative) || path.posix.isAbsolute(relative)) {
    return undefined;
  }
  const segments = relative.split("/");
  return segments.includes(".") || segments.includes("..")
    ? undefined
    : relative;
}
