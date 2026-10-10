// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/** Fixed historical-origin and fresh-recovery roles preserve ordinary v1 authority. */
import {
  verifyHistoricalProvider,
  verifyRecoveryProvider,
  verifyAssignable,
} from "./github-attestation-provider.mjs";
import { boundedSpawnSync } from "./bounded-spawn.mjs";
import { withProvenancePhase } from "./npm-update-invariants.mjs";
import {
  requireProof,
  verifiedRole,
  matchSigningTime,
  officialResult,
  PROPOSAL_PREDICATE,
  RECOVERY_PREDICATE,
} from "./github-attestation-verifier.mjs";

/** An active run's update is not completion; invalid provider chronology has no usable bounds. */
export function observedRunChronology(run, now) {
  const start = Date.parse(run.run_started_at);
  const updated = Date.parse(run.updated_at);
  if (
    ![now, start, updated].every(Number.isFinite) ||
    !["in_progress", "completed"].includes(run.status) ||
    start > updated ||
    updated > now + 60_000
  )
    return null;
  return { start, end: run.status === "in_progress" ? now : updated };
}

/** Historical origin authenticates bytes only within witnessed provider chronology. */
export function assertHistoricalAttestation(
  results,
  descriptor,
  digest,
  policy,
  run,
  claim,
  now = Date.now()
) {
  const result = verifiedRole(
    results,
    descriptor,
    digest,
    policy,
    PROPOSAL_PREDICATE,
    "descriptor.json"
  );
  const chronology = observedRunChronology(run, now);
  const claimed = Date.parse(claim.created_at);
  requireProof(
    chronology && Number.isFinite(claimed),
    "missing/invalid historical provider chronology"
  );
  const { start, end } = chronology;
  // Official signature/timestamp verification already authenticates these times.
  matchSigningTime(
    result.verifiedTimestamps,
    { ...policy, maxAgeSeconds: Number.MAX_SAFE_INTEGER },
    now
  );
  for (const time of result.verifiedTimestamps) {
    const signed = Date.parse(time.timestamp);
    requireProof(
      signed >= start - 60_000 &&
        signed >= claimed - 60_000 &&
        signed <= end + 60_000,
      "origin signed outside provider chronology"
    );
  }
  return result.signature.certificate;
}

const RECOVERY_KEYS = [
  "version",
  "purpose",
  "repository",
  "repositoryId",
  "ownerId",
  "queue",
  "workItem",
  "proposalKey",
  "bindingKey",
  "npmPolicySha256",
  "automationPolicySha256",
  "originDescriptorSha256",
  "originRunId",
  "originRunAttempt",
  "commit",
  "parent",
  "tree",
  "messageSha256",
  "claimCommentId",
  "claimSha256",
  "leafBodySha256",
  "branch",
  "expectedBranchHead",
  "prNumber",
  "expectedPrHead",
  "runId",
  "runAttempt",
];

/** Closed recovery fields bind fresh permission to one unchanged origin. */
export function validateRecovery(value, origin, digest, policy) {
  requireProof(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.keys(value).sort().join("\n") ===
        [...RECOVERY_KEYS].sort().join("\n"),
    "recovery fields differ"
  );
  const expected = {
    version: 1,
    purpose: "resume-identical-npm-proposal",
    repository: policy.repository,
    repositoryId: policy.repositoryId,
    ownerId: policy.ownerId,
    queue: origin.queue,
    workItem: origin.workItem,
    bindingKey: origin.proposalKey,
    automationPolicySha256: origin.policySha256,
    originDescriptorSha256: digest,
    originRunId: origin.runId,
    originRunAttempt: origin.runAttempt,
    parent: origin.parent,
    tree: origin.tree,
    messageSha256: origin.messageSha256,
    claimCommentId: origin.claimCommentId,
    claimSha256: origin.claimSha256,
  };
  for (const [key, expectedValue] of Object.entries(expected))
    requireProof(value[key] === expectedValue, `recovery ${key} differs`);
  for (const key of ["proposalKey", "npmPolicySha256", "leafBodySha256"])
    requireProof(/^[a-f0-9]{64}$/.test(value[key]), "invalid recovery digest");
  requireProof(
    /^[a-f0-9]{40}$/.test(value.commit) &&
      value.branch === `lisa/npm-${value.proposalKey}`,
    "invalid recovery destination"
  );
  requireProof(
    [value.runId, value.runAttempt].every(
      item => typeof item === "string" && /^[1-9]\d*$/.test(item)
    ),
    "invalid recovery invocation"
  );
  requireProof(
    value.runId !== origin.runId || value.runAttempt !== origin.runAttempt,
    "recovery repeats origin invocation"
  );
  requireProof(
    value.expectedBranchHead === null ||
      value.expectedBranchHead === value.commit,
    "foreign recovery branch"
  );
  requireProof(
    (value.prNumber === null && value.expectedPrHead === null) ||
      (Number.isSafeInteger(value.prNumber) &&
        value.prNumber > 0 &&
        value.expectedPrHead === value.commit &&
        value.expectedBranchHead === value.commit),
    "partial/foreign recovery PR"
  );
  return value;
}

