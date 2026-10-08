// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/** A manual cancellation is a third fixed signing purpose, never publication or review authority. */
import { canonicalJson } from "../lisa-automation-provenance.mjs";
import { required, keys, FILES, OBJECT } from "./npm-update-contract.mjs";
import { observedRunChronology } from "./github-attestation-recovery.mjs";
import {
  verifiedRole,
  matchSigningTime,
  officialResult,
  sha256,
} from "./github-attestation-verifier.mjs";

export const CANCELLATION_PREDICATE =
  "https://lisa.dev/attestations/npm-cancellation/v1";
const DIGEST = /^[a-f0-9]{64}$/;
const DECIMAL = /^[1-9]\d*$/;
const RECORD_KEYS = [
  "version",
  "purpose",
  "repository",
  "repositoryId",
  "ownerId",
  "selectionKey",
  "workItem",
  "oldProposalKey",
  "oldParent",
  "parent",
  "proposalKey",
  "proposalHashes",
  "originDescriptorSha256",
  "originCheckpointSha256",
  "claimCommentId",
  "claimSha256",
  "leafBodySha256",
  "policySha256",
  "npmPolicySha256",
  "maintainer",
  "operatorId",
  "runId",
  "runAttempt",
  "destination",
];

/** Manual intent comes from the provider's actual run and collaborator, not a comment or environment assertion. */
export function assertManualCancellation(
  run,
  permission,
  policy,
  maintainer,
  proposal,
  request,
  invocation
) {
  keys(request, ["number", "proposalKey", "parent"]);
  keys(invocation, ["runId", "runAttempt"]);
  required(
    Number.isSafeInteger(request.number) &&
      request.number > 0 &&
      typeof request.proposalKey === "string" &&
      DIGEST.test(request.proposalKey) &&
      request.parent === proposal.parent &&
      OBJECT.test(request.parent),
    "invalid exact cancellation intent"
  );
  required(
    [invocation.runId, invocation.runAttempt].every(
      value => typeof value === "string" && DECIMAL.test(value)
    ) &&
      String(run.id) === invocation.runId &&
      String(run.run_attempt) === invocation.runAttempt &&
      run.event === "workflow_dispatch" &&
      policy.allowedTriggers?.includes("workflow_dispatch") &&
      run.status === "in_progress" &&
      run.head_sha === proposal.parent &&
      run.head_branch === "main" &&
      run.path === policy.callerWorkflow.slice(policy.repository.length + 1) &&
      String(run.head_repository?.id) === policy.repositoryId &&
      Array.isArray(run.referenced_workflows) &&
      run.referenced_workflows.some(
        workflow =>
          workflow.path?.split("@")[0] === policy.signerWorkflow &&
          workflow.sha === policy.signerDigest
      ),
    "cancellation requires the actual manual main invocation"
  );
  const actor = run.triggering_actor;
  required(
    actor?.type === "User" &&
      actor.login === maintainer &&
      [actor.id, permission.user?.id].every(id =>
        typeof id === "string"
          ? DECIMAL.test(id)
          : Number.isSafeInteger(id) && id > 0
      ) &&
      permission.user?.type === "User" &&
      permission.user.login === maintainer &&
      String(permission.user.id) === String(actor.id) &&
      ["write", "admin"].includes(permission.permission),
    "cancellation requires the configured operator's current repository authority"
  );
  return String(actor.id);
}

/** The closed subject preserves one stale origin and one exact replacement, with no published destination. */
export function validateCancellation(value, expected) {
  keys(value, RECORD_KEYS);
  keys(
    value.proposalHashes,
    Object.hasOwn(expected.proposalHashes, "bun.lock")
      ? ["bun.lock", ...FILES]
      : FILES
  );
  keys(value.destination, ["branch", "expectedBranchHead", "prNumber"]);
  required(
    value.version === 1 &&
      value.purpose === "cancel-stale-prepublication-npm-proposal" &&
      typeof value.repository === "string" &&
      /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value.repository) &&
      typeof value.maintainer === "string" &&
      /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(value.maintainer) &&
      typeof value.oldParent === "string" &&
      typeof value.parent === "string" &&
      OBJECT.test(value.oldParent) &&
      OBJECT.test(value.parent) &&
      value.oldParent !== value.parent &&
      value.oldProposalKey !== value.proposalKey &&
      typeof value.workItem === "string" &&
      value.workItem.startsWith(`${value.repository}#`) &&
      DECIMAL.test(value.workItem.slice(value.repository.length + 1)),
    "invalid stale cancellation scope"
  );
  required(
    [
      "repositoryId",
      "ownerId",
      "claimCommentId",
      "operatorId",
      "runId",
      "runAttempt",
    ].every(
      key => typeof value[key] === "string" && DECIMAL.test(value[key])
    ) &&
      [
        "selectionKey",
        "oldProposalKey",
        "proposalKey",
        "originDescriptorSha256",
        "originCheckpointSha256",
        "claimSha256",
        "leafBodySha256",
        "policySha256",
        "npmPolicySha256",
      ].every(
        key => typeof value[key] === "string" && DIGEST.test(value[key])
      ) &&
      Object.values(value.proposalHashes).every(
        hash => typeof hash === "string" && DIGEST.test(hash)
      ),
    "invalid cancellation identity or digest"
  );
  required(
    value.destination.branch === `lisa/npm-${value.oldProposalKey}` &&
      value.destination.expectedBranchHead === null &&
      value.destination.prNumber === null &&
      canonicalJson(value) === canonicalJson(expected),
    "cancellation subject or prepublication destination differs"
  );
  return value;
}

