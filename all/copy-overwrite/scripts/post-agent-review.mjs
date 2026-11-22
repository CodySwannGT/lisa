// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { invokedAsScript } from "./lib/invoked-as-script.mjs";
import {
  nativeNumber,
  REVIEW_HEAD,
  REVIEW_POLICY_WORKFLOW,
  REVIEW_REPO,
} from "./lib/review-policy-contract.mjs";
import { reviewApi } from "./lib/review-policy-reader.mjs";
import { agentMarker, agentPacket } from "./lib/review-providers/agent.mjs";
import { submittedReview } from "./lib/review-providers/native-evidence.mjs";

/** Re-evaluate after GitHub records a review, using only the default workflow. */
function dispatchPolicy(api, repo, pr, head) {
  const repository = api([`repos/${repo}`]);
  if (
    repository.full_name?.toLowerCase() !== repo.toLowerCase() ||
    typeof repository.default_branch !== "string" ||
    !repository.default_branch
  )
    throw new Error(
      "GitHub did not identify the default branch for the review policy"
    );
  const workflow = api([
    `repos/${repo}/actions/workflows/${REVIEW_POLICY_WORKFLOW}`,
  ]);
  if (
    nativeNumber(workflow.id) === null ||
    workflow.state !== "active" ||
    workflow.path !== `.github/workflows/${REVIEW_POLICY_WORKFLOW}`
  )
    throw new Error("The default-branch review policy workflow is unavailable");
  const run = api(
    [
      `repos/${repo}/actions/workflows/${workflow.id}/dispatches`,
      "--method",
      "POST",
      "--input",
      "-",
    ],
    {
      ref: repository.default_branch,
      inputs: { pr: String(pr), sha: head },
      return_run_details: true,
    }
  );
  const runId = nativeNumber(run.workflow_run_id);
  const url = `https://github.com/${repository.full_name}/actions/runs/${runId}`;
  if (runId === null || run.html_url !== url)
    throw new Error("GitHub did not identify the dispatched review-policy run");
  return { runId, url };
}

/** Record the reviewer’s submitted report and read the native review back. */
export function postAgentReview({ repo, pr, packet, api = reviewApi }) {
  if (!REVIEW_REPO.test(repo ?? "") || nativeNumber(pr) === null)
    throw new Error("Give the repository and a positive pull request number");
  const head = packet?.head_sha;
  if (!REVIEW_HEAD.test(head ?? ""))
    throw new Error("The report must name the reviewed commit");
  const body = `${agentMarker(head)}\n${JSON.stringify(packet)}`;
  if (!agentPacket({ body }, head) || Buffer.byteLength(body) > 60_000)
    throw new Error(
      "The report is incomplete, oversized or lacks an independent review session"
    );

  const route = `repos/${repo}/pulls/${pr}`;
  const pull = api([route]);
  const reviewer = api(["user"]);
  if (pull.state !== "open" || pull.draft !== false || pull.head?.sha !== head)
    throw new Error(
      "The open pull request must be ready for review at the reported commit"
    );
  if (
    nativeNumber(pull.user?.id) === null ||
    nativeNumber(reviewer.id) === null ||
    pull.user.id === reviewer.id ||
    !/^[A-Za-z0-9_-]+$/u.test(reviewer.login ?? "")
  )
    throw new Error(
      "The reviewer must authenticate as an account other than the pull request author"
    );
  const permission = api([
    `repos/${repo}/collaborators/${reviewer.login}/permission`,
  ]);
  if (!["write", "maintain", "admin"].includes(permission.permission))
    throw new Error("The reviewer needs repository write access");

  const existing = api([
    `${route}/reviews?per_page=100`,
    "--paginate",
    "--slurp",
  ]);
  if (
    !Array.isArray(existing) ||
    existing.length === 0 ||
    existing.some(page => !Array.isArray(page))
  )
    throw new Error(
      "GitHub did not return a complete list of submitted reviews"
    );
  const matches = review =>
    submittedReview(review) &&
    review.user.id === reviewer.id &&
    review.commit_id === head &&
    review.state === "COMMENTED" &&
    review.body === body;
  const submitted =
    existing.flat().find(matches) ??
    api([`${route}/reviews`, "--method", "POST", "--input", "-"], {
      commit_id: head,
      event: "COMMENT",
      body,
    });
  if (nativeNumber(submitted.id) === null)
    throw new Error("GitHub did not return a submitted review ID");
  const readback = api([`${route}/reviews/${submitted.id}`]);
  if (
    readback.id !== submitted.id ||
    !matches(readback) ||
    api([route]).head?.sha !== head
  )
    throw new Error(
      "The submitted review could not be verified at the current head"
    );
  return { reviewId: readback.id, head, reviewerId: reviewer.id };
}

/** Accept a completed report and record the separate native workflow receipt. */
export function main(args = process.argv.slice(2), api = reviewApi) {
  const { values, tokens } = parseArgs({
    args,
    options: {
      repo: { type: "string" },
      pr: { type: "string" },
      report: { type: "string" },
    },
    tokens: true,
  });
  if (
    tokens.length !== 3 ||
    new Set(tokens.map(token => token.name)).size !== 3 ||
    !values.report
  )
    throw new Error("Give --repo, --pr and --report once each");
  const report = JSON.parse(readFileSync(values.report, "utf8"));
  const posted = postAgentReview({
    repo: values.repo,
    pr: values.pr,
    packet: report,
    api,
  });
  try {
    const refresh = dispatchPolicy(api, values.repo, values.pr, posted.head);
    process.stdout.write(`${JSON.stringify({ ...posted, refresh })}\n`);
    return 0;
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ ...posted, refresh: null })}\n`);
    process.stderr.write(
      `Review recorded. Policy refresh failed: ${error.message}\n`
    );
    return 1;
  }
}

if (invokedAsScript(import.meta.url)) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(`Agent review could not be posted: ${error.message}`);
    process.exitCode = 1;
  }
}
