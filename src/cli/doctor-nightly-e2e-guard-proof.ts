/**
 * @file doctor-nightly-e2e-guard-proof.ts
 * @description Non-executing provenance and contract proof for active targets
 * @module cli/doctor-nightly-e2e-guard-proof
 */
import { createHash } from "node:crypto";
import { TextDecoder } from "node:util";

import { LISA_OWNED_HASH_LEDGER } from "../core/lisa-owned-hash-ledger.js";
import type { HashLedger } from "../core/lisa-owned-provenance.js";
import {
  MAX_NIGHTLY_GUARD_CONTRACT_BYTES,
  MAX_NIGHTLY_GUARD_FILE_BYTES,
  NIGHTLY_GUARD_CANONICAL_TARGET,
  NIGHTLY_GUARD_TARGET_TIMEOUT_MS,
  type NightlyGuardProbeResult,
} from "./doctor-nightly-e2e-guard-contract.js";
import {
  createNightlyGuardDeadline,
  limitNightlyGuardDeadline,
  type NightlyGuardDeadline,
} from "./doctor-nightly-e2e-guard-deadline.js";
import { readNightlyGuardFile } from "./doctor-nightly-e2e-guard-io.js";

const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;
const DECLARATION =
  /^export const NIGHTLY_E2E_CONTRACT_VERSION = "([^"\r\n]*)";[ \t]*$/gmu;
const UTF8 = new TextDecoder("utf-8", { fatal: true });

/** Optional proof collaborators for ledger and deadline bite controls. */
export interface NightlyGuardProofDependencies {
  /** Lisa-shipped hashes; tests inject one precise fixture digest. */
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
 * Parse the single trusted source declaration without evaluating JavaScript.
 * @param bytes - Bytes already attested by the shipped hash ledger
 * @returns Strict major-1 semantic version or an explicit contract failure
 */
export function readTrustedNightlyGuardVersion(
  bytes: Buffer
): NightlyGuardProbeResult {
  const source = (() => {
    try {
      return UTF8.decode(bytes);
    } catch {
      return undefined;
    }
  })();
  if (source === undefined) {
    return {
      state: "failure",
      reason: "trusted target is not valid UTF-8 source",
    };
  }
  const matches = [...source.matchAll(DECLARATION)];
  if (matches.length !== 1) {
    return {
      state: "failure",
      reason:
        "trusted target must contain one exact NIGHTLY_E2E_CONTRACT_VERSION declaration",
    };
  }
  const declaration = matches[0]?.[0] ?? "";
  if (Buffer.byteLength(declaration) > MAX_NIGHTLY_GUARD_CONTRACT_BYTES) {
    return {
      state: "failure",
      reason: "contract declaration exceeds the 4 KiB capture limit",
    };
  }
  const version = matches[0]?.[1] ?? "";
  const semantic = VERSION.exec(version);
  if (!semantic) {
    return {
      state: "failure",
      reason:
        "contract declaration must contain one exact ASCII semantic version",
    };
  }
  return semantic[1] === "1"
    ? { state: "compatible", version }
    : {
        state: "failure",
        reason: `contract ${version} is incompatible; expected major 1`,
        version,
      };
}

/**
 * Prove a target by bounded no-follow hash and trusted literal inspection.
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
      "2 seconds target proof deadline exhausted"
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
  const ledger = dependencies.ledger ?? LISA_OWNED_HASH_LEDGER;
  if (!(ledger[NIGHTLY_GUARD_CANONICAL_TARGET] ?? []).includes(digest)) {
    return {
      state: "failure",
      reason:
        "target has no Lisa-shipped hash provenance; doctor refuses to execute untrusted JavaScript",
    };
  }
  return readTrustedNightlyGuardVersion(read.bytes);
}
