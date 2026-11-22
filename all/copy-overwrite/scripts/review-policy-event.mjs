// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

import { readFileSync } from "node:fs";
import { invokedAsScript } from "./lib/invoked-as-script.mjs";
import {
  nativeNumber,
  REVIEW_HEAD,
  REVIEW_POLICY_APP,
  REVIEW_POLICY_CONTEXT,
  REVIEW_REPO,
} from "./lib/review-policy-contract.mjs";
import {
  loadReviewConfig,
  loadReviewDeclaration,
  policyReviewReport,
  readPolicyReview,
  reviewApi,
  reviewBranchPulls,
  reviewHeadPulls,
} from "./lib/review-policy-reader.mjs";
import {
  resolveReviewPolicy,
  reviewHoldReasons,
} from "./lib/review-policy.mjs";

/** Resolve the immutable pull request head supplied by this event. */
function target(eventName, event) {
  const dispatch = eventName === "workflow_dispatch";
  const pr = nativeNumber(dispatch ? event.inputs?.pr : event.number);
  const head = dispatch ? event.inputs?.sha : event.pull_request?.head?.sha;
  if (pr === null || !REVIEW_HEAD.test(head ?? ""))
    throw new Error(
      "The review event must identify a pull request and its exact head"
    );
  return { pr, head };
}

/** Resolve an activity signal through the live GitHub source branch, even for forks. */
function activityTarget(event, repository, api) {
  const run = event.workflow_run;
  const sourceBranch = run?.head_branch;
  const owner = run?.head_repository?.owner?.login;
  const sourceRepo = nativeNumber(run?.head_repository?.id);
  if (
    event.action !== "requested" ||
    run?.event !== "pull_request_review" ||
    run.repository?.id !== repository.id ||
    run.path?.split("@")[0] !==
      ".github/workflows/review-policy-activity.yml" ||
    typeof sourceBranch !== "string" ||
    !sourceBranch ||
    !/^[a-z\d-]+$/iu.test(owner ?? "") ||
    sourceRepo === null
  )
    throw new Error(
      "The review activity did not identify a native source branch"
    );

  const matches = reviewBranchPulls(
    repository.full_name,
    owner,
    sourceBranch,
    api
  ).filter(
    pull =>
      pull.state === "open" &&
      pull.base?.ref === repository.default_branch &&
      pull.base.repo?.id === repository.id &&
      pull.head?.ref === sourceBranch &&
      pull.head.repo?.id === sourceRepo &&
      REVIEW_HEAD.test(pull.head.sha ?? "") &&
      nativeNumber(pull.number) !== null
  );
  if (matches.length > 1)
    throw new Error("The review activity matched multiple open pull requests");
  const [pull] = matches;
  return pull ? { pr: pull.number, head: pull.head.sha } : null;
}

/** Evaluate and publish only from the governing default-branch commit. */
export function runReviewPolicyEvent({ env, event, root, api = reviewApi }) {
  const repo = env.GITHUB_REPOSITORY;
  const run = nativeNumber(env.GITHUB_RUN_ID);
  const attempt = nativeNumber(env.GITHUB_RUN_ATTEMPT);
  const source = env.GITHUB_SHA;
  if (
    !REVIEW_REPO.test(repo ?? "") ||
    !REVIEW_HEAD.test(source ?? "") ||
    run === null ||
    attempt === null ||
    !["workflow_dispatch", "pull_request_target", "workflow_run"].includes(
      env.GITHUB_EVENT_NAME
    )
  )
    throw new Error(
      "The hosted review policy requires a supported native workflow event"
    );
  const config = loadReviewConfig(root);
  if (config.review === undefined)
    return { reason: "Review policy is not configured", checks: [] };
  const declaration = loadReviewDeclaration(root);
  const policy = resolveReviewPolicy(config, declaration);
  const repository = api([`repos/${repo}`]);
  const branch = repository.default_branch;
  const branchTip = () =>
    api([`repos/${repo}/branches/${encodeURIComponent(branch)}`]).commit?.sha;
  if (
    repository.full_name?.toLowerCase() !== repo.toLowerCase() ||
    nativeNumber(repository.id) === null ||
    typeof branch !== "string" ||
    env.GITHUB_REF !== `refs/heads/${branch}` ||
    branchTip() !== source
  )
    throw new Error(
      "The governing default branch moved or this workflow did not run from it"
    );
  const identified =
    env.GITHUB_EVENT_NAME === "workflow_run"
      ? activityTarget(event, repository, api)
      : target(env.GITHUB_EVENT_NAME, event);
  if (!identified)
    return { reason: "Review activity has no open pull request", checks: [] };
  const { pr, head } = identified;
  const endpoint = `repos/${repo}/pulls/${pr}`;
  const relevant = pull =>
    pull.state === "open" &&
    pull.head?.sha === head &&
    pull.base?.ref === branch &&
    pull.base.repo?.id === repository.id;
  const stale = {
    reason: "No matching open pull request at the event head",
    checks: [],
  };
  if (!relevant(api([endpoint]))) return stale;
  const observed = readPolicyReview({
    config,
    declaration,
    repo,
    pr,
    head,
    api,
  });
  const pullRequests = reviewHeadPulls(repo, head, api);
  if (pullRequests.length !== 1 || pullRequests[0] !== pr) return stale;
  const final = api([endpoint]);
  if (!relevant(final)) return stale;
  const holds =
    typeof final.draft !== "boolean" ||
    !Array.isArray(final.labels) ||
    final.labels.some(label => typeof label?.name !== "string")
      ? ["pull-request-holds-unreadable"]
      : reviewHoldReasons(policy, final);
  const verdict = holds.length
    ? {
        ...observed,
        outcome: "not-reviewed",
        reasons: [...new Set([...observed.reasons, ...holds])],
      }
    : observed;
  if (branchTip() !== source)
    throw new Error(
      "Governing review policy changed during evidence collection"
    );

  const conclusion = verdict.outcome === "reviewed" ? "success" : "failure";
  const details = `https://github.com/${repository.full_name}/actions/runs/${run}/attempts/${attempt}`;
  const binding = `lisa-review-policy:${run}:${attempt}:${pr}:${head}:${source}`;
  const title =
    verdict.outcome === "reviewed"
      ? `REVIEWED (${verdict.providers.join(", ")})`
      : "REVIEW REQUIRED";
  const published = api(
    [`repos/${repo}/check-runs`, "--method", "POST", "--input", "-"],
    {
      name: REVIEW_POLICY_CONTEXT,
      head_sha: head,
      status: "completed",
      conclusion,
      details_url: details,
      external_id: binding,
      output: { title, summary: policyReviewReport(verdict).slice(0, 10_000) },
    }
  );
  const checkId = nativeNumber(published.id);
  if (
    checkId === null ||
    published.app?.id !== REVIEW_POLICY_APP ||
    published.head_sha !== head ||
    published.external_id !== binding ||
    published.name !== REVIEW_POLICY_CONTEXT ||
    published.conclusion !== conclusion
  )
    throw new Error("GitHub did not return the bound review policy check");
  return {
    reason: "Published the current-head review policy",
    checks: [
      { pr, head, check: checkId, conclusion, providers: verdict.providers },
    ],
  };
}

if (invokedAsScript(import.meta.url)) {
  try {
    const env = process.env;
    const event = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, "utf8"));
    const result = runReviewPolicyEvent({ env, event, root: process.cwd() });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    console.error(`Review policy could not publish: ${error.message}`);
    process.exitCode = 1;
  }
}
