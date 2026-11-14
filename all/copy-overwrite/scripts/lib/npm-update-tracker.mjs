// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/**
 * @file npm-update-tracker.mjs
 * @description The npm updater's tracker seam (CodySwannGT/lisa#4859). The code host is
 * GitHub for every tracker; only work-item reads and writes go through the adapter
 * selected by the committed `tracker`. The GitHub adapter issues exactly the calls the
 * updater made before this seam existed, so GitHub artifacts stay byte-identical.
 * @module npm-updater
 */
import { required, operatorRefusal } from "./npm-update-invariants.mjs";
import { backlinkBody } from "../lisa-work-item.mjs";
import { verifyCurrentRun } from "./github-attestation-provider.mjs";
import { JiraTracker } from "./npm-update-tracker-jira.mjs";
import { LinearTracker } from "./npm-update-tracker-linear.mjs";

/** Today's GitHub calls, unchanged in endpoint, method, body and order. */
export function githubTracker(api, repository) {
  const repo = () => repository ?? api.policy.repository;
  const search = query =>
    api.request(`search/issues?q=${encodeURIComponent(query)}&per_page=100`);
  return {
    provider: "github",
    ref: number => `${repo()}#${number}`,
    issue: number => api.issue(number),
    searchPrior: proposal =>
      search(
        `repo:${proposal.repository} "${proposal.selectionKey}" is:issue in:body`
      ),
    relationships: async proposal => {
      const query = `repo:${proposal.repository} npm is:issue in:title,body`;
      return { ...(await search(query)), query };
    },
    vocabulary: async proposal =>
      (await api.list(`repos/${proposal.repository}/labels`)).map(
        label => label.name
      ),
    ensureRole: name =>
      api.request(`repos/${repo()}/labels`, "POST", {
        name,
        color: "ededed",
        description: "Managed dependency Task lifecycle",
      }),
    createLeaf: draft =>
      api.request(`repos/${repo()}/issues`, "POST", {
        title: draft.title,
        body: draft.body,
        labels: draft.labels,
        assignees: draft.assignees,
      }),
    assignable: maintainer => api.assignable(maintainer),
    assign: (number, maintainer) =>
      api.request(`repos/${repo()}/issues/${number}/assignees`, "POST", {
        assignees: [maintainer],
      }),
    transition: (issue, roles) => {
      const labels = issue.labels
        .map(label => label.name)
        .filter(name => name !== roles.ready);
      labels.push(roles.claimed);
      return api.request(`repos/${repo()}/issues/${issue.number}`, "PATCH", {
        labels,
      });
    },
    comment: (number, body) =>
      api.request(`repos/${repo()}/issues/${number}/comments`, "POST", {
        body,
      }),
    comments: number => api.list(`repos/${repo()}/issues/${number}/comments`),
    durableComment: (number, body) => githubDurable(api, repo(), number, body),
    isManagedActor: async user =>
      String(user?.id) === api.policy.claimActorId && user?.type === "Bot",
  };
}

/** The original checkpoint POST, issue-scope check and immediate readback, verbatim. */
async function githubDurable(api, repository, number, body) {
  const issueUrl = `https://api.github.com/repos/${repository}/issues/${number}`;
  const created = await api.request(
    `repos/${repository}/issues/${number}/comments`,
    "POST",
    { body }
  );
  required(created.issue_url === issueUrl, "checkpoint write scope differs");
  required(
    created.body === body && Number.isSafeInteger(created.id) && created.id > 0,
    "checkpoint write readback differs"
  );
  const read = await api.request(
    `repos/${repository}/issues/comments/${created.id}`
  );
  required(
    read.issue_url === issueUrl,
    "checkpoint immediate readback scope differs"
  );
  required(
    read.id === created.id && read.body === body,
    "checkpoint immediate readback differs"
  );
}

/** Humans whose comment may release a hold, from the configured tracker's own section. */
export function trustedHumanActorIds(config) {
  if (config.tracker === "jira" || config.tracker === "linear")
    return config[config.tracker]?.trustedHumanActorIds ?? [];
  return config.github.trustedHumanActorIds ?? [];
}

/**
 * A held Jira/Linear item whose project never named who may release holds can
 * never be released, so say that instead of the generic hold refusal (#4873).
 * The hold itself still stands: an absent list trusts no one.
 */
export function refuseUnreleasableHold(config, held) {
  const tracker = config.tracker;
  if (
    held &&
    (tracker === "jira" || tracker === "linear") &&
    !Array.isArray(config[tracker]?.trustedHumanActorIds)
  )
    throw operatorRefusal(
      "tracker hold trust list is absent",
      `This work item is held for a person, and ${tracker}.trustedHumanActorIds is not set in .lisa.config.json, so no release comment can lift the hold. List the ${tracker === "jira" ? "Jira accountIds" : "Linear user ids"} of the people allowed to release holds, then rerun.`
    );
}

