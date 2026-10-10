// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/** Authenticated non-AI attribution supplements ordinary tracking and lint gates. */
import {
  predictedCommit,
  verifyRecoveryOrigin,
} from "./lib/github-attestation-recovery.mjs";
import { invokedAsScript } from "./lib/invoked-as-script.mjs";
import {
  withProvenancePhase,
  provenanceFailure,
} from "./lib/npm-update-invariants.mjs";
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
  signedProposalFields,
} from "./lib/automation-provenance-contract.mjs";
import {
  git,
  privateBytes,
  localDescriptor,
  proofSnapshot,
  canonicalContext,
} from "./lib/automation-provenance-local.mjs";
export { canonicalJson } from "./lib/automation-provenance-contract.mjs";

const LOCAL_PROOF = "local-proof";

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
      canonicalJson({
        repository: policy.repository,
        target: "main",
        ecosystem: "npm",
        directory: ".",
        parent: descriptor.parent,
        policySha256: npmPolicySha256,
        updates: descriptor.updates,
        ...signedProposalFields(descriptor),
      })
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

/** Keep unchanged local authorization together without obscuring the canonical phase. */
function verifyLocalProposal(descriptor, messageBytes, reference, policy) {
  localDescriptor(descriptor, messageBytes, reference, policy);
  npmProposal(descriptor, git);
  requireProof(
    descriptor.proposalKey ===
      sha256(
        canonicalJson({
          repository: policy.repository,
          parent: descriptor.parent,
          updates: descriptor.updates,
          ...signedProposalFields(descriptor),
        })
      ),
    "deterministic proposal key differs"
  );
}

/** Final rereads preserve the original mutation checks after all provider verification. */
function verifyFinalSnapshot(
  paths,
  bundleBytes,
  bytes,
  descriptor,
  messageFile,
  reference,
  policy
) {
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
}

/** Verify fixed private proof against the final message, tree, binding and provider. */
export function verifyAutomationProvenance(messageFile) {
  const messageBytes = withProvenancePhase(LOCAL_PROOF, () =>
    privateBytes(messageFile, 65_536, false)
  );
  const message = messageBytes.toString("utf8");
  const reference = withProvenancePhase(LOCAL_PROOF, () =>
    automationReference(message)
  );
  if (!reference) return false;
  const { config, policy } = withProvenancePhase("configuration", () =>
    trustedConfiguration(git)
  );
  const { paths, optional, bytes, bundleBytes, descriptor } =
    withProvenancePhase(LOCAL_PROOF, proofSnapshot);
  withProvenancePhase(LOCAL_PROOF, () =>
    verifyLocalProposal(descriptor, messageBytes, reference, policy)
  );
  withProvenancePhase("verifier", () => assertPinnedVerifier(policy));
  const context = withProvenancePhase("canonical-context", () =>
    canonicalContext(message, config, policy, descriptor)
  );
  return withProvenancePhase("final-proof", () => {
    const recoveryBytes = optional[0]
      ? privateBytes(paths.recovery, 65_536)
      : null;
    const recoveryBundle = optional[0]
      ? privateBytes(paths.recoveryBundle, 1_048_576)
      : null;
    if (recoveryBytes) {
      withProvenancePhase("recovery-local", () =>
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
        )
      );
    } else {
      withProvenancePhase("ordinary-signature", () =>
        verifyDescriptorAttestation(policy, descriptor, paths, sha256(bytes))
      );
      withProvenancePhase("ordinary-provider", () =>
        verifyCurrentProvider(policy, descriptor)
      );
    }
    verifyFinalSnapshot(
      paths,
      bundleBytes,
      bytes,
      descriptor,
      messageFile,
      reference,
      policy
    );
    return true;
  });
}

if (invokedAsScript(import.meta.url)) {
  try {
    const verified = verifyAutomationProvenance(process.argv[2]);
    process.exitCode = verified ? 0 : 10;
  } catch (error) {
    console.error(provenanceFailure(error));
    process.exitCode = 1;
  }
}
