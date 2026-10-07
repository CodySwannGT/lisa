// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/** Trusted allocation retains origin bytes and renews only current recovery authority. */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { canonicalJson } from "../lisa-automation-provenance.mjs";
import { required, keys, validateProposal } from "./npm-update-contract.mjs";
import { writeJson, replaceJson } from "./npm-update-process.mjs";
import { descriptorFor } from "./npm-update-gate.mjs";
import { authorizeAllocation } from "./npm-update-leaf.mjs";
export { authorizeAllocation } from "./npm-update-leaf.mjs";
import { destinationSnapshot } from "./npm-update-publication.mjs";
export { destinationSnapshot } from "./npm-update-publication.mjs";
import { persistCheckpoint, recoveryRecord } from "./npm-update-recovery.mjs";
export { recoveryRecord } from "./npm-update-recovery.mjs";
import { verifyCurrentProvider } from "./github-attestation-verifier.mjs";
import { verifyHistoricalProvider } from "./github-attestation-provider.mjs";
import {
  verifyHistoricalDescriptor,
  predictedCommit,
} from "./github-attestation-recovery.mjs";

/** Serialize only original public filing data, never live operator comments. */
function publicAllocation(allocation) {
  const fields = [
    "number",
    "workItem",
    "claimCommentId",
    "claimSha256",
    "draft",
    "evidence",
    "quality",
  ];
  return Object.fromEntries(fields.map(key => [key, allocation[key]]));
}

/** Restored public bytes are recomputed and officially verified before renewal. */
async function restoredOrigin(
  cwd,
  output,
  proposal,
  allocation,
  policy,
  config
) {
  const origin = allocation.origin;
  const preview = origin.payload.preview;
  keys(preview, ["descriptor", "message", "epoch"]);
  const recomputed = await descriptorFor({
    cwd,
    proposal,
    policy,
    automation: config.automationProvenance,
    allocation,
    runId: preview.descriptor.runId,
    runAttempt: preview.descriptor.runAttempt,
    epoch: preview.epoch,
  });
  required(
    canonicalJson(preview) === canonicalJson(recomputed),
    "restored original artifact differs"
  );
  const paths = {
    descriptor: join(output, "descriptor.json"),
    bundle: join(output, "bundle.json"),
  };
  writeJson(paths.descriptor, preview.descriptor);
  required(
    Buffer.byteLength(origin.payload.bundle) <= 1_048_576,
    "origin bundle exceeds bound"
  );
  writeFileSync(paths.bundle, origin.payload.bundle, {
    mode: 0o600,
    flag: "wx",
  });
  const historical = verifyHistoricalProvider(
    config.automationProvenance,
    preview.descriptor
  );
  verifyHistoricalDescriptor(
    config.automationProvenance,
    preview.descriptor,
    paths,
    origin.digest,
    historical.run,
    historical.claim
  );
  return preview;
}

/** Restore the immutable origin before renewing its separately signed current authority. */
async function recoveryPreview({
  api,
  cwd,
  output,
  proposal,
  allocation,
  original,
  policy,
  config,
  issue,
}) {
  const preview = await restoredOrigin(
    cwd,
    output,
    proposal,
    allocation,
    policy,
    config
  );
  if (!allocation.origin.complete) {
    verifyCurrentProvider(api.policy, {
      ...preview.descriptor,
      runId: process.env.GITHUB_RUN_ID,
      runAttempt: process.env.GITHUB_RUN_ATTEMPT,
    });
    await persistCheckpoint(
      api,
      original.number,
      allocation.origin.payload,
      allocation.origin.digest,
      () => authorizeAllocation(api, proposal, original, policy, config)
    );
  }
  const commit = predictedCommit(
    preview.descriptor,
    Buffer.from(preview.message)
  );
  const snapshot = await destinationSnapshot(api, proposal, original, commit);
  writeJson(
    join(output, "recovery.json"),
    recoveryRecord(
      proposal,
      original,
      preview,
      policy,
      config.automationProvenance,
      issue,
      snapshot
    )
  );
  return preview;
}

/** Public draft storage precedes the first immutable descriptor and prospective commit. */
async function originPreview({
  api,
  cwd,
  output,
  proposal,
  original,
  policy,
  config,
}) {
  await persistCheckpoint(
    api,
    original.number,
    { version: 1, proposal, allocation: original, preview: null, bundle: "" },
    proposal.key,
    () => authorizeAllocation(api, proposal, original, policy, config)
  );
  const preview = await descriptorFor({
    cwd,
    proposal,
    policy,
    automation: config.automationProvenance,
    allocation: original,
    runId: process.env.GITHUB_RUN_ID,
    runAttempt: process.env.GITHUB_RUN_ATTEMPT,
    epoch: Math.floor(Date.now() / 1000),
  });
  const commit = predictedCommit(
    preview.descriptor,
    Buffer.from(preview.message)
  );
  writeJson(
    join(output, "destination.json"),
    await destinationSnapshot(api, proposal, original, commit)
  );
  writeJson(join(output, "descriptor.json"), preview.descriptor);
  return preview;
}

/** Origin creation or recovery preparation occurs only in the trusted allocator. */
export async function prepareAuthorization({
  api,
  cwd,
  output,
  proposal: suppliedProposal,
  allocation,
  policy,
  config,
}) {
  let proposal = suppliedProposal;
  if (allocation.status === "stale-outstanding")
    return { mode: allocation.status, allocation };
  const restored =
    allocation.origin?.payload.proposal ??
    allocation.originalProposal ??
    proposal;
  validateProposal(restored, policy);
  if (canonicalJson(restored) !== canonicalJson(proposal))
    replaceJson(join(output, "proposal.json"), restored);
  proposal = restored;
  const original = publicAllocation(allocation);
  const issue = await authorizeAllocation(
    api,
    proposal,
    original,
    policy,
    config
  );
  const inputs = {
    api,
    cwd,
    output,
    proposal,
    allocation,
    original,
    policy,
    config,
    issue,
  };
  const preview = allocation.origin
    ? await recoveryPreview(inputs)
    : await originPreview(inputs);
  writeJson(join(output, "preview.json"), preview);
  writeJson(join(output, "allocation.json"), original);
  const mode = allocation.origin ? "recovery" : "origin";
  writeJson(join(output, "authorization.json"), { mode });
  return { mode, allocation: original };
}

export { finalizeAuthorization } from "./npm-update-recovery.mjs";
