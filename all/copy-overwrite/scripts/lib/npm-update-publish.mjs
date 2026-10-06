// This file is managed by Lisa. Durable changes belong upstream.
/** Durable proof and exact gated raw-object publication. @module npm-updater */
import { canonicalJson } from "../lisa-automation-provenance.mjs";
import {
  sha256,
  verifyDescriptorAttestation,
  verifyCurrentProvider,
} from "./github-attestation-verifier.mjs";
import {
  required,
  validateProposal,
  validateRawCommit,
} from "./npm-update-contract.mjs";
import {
  authorizeAllocation,
  destinationSnapshot,
} from "./npm-update-authorization.mjs";
import { readJson, readBytes, runProcess } from "./npm-update-process.mjs";
import { existsSync } from "node:fs";
import { verifyRecoveryOrigin } from "./github-attestation-recovery.mjs";
import { refTransport, descriptorFor } from "./npm-update-gate.mjs";
import {
  publicationBody,
  assertPublicationPolicy,
  publicationBacklink,
} from "./npm-update-publication.mjs";
export {
  publicationBody,
  assertPublicationPolicy,
  assertPublication,
} from "./npm-update-publication.mjs";

/** Fixed distinct proof slots select origin or recovery; partial authority always refuses. */
function publicationProof(
  api,
  descriptor,
  proof,
  proposal,
  policy,
  issue,
  commit
) {
  required(
    canonicalJson(readJson(proof.descriptor, 65_536)) ===
      canonicalJson(descriptor),
    "publication descriptor bytes differ"
  );
  const digest = sha256(readBytes(proof.descriptor, 65_536));
  const recovery = Boolean(proof.recovery && existsSync(proof.recovery));
  const bundle = Boolean(
    proof.recoveryBundle && existsSync(proof.recoveryBundle)
  );
  required(recovery === bundle, "partial publication recovery authority");
  if (recovery) {
    verifyRecoveryOrigin(
      api.policy,
      descriptor,
      readJson(proof.recovery, 65_536),
      digest,
      proof,
      {
        npmPolicySha256: proposal.policySha256,
        proposalKey: proposal.key,
        leafBodySha256: sha256(issue.body),
        commit: commit.sha,
        maintainer: policy.maintainer,
        recoverySha256: sha256(readBytes(proof.recovery, 65_536)),
      }
    );
  } else {
    verifyDescriptorAttestation(api.policy, descriptor, proof, digest);
    verifyCurrentProvider(api.policy, descriptor);
  }
}

/** Create an absent exact ref only after a second live destination and authority read. */
async function destinationRef(api, proposal, allocation, commit, authorize) {
  const path = `repos/${proposal.repository}`;
  await authorize();
  let snapshot = await destinationSnapshot(
    api,
    proposal,
    allocation,
    commit.sha
  );
  if (snapshot.expectedBranchHead === null) {
    await authorize();
    snapshot = await destinationSnapshot(api, proposal, allocation, commit.sha);
    required(
      snapshot.expectedBranchHead === null && snapshot.prNumber === null,
      "publication destination changed before ref creation"
    );
    const ref = await api.request(`${path}/git/refs`, "POST", {
      ref: `refs/heads/${snapshot.branch}`,
      sha: commit.sha,
    });
    required(
      ref.ref === `refs/heads/${snapshot.branch}` &&
        ref.object?.type === "commit" &&
        ref.object.sha === commit.sha,
      "published ref differs"
    );
    snapshot = await destinationSnapshot(api, proposal, allocation, commit.sha);
    required(
      snapshot.expectedBranchHead === commit.sha,
      "published ref readback differs"
    );
  }
  return snapshot;
}

