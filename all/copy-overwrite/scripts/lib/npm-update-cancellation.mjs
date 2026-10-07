// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/** Explicit hosted manual cancellation preserves the old leaf and issues no publication authority. */
import { join } from "node:path";
import { writeFileSync } from "node:fs";
import { canonicalJson } from "../lisa-automation-provenance.mjs";
import { required, keys } from "./npm-update-contract.mjs";
import { readBytes, readJson, writeJson } from "./npm-update-process.mjs";
import { assertHostedGate } from "./npm-update-hosted-gate.mjs";
import { sha256 } from "./github-attestation-verifier.mjs";
import { discoverPrior } from "./npm-update-allocate.mjs";
import { authenticateStaleOrigin } from "./npm-update-cancel-origin.mjs";
import {
  recordedCancellation,
  cancellationDestinationAbsent,
} from "./npm-update-supersession.mjs";
import {
  assertManualCancellation,
  cancellationRecord,
  validateCancellation,
  verifyCancellationAttestation,
} from "./npm-update-cancellation-proof.mjs";
import {
  persistCheckpoint,
  decodeCheckpoint,
} from "./npm-update-checkpoint.mjs";
import { withStage } from "./npm-update-invariants.mjs";

/** Native dispatch bytes are checked independently of reusable workflow input forwarding. */
export function assertDispatchCancellation(event, run, request, authority) {
  required(
    event &&
      ["main", "refs/heads/main"].includes(event.ref) &&
      event.repository?.full_name === authority.repository &&
      String(event.repository.id) === authority.repositoryId &&
      String(event.repository.owner?.id) === authority.ownerId &&
      event.sender?.type === "User" &&
      event.sender.id === run.triggering_actor?.id &&
      event.sender.login === run.triggering_actor.login &&
      event.inputs?.cancel_issue === String(request.number) &&
      event.inputs.cancel_proposal_key === request.proposalKey &&
      event.inputs.cancel_expected_main === request.parent,
    "native manual dispatch intent differs"
  );
}

/** The actual run and repository permission are read through the existing pinned default-token transport. */
async function manualAuthority(api, proposal, config, request) {
  assertHostedGate({ policy: config.npmUpdater, proposal, config });
  const invocation = {
    runId: process.env.GITHUB_RUN_ID,
    runAttempt: process.env.GITHUB_RUN_ATTEMPT,
  };
  required(
    Object.values(invocation).every(
      value => typeof value === "string" && /^[1-9]\d*$/.test(value)
    ),
    "native cancellation invocation is absent"
  );
  await api.main(proposal.parent);
  const run = await api.request(
    `repos/${proposal.repository}/actions/runs/${invocation.runId}/attempts/${invocation.runAttempt}`
  );
  const permission = await api.request(
    `repos/${proposal.repository}/collaborators/${config.npmUpdater.maintainer}/permission`
  );
  const operatorId = assertManualCancellation(
    run,
    permission,
    api.policy,
    config.npmUpdater.maintainer,
    proposal,
    request,
    invocation
  );
  const event = JSON.parse(
    new TextDecoder("utf8", { fatal: true }).decode(
      readBytes(process.env.GITHUB_EVENT_PATH, 1_048_576, false)
    )
  );
  assertDispatchCancellation(event, run, request, api.policy);
  return { invocation, operatorId };
}

/** Named stale origins are never substituted by a closed implementation ticket or another active leaf. */
async function cancellationState(context) {
  const { api, cwd, proposal, config, request } = context;
  const manual = await withStage("cancel-intent", () =>
    manualAuthority(api, proposal, config, request)
  );
  const prior = await discoverPrior(api, proposal, { cwd, config });
  const issue = await api.issue(request.number);
  const origin = await withStage("cancel-origin", () =>
    authenticateStaleOrigin({ api, cwd, issue, proposal, config })
  );
  required(
    origin.proposal.key === request.proposalKey,
    "named original proposal differs"
  );
  await cancellationDestinationAbsent(api, request.proposalKey);
  const recorded = await recordedCancellation({
    api,
    cwd,
    issue,
    proposal,
    config,
    origin,
  });
  if (recorded) {
    const record = recorded.payload.preview.cancellation;
    required(
      record.parent === proposal.parent &&
        record.proposalKey === proposal.key &&
        canonicalJson(record.proposalHashes) === canonicalJson(proposal.hashes),
      "recorded replacement no longer matches"
    );
  } else
    required(
      issue.state === "open" &&
        prior.status === "stale-outstanding" &&
        prior.issue.number === request.number,
      "only the active stale origin can be cancelled"
    );
  return { ...manual, issue, origin, recorded };
}