/** Fresh recovery has its own signed subject and retains ordinary freshness. */
export function assertRecoveryAttestation(
  results,
  recovery,
  digest,
  policy,
  now = Date.now()
) {
  const result = verifiedRole(
    results,
    recovery,
    digest,
    policy,
    RECOVERY_PREDICATE,
    "recovery.json"
  );
  matchSigningTime(result.verifiedTimestamps, policy, now);
  return result.signature.certificate;
}

/** Historical verification cannot be selected by an ordinary-v1 caller flag. */
export function verifyHistoricalDescriptor(
  policy,
  descriptor,
  paths,
  digest,
  run,
  claim,
  execute = boundedSpawnSync
) {
  return assertHistoricalAttestation(
    officialResult(
      policy,
      descriptor,
      paths.descriptor,
      paths.bundle,
      PROPOSAL_PREDICATE,
      execute
    ),
    descriptor,
    digest,
    policy,
    run,
    claim
  );
}

/** Recovery verification uses only its fixed separate private subject and bundle. */
export function verifyRecoveryAttestation(
  policy,
  recovery,
  paths,
  digest,
  execute = boundedSpawnSync
) {
  return assertRecoveryAttestation(
    officialResult(
      policy,
      recovery,
      paths.recovery,
      paths.recoveryBundle,
      RECOVERY_PREDICATE,
      execute
    ),
    recovery,
    digest,
    policy
  );
}

// Compatibility export preserves callers of the fixed local Git construction.
export { predictedCommit } from "./automation-provenance-local.mjs";

/** Both proofs and current live authority are necessary; historical data alone grants nothing. */
export function verifyRecoveryOrigin(
  policy,
  descriptor,
  recovery,
  digest,
  paths,
  scope,
  execute = boundedSpawnSync
) {
  withProvenancePhase("recovery-local", () => {
    validateRecovery(recovery, descriptor, digest, policy);
    for (const key of [
      "npmPolicySha256",
      "proposalKey",
      "leafBodySha256",
      "commit",
    ])
      requireProof(
        recovery[key] === scope[key],
        `current recovery ${key} differs`
      );
    requireProof(
      process.env.GITHUB_RUN_ID === recovery.runId &&
        process.env.GITHUB_RUN_ATTEMPT === recovery.runAttempt,
      "recovery replayed into different current invocation"
    );
  });
  const origin = withProvenancePhase("historical-provider", () =>
    verifyHistoricalProvider(policy, descriptor, execute)
  );
  withProvenancePhase("historical-signature", () =>
    verifyHistoricalDescriptor(
      policy,
      descriptor,
      paths,
      digest,
      origin.run,
      origin.claim,
      execute
    )
  );
  withProvenancePhase("recovery-signature", () =>
    verifyRecoveryAttestation(
      policy,
      recovery,
      paths,
      scope.recoverySha256,
      execute
    )
  );
  withProvenancePhase("recovery-provider", () =>
    verifyRecoveryProvider(
      policy,
      descriptor,
      recovery,
      scope.maintainer,
      execute
    )
  );
  withProvenancePhase("assignable", () =>
    verifyAssignable(policy, scope.maintainer, execute)
  );
}