/** Resume the exact owned ref/PR and repair only its supported managed backlink. */
export async function publishDestination({
  api,
  cwd,
  proposal,
  allocation,
  commit,
  authorize,
}) {
  const snapshot = await destinationRef(
    api,
    proposal,
    allocation,
    commit,
    authorize
  );
  const path = `repos/${proposal.repository}`;
  let pr;
  if (snapshot.prNumber === null) {
    await authorize();
    const current = await destinationSnapshot(
      api,
      proposal,
      allocation,
      commit.sha
    );
    required(
      current.prNumber === null,
      "publication PR appeared before creation"
    );
    pr = await api.request(`${path}/pulls`, "POST", {
      title: allocation.draft.title,
      head: snapshot.branch,
      base: "main",
      body: publicationBody(allocation),
    });
  } else pr = await api.request(`${path}/pulls/${snapshot.prNumber}`);
  const readback = await destinationSnapshot(
    api,
    proposal,
    allocation,
    commit.sha
  );
  required(
    readback.prNumber === pr.number &&
      pr.base?.sha === proposal.parent &&
      pr.user?.type === "Bot" &&
      pr.user.login === "github-actions[bot]",
    "actual publisher identity or immutable PR base differs"
  );
  await publicationBacklink(
    { api, cwd, proposal, allocation, commit, authorize },
    pr
  );
  return {
    status: "published-awaiting-review",
    number: pr.number,
    url: pr.html_url,
    commit: commit.sha,
    base: proposal.parent,
    publisher: pr.user.login,
  };
}

/** The publisher consumes signed/gated data and writes only an identical two-file commit. */
export async function publishProposal({
  api,
  proposal,
  policy,
  config,
  allocation,
  descriptor,
  proof,
  receipt,
  raw,
  cwd,
}) {
  validateProposal(proposal, policy);
  const commit = validateRawCommit(raw, descriptor, cwd);
  required(
    descriptor.parent === proposal.parent &&
      descriptor.proposalKey === proposal.bindingKey &&
      canonicalJson(descriptor.files) === canonicalJson(proposal.hashes) &&
      canonicalJson(descriptor.updates) === canonicalJson(proposal.updates) &&
      descriptor.workItem === allocation.workItem &&
      descriptor.claimCommentId === allocation.claimCommentId,
    "signed proposal allocation differs"
  );
  required(
    receipt.commit === commit.sha &&
      receipt.tree === descriptor.tree &&
      receipt.parent === proposal.parent &&
      receipt.proposalKey === proposal.key &&
      receipt.commitExit === 0 &&
      receipt.pushExit === 0,
    "ordinary gate receipt differs"
  );
  refTransport(`lisa/npm-${proposal.key}`, commit.sha, receipt.refs);
  required(
    receipt.remote === `https://github.com/${policy.repository}.git` &&
      canonicalJson(receipt.range) === canonicalJson([commit.sha]),
    "gated transport range differs"
  );
  const authorize = async () => {
    const issue = await authorizeAllocation(
      api,
      proposal,
      allocation,
      policy,
      config
    );
    await destinationSnapshot(api, proposal, allocation, commit.sha);
    publicationProof(api, descriptor, proof, proposal, policy, issue, commit);
    return issue;
  };
  await authorize();
  assertPublicationPolicy(
    await api.request(`repos/${policy.repository}/actions/permissions/workflow`)
  );
  await publicationObjects(
    cwd,
    proposal,
    policy,
    config,
    allocation,
    descriptor,
    raw,
    commit
  );
  await api.gitCommit(proposal, descriptor, commit, authorize, cwd);
  return publishDestination({
    api,
    cwd,
    proposal,
    allocation,
    commit,
    authorize,
  });
}

/** Reconstruct local objects as Git data so the original validator reads the complete range. */
export async function publicationObjects(
  cwd,
  proposal,
  policy,
  config,
  allocation,
  descriptor,
  raw,
  commit
) {
  const preview = await descriptorFor({
    cwd,
    proposal,
    policy,
    automation: config.automationProvenance,
    allocation,
    runId: descriptor.runId,
    runAttempt: descriptor.runAttempt,
    epoch: Number(descriptor.author.split(" ").at(-2)),
  });
  required(
    canonicalJson(preview.descriptor) === canonicalJson(descriptor),
    "publisher original object reconstruction differs"
  );
  const result = await runProcess(
    "git",
    ["hash-object", "-t", "commit", "-w", "--stdin"],
    {
      cwd,
      env: {
        PATH: process.env.PATH,
        HOME: "/nonexistent",
        GIT_TERMINAL_PROMPT: "0",
      },
      input: raw,
    }
  );
  required(
    result.stdout.toString().trim() === commit.sha,
    "publisher local raw object differs"
  );
}
