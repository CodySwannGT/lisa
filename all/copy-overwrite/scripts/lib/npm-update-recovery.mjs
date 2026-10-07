// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/**
 * @file npm-update-recovery.mjs
 * @description Durable public bytes survive runner loss without supplying authority.
 * @module npm-updater
 */
import { join } from "node:path";
import { canonicalJson } from "../lisa-automation-provenance.mjs";
import { readBytes, readJson, writeJson } from "./npm-update-process.mjs";
import { authorizeAllocation } from "./npm-update-leaf.mjs";
import {
  sha256,
  verifyDescriptorAttestation,
  verifyCurrentProvider,
} from "./github-attestation-verifier.mjs";
import {
  verifyRecoveryOrigin,
  predictedCommit,
} from "./github-attestation-recovery.mjs";
import { persistCheckpoint } from "./npm-update-checkpoint.mjs";
import { required, validateProposal } from "./npm-update-contract.mjs";

import {
  checkpointComments,
  decodeCheckpoint,
} from "./npm-update-checkpoint.mjs";

/** A new issuer binds current authority to the immutable original artifact and destination. */
export function recoveryRecord(
  proposal,
  allocation,
  preview,
  policy,
  automation,
  issue,
  snapshot
) {
  const d = preview.descriptor;
  return {
    version: 1,
    purpose: "resume-identical-npm-proposal",
    repository: policy.repository,
    repositoryId: automation.repositoryId,
    ownerId: automation.ownerId,
    queue: d.queue,
    workItem: d.workItem,
    proposalKey: proposal.key,
    bindingKey: d.proposalKey,
    npmPolicySha256: proposal.policySha256,
    automationPolicySha256: d.policySha256,
    originDescriptorSha256: sha256(`${canonicalJson(d)}\n`),
    originRunId: d.runId,
    originRunAttempt: d.runAttempt,
    commit: predictedCommit(d, Buffer.from(preview.message)),
    parent: d.parent,
    tree: d.tree,
    messageSha256: d.messageSha256,
    claimCommentId: allocation.claimCommentId,
    claimSha256: allocation.claimSha256,
    leafBodySha256: sha256(issue.body),
    ...snapshot,
    runId: process.env.GITHUB_RUN_ID,
    runAttempt: process.env.GITHUB_RUN_ATTEMPT,
  };
}

/** Complete untrusted chunks can restore missing transport metadata, never authority. */
export function recoverPartialCheckpoint(comments, digest) {
  required(
    Array.isArray(comments) && comments.length <= 2000,
    "partial checkpoint inventory exceeds bound"
  );
  const bodies = comments.filter(comment =>
    comment.body?.startsWith(`[lisa-npm-checkpoint] v1 ${digest} `)
  );
  const chunks = new Map();
  let count;
  for (const { body } of bodies) {
    const match =
      /^\[lisa-npm-checkpoint\] v1 ([a-f0-9]{64}) chunk (0|[1-9]\d*)\/([1-9]\d*) ([a-f0-9]{64})\n([A-Za-z0-9+/]+=*)$/.exec(
        body
      );
    required(
      match && Buffer.byteLength(body) <= 24_576 && match[1] === digest,
      "partial checkpoint chunk differs"
    );
    count ??= Number(match[3]);
    const index = Number(match[2]);
    const bytes = Buffer.from(match[5], "base64");
    required(
      count <= 256 &&
        Number(match[3]) === count &&
        index < count &&
        bytes.length <= 16_384 &&
        bytes.toString("base64") === match[5] &&
        sha256(bytes) === match[4],
      "partial checkpoint bounds or digest differ"
    );
    required(
      !chunks.has(index) || chunks.get(index).equals(bytes),
      "partial checkpoint has differing duplicate chunk"
    );
    chunks.set(index, bytes);
  }
  required(
    count > 0 && chunks.size === count,
    "partial checkpoint has missing original material"
  );
  const bytes = Buffer.concat(
    Array.from({ length: count }, (_, index) => chunks.get(index))
  );
  required(
    bytes.length <= 4_194_304,
    "partial checkpoint exceeds aggregate bound"
  );
  const payload = JSON.parse(
    new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes)
  );
  const complete = checkpointComments(payload, digest).at(-1);
  return decodeCheckpoint([...comments, { body: complete }], digest);
}

