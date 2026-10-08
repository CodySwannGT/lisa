// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/** Cancellation reads immutable old authority without granting that authority to new bytes. */
import { join } from "node:path";
import { writeFileSync } from "node:fs";
import { canonicalJson } from "../lisa-automation-provenance.mjs";
import {
  required,
  keys,
  OBJECT,
  validatePolicy,
  validateProposal,
} from "./npm-update-contract.mjs";
import {
  runProcess,
  withPrivateRoot,
  writeJson,
} from "./npm-update-process.mjs";
import { decodeCheckpoint } from "./npm-update-checkpoint.mjs";
import {
  buildDraft,
  historicalFiling,
  inspectLeaf,
  inspectCancelledLeaf,
  qualityGates,
} from "./npm-update-leaf.mjs";
import { sha256 } from "./github-attestation-verifier.mjs";
import { verifyStaleOriginProvider } from "./github-attestation-provider.mjs";
import {
  observedRunChronology,
  verifyHistoricalDescriptor,
} from "./github-attestation-recovery.mjs";
import {
  DESCRIPTOR_KEYS,
  optionalLockFields,
} from "./automation-provenance-contract.mjs";

/** Only complete, digest-checked transport is considered; incomplete chunks grant nothing. */
export function completeCheckpoints(comments) {
  required(
    Array.isArray(comments) && comments.length <= 2000,
    "checkpoint inventory exceeds bound"
  );
  const digests = new Set();
  for (const comment of comments) {
    const match = /^\[lisa-npm-checkpoint\] v1 ([a-f0-9]{64}) complete\n/.exec(
      comment.body ?? ""
    );
    if (match) digests.add(match[1]);
  }
  required(digests.size <= 100, "completed checkpoint inventory exceeds bound");
  return [...digests].map(digest => ({
    digest,
    payload: decodeCheckpoint(comments, digest),
  }));
}

/** Named committed objects, never ignored config or candidate paths, select historical authority. */
export async function committedCancellationConfig(cwd, parent) {
  required(
    typeof parent === "string" && OBJECT.test(parent),
    "invalid committed cancellation parent"
  );
  const result = await runProcess(
    "git",
    ["show", `${parent}:.lisa.config.json`],
    {
      cwd,
      env: {
        PATH: process.env.PATH,
        HOME: "/nonexistent",
        GIT_TERMINAL_PROMPT: "0",
      },
      maximum: 1_048_576,
    }
  );
  const config = JSON.parse(result.stdout.toString());
  required(
    config.automationProvenance?.enabled === true,
    "original committed authority is disabled"
  );
  validatePolicy(config.npmUpdater, config);
  required(
    config.automationProvenance.repository === config.npmUpdater.repository,
    "original committed authority repository differs"
  );
  return config;
}

/** One original signed checkpoint is required, even if an unsigned filing or cancellation is present. */
function originCheckpoint(issue) {
  const origins = completeCheckpoints(issue.comments).filter(
    ({ payload }) => payload.preview?.descriptor
  );
  required(
    origins.length === 1 && origins[0].payload.bundle.length > 0,
    "complete original signed checkpoint is missing or ambiguous"
  );
  return origins[0];
}

/** Original chunk bytes must be the unedited Bot's posts during its witnessed run, not later copied markers. */
export function assertOriginTransport(
  comments,
  digest,
  policy,
  run,
  now = Date.now()
) {
  const chronology = observedRunChronology(run, now);
  required(chronology, "invalid original transport chronology");
  const { start, end } = chronology;
  const selected = comments.filter(comment =>
    comment.body?.startsWith(`[lisa-npm-checkpoint] v1 ${digest} `)
  );
  required(selected.length > 0, "original transport is missing");
  for (const comment of selected) {
    const posted = Date.parse(comment.created_at);
    required(
      comment.user?.type === "Bot" &&
        String(comment.user.id) === policy.claimActorId &&
        comment.updated_at === comment.created_at &&
        Number.isFinite(posted) &&
        posted >= start - 60_000 &&
        posted <= end + 60_000,
      "original checkpoint was edited, copied or posted by a foreign actor"
    );
  }
}

