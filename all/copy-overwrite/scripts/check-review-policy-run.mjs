// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

import { parseArgs } from "node:util";
import { invokedAsScript } from "./lib/invoked-as-script.mjs";
import {
  nativeNumber,
  REVIEW_HEAD,
  REVIEW_POLICY_APP,
  REVIEW_POLICY_CONTEXT,
  REVIEW_POLICY_WORKFLOW,
  REVIEW_REPO,
} from "./lib/review-policy-contract.mjs";
import { reviewApi, reviewHeadPulls } from "./lib/review-policy-reader.mjs";

const workflowPath = `.github/workflows/${REVIEW_POLICY_WORKFLOW}`;
const jobName = "Evaluate review policy";
const successful = row =>
  row.status === "completed" && row.conclusion === "success";

/** All pages of a native workflow listing must account for its reported total. */
function rows(api, endpoint, property) {
  const pages = api([endpoint, "--paginate", "--slurp"]);
  if (
    !Array.isArray(pages) ||
    !pages.length ||
    pages.some(page => !Array.isArray(page[property]))
  )
    throw new Error(`GitHub did not return complete ${property}`);
  const all = pages.flatMap(page => page[property]);
  if (
    pages.some(
      page =>
        !Number.isSafeInteger(page.total_count) || page.total_count > all.length
    ) ||
    new Set(all.map(row => row.id)).size !== all.length
  )
    throw new Error(`GitHub did not return complete ${property}`);
  return all;
}

