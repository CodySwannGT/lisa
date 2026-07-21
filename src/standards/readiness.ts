/** Read-only setup.standards proof validation and freshness recomputation. */
import { getPackageVersion } from "../cli/version.js";
import { readConfinedDetectedStacks } from "../cli/ui-detected-stacks.js";
import { readConfinedMergedConfig } from "../cli/ui-confined-project-read.js";
import type { SetupReadinessFinding } from "../cli/ui-setup-readiness-contract.js";
import { setupFinding } from "../cli/ui-setup-readiness-contract.js";
import type { StandardsProof } from "./contract.js";
import { readStandardsGitState, type StandardsGitState } from "./git-state.js";
import {
  resolveStandardsCheckPlan,
  type StandardsCheckPlan,
} from "./registry.js";
import { readStandardsProof } from "./storage.js";

const STANDARDS_FINDING_ID = "setup.standards";
const PROOF_COMMAND_HINT = "Run lisa standards-proof.";
const OBSERVATION_REASONS = Object.freeze({
  git: "Git repository identity and state could not be observed",
  stacks: "project stack detection could not be completed",
  config: "local Lisa configuration is malformed or unreadable",
  plan: "required standards check plan is incomplete or unavailable",
  generic: "current standards proof inputs could not be observed",
});

/**
 * Validate the stored proof against current Git, stack, config, registry, and
 * Lisa version without executing project commands or writing any state.
 * Strict recomputation rejects casual tampering; defending against a malicious
 * actor who can rewrite both repository inputs and local proof is out of scope.
 * @param projectRoot - Canonical project root
 * @returns setup.standards proof contribution
 */
export async function standardsProofFinding(
  projectRoot: string
): Promise<SetupReadinessFinding> {
  const stored = await readStandardsProof(projectRoot);
  if (stored.status === "missing") {
    return setupFinding(
      STANDARDS_FINDING_ID,
      "warn",
      `Standards proof is missing. ${PROOF_COMMAND_HINT}`
    );
  }
  if (stored.status === "unreadable") {
    return setupFinding(
      STANDARDS_FINDING_ID,
      "fail",
      `Standards proof is unreadable: ${stored.reason}. ${PROOF_COMMAND_HINT}`
    );
  }
  const proof = stored.proof;
  if (proof.lisaVersion !== getPackageVersion()) {
    return stale("Lisa version changed");
  }
  const gitObservation = await observeCurrentInput(
    async () => await readStandardsGitState(projectRoot),
    OBSERVATION_REASONS.git
  );
  if (gitObservation.status === "unavailable") return gitObservation.finding;
  const repositoryCause = repositoryStaleCause(proof, gitObservation.value);
  if (repositoryCause !== undefined) return stale(repositoryCause);
  const observation = await observeCurrentPlanInputs(gitObservation.value);
  if (observation.status === "unavailable") return observation.finding;
  return evaluateProofFreshness(proof, observation.value);
}

/** Current project and standards-plan inputs needed for proof validation. */
interface CurrentPlanInputs {
  readonly projectTypes: Awaited<ReturnType<typeof readConfinedDetectedStacks>>;
  readonly plan: StandardsCheckPlan;
}

/**
 * Observe current project and plan inputs without running quality commands.
 * @param git - Previously validated repository state
 * @returns Available plan inputs or the first fail-closed finding
 */
async function observeCurrentPlanInputs(
  git: StandardsGitState
): Promise<CurrentInputObservation<CurrentPlanInputs>> {
  const stackObservation = await observeCurrentInput(
    async () => await readConfinedDetectedStacks(git.root),
    OBSERVATION_REASONS.stacks
  );
  if (stackObservation.status === "unavailable") return stackObservation;
  const projectTypes = stackObservation.value;
  const configObservation = await observeCurrentInput(
    async () => await readConfinedMergedConfig(git.root),
    OBSERVATION_REASONS.config
  );
  if (configObservation.status === "unavailable") return configObservation;
  const config = configObservation.value;
  const planObservation = await observeCurrentInput(
    async () => await resolveStandardsCheckPlan(git.root, projectTypes, config),
    OBSERVATION_REASONS.plan
  );
  if (planObservation.status === "unavailable") return planObservation;
  return {
    status: "available",
    value: {
      projectTypes,
      plan: planObservation.value,
    },
  };
}