/** Preparation writes only a private prospective subject, never a provider lifecycle mutation. */
export async function prepareCancellation(context) {
  const { output, proposal, config, request } = context;
  const state = await cancellationState(context);
  const record =
    state.recorded?.payload.preview.cancellation ??
    cancellationRecord(
      state.origin,
      proposal,
      config,
      state.invocation,
      state.operatorId
    );
  validateCancellation(record, record);
  writeJson(join(output, "cancellation.json"), record);
  const mode = state.recorded ? "recorded" : "fresh";
  if (state.recorded) {
    const bytes = Buffer.from(state.recorded.payload.bundle);
    required(bytes.length <= 1_048_576, "cancellation bundle exceeds bound");
    writeFileSync(join(output, "cancellation-bundle.json"), bytes, {
      mode: 0o600,
      flag: "wx",
    });
  }
  writeJson(join(output, "cancellation-state.json"), { mode, request });
  return { mode };
}

/** Each chunk and closure rechecks current operator, main, holds, destination and immutable subject. */
async function authorizeCancellation(context, record, paths, state) {
  const current = await cancellationState(context);
  if (state.mode === "fresh") {
    validateCancellation(
      record,
      cancellationRecord(
        current.origin,
        context.proposal,
        context.config,
        current.invocation,
        current.operatorId
      )
    );
    verifyCancellationAttestation(
      context.api.policy,
      record,
      paths,
      sha256(readBytes(paths.cancellation, 65_536))
    );
  } else
    required(
      state.mode === "recorded" &&
        current.recorded &&
        canonicalJson(current.recorded.payload.preview.cancellation) ===
          canonicalJson(record),
      "recorded cancellation authority differs"
    );
  return current;
}

/** Durable proof precedes a not_planned close; interruptions retain all evidence for the next manual run. */
export async function finalizeCancellation(context) {
  const { api, output, proposal, request } = context;
  const state = readJson(join(output, "cancellation-state.json"), 65_536);
  keys(state, ["mode", "request"]);
  required(
    canonicalJson(state.request) === canonicalJson(request),
    "cancellation intent changed"
  );
  const paths = {
    cancellation: join(output, "cancellation.json"),
    cancellationBundle: join(output, "cancellation-bundle.json"),
  };
  const record = readJson(paths.cancellation, 65_536);
  const digest = sha256(readBytes(paths.cancellation, 65_536));
  const current = await authorizeCancellation(context, record, paths, state);
  const payload = current.recorded?.payload ?? {
    version: 1,
    proposal,
    allocation: current.origin.allocation,
    preview: { cancellation: record },
    bundle: readBytes(paths.cancellationBundle, 1_048_576).toString("utf8"),
  };
  if (!current.recorded)
    await withStage("cancel-checkpoint", () =>
      persistCheckpoint(api, request.number, payload, digest, () =>
        authorizeCancellation(context, record, paths, state)
      )
    );
  const issue = (await authorizeCancellation(context, record, paths, state))
    .issue;
  required(
    canonicalJson(decodeCheckpoint(issue.comments, digest)) ===
      canonicalJson(payload),
    "durable cancellation checkpoint differs"
  );
  if (issue.state === "open")
    await withStage("cancel-close", () =>
      api.request(
        `repos/${proposal.repository}/issues/${request.number}`,
        "PATCH",
        { state: "closed", state_reason: "not_planned" }
      )
    );
  const closed = await api.issue(request.number);
  required(
    closed.state === "closed" &&
      closed.state_reason === "not_planned" &&
      closed.closed_by?.type === "Bot" &&
      String(closed.closed_by.id) === api.policy.claimActorId &&
      closed.body === issue.body &&
      closed.title === issue.title,
    "cancellation closure readback differs"
  );
  await api.main(proposal.parent);
  await cancellationDestinationAbsent(api, request.proposalKey);
  return {
    status: "cancelled",
    number: request.number,
    cancellationSha256: digest,
  };
}