/** Verify a published decision against the owned run and exact native PR/head. */
export function verifyReviewPolicyRun(
  { repo, pr, head, runId },
  api = reviewApi
) {
  if (
    !REVIEW_REPO.test(repo ?? "") ||
    !REVIEW_HEAD.test(head ?? "") ||
    nativeNumber(pr) === null ||
    nativeNumber(runId) === null
  )
    throw new Error(
      "Identify the repository, pull request, reviewed commit and workflow run"
    );
  const root = `repos/${repo}`;
  const repository = api([root]);
  const branch = repository.default_branch;
  const workflow = api([`${root}/actions/workflows/${REVIEW_POLICY_WORKFLOW}`]);
  const run = api([`${root}/actions/runs/${runId}`]);
  const attempt = nativeNumber(run.run_attempt);
  const title = `Lisa review policy PR ${pr}`;
  const pullPath = `${root}/pulls/${pr}`;
  const source = api([pullPath]).head;
  const sourceRepo = nativeNumber(source?.repo?.id);
  if (sourceRepo === null || typeof source?.ref !== "string" || !source.ref)
    throw new Error("The pull request source branch could not be established");
  const activityTitle = `Lisa review policy PR activity:${sourceRepo}:${source.ref}`;
  const activityRun =
    run.event === "workflow_run" && run.display_title === activityTitle;
  if (
    nativeNumber(repository.id) === null ||
    repository.full_name?.toLowerCase() !== repo.toLowerCase() ||
    typeof branch !== "string" ||
    !branch ||
    nativeNumber(workflow.id) === null ||
    workflow.state !== "active" ||
    workflow.path !== workflowPath ||
    run.id !== runId ||
    run.workflow_id !== workflow.id ||
    run.head_branch !== branch ||
    (run.event === "workflow_run"
      ? !activityRun
      : run.display_title !== title) ||
    run.repository?.id !== repository.id ||
    run.head_repository?.id !== repository.id ||
    ![
      workflowPath,
      `${workflowPath}@${branch}`,
      `${workflowPath}@refs/heads/${branch}`,
    ].includes(run.path) ||
    !["workflow_dispatch", "pull_request_target", "workflow_run"].includes(
      run.event
    ) ||
    !REVIEW_HEAD.test(run.head_sha ?? "") ||
    attempt === null ||
    !successful(run) ||
    !Number.isFinite(Date.parse(run.created_at))
  )
    throw new Error(
      "This run is not the successful policy workflow from the default branch"
    );

  const jobs = rows(
    api,
    `${root}/actions/runs/${runId}/attempts/${attempt}/jobs?per_page=100`,
    "jobs"
  );
  const matching = jobs.filter(job => job.name === jobName);
  const job = matching[0];
  if (
    matching.length !== 1 ||
    job.run_id !== runId ||
    job.head_sha !== run.head_sha ||
    !successful(job) ||
    !Array.isArray(job.steps)
  )
    throw new Error(
      "GitHub did not record a successful policy job for this run"
    );
  const stepPrefix = `Review policy result PR ${pr} head ${head} check `;
  const stepSuffix = " success";
  const results = job.steps.filter(
    step =>
      step.name?.startsWith(stepPrefix) &&
      step.name.endsWith(stepSuffix) &&
      successful(step)
  );
  const checkId = nativeNumber(
    results[0]?.name.slice(stepPrefix.length, -stepSuffix.length)
  );
  if (results.length !== 1 || checkId === null)
    throw new Error(
      "The policy job recorded no successful verdict for this pull request and commit"
    );
  const published = api([`${root}/check-runs/${checkId}`]);
  if (
    published.id !== checkId ||
    published.app?.id !== REVIEW_POLICY_APP ||
    published.head_sha !== head ||
    published.name !== REVIEW_POLICY_CONTEXT ||
    !successful(published) ||
    published.external_id !==
      `lisa-review-policy:${runId}:${attempt}:${pr}:${head}:${run.head_sha}` ||
    published.details_url !==
      `https://github.com/${repository.full_name}/actions/runs/${runId}/attempts/${attempt}`
  )
    throw new Error(
      "The review check does not match the native policy job receipt"
    );

  const latestChecks = rows(
    api,
    `${root}/commits/${head}/check-runs?check_name=${encodeURIComponent(REVIEW_POLICY_CONTEXT)}&filter=latest&per_page=100`,
    "check_runs"
  ).filter(
    item =>
      item.name === REVIEW_POLICY_CONTEXT && item.app?.id === REVIEW_POLICY_APP
  );
  if (
    !latestChecks.some(item => item.id === checkId) ||
    latestChecks.some(
      item => nativeNumber(item.id) === null || item.id > checkId
    )
  )
    throw new Error("The head has a newer or unreadable policy verdict");

  const branchRuns = rows(
    api,
    `${root}/actions/workflows/${workflow.id}/runs?branch=${encodeURIComponent(branch)}&created=${encodeURIComponent(`>=${run.created_at}`)}&per_page=100`,
    "workflow_runs"
  );
  const recent = branchRuns.filter(
    row =>
      row.display_title === title ||
      (row.event === "workflow_run" && row.display_title === activityTitle)
  );
  if (
    !recent.some(row => row.id === runId && row.run_attempt === attempt) ||
    recent.some(row => nativeNumber(row.id) === null || row.id > runId)
  )
    throw new Error(
      "A newer or indeterminate review-policy run needs to settle"
    );
  const pull = api([pullPath]);
  const headPulls = reviewHeadPulls(repo, head, api);
  if (
    pull.number !== pr ||
    pull.state !== "open" ||
    pull.draft !== false ||
    pull.head?.sha !== head ||
    pull.head.repo?.id !== sourceRepo ||
    pull.head.ref !== source.ref ||
    pull.base?.repo?.id !== repository.id ||
    pull.base.ref !== branch ||
    headPulls.length !== 1 ||
    headPulls[0] !== pr
  )
    throw new Error(
      "The reviewed head is changed, closed, a draft, or shared by multiple open pull requests"
    );
  const governing = api([`${root}/branches/${encodeURIComponent(branch)}`]);
  if (governing.name !== branch || governing.commit?.sha !== run.head_sha)
    throw new Error(
      "The default branch advanced. Re-evaluate this head with the current policy"
    );
  return {
    verified: true,
    repo,
    pr,
    head,
    runId,
    attempt,
    checkId,
    source: run.head_sha,
  };
}

/** Read native workflow provenance and emit the verification record. */
export function main(args = process.argv.slice(2)) {
  try {
    const { values, tokens } = parseArgs({
      args,
      tokens: true,
      options: {
        repo: { type: "string" },
        pr: { type: "string" },
        sha: { type: "string" },
        run: { type: "string" },
      },
    });
    if (
      tokens.length !== 4 ||
      new Set(tokens.map(token => token.name)).size !== 4
    )
      throw new Error("Give --repo, --pr, --sha and --run once each");
    const result = verifyReviewPolicyRun({
      repo: values.repo,
      pr: nativeNumber(values.pr),
      head: values.sha,
      runId: nativeNumber(values.run),
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return 0;
  } catch (error) {
    process.stdout.write(
      `${JSON.stringify({ verified: false, reason: error.message })}\n`
    );
    return 1;
  }
}

if (invokedAsScript(import.meta.url)) process.exitCode = main();