/** Original claim, body, policy and proposal are checked separately from current authority. */
async function inspectOrigin(api, issue, payload, oldConfig, currentConfig) {
  const policy = validatePolicy(oldConfig.npmUpdater, oldConfig);
  const proposal = validateProposal(payload.proposal, policy);
  const allocation = payload.allocation;
  keys(allocation, [
    "number",
    "workItem",
    "claimCommentId",
    "claimSha256",
    "draft",
    "evidence",
    "quality",
  ]);
  const evidence = historicalFiling(issue);
  const draft = buildDraft(proposal, policy, oldConfig, evidence);
  required(
    canonicalJson(allocation.evidence) === canonicalJson(evidence) &&
      canonicalJson(allocation.draft) === canonicalJson(draft) &&
      allocation.number === issue.number &&
      allocation.workItem === `${policy.repository}#${issue.number}`,
    "original allocation differs"
  );
  // The current qualified classifier checks present holds; historical config only supplies the original draft.
  const state = await (
    issue.state === "open" ? inspectLeaf : inspectCancelledLeaf
  )(issue, draft, policy, currentConfig);
  required(
    state.claimed &&
      !state.unassigned &&
      state.claims.length === 1 &&
      String(state.claims[0].id) === allocation.claimCommentId &&
      sha256(state.claims[0].body) === allocation.claimSha256 &&
      String(state.claims[0].user?.id) === api.policy.claimActorId &&
      state.claims[0].user?.type === "Bot",
    "original managed claim changed"
  );
  qualityGates(
    { ...draft, body: issue.body, title: issue.title },
    proposal,
    policy,
    oldConfig,
    evidence
  );
  return { policy, proposal, allocation };
}

/** Descriptor fields preserve the complete original immutable proposal and claim. */
export function originalDescriptor(checkpoint, old, allocation, authority) {
  const preview = checkpoint.payload.preview;
  keys(preview, ["descriptor", "message", "epoch"]);
  const d = preview.descriptor;
  keys(d, [...DESCRIPTOR_KEYS, ...optionalLockFields(old)]);
  required(
    d.version === 1 &&
      d.parent === old.parent &&
      d.queue === old.repository &&
      d.workItem === allocation.workItem &&
      d.claimCommentId === allocation.claimCommentId &&
      d.claimSha256 === allocation.claimSha256 &&
      d.proposalKey === old.bindingKey &&
      d.policySha256 === sha256(canonicalJson(authority)) &&
      canonicalJson(d.files) === canonicalJson(old.hashes) &&
      d.bunLockSha256 === old.bunLockSha256 &&
      canonicalJson(d.updates) === canonicalJson(old.updates) &&
      typeof preview.message === "string" &&
      sha256(preview.message) === d.messageSha256 &&
      checkpoint.digest === sha256(`${canonicalJson(d)}\n`),
    "original descriptor differs"
  );
  return d;
}

/** The original fixed signing purpose and native transport chronology remain mandatory. */
async function verifyOriginalSubject(checkpoint, authority, d, issue, parent) {
  await withPrivateRoot(async root => {
    const paths = {
      descriptor: join(root, "descriptor.json"),
      bundle: join(root, "bundle.json"),
    };
    writeJson(paths.descriptor, d);
    required(
      Buffer.byteLength(checkpoint.payload.bundle) <= 1_048_576,
      "origin bundle exceeds bound"
    );
    writeFileSync(paths.bundle, checkpoint.payload.bundle, {
      mode: 0o600,
      flag: "wx",
    });
    const observed = verifyStaleOriginProvider(authority, d, parent);
    assertOriginTransport(
      issue.comments,
      checkpoint.digest,
      authority,
      observed.run
    );
    verifyHistoricalDescriptor(
      authority,
      d,
      paths,
      checkpoint.digest,
      observed.run,
      observed.claim
    );
  });
}

/** Proof reads use the actual original pin and original run, while live main remains the replacement parent. */
export async function authenticateStaleOrigin({
  api,
  cwd,
  issue,
  proposal,
  config,
}) {
  await api.main(proposal.parent);
  const checkpoint = originCheckpoint(issue);
  const old = checkpoint.payload.proposal;
  required(
    old.parent !== proposal.parent &&
      old.selectionKey === proposal.selectionKey,
    "origin is not this stale selection"
  );
  const oldConfig = await committedCancellationConfig(cwd, old.parent);
  const authority = oldConfig.automationProvenance;
  required(
    [
      "repository",
      "repositoryId",
      "ownerId",
      "claimActorId",
      "ghExecutable",
      "ghSha256",
    ].every(key => authority[key] === api.policy[key]),
    "original and current repository/transport identity differs"
  );
  const inspected = await inspectOrigin(
    api,
    issue,
    checkpoint.payload,
    oldConfig,
    config
  );
  const manifest = await runProcess(
    "git",
    ["show", `${old.parent}:package.json`],
    {
      cwd,
      env: {
        PATH: process.env.PATH,
        HOME: "/nonexistent",
        GIT_TERMINAL_PROMPT: "0",
      },
      maximum: 1_048_576,
    }
  );
  required(
    canonicalJson(JSON.parse(manifest.stdout.toString())) ===
      canonicalJson(old.before),
    "original committed manifest differs"
  );
  const d = originalDescriptor(
    checkpoint,
    old,
    inspected.allocation,
    authority
  );
  await verifyOriginalSubject(checkpoint, authority, d, issue, proposal.parent);
  return { ...inspected, checkpoint, oldConfig, descriptor: d };
}
