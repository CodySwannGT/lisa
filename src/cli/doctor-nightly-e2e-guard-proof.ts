/**
 * @file doctor-nightly-e2e-guard-proof.ts
 * @description Non-executing provenance and contract proof for active targets
 * @module cli/doctor-nightly-e2e-guard-proof
 */
import { createHash } from "node:crypto";

import {
  NIGHTLY_E2E_GUARD_BEHAVIOR_CERTIFICATES,
  NIGHTLY_E2E_GUARD_CERTIFICATE_SCHEMA_VERSION,
} from "../core/nightly-e2e-guard-behavior-certificate.js";
import type { HashLedger } from "../core/lisa-owned-provenance.js";
import {
  MAX_NIGHTLY_GUARD_FILE_BYTES,
  NIGHTLY_GUARD_TARGET_TIMEOUT_MS,
  type NightlyGuardProbeResult,
} from "./doctor-nightly-e2e-guard-contract.js";
import {
  createNightlyGuardDeadline,
  limitNightlyGuardDeadline,
  nightlyGuardTargetDeadlineReason,
  type NightlyGuardDeadline,
} from "./doctor-nightly-e2e-guard-deadline.js";
import { readNightlyGuardFile } from "./doctor-nightly-e2e-guard-io.js";

const VERSION = /^1\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;

/** One digest whose actual Lisa package handler passed the behavior suite. */
export interface NightlyGuardBehaviorCertificate {
  /** Major-1 contract emitted by the behavior-proven handler. */
  readonly contractVersion: string;
}

/** Exact digest lookup; target paths never broaden certificate authority. */
export type NightlyGuardBehaviorCertificates = Readonly<
  Record<string, NightlyGuardBehaviorCertificate>
>;

/** Optional proof collaborators for ledger and deadline bite controls. */
export interface NightlyGuardProofDependencies {
  /** Behavior-proven exact digests; tests may inject a precise certificate. */
  readonly certificates?: NightlyGuardBehaviorCertificates;
  /** Legacy compatibility seam; generic ownership hashes grant no authority. */
  readonly ledger?: HashLedger;
  /** Whole-operation deadline, narrowed to the target ceiling here. */
  readonly deadline?: NightlyGuardDeadline;
  /** Standalone target ceiling override for deterministic tests. */
  readonly timeoutMs?: number;
  /** Monotonic clock for standalone proof tests. */
  readonly now?: () => number;
}

/**
 * Lower-case sha256 used as non-executing shipped provenance.
 * @param bytes - Safely captured target bytes
 * @returns Lower-case SHA-256 hex digest
 */
export const digestNightlyGuardBytes = (bytes: Buffer): string =>
  createHash("sha256").update(bytes).digest("hex");

/**
 * Prove a target by bounded no-follow hash and an exact behavior certificate.
 *
 * The target is deliberately never imported, spawned, or evaluated. A caller
 * can therefore retain direct invocation while doctor itself grants untrusted
 * bytes no filesystem, process, environment, or network capability.
 * @param projectRoot - Project root forming the containment boundary
 * @param target - Literal project-relative JavaScript file
 * @param dependencies - Optional ledger/deadline collaborators
 * @returns Compatible major-1 version, or an explicit failed proof
 */
export async function proveNightlyE2eGuardTarget(
  projectRoot: string,
  target: string,
  dependencies: NightlyGuardProofDependencies = {}
): Promise<NightlyGuardProbeResult> {
  const outer =
    dependencies.deadline ??
    createNightlyGuardDeadline(
      dependencies.now,
      dependencies.timeoutMs ?? NIGHTLY_GUARD_TARGET_TIMEOUT_MS,
      nightlyGuardTargetDeadlineReason(
        dependencies.timeoutMs ?? NIGHTLY_GUARD_TARGET_TIMEOUT_MS
      )
    );
  const deadline = dependencies.deadline
    ? limitNightlyGuardDeadline(
        outer,
        dependencies.timeoutMs ?? NIGHTLY_GUARD_TARGET_TIMEOUT_MS
      )
    : outer;
  const read = await readNightlyGuardFile(
    projectRoot,
    target,
    MAX_NIGHTLY_GUARD_FILE_BYTES,
    deadline
  );
  if (read.state !== "ok") {
    return { state: "failure", reason: read.reason };
  }
  const digest = digestNightlyGuardBytes(read.bytes);
  const certificates: NightlyGuardBehaviorCertificates =
    dependencies.certificates ?? NIGHTLY_E2E_GUARD_BEHAVIOR_CERTIFICATES;
  const certificate = certificates[digest];
  if (certificate === undefined) {
    return {
      state: "failure",
      reason:
        "target bytes are not in Lisa's nightly guard behavior certificate; doctor refuses to execute untrusted JavaScript—upgrade Lisa and apply its exact guard",
    };
  }
  if (
    NIGHTLY_E2E_GUARD_CERTIFICATE_SCHEMA_VERSION !== 1 ||
    !VERSION.test(certificate.contractVersion)
  ) {
    return {
      state: "failure",
      reason: "nightly guard behavior certificate is malformed or incompatible",
    };
  }
  return { state: "compatible", version: certificate.contractVersion };
}
