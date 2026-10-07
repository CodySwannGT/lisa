// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/** Current-head checks and human approval retain their real integration and reviewer identities. @module npm-updater */
import { workItemLines } from "../lisa-work-item.mjs";
import { required } from "./npm-update-contract.mjs";
import {
  sha256,
  verifyDescriptorAttestation,
  verifyCurrentProvider,
} from "./github-attestation-verifier.mjs";
import { canonicalJson } from "../lisa-automation-provenance.mjs";
import { readJson, readBytes } from "./npm-update-process.mjs";
import { existsSync } from "node:fs";
import { verifyRecoveryOrigin } from "./github-attestation-recovery.mjs";

/** Fixed distinct proof slots select origin or recovery; partial authority always refuses. */
export function publicationProof(
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

/** The publisher consumes evidence of the actual ordinary commit and both original hook streams. */
export function ordinaryGateReceipt(
  context,
  object,
  hook,
  streams,
  destination,
  remote
) {
  return {
    raw: object.raw.toString("base64"),
    receipt: {
      version: 1,
      proposalKey: context.proposal.key,
      parent: context.proposal.parent,
      tree: context.preview.descriptor.tree,
      commit: object.head,
      commitExit: object.committed.code,
      pushExit: streams.destination.exit,
      refs: streams.destination.refs,
      audit: streams.audit,
      destination: streams.destination,
      destinationHead: destination.expectedBranchHead,
      remote,
      range: object.ranges,
      hookSha256: hook.sourceSha256,
      hookManager: hook.manager,
      hookSource: hook.source,
      hookWrapperSha256: hook.wrapperSha256,
      commitLogSha256: sha256(
        Buffer.concat([object.committed.stdout, object.committed.stderr])
      ),
      pushLogSha256: streams.destination.logSha256,
    },
  };
}

/** Original writer commands retain independent current authorization at each boundary. */
export async function publicationBacklink(
  { api, cwd, proposal, allocation, commit, authorize, controller },
  pr
) {
  await authorize();
  await api.workItem(
    cwd,
    ["backlink", "--ref", allocation.workItem, "--pr-url", pr.html_url],
    { ...controller, proposal, allocation, commit, pr }
  );
  await authorize();
  await api.workItem(
    cwd,
    [
      "validate-pr",
      "--base",
      proposal.parent,
      "--head",
      commit.sha,
      "--pr-number",
      String(pr.number),
      "--repo",
      proposal.repository,
      "--pr-url",
      pr.html_url,
    ],
    { ...controller, proposal, allocation, commit, pr }
  );
}

/** A fixed snapshot refuses foreign existing refs or PRs before any mutation. */
export async function destinationSnapshot(api, proposal, allocation, commit) {
  const branch = `lisa/npm-${proposal.key}`;
  const ref = await api.maybe(
    `repos/${proposal.repository}/git/ref/heads/${branch}`
  );
  required(
    !ref ||
      (ref.ref === `refs/heads/${branch}` &&
        ref.object?.type === "commit" &&
        ref.object.sha === commit),
    "foreign proposal branch is preserved"
  );
  const pulls = await api.list(
    `repos/${proposal.repository}/pulls?state=all&head=${encodeURIComponent(`${proposal.repository.split("/")[0]}:${branch}`)}`
  );
  required(pulls.length <= 1, "ambiguous proposal PRs are preserved");
  const pr = pulls[0];
  if (pr)
    required(
      ref &&
        Number.isSafeInteger(pr.number) &&
        pr.number > 0 &&
        pr.html_url ===
          `https://github.com/${proposal.repository}/pull/${pr.number}` &&
        pr.state === "open" &&
        pr.head?.sha === commit &&
        pr.head?.ref === branch &&
        pr.head?.repo?.full_name === proposal.repository &&
        pr.base?.ref === "main" &&
        pr.base?.repo?.full_name === proposal.repository &&
        pr.body === publicationBody(allocation),
      "foreign/closed/changed proposal PR is preserved"
    );
  return {
    branch,
    expectedBranchHead: ref?.object.sha ?? null,
    prNumber: pr?.number ?? null,
    expectedPrHead: pr?.head.sha ?? null,
  };
}

/** The declaration is complete and the relationship waits for postmerge verification. */
export function publicationBody(allocation) {
  const body = `${allocation.draft.body}\nWork-Item: ${allocation.workItem}\n\nRelates to https://github.com/${allocation.workItem.replace("#", "/issues/")}\n`;
  const closing = [
    ...body.matchAll(/\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+/gi),
  ];
  const references = [
    /^#[1-9]\d*\b/,
    /^[\w.-]+\/[\w.-]+#[1-9]\d*\b/,
    /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/issues\/[1-9]\d*\b/,
  ];
  required(
    !closing.some(match =>
      references.some(expression =>
        expression.test(body.slice(match.index + match[0].length))
      )
    ),
    "premature closing relationship is forbidden"
  );
  const declaredReferences = workItemLines(body);
  required(
    declaredReferences.length === 1 &&
      declaredReferences[0] === allocation.workItem,
    "complete PR declaration differs"
  );
  return body;
}

/** Default Actions policy may forbid creation; activation belongs to the operator. */
export function assertPublicationPolicy(value) {
  required(
    value.can_approve_pull_request_reviews === true,
    "Actions pull-request creation is disabled; explicitly activate repository Actions PR creation before retrying"
  );
}

/** Current-head success and real human approval cannot be supplied by stale/skip records. */
export function assertPublication(pr, checks, reviews, sha, requirements = []) {
  required(
    pr.state === "open" && pr.head?.sha === sha && pr.base?.ref === "main",
    "current-head PR differs"
  );
  required(
    checks.length > 0 && requirements.length > 0,
    "required current-head checks are not qualified"
  );
  required(
    requirements.every(requirement =>
      successfulCheck(checks, requirement, sha)
    ),
    "required current-head checks are incomplete"
  );
  const latest = new Map();
  for (const review of [...reviews].sort((left, right) => left.id - right.id))
    if (review.user?.type === "User") latest.set(review.user.id, review);
  required(
    ![...latest.values()].some(
      review => review.state === "CHANGES_REQUESTED"
    ) &&
      [...latest.values()].some(
        review => review.state === "APPROVED" && review.commit_id === sha
      ),
    "genuine current-head human approval is pending"
  );
}

/** The newest run from the exact required integration must succeed on this head. */
function successfulCheck(checks, requirement, sha) {
  required(
    requirement &&
      typeof requirement.name === "string" &&
      Number.isSafeInteger(requirement.appId) &&
      requirement.appId > 0,
    "required check integration identity is unresolved"
  );
  const matches = checks.filter(
    check =>
      check.name === requirement.name &&
      check.app?.id === requirement.appId &&
      check.head_sha === sha
  );
  required(
    matches.every(check => Number.isSafeInteger(check.id) && check.id > 0) &&
      new Set(matches.map(check => check.id)).size === matches.length,
    "ambiguous current check execution"
  );
  const latest = matches.sort((left, right) => right.id - left.id)[0];
  return latest?.status === "completed" && latest.conclusion === "success";
}
