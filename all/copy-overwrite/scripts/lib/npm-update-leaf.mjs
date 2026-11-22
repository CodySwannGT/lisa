// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/**
 * @file npm-update-leaf.mjs
 * @description A fixed dependency Task still owes all writer gates and current human authorization.
 * @module npm-updater
 */
import { canonicalClassifier } from "./npm-update-helper.mjs";
import { canonicalJson } from "../lisa-automation-provenance.mjs";
import { required, CLAIM, keys, policyTarget } from "./npm-update-contract.mjs";
import { qualityGates } from "./npm-update-quality.mjs";
import { leafRoles } from "./npm-update-leaf-contract.mjs";
export {
  leafRoles,
  environment,
  buildDraft,
} from "./npm-update-leaf-contract.mjs";
import { sha256 } from "./github-attestation-verifier.mjs";
import {
  trackerFor,
  trustedHumanActorIds,
  refuseUnreleasableHold,
} from "./npm-update-tracker.mjs";

/** Each transition rereads holds, ownership and the actual managed claim. */
export async function claimLeaf(
  api,
  suppliedIssue,
  draft,
  proposal,
  policy,
  config,
  evidence,
  roles
) {
  const tracker = trackerFor(api, policy, config);
  let issue = await tracker.issue(suppliedIssue.number);
  let state = await inspectLeaf(issue, draft, policy, config);
  qualityGates(
    { ...draft, title: issue.title, body: issue.body },
    proposal,
    policy,
    config,
    evidence
  );
  if (state.unassigned) {
    await tracker.assignable(policy.maintainer);
    await tracker.assign(issue.number, policy.maintainer);
  }
  issue = await tracker.issue(issue.number);
  state = await inspectLeaf(issue, draft, policy, config);
  required(!state.unassigned, "allocation lacks trusted maintainer ownership");
  if (!state.claimed) await tracker.transition(issue, roles);
  issue = await tracker.issue(issue.number);
  state = await inspectLeaf(issue, draft, policy, config);
  if (!state.claims.length) await tracker.comment(issue.number, CLAIM);
  issue = await tracker.issue(issue.number);
  state = await inspectLeaf(issue, draft, policy, config);
  required(
    state.claimed &&
      state.claims.length === 1 &&
      (await tracker.isManagedActor(state.claims[0].user)),
    "actual managed claim identity differs"
  );
  return { issue, state };
}

/** Complete provider history and immutable human policy govern every mutation. */
export async function inspectLeaf(issue, draft, policy, config) {
  required(
    issue.state === "open" && !issue.pull_request && issue.number > 0,
    "closed or nonissue leaf"
  );
  return inspectLeafFields(issue, draft, policy, config);
}

/** Closed-state inspection never grants authority without a separately verified cancellation. */
export async function inspectCancelledLeaf(issue, draft, policy, config) {
  required(
    issue.state === "closed" &&
      issue.state_reason === "not_planned" &&
      !issue.pull_request &&
      issue.number > 0,
    "leaf is not explicitly cancelled"
  );
  return inspectLeafFields(issue, draft, policy, config);
}

/** Both fixed state entry points preserve the original complete ownership and hold checks. */
async function inspectLeafFields(issue, draft, policy, config) {
  const roles = leafRoles(config, policy.repository, policyTarget(policy));
  const labels = issue.labels.map(label => label.name);
  required(
    issue.children.length === 0 &&
      issue.blockers.every(item => item.state === "closed"),
    "child work or active blocker"
  );
  required(
    !/- \[[ x]\]/i.test(issue.body) && !labels.includes("type:Epic"),
    "container is not claimable"
  );
  required(
    !roles.terminals.some(label => labels.includes(label)) &&
      !labels.includes(roles.blocked),
    "terminal or blocked leaf"
  );
  const hold = (await canonicalClassifier(config))({
    body: issue.body,
    labels,
    // Jira/Linear comments carry a classifier-only `prose` projection that keeps
    // code boundaries; `body` stays the lossless managed-record form.
    comments: issue.comments.map(comment =>
      typeof comment.prose === "string"
        ? { ...comment, body: comment.prose }
        : comment
    ),
    trustedHumanActorIds: trustedHumanActorIds(config),
    humanNeededLabel: roles.human,
  });
  refuseUnreleasableHold(config, hold.held);
  required(!hold.held, "current human hold is outstanding");
  required(
    issue.body === draft.body && issue.title === draft.title,
    "live proposal specification differs"
  );
  required(
    issue.assignees.every(
      actor => actor.login === policy.maintainer && actor.type === "User"
    ),
    "existing assignee is foreign; preserve ownership"
  );
  required(
    ["type:Task", "priority:medium"].every(label => labels.includes(label)),
    "required live labels differ"
  );
  const claims = issue.comments.filter(comment => comment.body === CLAIM);
  required(claims.length <= 1, "ambiguous managed claims");
  return {
    claimed: labels.some(label => roles.later.includes(label)),
    unassigned: issue.assignees.length === 0,
    claims,
    roles,
  };
}

/** Initial public filing evidence is immutable specification, not live authorization. */
export function historicalFiling(issue) {
  const matches = [
    ...issue.body.matchAll(/<!-- \[lisa-npm-filing\] ([A-Za-z0-9+/]+=*) -->/g),
  ];
  required(
    matches.length === 1 && matches[0][1].length <= 65_536,
    "original filing evidence is missing or ambiguous"
  );
  const bytes = Buffer.from(matches[0][1], "base64");
  required(
    bytes.toString("base64") === matches[0][1],
    "original filing encoding differs"
  );
  const value = JSON.parse(
    new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes)
  );
  keys(value, [
    "history",
    "search",
    "registry",
    "labels",
    "main",
    ...(value.supersession ? ["supersession"] : []),
  ]);
  if (value.supersession)
    keys(value.supersession, ["workItem", "cancellationSha256", "proposalKey"]);
  required(
    canonicalJson(value) === bytes.toString("utf8"),
    "original filing fields are noncanonical"
  );
  return value;
}

export { qualityGates } from "./npm-update-quality.mjs";

/** Every privileged transition rechecks current policy, claim, owner and holds. */
export async function authorizeAllocation(
  api,
  proposal,
  allocation,
  policy,
  config
) {
  const tracker = trackerFor(api, policy, config);
  await api.main(proposal.parent, proposal.target);
  await tracker.assignable(policy.maintainer);
  const issue = await tracker.issue(allocation.number);
  const state = await inspectLeaf(issue, allocation.draft, policy, config);
  required(
    state.claimed &&
      !state.unassigned &&
      state.claims.length === 1 &&
      String(state.claims[0].id) === allocation.claimCommentId &&
      (await tracker.isManagedActor(state.claims[0].user)) &&
      sha256(state.claims[0].body) === allocation.claimSha256,
    "current proposal claim differs"
  );
  qualityGates(
    { ...allocation.draft, title: issue.title, body: issue.body },
    proposal,
    policy,
    config,
    allocation.evidence
  );
  return issue;
}
