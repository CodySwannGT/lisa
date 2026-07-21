/* eslint-disable jsdoc/require-jsdoc, sonarjs/cognitive-complexity, sonarjs/no-duplicate-string -- ordered fail-closed freshness reasons stay explicit for operators */
/** Read-only setup.standards proof validation and freshness recomputation. */
import { getPackageVersion } from "../cli/version.js";
import { readConfinedDetectedStacks } from "../cli/ui-detected-stacks.js";
import { readConfinedMergedConfig } from "../cli/ui-confined-project-read.js";
import type { SetupReadinessFinding } from "../cli/ui-setup-readiness-contract.js";
import { setupFinding } from "../cli/ui-setup-readiness-contract.js";
import { readStandardsGitState } from "./git-state.js";
import { resolveStandardsCheckPlan } from "./registry.js";
import { readStandardsProof } from "./storage.js";

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
// eslint-disable-next-line max-lines-per-function -- ordered fail-closed causes remain operator-auditable together
export async function standardsProofFinding(
  projectRoot: string
): Promise<SetupReadinessFinding> {
  const stored = await readStandardsProof(projectRoot);
  if (stored.status === "missing") {
    return setupFinding(
      "setup.standards",
      "warn",
      "Standards proof is missing. Run lisa standards-proof."
    );
  }
  if (stored.status === "unreadable") {
    return setupFinding(
      "setup.standards",
      "fail",
      `Standards proof is unreadable: ${stored.reason}. Run lisa standards-proof.`
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
  const git = gitObservation.value;
  if (!git.clean) return stale("tracked or nonignored worktree state changed");
  if (git.identity !== proof.repository.identity) {
    return stale("repository identity changed");
  }
  if (git.head !== proof.repository.head) return stale("HEAD changed");
  if (git.tree !== proof.repository.tree) return stale("Git tree changed");
  const stackObservation = await observeCurrentInput(
    async () => await readConfinedDetectedStacks(git.root),
    OBSERVATION_REASONS.stacks
  );
  if (stackObservation.status === "unavailable")
    return stackObservation.finding;
  const projectTypes = stackObservation.value;
  const configObservation = await observeCurrentInput(
    async () => await readConfinedMergedConfig(git.root),
    OBSERVATION_REASONS.config
  );
  if (configObservation.status === "unavailable")
    return configObservation.finding;
  const config = configObservation.value;
  const planObservation = await observeCurrentInput(
    async () => await resolveStandardsCheckPlan(git.root, projectTypes, config),
    OBSERVATION_REASONS.plan
  );
  if (planObservation.status === "unavailable") return planObservation.finding;
  const plan = planObservation.value;
  try {
    if (JSON.stringify(projectTypes) !== JSON.stringify(proof.projectTypes)) {
      return stale("detected project types changed");
    }
    if (plan.configDigest !== proof.configDigest) {
      return stale("Lisa configuration changed");
    }
    if (plan.registryDigest !== proof.registryDigest) {
      return stale("standards registry changed");
    }
    const expected = plan.checks.map(check => check.id);
    if (JSON.stringify(expected) !== JSON.stringify(proof.applicableChecks)) {
      return stale("required check membership changed");
    }
    if (
      proof.results.some(
        (result, index) =>
          result.check !== plan.checks[index]?.id ||
          result.category !== plan.checks[index]?.category ||
          result.status !== "pass"
      )
    ) {
      return stale("required check results are incomplete");
    }
    return setupFinding(
      "setup.standards",
      "pass",
      "Managed standards and automated lint, analysis, test, guardrail, and threshold conformance are current for this Git artifact."
    );
  } catch {
    return observationFailed(OBSERVATION_REASONS.generic);
  }
}

function stale(cause: string): SetupReadinessFinding {
  return setupFinding(
    "setup.standards",
    "warn",
    `Standards proof is stale: ${cause}. Run lisa standards-proof.`
  );
}

function observationFailed(reason: string): SetupReadinessFinding {
  return setupFinding(
    "setup.standards",
    "warn",
    `Standards proof freshness could not be established: ${reason}. Run lisa standards-proof.`
  );
}

type CurrentInputObservation<T> =
  | { readonly status: "available"; readonly value: T }
  | { readonly status: "unavailable"; readonly finding: SetupReadinessFinding };

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
/* eslint-enable jsdoc/require-jsdoc, sonarjs/cognitive-complexity, sonarjs/no-duplicate-string -- restore repository defaults */
