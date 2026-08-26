/**
 * @file doctor-nightly-e2e-guard-remediation.ts
 * @description Provenance-aware repair guidance for nightly guard findings
 * @module cli/doctor-nightly-e2e-guard-remediation
 */
import {
  classifyHostCopy,
  type HashLedger,
} from "../core/lisa-owned-provenance.js";
import { LISA_OWNED_HASH_LEDGER } from "../core/lisa-owned-hash-ledger.js";
import {
  MAX_NIGHTLY_GUARD_FILE_BYTES,
  NIGHTLY_GUARD_CANONICAL_TARGET,
  NIGHTLY_GUARD_SHIPPED_TARGET,
  type NightlyGuardCaller,
} from "./doctor-nightly-e2e-guard-contract.js";
import type { NightlyGuardDeadline } from "./doctor-nightly-e2e-guard-deadline.js";
import { readNightlyGuardFile } from "./doctor-nightly-e2e-guard-io.js";
import {
  digestNightlyGuardBytes,
  readTrustedNightlyGuardVersion,
} from "./doctor-nightly-e2e-guard-proof.js";

const exactProbe = (target: string): string =>
  `node ${target} --contract-version`;
const preserveContext =
  "preserve the workflow/job names and required-check context unless a coordinated ruleset migration is planned";

/** Inputs shared by every caller-specific remediation decision. */
export interface NightlyGuardRemediationInput {
  /** Host project under inspection. */
  readonly projectRoot: string;
  /** Installed Lisa package root. */
  readonly lisaRoot: string;
  /** Active caller whose target failed proof. */
  readonly caller: NightlyGuardCaller;
  /** Shared whole-operation deadline. */
  readonly deadline: NightlyGuardDeadline;
  /** Optional shipped provenance fixture. */
  readonly ledger?: HashLedger;
}

const packageUnavailable = (reason: string): string =>
  `repair or reinstall Lisa first: its packaged guard is unreadable or corrupt (${reason}); then run \`lisa apply .\` and \`${exactProbe(NIGHTLY_GUARD_CANONICAL_TARGET)}\``;

/**
 * Produce exact repair guidance without collapsing missing, unreadable, stale,
 * and deliberately modified files into the same destructive instruction.
 * @param input - Caller, package, provenance, and deadline context
 * @returns One bounded operator-readable remediation
 */
export async function nightlyGuardRemediation(
  input: NightlyGuardRemediationInput
): Promise<string> {
  const shipped = await readNightlyGuardFile(
    input.lisaRoot,
    NIGHTLY_GUARD_SHIPPED_TARGET,
    MAX_NIGHTLY_GUARD_FILE_BYTES,
    input.deadline
  );
  if (shipped.state === "missing") {
    return `upgrade first: install Lisa 2.353.0+ on 2.x or, preferably, the current release; then run \`lisa apply .\` and \`${exactProbe(NIGHTLY_GUARD_CANONICAL_TARGET)}\``;
  }
  if (shipped.state === "unavailable") {
    return packageUnavailable(shipped.reason);
  }
  const ledger = input.ledger ?? LISA_OWNED_HASH_LEDGER;
  const shippedDigest = digestNightlyGuardBytes(shipped.bytes);
  if (!(ledger[NIGHTLY_GUARD_CANONICAL_TARGET] ?? []).includes(shippedDigest)) {
    return packageUnavailable("its hash has no Lisa-shipped provenance");
  }
  const shippedContract = readTrustedNightlyGuardVersion(shipped.bytes);
  if (
    shippedContract.state === "failure" &&
    shippedContract.version === undefined
  ) {
    return packageUnavailable(shippedContract.reason);
  }
  if (input.caller.target !== NIGHTLY_GUARD_CANONICAL_TARGET) {
    return `install ${NIGHTLY_GUARD_CANONICAL_TARGET} with \`lisa apply .\`, repoint this job to it, retire ${input.caller.target}, then run \`${exactProbe(NIGHTLY_GUARD_CANONICAL_TARGET)}\`; ${preserveContext}`;
  }

  const host = await readNightlyGuardFile(
    input.projectRoot,
    NIGHTLY_GUARD_CANONICAL_TARGET,
    MAX_NIGHTLY_GUARD_FILE_BYTES,
    input.deadline
  );
  if (host.state === "missing") {
    return `run \`lisa apply .\` to install ${NIGHTLY_GUARD_CANONICAL_TARGET}, then run \`${exactProbe(NIGHTLY_GUARD_CANONICAL_TARGET)}\``;
  }
  if (host.state === "unavailable") {
    return `repair the canonical host path before applying: ${host.reason}; no file was replaced`;
  }
  const verdict = classifyHostCopy(
    NIGHTLY_GUARD_CANONICAL_TARGET,
    host.bytes,
    shipped.bytes,
    ledger
  );
  if (verdict.kind === "identical") {
    return `the failing target is the byte-identical packaged copy; repair, reinstall, or upgrade Lisa, re-run \`lisa apply .\`, then run \`${exactProbe(NIGHTLY_GUARD_CANONICAL_TARGET)}\``;
  }
  if (verdict.kind === "provably-stale") {
    return `this canonical copy is provably stale; run \`lisa apply .\`, then run \`${exactProbe(NIGHTLY_GUARD_CANONICAL_TARGET)}\``;
  }
  return `review the preserved modified canonical guard, then take Lisa's exact copy with \`lisa apply . --refresh-templates=${NIGHTLY_GUARD_CANONICAL_TARGET}\` and run \`${exactProbe(NIGHTLY_GUARD_CANONICAL_TARGET)}\``;
}
