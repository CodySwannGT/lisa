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

/** The operator-approved sentence for every Jira/Linear phase that is not supported yet. */
export const FOLLOWUP_SENTENCE =
  "The npm updater can file and claim Jira and Linear work items, but it cannot yet check their claims, publish the pull request or cancel them. That support is tracked in CodySwannGT/lisa#4873. Projects that track work in GitHub are fully supported today.";

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

/** Every unsupported Jira/Linear step stops before its first write, in words the operator can act on. */
export function refuseUnlessGithub(config, step) {
  if (config.tracker !== "github")
    throw operatorRefusal(
      `${step} is not supported for this tracker yet`,
      FOLLOWUP_SENTENCE
    );
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
