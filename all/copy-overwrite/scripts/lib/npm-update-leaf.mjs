// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/**
 * @file npm-update-leaf.mjs
 * @description A fixed dependency Task still owes all writer gates and current human authorization.
 * @module npm-updater
 */
import { canonicalClassifier } from "./npm-update-helper.mjs";
import { canonicalJson } from "../lisa-automation-provenance.mjs";
import { required, CLAIM, keys } from "./npm-update-contract.mjs";
import { qualityGates } from "./npm-update-quality.mjs";
import { leafRoles } from "./npm-update-leaf-contract.mjs";
export {
  leafRoles,
  environment,
  buildDraft,
} from "./npm-update-leaf-contract.mjs";
import { sha256 } from "./github-attestation-verifier.mjs";

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
  let issue = await api.issue(suppliedIssue.number);
  let state = await inspectLeaf(issue, draft, policy, config);
  qualityGates(
    { ...draft, title: issue.title, body: issue.body },
    proposal,
    policy,
    config,
    evidence
  );
  if (state.unassigned) {
    await api.assignable(policy.maintainer);
    await api.request(
      `repos/${policy.repository}/issues/${issue.number}/assignees`,
      "POST",
      { assignees: [policy.maintainer] }
    );
  }
  issue = await api.issue(issue.number);
  state = await inspectLeaf(issue, draft, policy, config);
  required(!state.unassigned, "allocation lacks trusted maintainer ownership");
  if (!state.claimed) {
    const labels = issue.labels
      .map(label => label.name)
      .filter(name => name !== roles.ready);
    labels.push(roles.claimed);
    await api.request(
      `repos/${policy.repository}/issues/${issue.number}`,
      "PATCH",
      { labels }
    );
  }
  issue = await api.issue(issue.number);
  state = await inspectLeaf(issue, draft, policy, config);
  if (!state.claims.length)
    await api.request(
      `repos/${policy.repository}/issues/${issue.number}/comments`,
      "POST",
      { body: CLAIM }
    );
  issue = await api.issue(issue.number);
  state = await inspectLeaf(issue, draft, policy, config);
  required(
    state.claimed &&
      state.claims.length === 1 &&
      String(state.claims[0].user?.id) === api.policy.claimActorId &&
      state.claims[0].user?.type === "Bot",
    "actual managed claim identity differs"
  );
  return { issue, state };
}

/** Complete provider history and immutable human policy govern every mutation. */
export async function inspectLeaf(issue, draft, policy, config) {
  const roles = leafRoles(config, policy.repository);
  const labels = issue.labels.map(label => label.name);
  required(
    issue.state === "open" && !issue.pull_request && issue.number > 0,
    "closed or nonissue leaf"
  );
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
    comments: issue.comments,
    trustedHumanActorIds: config.github.trustedHumanActorIds ?? [],
    humanNeededLabel: roles.human,
  });
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
  keys(value, ["history", "search", "registry", "labels", "main"]);
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
  await api.main(proposal.parent);
  await api.assignable(policy.maintainer);
  const issue = await api.issue(allocation.number);
  const state = await inspectLeaf(issue, allocation.draft, policy, config);
  required(
    state.claimed &&
      !state.unassigned &&
      state.claims.length === 1 &&
      String(state.claims[0].id) === allocation.claimCommentId &&
      String(state.claims[0].user?.id) === api.policy.claimActorId &&
      state.claims[0].user?.type === "Bot" &&
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
