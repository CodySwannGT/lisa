#!/usr/bin/env node
// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/**
 * Wake the bounded review gate after a declared reviewer finally answers.
 * Event data selects work; it never supplies review proof. Only default-branch
 * code runs here, and the dispatched gate independently reads the current PR.
 * @module scripts/review-evidence-event
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { configuredReviewers } from "./check-third-party-review-evidence.mjs";
import { readGates } from "./lisa-gates.mjs";
import { boundedExecFileSync } from "./lib/bounded-spawn.mjs";
import { invokedAsScript } from "./lib/invoked-as-script.mjs";

/**
 * Read a terminal reviewer signal, without trusting its reported verdict.
 * @param {string} eventName - Actions event name.
 * @param {object} event - Native webhook payload.
 * @returns {object|null} A candidate signal or an explicit no-op.
 */
function terminalSignal(eventName, event) {
  if (eventName === "check_run") {
    const run = event.check_run;
    if (event.action !== "completed" || run?.status !== "completed")
      return null;
    if (!Number.isSafeInteger(run.app?.id) || run.app.id <= 0) return null;
    if (run.app.slug === "github-actions") return null;
    return { name: run.name, head: run.head_sha, appId: run.app.id };
  }
  if (
    eventName === "status" &&
    ["success", "failure", "error"].includes(event.state)
  )
    return { name: event.context, head: event.sha };
  return null;
}

/**
 * Resolve every open PR whose current head matches a declared reviewer event.
 * A pinned app must match before API discovery. Never execute files from a PR.
 * @param {object} input - Validated configuration and bounded external reads.
 * @param {string} input.eventName - Native event type.
 * @param {object} input.event - Webhook payload.
 * @param {object} input.declaration - Default branch required-checks declaration.
 * @param {string} input.repo - Expected owner/repository.
 * @param {Array<object>} [input.reviewers] - Canonical configured reviewer pins.
 * @param {Function} input.listPullRequests - Complete commit-associated PR list.
 * @param {Function} input.readPullRequest - Fresh PR metadata by number.
 * @returns {{targets: Array<{pr: number, head: string}>, reason?: string}} Work.
 */
export function resolveReviewEvidenceEvent({
  eventName,
  event,
  declaration,
  repo,
  reviewers = [],
  listPullRequests,
  readPullRequest,
}) {
  const no = reason => ({ targets: [], reason });
  const signal = terminalSignal(eventName, event);
  if (signal === null) return no("not a terminal external reviewer signal");
  if (event.repository?.full_name !== repo)
    return no("event belongs to another repository");
  if (!/^[a-f0-9]{40}$/iu.test(signal.head ?? ""))
    throw new Error("Reviewer event has no concrete commit SHA");
  if (!Object.hasOwn(declaration.evidence_bearing_checks ?? {}, signal.name))
    return no("event does not name a declared evidence-bearing check");
  const pins = reviewers.filter(
    reviewer =>
      reviewer.context === signal.name && reviewer.postedBy !== undefined
  );
  if (
    eventName === "check_run" &&
    pins.some(reviewer => reviewer.postedBy !== signal.appId)
  )
    return no("event app does not match the configured reviewer");
  const targets = [];
  const seen = new Set();
  for (const candidate of listPullRequests(signal.head)) {
    const number = candidate.number;
    if (!Number.isSafeInteger(number) || number <= 0)
      throw new Error("Commit PR read returned an invalid number");
    if (seen.has(number)) continue;
    seen.add(number);
    const current = readPullRequest(number);
    if (
      current.state !== "open" ||
      current.head?.sha !== signal.head ||
      current.base?.repo?.full_name !== repo
    )
      continue;
    targets.push({ pr: number, head: signal.head });
  }
  return targets.length === 0
    ? no("commit is not a current open PR head")
    : { targets };
}

/**
 * Read GitHub JSON through the normal authenticated CLI, with a bounded child.
 * @param {string} route - Native API route.
 * @param {boolean} [paginate] - Read all list pages without dropping PRs.
 * @returns {object|Array<object>} Parsed native response.
 */
function ghJson(route, paginate = false) {
  const args = ["api", route, ...(paginate ? ["--paginate", "--slurp"] : [])];
  const result = JSON.parse(
    boundedExecFileSync("gh", args, { encoding: "utf8" })
  );
  return paginate ? result.flat() : result;
}

/**
 * Resolve the event and optionally dispatch the existing canonical gate.
 * workflow_dispatch is permitted with GITHUB_TOKEN; it does not check out PR
 * code with the event job's write token. No polling or review re-request occurs.
 * @param {string[]} [argv] - Only --dispatch is accepted.
 * @param {NodeJS.ProcessEnv} [env] - Native Actions environment.
 * @returns {object} Resolved targets and dispatch receipt.
 */
export function runReviewEvidenceEvent(
  argv = process.argv.slice(2),
  env = process.env
) {
  if (argv.some(arg => arg !== "--dispatch"))
    throw new Error("Expected only --dispatch");
  const repo = env.GITHUB_REPOSITORY;
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(repo ?? ""))
    throw new Error("GITHUB_REPOSITORY must name owner/repository");
  const event = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, "utf8"));
  const declaration = JSON.parse(
    readFileSync(join(process.cwd(), ".github/required-checks.json"), "utf8")
  );
  const result = resolveReviewEvidenceEvent({
    eventName: env.GITHUB_EVENT_NAME,
    event,
    declaration,
    repo,
    reviewers: configuredReviewers(readGates()),
    listPullRequests: head =>
      ghJson(`repos/${repo}/commits/${head}/pulls?per_page=100`, true),
    readPullRequest: number => ghJson(`repos/${repo}/pulls/${number}`),
  });
  if (result.targets.length === 0) {
    console.log(`NO-OP — ${result.reason}. No review verdict was reached.`);
    return result;
  }
  if (argv.includes("--dispatch")) {
    const metadata = ghJson(`repos/${repo}`);
    if (
      metadata.full_name !== repo ||
      typeof metadata.default_branch !== "string" ||
      metadata.default_branch.length === 0
    )
      throw new Error(
        "Cannot resolve this repository's default branch for review re-evaluation"
      );
    for (const target of result.targets) {
      // Discovery and dispatch can race a push or close. Recheck immediately;
      // the dispatched gate then performs its own coherent current-head read.
      const current = ghJson(`repos/${repo}/pulls/${target.pr}`);
      if (
        current.state !== "open" ||
        current.head?.sha !== target.head ||
        current.base?.repo?.full_name !== repo
      )
        continue;
      boundedExecFileSync(
        "gh",
        [
          "workflow",
          "run",
          "review-evidence.yml",
          "--repo",
          repo,
          "--ref",
          metadata.default_branch,
          "-f",
          `pr=${target.pr}`,
        ],
        { encoding: "utf8" }
      );
      console.log(
        `Dispatched review-evidence.yml for PR #${target.pr} at ${target.head}; event is a wake-up, not review proof.`
      );
    }
  }
  return result;
}

if (invokedAsScript(import.meta.url)) {
  try {
    runReviewEvidenceEvent();
  } catch (error) {
    console.error(`review-evidence-event: ${error.message}`);
    process.exitCode = 1;
  }
}
