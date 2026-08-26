/**
 * @file doctor-nightly-e2e-guard.ts
 * @description Read-only doctor verdict for active bounded nightly bypass guards
 * @module cli/doctor-nightly-e2e-guard
 */
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import type { HashLedger } from "../core/lisa-owned-provenance.js";
import type { DoctorCheck } from "./doctor.js";
import {
  NIGHTLY_GUARD_OPERATION_TIMEOUT_MS,
  type NightlyGuardCaller,
  type NightlyGuardProbeResult,
  type NightlyGuardScanResult,
} from "./doctor-nightly-e2e-guard-contract.js";
import {
  createNightlyGuardDeadline,
  NightlyGuardDeadlineError,
  type NightlyGuardDeadline,
  withinNightlyGuardDeadline,
} from "./doctor-nightly-e2e-guard-deadline.js";
import {
  proveNightlyE2eGuardTarget,
  type NightlyGuardProofDependencies,
} from "./doctor-nightly-e2e-guard-proof.js";
import { nightlyGuardRemediation } from "./doctor-nightly-e2e-guard-remediation.js";
import {
  scanNightlyE2eGuardCallers,
  type NightlyGuardScanDependencies,
} from "./doctor-nightly-e2e-guard-scan.js";

/** Stable doctor row name shared by human and JSON output. */
export const NIGHTLY_GUARD_CHECK_NAME = "Nightly E2E bypass guard bounded?";

/** Injected read-only collaborators for deterministic deadline/provenance tests. */
export interface NightlyGuardDependencies {
  /** Installed Lisa root, for package-copy remediation classification. */
  readonly lisaRoot?: string;
  /** Known shipped hashes, injectable for provenance bite controls. */
  readonly ledger?: HashLedger;
  /** Monotonic clock started before discovery. */
  readonly now?: () => number;
  /** Discovery seam used to prove the outer deadline includes scanning. */
  readonly scanImpl?: (
    projectRoot: string,
    dependencies?: NightlyGuardScanDependencies
  ) => Promise<NightlyGuardScanResult>;
  /** Static target proof seam used to prove target deduplication. */
  readonly probeImpl?: (
    projectRoot: string,
    target: string,
    dependencies?: NightlyGuardProofDependencies
  ) => Promise<NightlyGuardProbeResult>;
  /** Target ceiling override used only by deterministic tests. */
  readonly timeoutMs?: number;
}

const defaultLisaRoot = (): string =>
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const displayError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const deadlineFailure = (reason: string): DoctorCheck => ({
  name: NIGHTLY_GUARD_CHECK_NAME,
  status: "fail",
  detail: `Guard proof unavailable: ${reason} across discovery, target proof, and remediation.`,
});

const discoveryFailure = (
  scan: Extract<NightlyGuardScanResult, { state: "unavailable" }>
): DoctorCheck => {
  const facts = scan.failures
    .map(failure => `${failure.workflow}: ${failure.reason}`)
    .join("; ");
  return {
    name: NIGHTLY_GUARD_CHECK_NAME,
    status: "fail",
    detail: `Guard discovery unavailable: ${facts}. Remediation: keep workflow/job names and required-check context, use one literal \`node <relative-guard.js>\` target, then run \`node <relative-guard.js> --contract-version\`.`,
  };
};

const determinateZero = (): DoctorCheck => ({
  name: NIGHTLY_GUARD_CHECK_NAME,
  status: "ok",
  detail:
    "Inspected active workflows: 0 bypass-bearing nightly callers (determinate zero).",
});

/** Target-keyed result used to deduplicate proof from caller attribution. */
interface TargetProof {
  readonly target: string;
  readonly result: NightlyGuardProbeResult;
}

/**
 * Prove distinct targets sequentially so the shared deadline remains exact.
 * @param projectRoot - Project containment root
 * @param targets - Distinct literal target paths
 * @param deadline - Whole-operation deadline
 * @param dependencies - Injected proof collaborators
 * @returns Target-keyed proof results
 */
async function proveTargets(
  projectRoot: string,
  targets: readonly string[],
  deadline: NightlyGuardDeadline,
  dependencies: NightlyGuardDependencies
): Promise<readonly TargetProof[]> {
  const prove = dependencies.probeImpl ?? proveNightlyE2eGuardTarget;
  const proveNext = async (
    index: number,
    prior: readonly TargetProof[]
  ): Promise<readonly TargetProof[]> => {
    const target = targets[index];
    if (target === undefined) return prior;
    if (deadline.expiresAt - deadline.now() <= 0) {
      throw new NightlyGuardDeadlineError(deadline.reason);
    }
    const result = await prove(projectRoot, target, {
      deadline,
      ...(dependencies.ledger ? { ledger: dependencies.ledger } : {}),
      ...(dependencies.timeoutMs ? { timeoutMs: dependencies.timeoutMs } : {}),
    });
    return await proveNext(index + 1, [...prior, { target, result }]);
  };
  return await proveNext(0, []);
}

const successfulFinding = (
  callers: readonly NightlyGuardCaller[],
  results: ReadonlyMap<string, NightlyGuardProbeResult>
): DoctorCheck => {
  const facts = callers.map(caller => {
    const result = results.get(caller.target);
    const version =
      result?.state === "compatible" ? result.version : "unavailable";
    return `${caller.callPath} -> ${caller.target} (${version})`;
  });
  return {
    name: NIGHTLY_GUARD_CHECK_NAME,
    status: "ok",
    detail: `Inspected ${callers.length} bypass-bearing nightly caller(s) and ${results.size} target(s): ${facts.join("; ")}.`,
  };
};