/** A durable cancellation still proves its own actual manual operator; completion is not fresh publication authority. */
export function assertRecordedOperator(run, permission, policy, record) {
  required(
    ["in_progress", "completed"].includes(run.status) &&
      String(run.id) === record.runId &&
      String(run.run_attempt) === record.runAttempt &&
      run.event === "workflow_dispatch" &&
      policy.allowedTriggers?.includes("workflow_dispatch") &&
      run.head_sha === record.parent &&
      run.head_branch === "main" &&
      run.path === policy.callerWorkflow.slice(policy.repository.length + 1) &&
      String(run.head_repository?.id) === policy.repositoryId &&
      run.triggering_actor?.type === "User" &&
      run.triggering_actor.login === record.maintainer &&
      String(run.triggering_actor.id) === record.operatorId &&
      permission.user?.type === "User" &&
      permission.user.login === record.maintainer &&
      String(permission.user.id) === record.operatorId &&
      ["write", "admin"].includes(permission.permission) &&
      Array.isArray(run.referenced_workflows) &&
      run.referenced_workflows.some(
        workflow =>
          workflow.path?.split("@")[0] === policy.signerWorkflow &&
          workflow.sha === policy.signerDigest
      ),
    "recorded cancellation operator or invocation differs"
  );
}

/** The same fixed constructor is used before issuance and after independent provider verification. */
export function cancellationRecord(
  origin,
  proposal,
  config,
  invocation,
  operatorId
) {
  const authority = config.automationProvenance;
  return {
    version: 1,
    purpose: "cancel-stale-prepublication-npm-proposal",
    repository: proposal.repository,
    repositoryId: authority.repositoryId,
    ownerId: authority.ownerId,
    selectionKey: proposal.selectionKey,
    workItem: origin.allocation.workItem,
    oldProposalKey: origin.proposal.key,
    oldParent: origin.proposal.parent,
    parent: proposal.parent,
    proposalKey: proposal.key,
    proposalHashes: proposal.hashes,
    originDescriptorSha256: origin.checkpoint.digest,
    originCheckpointSha256: sha256(canonicalJson(origin.checkpoint.payload)),
    claimCommentId: origin.allocation.claimCommentId,
    claimSha256: origin.allocation.claimSha256,
    leafBodySha256: sha256(origin.allocation.draft.body),
    policySha256: sha256(canonicalJson(authority)),
    npmPolicySha256: proposal.policySha256,
    maintainer: config.npmUpdater.maintainer,
    operatorId,
    runId: invocation.runId,
    runAttempt: invocation.runAttempt,
    destination: {
      branch: `lisa/npm-${origin.proposal.key}`,
      expectedBranchHead: null,
      prNumber: null,
    },
  };
}

/** Fresh cancellation always uses its fixed subject, predicate and ordinary expiration. */
export function assertCancellationAttestation(
  results,
  record,
  digest,
  policy,
  now = Date.now()
) {
  const result = verifiedRole(
    results,
    record,
    digest,
    policy,
    CANCELLATION_PREDICATE,
    "cancellation.json"
  );
  matchSigningTime(result.verifiedTimestamps, policy, now);
  return result.signature.certificate;
}

/** A recorded cancellation authenticates historical bytes within the actual provider run chronology. */
export function assertRecordedCancellation(
  results,
  record,
  digest,
  policy,
  run,
  now = Date.now()
) {
  const result = verifiedRole(
    results,
    record,
    digest,
    policy,
    CANCELLATION_PREDICATE,
    "cancellation.json"
  );
  const chronology = observedRunChronology(run, now);
  required(chronology, "invalid cancellation provider chronology");
  const { start, end } = chronology;
  matchSigningTime(
    result.verifiedTimestamps,
    { ...policy, maxAgeSeconds: Number.MAX_SAFE_INTEGER },
    now
  );
  for (const time of result.verifiedTimestamps) {
    const signed = Date.parse(time.timestamp);
    required(
      signed >= start - 60_000 && signed <= end + 60_000,
      "cancellation signed outside provider chronology"
    );
  }
  return result.signature.certificate;
}

/** Both fixed roles run the same official binary and cancellation-only subject/predicate. */
function cancellationResult(policy, record, paths) {
  return officialResult(
    policy,
    record,
    paths.cancellation,
    paths.cancellationBundle,
    CANCELLATION_PREDICATE
  );
}

/** Verification never substitutes an operator's ambient GH binary for the immutable Linux policy. */
export function verifyCancellationAttestation(policy, record, paths, digest) {
  return assertCancellationAttestation(
    cancellationResult(policy, record, paths),
    record,
    digest,
    policy
  );
}

/** This fixed historical entry point grants no current publication authority. */
export function verifyRecordedCancellation(policy, record, paths, digest, run) {
  return assertRecordedCancellation(
    cancellationResult(policy, record, paths),
    record,
    digest,
    policy,
    run
  );
}