/**
 * Compare a stored proof with freshly observed inputs.
 * @param proof - Strict stored standards proof
 * @param current - Fresh repository and plan inputs
 * @returns Current pass or stale/unavailable finding
 */
function evaluateProofFreshness(
  proof: StandardsProof,
  current: CurrentPlanInputs
): SetupReadinessFinding {
  try {
    const cause = planStaleCause(proof, current);
    if (cause !== undefined) return stale(cause);
    return setupFinding(
      STANDARDS_FINDING_ID,
      "pass",
      "Managed standards and automated lint, analysis, test, guardrail, and threshold conformance are current for this Git artifact."
    );
  } catch {
    return observationFailed(OBSERVATION_REASONS.generic);
  }
}

/**
 * Find the first repository-state mismatch.
 * @param proof - Stored proof
 * @param git - Current repository state
 * @returns Operator-readable stale cause, when present
 */
function repositoryStaleCause(
  proof: StandardsProof,
  git: StandardsGitState
): string | undefined {
  if (!git.clean) return "tracked or nonignored worktree state changed";
  if (git.identity !== proof.repository.identity)
    return "repository identity changed";
  if (git.head !== proof.repository.head) return "HEAD changed";
  if (git.tree !== proof.repository.tree) return "Git tree changed";
  return undefined;
}

/**
 * Find the first project-plan or result mismatch.
 * @param proof - Stored proof
 * @param current - Current project types and standards plan
 * @returns Operator-readable stale cause, when present
 */
function planStaleCause(
  proof: StandardsProof,
  current: CurrentPlanInputs
): string | undefined {
  const { plan, projectTypes } = current;
  if (JSON.stringify(projectTypes) !== JSON.stringify(proof.projectTypes))
    return "detected project types changed";
  if (plan.configDigest !== proof.configDigest)
    return "Lisa configuration changed";
  if (plan.registryDigest !== proof.registryDigest)
    return "standards registry changed";
  const expected = plan.checks.map(check => check.id);
  if (JSON.stringify(expected) !== JSON.stringify(proof.applicableChecks))
    return "required check membership changed";
  if (hasIncompleteResults(proof, plan))
    return "required check results are incomplete";
  return undefined;
}

/**
 * Determine whether any stored result differs from its required check.
 * @param proof - Stored proof
 * @param plan - Current standards check plan
 * @returns Whether required result evidence is incomplete
 */
function hasIncompleteResults(
  proof: StandardsProof,
  plan: StandardsCheckPlan
): boolean {
  return proof.results.some(
    (result, index) =>
      result.check !== plan.checks[index]?.id ||
      result.category !== plan.checks[index]?.category ||
      result.status !== "pass"
  );
}

/**
 * Create a stale-proof warning with the remediation command.
 * @param cause - Operator-readable stale cause
 * @returns Stale standards finding
 */
function stale(cause: string): SetupReadinessFinding {
  return setupFinding(
    STANDARDS_FINDING_ID,
    "warn",
    `Standards proof is stale: ${cause}. ${PROOF_COMMAND_HINT}`
  );
}

/**
 * Create a fail-closed observation warning with the remediation command.
 * @param reason - Sanitized observation failure reason
 * @returns Fail-closed standards finding
 */
function observationFailed(reason: string): SetupReadinessFinding {
  return setupFinding(
    STANDARDS_FINDING_ID,
    "warn",
    `Standards proof freshness could not be established: ${reason}. ${PROOF_COMMAND_HINT}`
  );
}

/** Result of one fail-closed current-input observation. */
type CurrentInputObservation<T> =
  | { readonly status: "available"; readonly value: T }
  | { readonly status: "unavailable"; readonly finding: SetupReadinessFinding };

/**
 * Convert one throwing observation into a fail-closed result.
 * @param operation - Read-only operation to execute
 * @param reason - Sanitized reason to expose if observation fails
 * @returns Available value or sanitized unavailable finding
 */
async function observeCurrentInput<T>(
  operation: () => Promise<T>,
  reason: string
): Promise<CurrentInputObservation<T>> {
  try {
    return { status: "available", value: await operation() };
  } catch {
    return { status: "unavailable", finding: observationFailed(reason) };
  }
}