/**
 * A synchronous test for "the automation wrote this". GitHub: the configured
 * Bot. Jira/Linear: the credential's own account, already required to be the
 * declared claimActorRef (#4873).
 */
export async function managedActor(api) {
  if (!api.tracker)
    return user =>
      user?.type === "Bot" && String(user.id) === api.policy.claimActorId;
  const id = await api.tracker.actorId();
  return user => typeof user?.id === "string" && user.id === id;
}

/** The one work item reference an allocation of this tracker may carry. */
export function allocationWorkItem(api, config, repository, number) {
  return api.tracker
    ? expectedWorkItem(config, number)
    : `${repository}#${number}`;
}

/**
 * The one closure check every cancellation path shares. GitHub: closed as
 * not_planned by the configured Bot. Jira/Linear: closed into the canceled
 * status or state, and the changelog or history shows the automation made that
 * move (#4873). `reason` keeps each caller's original refusal.
 */
export async function assertManagedClosure(api, issue, reason) {
  required(
    issue.state === "closed" &&
      issue.state_reason === "not_planned" &&
      (api.tracker ||
        (issue.closed_by?.type === "Bot" &&
          String(issue.closed_by.id) === api.policy.claimActorId)),
    reason
  );
  if (api.tracker) await api.tracker.assertCancelled(issue.number);
}

/**
 * Publish-time tracker authority for Jira/Linear (#4873): the live claim by the
 * automation identity (returned for the origin chronology), one owner who is the
 * maintainer, and that owner still assignable. GitHub hosts return undefined;
 * their claim is read from GitHub by the provider proof.
 */
export async function trackerPublishAuthority(api, descriptor, policy, issue) {
  if (!api.tracker) return undefined;
  const claim = await api.tracker.proveClaim(descriptor);
  required(
    issue.assignees.length === 1 &&
      issue.assignees[0].login === policy.maintainer,
    "current recovery leaf or owner differs"
  );
  await api.tracker.assignable(policy.maintainer);
  return claim;
}

/** An api without an attached adapter is a GitHub-tracked host, exactly as before. */
export function trackerOf(api, repository) {
  return api.tracker ?? githubTracker(api, repository);
}

/** The adapter must be the one the committed config names; a mismatch never falls through. */
export function trackerFor(api, policy, config) {
  const tracker = trackerOf(api, policy.repository);
  required(
    tracker.provider === config.tracker,
    "configured tracker adapter differs"
  );
  return tracker;
}

/** Jira and Linear adapters resolve credentials here, before any provider call; GitHub has none. */
export function createTracker(config, env, transport = globalThis.fetch) {
  if (config.tracker === "github") return undefined;
  required(
    config.tracker === "jira" || config.tracker === "linear",
    "configured tracker has no API adapter"
  );
  return config.tracker === "jira"
    ? new JiraTracker(config, env, transport)
    : new LinearTracker(config, env, transport);
}

/** The one reference grammar a tracker's signed artifacts may carry. */
export function expectedWorkItem(config, number) {
  required(Number.isSafeInteger(number) && number > 0, "invalid work item");
  const key = String(
    config.tracker === "jira" ? config.jira?.project : config.linear?.teamKey
  )
    .trim()
    .toUpperCase();
  required(/^[A-Z][A-Z0-9]{1,9}$/.test(key), "invalid work item key");
  return `${key}-${number}`;
}

/** The allocation, the signed descriptor and the single commit trailer name the same exact reference. */
export function verifySignedWorkItem(config, allocation, preview) {
  const expected = expectedWorkItem(config, allocation.number);
  const trailers = [...preview.message.matchAll(/^Work-Item: (.*)$/gm)];
  required(
    allocation.workItem === expected &&
      preview.descriptor.workItem === expected &&
      trailers.length === 1 &&
      trailers[0][1] === expected,
    "signed work item differs from the configured tracker"
  );
}

/**
 * The managed PR backlink on a Jira/Linear work item, written by the declared
 * automation identity and read back exactly. A rerun finds it and writes nothing.
 */
export async function vendorBacklink(tracker, number, prUrl) {
  const body = backlinkBody(prUrl);
  const present = async () => {
    for (const comment of await tracker.comments(number))
      if (comment.body === body && (await tracker.isManagedActor(comment.user)))
        return true;
    return false;
  };
  if (!(await present())) await tracker.backlinkComment(number, body);
  required(await present(), "work item backlink readback differs");
}

/** Checkpoint authority for Jira/Linear: the live GitHub run plus the claim proved on the tracker. */
export async function proveTrackerProvider(api, descriptor, config) {
  const tracker = trackerFor(api, api.policy, config);
  verifyCurrentRun(api.policy, descriptor);
  await tracker.proveClaim(descriptor);
}
