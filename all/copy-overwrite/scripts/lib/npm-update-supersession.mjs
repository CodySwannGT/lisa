// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/** Authenticated cancellation chains remain finite, exact and separate from ordinary recovery. */
import { canonicalJson } from "../lisa-automation-provenance.mjs";
import { required } from "./npm-update-contract.mjs";
import { validateProposal, keys } from "./npm-update-contract.mjs";
import { join } from "node:path";
import { writeFileSync } from "node:fs";
import { writeJson, withPrivateRoot } from "./npm-update-process.mjs";
import { sha256 } from "./github-attestation-verifier.mjs";
import {
  completeCheckpoints,
  committedCancellationConfig,
  authenticateStaleOrigin,
  assertOriginTransport,
} from "./npm-update-cancel-origin.mjs";
import {
  cancellationRecord,
  validateCancellation,
  assertRecordedOperator,
  verifyRecordedCancellation,
} from "./npm-update-cancellation-proof.mjs";

/** This pure topology function consumes already verified records; it grants no signature or provider authority. */
export function selectSupersession(issues, records, proposal) {
  required(
    issues.length > 0 && issues.length <= 100,
    "supersession inventory exceeds bound"
  );
  const keys = new Map(issues.map(issue => [issue.key, issue]));
  required(keys.size === issues.length, "duplicate proposal keys");
  const active = issues.filter(issue => issue.state === "open");
  required(
    active.length <= 1 && records.size === issues.length - active.length,
    "unverified closure or multiple active proposals"
  );
  const incoming = new Set();
  for (const issue of issues.filter(item => item.state !== "open")) {
    const record = records.get(issue.number);
    required(
      issue.state === "closed" &&
        issue.state_reason === "not_planned" &&
        record?.oldProposalKey === issue.key &&
        record.proposalKey !== issue.key &&
        !incoming.has(record.proposalKey),
      "invalid or forked cancellation chain"
    );
    incoming.add(record.proposalKey);
  }
  const roots = issues.filter(issue => !incoming.has(issue.key));
  required(roots.length === 1, "disconnected or cyclic cancellation chain");
  let cursor = roots[0],
    count = 0,
    last;
  while (cursor.state === "closed") {
    required(++count <= issues.length, "cyclic cancellation chain");
    last = records.get(cursor.number);
    cursor = keys.get(last.proposalKey);
    if (!cursor) break;
  }
  required(
    count === records.size && (!active.length || cursor === active[0]),
    "disconnected cancellation chain"
  );
  if (cursor)
    return {
      status:
        cursor.parent === proposal.parent ? "existing" : "stale-outstanding",
      issue: cursor.issue ?? cursor,
    };
  required(
    last?.proposalKey === proposal.key &&
      last.parent === proposal.parent &&
      canonicalJson(last.proposalHashes) === canonicalJson(proposal.hashes),
    "cancelled replacement no longer matches; preserve the chain"
  );
  return { status: "new", supersession: last };
}

/** Both branch and every historical PR must actually be absent before cancellation or reuse. */
export async function cancellationDestinationAbsent(api, proposalKey) {
  required(
    typeof proposalKey === "string" && /^[a-f0-9]{64}$/.test(proposalKey),
    "invalid cancellation destination"
  );
  const branch = `lisa/npm-${proposalKey}`;
  required(
    (await api.maybe(
      `repos/${api.policy.repository}/git/ref/heads/${branch}`
    )) === null,
    "published branch prevents cancellation"
  );
  const head = encodeURIComponent(
    `${api.policy.repository.split("/")[0]}:${branch}`
  );
  const pulls = await api.list(
    `repos/${api.policy.repository}/pulls?state=all&head=${head}`
  );
  required(pulls.length === 0, "published PR prevents cancellation");
}

/** Checkpoint discovery remains transport-only and refuses unknown complete roles. */
function cancellationCheckpoint(issue) {
  const checkpoints = completeCheckpoints(issue.comments);
  for (const { payload } of checkpoints)
    required(
      payload.preview === null ||
        payload.preview?.descriptor ||
        payload.preview?.cancellation,
      "unknown completed checkpoint role"
    );
  const matches = checkpoints.filter(
    ({ payload }) => payload.preview?.cancellation
  );
  required(matches.length <= 1, "ambiguous completed cancellation records");
  return matches[0];
}