/**
 * Format one failed caller with target proof and exact repair advice.
 * @param caller - Active attributed call path
 * @param result - Deduplicated target proof
 * @param projectRoot - Project containment root
 * @param deadline - Whole-operation deadline
 * @param dependencies - Package/provenance collaborators
 * @returns One operator-readable failure fact
 */
async function failedFact(
  caller: NightlyGuardCaller,
  result: NightlyGuardProbeResult | undefined,
  projectRoot: string,
  deadline: NightlyGuardDeadline,
  dependencies: NightlyGuardDependencies
): Promise<string> {
  const reason =
    result?.state === "failure" ? result.reason : "proof unavailable";
  const version =
    result?.state === "failure" && result.version
      ? ` (reported ${result.version})`
      : "";
  const remediation = await nightlyGuardRemediation({
    projectRoot,
    lisaRoot: dependencies.lisaRoot ?? defaultLisaRoot(),
    caller,
    deadline,
    ...(dependencies.ledger ? { ledger: dependencies.ledger } : {}),
  });
  return `${caller.callPath} -> ${caller.target}: ${reason}${version}. Remediation: ${remediation}`;
}

/**
 * Build deterministic failure facts while retaining every active call path.
 * @param callers - Active caller paths
 * @param results - Deduplicated target proofs
 * @param projectRoot - Project containment root
 * @param deadline - Whole-operation deadline
 * @param dependencies - Package/provenance collaborators
 * @returns Failed doctor row
 */
async function failedFinding(
  callers: readonly NightlyGuardCaller[],
  results: ReadonlyMap<string, NightlyGuardProbeResult>,
  projectRoot: string,
  deadline: NightlyGuardDeadline,
  dependencies: NightlyGuardDependencies
): Promise<DoctorCheck> {
  const failed = callers.filter(
    caller => results.get(caller.target)?.state !== "compatible"
  );
  const facts = await Promise.all(
    failed.map(caller =>
      failedFact(
        caller,
        results.get(caller.target),
        projectRoot,
        deadline,
        dependencies
      )
    )
  );
  return {
    name: NIGHTLY_GUARD_CHECK_NAME,
    status: "fail",
    detail: `Nightly bypass guard contract failed for ${failed.length} caller(s):\n${facts.map(fact => `  - ${fact}`).join("\n")}`,
  };
}

/**
 * Evaluate discovery and static proof under one already-started deadline.
 * @param projectRoot - Project containment root
 * @param deadline - Deadline started before discovery
 * @param dependencies - Read-only collaborators
 * @returns Complete doctor row
 */
async function evaluateNightlyGuard(
  projectRoot: string,
  deadline: NightlyGuardDeadline,
  dependencies: NightlyGuardDependencies
): Promise<DoctorCheck> {
  const scan = await (dependencies.scanImpl ?? scanNightlyE2eGuardCallers)(
    projectRoot,
    { deadline }
  );
  if (deadline.expiresAt - deadline.now() <= 0) {
    throw new NightlyGuardDeadlineError(deadline.reason);
  }
  if (scan.state === "unavailable") return discoveryFailure(scan);
  if (scan.callers.length === 0) return determinateZero();
  const targets = [...new Set(scan.callers.map(caller => caller.target))];
  const proofs = await proveTargets(
    projectRoot,
    targets,
    deadline,
    dependencies
  );
  const results = new Map(proofs.map(proof => [proof.target, proof.result]));
  return proofs.every(proof => proof.result.state === "compatible")
    ? successfulFinding(scan.callers, results)
    : await failedFinding(
        scan.callers,
        results,
        projectRoot,
        deadline,
        dependencies
      );
}

/**
 * Report whether every active bypass-bearing nightly caller runs a trusted,
 * compatible major-1 guard without evaluating any target bytes.
 * @param projectRoot - Project root to inspect without mutation
 * @param dependencies - Optional read-only collaborators for tests
 * @returns Existing `DoctorCheck` shape used by both renderers and exit logic
 */
export async function checkNightlyE2eGuard(
  projectRoot: string,
  dependencies: NightlyGuardDependencies = {}
): Promise<DoctorCheck> {
  const deadline = createNightlyGuardDeadline(
    dependencies.now,
    NIGHTLY_GUARD_OPERATION_TIMEOUT_MS
  );
  try {
    return await withinNightlyGuardDeadline(deadline, () =>
      evaluateNightlyGuard(projectRoot, deadline, dependencies)
    );
  } catch (error) {
    return error instanceof NightlyGuardDeadlineError
      ? deadlineFailure(error.message)
      : {
          name: NIGHTLY_GUARD_CHECK_NAME,
          status: "fail",
          detail: `Guard proof unavailable: ${displayError(error)}.`,
        };
  }
}

/** Backward-compatible name for direct callers of the former executable probe. */
export const probeNightlyE2eGuardTarget = proveNightlyE2eGuardTarget;
export type { NightlyGuardProbeResult } from "./doctor-nightly-e2e-guard-contract.js";
