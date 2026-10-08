// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/** Authenticated non-AI attribution supplements ordinary tracking and lint gates. */
import {
  predictedCommit,
  verifyRecoveryOrigin,
} from "./lib/github-attestation-recovery.mjs";
import { invokedAsScript } from "./lib/invoked-as-script.mjs";
import {
  assertPinnedVerifier,
  requireProof,
  sha256,
  verifyCurrentProvider,
  verifyDescriptorAttestation,
} from "./lib/github-attestation-verifier.mjs";
import {
  canonicalJson,
  trustedConfiguration,
  npmProposal,
} from "./lib/automation-provenance-contract.mjs";
import {
  git,
  privateBytes,
  localDescriptor,
  proofSnapshot,
  canonicalContext,
} from "./lib/automation-provenance-local.mjs";
export { canonicalJson } from "./lib/automation-provenance-contract.mjs";

/** A present but malformed reference is a failure, even with ordinary AI trailers. */
export function automationReference(message) {
  const lines = message
    .split(/\r?\n/)
    .filter(line => /^\s*Automation-Provenance\s*:/i.test(line));
  if (lines.length === 0) return undefined;
  requireProof(lines.length === 1, "ambiguous automation reference");
  const match =
    /^Automation-Provenance: actions\/([1-9]\d*)\/attempts\/([1-9]\d*)$/.exec(
      lines[0]
    );
  requireProof(Boolean(match), "malformed automation reference");
  return { runId: match[1], runAttempt: match[2] };
}

/**
 * The optional Bun-lock binding a proposal carries, spelled once.
 *
 * A proposal that rewrites `bun.lock` binds the original lock digest into both
 * of its keys. Every place that derives or re-derives a key spreads this, so a
 * verifier cannot recompute a key from fewer fields than the producer signed.
 * Absent stays absent, so npm-only proposals keep their existing keys.
 * @param {{ bunLockSha256?: string }} value A proposal or descriptor.
 * @returns {{ bunLockSha256?: string }} The binding to spread, or nothing.
 */
export function lockBinding(value) {
  return Object.hasOwn(value, "bunLockSha256")
    ? { bunLockSha256: value.bunLockSha256 }
    : {};
}

/**
 * The deterministic binding key: the hook-signed `descriptor.proposalKey`.
 * @param {string} repository Repository slug.
 * @param {{ parent: string, updates: object[], bunLockSha256?: string }} value Proposal fields.
 * @returns {string} sha256 hex digest.
 */
export function npmBindingKey(repository, value) {
  return sha256(
    canonicalJson({
      repository,
      parent: value.parent,
      updates: value.updates,
      ...lockBinding(value),
    })
  );
}

/**
 * The full proposal identity whose digest is the recovery `proposalKey`.
 * @param {string} repository Repository slug.
 * @param {string} target Target branch.
 * @param {string} policySha256 Digest of the canonical npm updater policy.
 * @param {{ parent: string, updates: object[], bunLockSha256?: string }} value Proposal fields.
 * @returns {{ repository: string, target: string, ecosystem: string, directory: string, parent: string, policySha256: string, updates: any[], bunLockSha256?: string }} The identity, in the producer's field order.
 */
export function npmProposalIdentity(repository, target, policySha256, value) {
  return {
    repository,
    target,
    ecosystem: "npm",
    directory: ".",
    parent: value.parent,
    policySha256,
    updates: value.updates,
    ...lockBinding(value),
  };
}

/** Fresh recovery is a fixed separate role; original proof never acquires current authority. */
function recoveryPermission(
  policy,
  descriptor,
  context,
  config,
  bytes,
  paths,
  recoveryBytes,
  recoveryBundle,
  messageBytes
) {
  const recovery = JSON.parse(recoveryBytes.toString("utf8"));
  requireProof(
    recoveryBytes.toString("utf8") === `${canonicalJson(recovery)}\n`,
    "noncanonical/duplicate recovery fields"
  );
  const npmPolicySha256 = sha256(canonicalJson(config.npmUpdater));
  verifyRecoveryOrigin(policy, descriptor, recovery, sha256(bytes), paths, {
    npmPolicySha256,
    proposalKey: sha256(
      canonicalJson(
        npmProposalIdentity(
          policy.repository,
          config.npmUpdater.target,
          npmPolicySha256,
          descriptor
        )
      )
    ),
    leafBodySha256: sha256(context.issue.body),
    commit: predictedCommit(descriptor, messageBytes),
    maintainer: config.npmUpdater.maintainer,
    recoverySha256: sha256(recoveryBytes),
  });
  requireProof(
    privateBytes(paths.recovery, 65_536).equals(recoveryBytes) &&
      privateBytes(paths.recoveryBundle, 1_048_576).equals(recoveryBundle),
    "recovery proof changed during verification"
  );
}

/** Verify fixed private proof against the final message, tree, binding and provider. */
export function verifyAutomationProvenance(messageFile) {
  const messageBytes = privateBytes(messageFile, 65_536, false);
  const message = messageBytes.toString("utf8");
  const reference = automationReference(message);
  if (!reference) return false;
  const { config, policy } = trustedConfiguration(git);
  const { paths, optional, bytes, bundleBytes, descriptor } = proofSnapshot();
  localDescriptor(descriptor, messageBytes, reference, policy);
  npmProposal(descriptor, git);
  requireProof(
    descriptor.proposalKey === npmBindingKey(policy.repository, descriptor),
    "deterministic proposal key differs"
  );
  assertPinnedVerifier(policy);
  const context = canonicalContext(message, config, policy, descriptor);
  const recoveryBytes = optional[0]
    ? privateBytes(paths.recovery, 65_536)
    : null;
  const recoveryBundle = optional[0]
    ? privateBytes(paths.recoveryBundle, 1_048_576)
    : null;
  if (recoveryBytes) {
    recoveryPermission(
      policy,
      descriptor,
      context,
      config,
      bytes,
      paths,
      recoveryBytes,
      recoveryBundle,
      messageBytes
    );
  } else {
    verifyDescriptorAttestation(policy, descriptor, paths, sha256(bytes));
    verifyCurrentProvider(policy, descriptor);
  }
  requireProof(
    privateBytes(paths.bundle, 1_048_576).equals(bundleBytes),
    "origin bundle changed during verification"
  );
  requireProof(
    privateBytes(paths.descriptor, 65_536).equals(bytes),
    "descriptor changed during verification"
  );
  localDescriptor(
    descriptor,
    privateBytes(messageFile, 65_536, false),
    reference,
    policy
  );
  return true;
}

if (invokedAsScript(import.meta.url)) {
  try {
    const verified = verifyAutomationProvenance(process.argv[2]);
    process.exitCode = verified ? 0 : 10;
  } catch {
    console.error(
      "Invalid automation provenance: required proof, policy or provider evidence failed"
    );
    process.exitCode = 1;
  }
}