/** Provider operator and official signature independently authenticate the complete historical subject. */
async function verifyRecordedBundle(api, authority, checkpoint, record, issue) {
  const run = await api.request(
    `repos/${record.repository}/actions/runs/${record.runId}/attempts/${record.runAttempt}`
  );
  const permission = await api.request(
    `repos/${record.repository}/collaborators/${record.maintainer}/permission`
  );
  assertRecordedOperator(run, permission, authority, record);
  assertOriginTransport(issue.comments, checkpoint.digest, authority, run);
  await withPrivateRoot(async root => {
    const paths = {
      cancellation: join(root, "cancellation.json"),
      cancellationBundle: join(root, "bundle.json"),
    };
    writeJson(paths.cancellation, record);
    required(
      Buffer.byteLength(checkpoint.payload.bundle) <= 1_048_576,
      "cancellation bundle exceeds bound"
    );
    writeFileSync(paths.cancellationBundle, checkpoint.payload.bundle, {
      mode: 0o600,
      flag: "wx",
    });
    verifyRecordedCancellation(
      authority,
      record,
      paths,
      checkpoint.digest,
      run
    );
  });
}

/** A completion marker is only transport; original authority and a third fixed proof are independently required. */
export async function recordedCancellation({
  api,
  cwd,
  issue,
  proposal,
  config,
  origin,
}) {
  const checkpoint = cancellationCheckpoint(issue);
  if (!checkpoint) return undefined;
  keys(checkpoint.payload.preview, ["cancellation"]);
  const record = checkpoint.payload.preview.cancellation;
  validateCancellation(record, record);
  const historical = await committedCancellationConfig(cwd, record.parent);
  const authority = historical.automationProvenance;
  required(
    [
      "repository",
      "repositoryId",
      "ownerId",
      "claimActorId",
      "ghExecutable",
      "ghSha256",
    ].every(key => authority[key] === api.policy[key]) &&
      historical.npmUpdater.maintainer === config.npmUpdater.maintainer,
    "recorded cancellation authority differs"
  );
  const replacement = validateProposal(
    checkpoint.payload.proposal,
    historical.npmUpdater
  );
  required(
    replacement.selectionKey === proposal.selectionKey,
    "recorded cancellation selection differs"
  );
  const original =
    origin ??
    (await authenticateStaleOrigin({ api, cwd, issue, proposal, config }));
  required(
    canonicalJson(checkpoint.payload.allocation) ===
      canonicalJson(original.allocation),
    "recorded cancellation allocation differs"
  );
  const expected = cancellationRecord(
    original,
    replacement,
    historical,
    record,
    record.operatorId
  );
  validateCancellation(record, expected);
  required(
    checkpoint.digest === sha256(`${canonicalJson(record)}\n`),
    "cancellation subject digest differs"
  );
  await verifyRecordedBundle(api, authority, checkpoint, record, issue);
  await api.main(proposal.parent);
  await cancellationDestinationAbsent(api, record.oldProposalKey);
  if (issue.state === "closed")
    required(
      issue.state_reason === "not_planned" &&
        issue.closed_by?.type === "Bot" &&
        String(issue.closed_by.id) === api.policy.claimActorId,
      "closure is not the authenticated managed cancellation"
    );
  return checkpoint;
}

/** Every closed match must independently authenticate before a finite connected chain is accepted. */
export async function discoverSupersession(
  api,
  proposal,
  found,
  { cwd, config }
) {
  required(
    found.length > 0 && found.length <= 100,
    "supersession search exceeds bound"
  );
  const issues = [],
    records = new Map();
  for (const item of found) {
    const issue = await api.issue(item.number);
    required(
      !issue.pull_request && typeof issue.body === "string",
      "foreign supersession issue"
    );
    const one = (name, pattern) => {
      const values = [
        ...issue.body.matchAll(new RegExp(`^${name}: (${pattern})$`, "gm")),
      ];
      required(values.length === 1, "ambiguous supersession identity");
      return values[0][1];
    };
    required(
      one("Selection key", "[a-f0-9]{64}") === proposal.selectionKey,
      "supersession selection differs"
    );
    issues.push({
      number: issue.number,
      state: issue.state,
      state_reason: issue.state_reason,
      key: one("Proposal key", "[a-f0-9]{64}"),
      parent: one("Base parent", "[a-f0-9]{40}"),
      issue,
    });
    if (issue.state !== "open") {
      const checkpoint = await recordedCancellation({
        api,
        cwd,
        issue,
        proposal,
        config,
      });
      required(checkpoint, "closed leaf lacks authenticated cancellation");
      records.set(issue.number, checkpoint.payload.preview.cancellation);
    }
  }
  return selectSupersession(issues, records, proposal);
}