/** Unsigned draft bytes aid retry; only the separately verified origin can authorize gates. */
export function locateCheckpoint(comments, proposal, policy) {
  const digests = new Set(
    comments.flatMap(comment => {
      const match =
        /^\[lisa-npm-checkpoint\] v1 ([a-f0-9]{64}) (?:chunk|complete)\b/.exec(
          comment.body ?? ""
        );
      return match && match[1] !== proposal.key ? [match[1]] : [];
    })
  );
  required(digests.size <= 1, "multiple origin checkpoints are preserved");
  const digest = [...digests][0] ?? proposal.key;
  const present = comments.filter(comment =>
    comment.body?.startsWith(`[lisa-npm-checkpoint] v1 ${digest} `)
  );
  const complete = present.some(comment =>
    comment.body.startsWith(`[lisa-npm-checkpoint] v1 ${digest} complete\n`)
  );
  const payload = complete
    ? decodeCheckpoint(comments, digest)
    : present.length
      ? recoverPartialCheckpoint(comments, digest)
      : undefined;
  if (!payload) return undefined;
  const restored = validateProposal(payload.proposal, policy);
  required(
    restored.selectionKey === proposal.selectionKey &&
      restored.parent === proposal.parent,
    "checkpoint selection or base differs"
  );
  const signed = digest !== proposal.key;
  required(
    signed
      ? payload.preview?.descriptor && payload.bundle.length > 0
      : payload.preview === null && payload.bundle === "",
    "checkpoint origin role differs"
  );
  return { payload, digest, signed, complete };
}

export {
  checkpointComments,
  decodeCheckpoint,
  persistCheckpoint,
} from "./npm-update-checkpoint.mjs";

/** Renewal verifies fresh authority against every immutable original identity field. */
function verifyRenewal({
  api,
  preview,
  paths,
  digest,
  proposal,
  issue,
  policy,
}) {
  const recovery = readJson(paths.recovery, 65_536);
  verifyRecoveryOrigin(
    api.policy,
    preview.descriptor,
    recovery,
    digest,
    paths,
    {
      npmPolicySha256: proposal.policySha256,
      proposalKey: proposal.key,
      leafBodySha256: sha256(issue.body),
      commit: predictedCommit(preview.descriptor, Buffer.from(preview.message)),
      maintainer: policy.maintainer,
      recoverySha256: sha256(readBytes(paths.recovery, 65_536)),
    }
  );
}

/** Completion after official issuance is required before ordinary commit construction. */
export async function finalizeAuthorization({
  api,
  output,
  proposal,
  allocation,
  preview,
  policy,
  config,
}) {
  const paths = {
    descriptor: join(output, "descriptor.json"),
    bundle: join(output, "bundle.json"),
    recovery: join(output, "recovery.json"),
    recoveryBundle: join(output, "recovery-bundle.json"),
  };
  const digest = sha256(readBytes(paths.descriptor, 65_536));
  const issue = await authorizeAllocation(
    api,
    proposal,
    allocation,
    policy,
    config
  );
  const mode = readJson(join(output, "authorization.json")).mode;
  if (mode === "recovery") {
    verifyRenewal({ api, preview, paths, digest, proposal, issue, policy });
  } else {
    required(mode === "origin", "unknown authorization role");
    verifyDescriptorAttestation(api.policy, preview.descriptor, paths, digest);
    verifyCurrentProvider(api.policy, preview.descriptor);
    await persistCheckpoint(
      api,
      allocation.number,
      {
        version: 1,
        proposal,
        allocation,
        preview,
        bundle: readBytes(paths.bundle, 1_048_576).toString("utf8"),
      },
      digest,
      () => authorizeAllocation(api, proposal, allocation, policy, config)
    );
  }
  const checkpoint = locateCheckpoint(
    (await api.issue(allocation.number)).comments,
    proposal,
    policy
  );
  required(
    checkpoint?.signed &&
      checkpoint.complete === true &&
      checkpoint.digest === digest &&
      canonicalJson(checkpoint.payload.preview) === canonicalJson(preview) &&
      canonicalJson(checkpoint.payload.proposal) === canonicalJson(proposal),
    "durable original checkpoint differs"
  );
  writeJson(join(output, "checkpoint.json"), {
    version: 1,
    originDescriptorSha256: digest,
    complete: true,
  });
  return { mode, complete: true };
}
