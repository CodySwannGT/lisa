#!/usr/bin/env node
/**
 * Wake the owning agent when a required check fails on its pull request.
 *
 * The gap (CodySwannGT/lisa#4607): when a required check fails on an agent's
 * PR, nothing tells the agent. The work item sits in the claimed lane, the PR
 * stalls, and a human has to notice. Agent work is not complete until CI is
 * green, so a failed required check must put the item back where build intake
 * looks — the ready lane — with a marker that tells intake to send the agent
 * back to the EXISTING PR rather than start again.
 *
 * Decide, then act. `planRedispatch` is a pure read over an injectable `gh`
 * runner and returns the writes it would make; `applyPlan` performs them. A
 * recorded fixture serves the reads for tests and `--dry-run` demonstrations
 * and refuses every write, so a fixture can never touch the tracker.
 *
 * What counts:
 * - A required check FAILED when its `gh pr checks` bucket is `fail`. A
 *   `cancel` bucket is not a failure — a cancelled run is usually superseded by
 *   a newer push or a manual re-run, and bouncing an item for it would
 *   re-dispatch an agent for a failure nobody observed. It is not a pass
 *   either, so it holds the clear path until it resolves.
 * - Every required check PASSED when each bucket is `pass` or `skipping`.
 * - Anything else is still running: no write.
 *
 * Writes need positive evidence. A run for a superseded head, a fork PR, a PR
 * with no or a foreign `Work-Item:`, a closed item, or an item outside the
 * claimed lane all end with no write.
 *
 * Repo-only: this is the Lisa monorepo's own automation and is deliberately
 * NOT shipped to host projects (CodySwannGT/lisa#4607, Out of Scope).
 * @module scripts/lisa-ci-failure-redispatch
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import process from "node:process";

import { invokedAsScript } from "../all/copy-overwrite/scripts/lib/invoked-as-script.mjs";
import {
  soleWorkItem,
  trackerContract,
} from "../all/copy-overwrite/scripts/lisa-work-item.mjs";

const SHA = /^[0-9a-f]{40}$/u;
/**
 * The failure marker; captures the PR number and head SHA. Exported with the
 * other marker patterns and predicates below so the dispatch-side reader
 * (`scripts/lisa-ci-rework-route.mjs`, CodySwannGT/lisa#4677) shares one
 * definition with the producer instead of a copy that could drift.
 */
export const FAILURE_MARKER =
  /<!-- \[lisa-ci-failed\] pr=(\d+) sha=([0-9a-f]{40}) -->/u;
/** The line a later all-green run appends to a failure marker's comment. */
export const CLEARED_MARKER = /<!-- \[lisa-ci-cleared\] run=\d+ -->/u;
/** Any Lisa lifecycle marker — the claim, attempt, and CI markers alike. */
export const LISA_MARKER = /\[(?:lisa-[a-z0-9-]+|claude-build-intake)\]/u;
const NO_REQUIRED = /no (?:required )?checks reported/iu;

/**
 * The only comment authors whose `[lisa-ci-failed]` / `[lisa-ci-cleared]`
 * markers count. Anyone who can comment on an issue can type a marker; a
 * forged one must neither suppress a real re-dispatch nor make the workflow
 * edit an outsider's comment and restore a lane. The workflow posts with
 * `GITHUB_TOKEN`, whose author is `github-actions[bot]`.
 */
export const MARKER_AUTHORS = Object.freeze(["github-actions[bot]"]);
/**
 * One write a plan would make.
 * @typedef {object} PlannedAction
 * @property {string} kind - `comment`, `relabel`, or `edit-comment`.
 * @property {string} [item] - Canonical work item, for `comment` and `relabel`.
 * @property {string} [body] - Comment body, for `comment` and `edit-comment`.
 * @property {string} [remove] - Lane label to remove, for `relabel`.
 * @property {string} [add] - Lane label to add, for `relabel`.
 * @property {number} [commentId] - Numeric comment id, for `edit-comment`.
 */

/**
 * The decision for one completed run.
 * @typedef {object} Plan
 * @property {string} outcome - Outcome name, e.g. `redispatch` or `non-agent-pr`.
 * @property {string} reason - Plain-language reason.
 * @property {PlannedAction[]} actions - Writes, in order; empty for a no-op.
 * @property {number} [pr] - Resolved PR number.
 * @property {string} [sha] - Run head SHA.
 * @property {string} [item] - Canonical work item.
 * @property {string} [repository] - Repository the writes target.
 * @property {number} [runId] - Actions run id.
 */

/** The three writes a plan can contain. */
const ACTION = Object.freeze({
  comment: "comment",
  relabel: "relabel",
  editComment: "edit-comment",
});

/**
 * The machine marker a failure comment carries, one per PR head.
 * @param {number} pr - Pull request number.
 * @param {string} sha - Head commit the failure was observed on.
 * @returns {string} The HTML-comment marker.
 */
export function failureMarker(pr, sha) {
  return `<!-- [lisa-ci-failed] pr=${pr} sha=${sha} -->`;
}

/**
 * Judge the PR's required checks.
 * @param {Array<{name: string, bucket: string}>} checks - `gh pr checks --required` rows.
 * @returns {{verdict: "fail"|"pass"|"pending", failing: string[]}} The judgment.
 */
export function classifyRequiredChecks(checks) {
  const failing = checks.filter(c => c.bucket === "fail").map(c => c.name);
  if (failing.length > 0) return { verdict: "fail", failing };
  const settled = checks.every(c => ["pass", "skipping"].includes(c.bucket));
  return { verdict: settled ? "pass" : "pending", failing: [] };
}

/**
 * Serve recorded `gh` answers keyed by their argv; refuse anything else.
 * @param {Record<string, {stdout?: unknown, ok?: boolean, stderr?: string}>} recordings - Recorded answers.
 * @returns {Function} A gh runner that never reaches the network.
 */
export function recordedGh(recordings) {
  return (args, options = {}) => {
    if (options.write)
      throw new Error(
        `refusing to write through a recorded fixture: gh ${args.join(" ")}`
      );
    const key = args.join(" ");
    if (!Object.hasOwn(recordings, key))
      throw new Error(`gh call not recorded in the fixture: gh ${key}`);
    const { stdout = "", ok = true, stderr = "" } = recordings[key];
    const text = typeof stdout === "string" ? stdout : JSON.stringify(stdout);
    return { ok, stdout: text, stderr };
  };
}

/**
 * The live gh runner. Never throws on a non-zero exit; callers judge `ok`.
 * @param {string[]} args - Arguments to `gh`.
 * @param {{input?: string}} [options] - Optional stdin.
 * @returns {{ok: boolean, stdout: string, stderr: string}} Outcome.
 */
export function liveGh(args, options = {}) {
  const result = spawnSync("gh", args, {
    encoding: "utf8",
    input: options.input,
    timeout: 60_000,
    maxBuffer: 64 * 1024 * 1024,
  });
  const stderr = result.error
    ? String(result.error.message)
    : (result.stderr ?? "");
  return { ok: result.status === 0, stdout: result.stdout ?? "", stderr };
}

/**
 * Run a gh read and parse its JSON, or throw naming the call.
 * @param {Function} gh - Runner.
 * @param {string[]} args - Arguments.
 * @returns {any} Parsed stdout.
 */
function readJson(gh, args) {
  const result = gh(args);
  if (!result.ok)
    throw new Error(`gh ${args.join(" ")} failed: ${result.stderr}`);
  return JSON.parse(result.stdout);
}

/**
 * Candidate PR numbers for the run's head.
 * @param {object} run - `workflow_run` object.
 * @param {string} repo - Repository.
 * @param {Function} gh - Runner.
 * @returns {number[]} Distinct PR numbers.
 */
function candidatePullRequests(run, repo, gh) {
  const listed = (run.pull_requests ?? []).map(pr => pr.number);
  if (listed.length > 0) return [...new Set(listed)];
  const found = readJson(gh, [
    "pr",
    "list",
    "--repo",
    repo,
    "--state",
    "open",
    "--search",
    run.head_sha,
    "--json",
    "number,headRefOid",
  ]);
  return found
    .filter(pr => pr.headRefOid === run.head_sha)
    .map(pr => pr.number);
}

/**
 * Resolve the run to one open, same-repository PR at the run's head and its work item.
 * @param {object} run - `workflow_run` object.
 * @param {object} contract - Tracker contract.
 * @param {Function} gh - Runner.
 * @returns {{stop?: object, pr?: number, item?: string}} A stop decision or the binding.
 */
function resolveBinding(run, contract, gh) {
  const repo = contract.repository;
  const prs = candidatePullRequests(run, repo, gh);
  if (prs.length === 0)
    return {
      stop: stop("no-pull-request", "no open PR carries this run's head"),
    };
  if (prs.length > 1)
    return {
      stop: stop(
        "ambiguous-pull-request",
        `several PRs carry this head: ${prs.join(", ")}`
      ),
    };
  const pr = readJson(gh, [
    "pr",
    "view",
    String(prs[0]),
    "--repo",
    repo,
    "--json",
    "number,state,body,headRefOid,isCrossRepository",
  ]);
  const base = { pr: pr.number };
  if (pr.state !== "OPEN")
    return { stop: stop("pull-request-not-open", `PR is ${pr.state}`, base) };
  if (pr.headRefOid !== run.head_sha)
    return {
      stop: stop(
        "superseded-head",
        `the PR head is now ${pr.headRefOid}`,
        base
      ),
    };
  if (pr.isCrossRepository)
    return {
      stop: stop("non-agent-pr", "a fork PR is never an agent PR", base),
    };
  try {
    return {
      pr: pr.number,
      item: soleWorkItem(pr.body ?? "", contract, "pull-request body"),
    };
  } catch (error) {
    return { stop: stop("non-agent-pr", String(error.message), base) };
  }
}

/**
 * A no-write decision.
 * @param {string} outcome - Outcome name.
 * @param {string} reason - Plain-language reason.
 * @param {object} [extra] - Fields already known.
 * @returns {Plan} Plan with no actions.
 */
function stop(outcome, reason, extra = {}) {
  return { ...extra, outcome, reason, actions: [] };
}

/**
 * Read the item's state, labels and comments, oldest comment first.
 * @param {string} item - Canonical `owner/repo#n`.
 * @param {string} repo - Repository.
 * @param {Function} gh - Runner.
 * @returns {{number: string, open: boolean, labels: string[], comments: object[]}} Item view.
 */
function readItem(item, repo, gh) {
  const number = item.slice(item.lastIndexOf("#") + 1);
  const view = readJson(gh, [
    "issue",
    "view",
    number,
    "--repo",
    repo,
    "--json",
    "state,labels",
  ]);
  return {
    number,
    open: view.state === "OPEN",
    labels: view.labels.map(l => l.name),
    comments: readItemComments(number, repo, gh),
  };
}

/**
 * Read every comment on an issue, oldest first. Throws naming the call when
 * the read fails. Shared with `scripts/lisa-ci-rework-route.mjs`.
 * @param {string} number - Issue number.
 * @param {string} repo - Repository.
 * @param {Function} gh - Runner.
 * @returns {object[]} Comments sorted by `created_at`.
 */
export function readItemComments(number, repo, gh) {
  const pages = readJson(gh, [
    "api",
    `repos/${repo}/issues/${number}/comments`,
    "--paginate",
    "--slurp",
  ]);
  return pages
    .flat()
    .toSorted((a, b) =>
      String(a.created_at).localeCompare(String(b.created_at))
    );
}

/**
 * Read the PR's required checks; `null` when the PR has none.
 * @param {number} pr - PR number.
 * @param {string} repo - Repository.
 * @param {Function} gh - Runner.
 * @returns {Array<object>|null} Rows, or null.
 */
function readRequiredChecks(pr, repo, gh) {
  const args = [
    "pr",
    "checks",
    String(pr),
    "--repo",
    repo,
    "--required",
    "--json",
    "name,state,bucket",
  ];
  const result = gh(args);
  // `gh pr checks` exits non-zero when a check failed or is pending, yet still
  // prints the rows; only an unparseable answer is a failed read.
  try {
    const rows = JSON.parse(result.stdout);
    if (Array.isArray(rows)) return rows;
  } catch {
    // fall through
  }
  if (NO_REQUIRED.test(result.stderr)) return null;
  throw new Error(`gh ${args.join(" ")} failed: ${result.stderr}`);
}

/**
 * The marker comment for this PR head, if any.
 * @param {object[]} comments - Item comments.
 * @param {number} pr - PR number.
 * @param {string} sha - Head SHA.
 * @returns {object|undefined} The comment.
 */
function markerComment(comments, pr, sha) {
  return comments.find(c => {
    if (!trustedAuthor(c)) return false;
    const match = FAILURE_MARKER.exec(c.body ?? "");
    return match !== null && Number(match[1]) === pr && match[2] === sha;
  });
}

/**
 * The PR number a comment's failure marker names, if it carries one.
 * @param {object} comment - Item comment.
 * @returns {number|null} PR number.
 */
function markerPr(comment) {
  if (!trustedAuthor(comment)) return null;
  const match = FAILURE_MARKER.exec(comment.body ?? "");
  return match === null ? null : Number(match[1]);
}

/**
 * True when the comment was posted by an identity whose markers count.
 * @param {object} comment - Item comment.
 * @returns {boolean} Whether its markers are trusted.
 */
export function trustedAuthor(comment) {
  return MARKER_AUTHORS.includes(comment.user?.login ?? "");
}

/**
 * True when the item gained `lane` after `comment` was posted. Comments alone
 * cannot say a claim happened: a claim path that posts its claim comment once
 * per item leaves no newer comment when it re-claims, but the label event is
 * always recorded.
 * @param {object[]} events - Issue events.
 * @param {object} comment - The marker comment.
 * @param {string} lane - Lane label.
 * @returns {boolean} Whether a later `labeled` event exists.
 */
function laneGainedSince(events, comment, lane) {
  return events.some(
    e =>
      e.event === "labeled" &&
      e.label?.name === lane &&
      String(e.created_at) > String(comment.created_at)
  );
}

/**
 * Read the item's issue events (label history).
 * @param {string} number - Issue number.
 * @param {string} repo - Repository.
 * @param {Function} gh - Runner.
 * @returns {object[]} Events.
 */
function readEvents(number, repo, gh) {
  return readJson(gh, [
    "api",
    `repos/${repo}/issues/${number}/events`,
    "--paginate",
    "--slurp",
  ]).flat();
}

/**
 * True when `comment` is the newest comment carrying any Lisa marker — nothing
 * (a claim, an attempt, a hold) has happened to the item since it was posted.
 * @param {object[]} comments - Item comments, oldest first.
 * @param {object} comment - The marker comment.
 * @returns {boolean} Whether it is the newest.
 */
export function isNewestLisaMarker(comments, comment) {
  // A forged failure marker counts for nothing, including as "something newer".
  const marked = comments.filter(
    c =>
      LISA_MARKER.test(c.body ?? "") &&
      (trustedAuthor(c) || !FAILURE_MARKER.test(c.body ?? ""))
  );
  return marked.at(-1)?.id === comment.id;
}

/**
 * Plan the failure path.
 * @param {object} ctx - Resolved context.
 * @returns {Plan} Plan.
 */
function planFailure(ctx) {
  const { item, view, pr, sha, failing, lanes } = ctx;
  const known = { pr, sha, item };
  const relabel = {
    kind: ACTION.relabel,
    item,
    remove: lanes.claimed,
    add: lanes.ready,
  };
  const claimed = view.labels.includes(lanes.claimed);
  const existing = markerComment(view.comments, pr, sha);
  if (existing) {
    if (
      claimed &&
      !CLEARED_MARKER.test(existing.body) &&
      isNewestLisaMarker(view.comments, existing) &&
      !laneGainedSince(ctx.events(), existing, lanes.claimed)
    )
      return {
        ...known,
        outcome: "relabel-repair",
        reason: "marker posted but the lane move did not land",
        actions: [relabel],
      };
    return stop(
      "already-reported",
      "this PR head already has a [lisa-ci-failed] marker",
      known
    );
  }
  if (!claimed)
    return stop(
      "not-claimed",
      `the item is not in the claimed lane (${lanes.claimed})`,
      known
    );
  const body = [
    `A required check failed on pull request #${pr} at commit ${sha}: ${failing.join(", ")}.`,
    "",
    `Lisa moved this item from \`${lanes.claimed}\` back to \`${lanes.ready}\` so build intake sends the owning agent back to fix the existing pull request. The work is not complete until every required check passes.`,
    "",
    failureMarker(pr, sha),
  ].join("\n");
  return {
    ...known,
    outcome: "redispatch",
    reason: "a required check failed",
    actions: [{ kind: ACTION.comment, item, body }, relabel],
  };
}

/**
 * Plan the clear path.
 * @param {object} ctx - Resolved context.
 * @returns {Plan} Plan.
 */
function planClear(ctx) {
  const { item, view, pr, sha, runId, lanes } = ctx;
  const known = { pr, sha, item };
  // A green head clears every uncleared marker on this PR, not only the one
  // naming this head: once the agent pushes a fix, the failed head is
  // superseded and no run will ever pass on it, so a marker scoped to it alone
  // would stay uncleared — and hold the item "not complete" — forever.
  const open = view.comments.filter(
    c => markerPr(c) === pr && !CLEARED_MARKER.test(c.body)
  );
  if (open.length === 0) {
    if (markerComment(view.comments, pr, sha))
      return stop(
        "already-cleared",
        "the marker for this head is already cleared",
        known
      );
    return stop(
      "nothing-to-clear",
      "every required check passed and no uncleared marker names this PR",
      known
    );
  }
  const actions = open.map(c => ({
    kind: ACTION.editComment,
    commentId: c.id,
    body: `${c.body}\n\nEvery required check now passes on ${sha}; cleared by run ${runId}.\n<!-- [lisa-ci-cleared] run=${runId} -->`,
  }));
  const unclaimed =
    view.labels.includes(lanes.ready) && !view.labels.includes(lanes.claimed);
  const newest = open.find(c => isNewestLisaMarker(view.comments, c));
  if (
    unclaimed &&
    newest !== undefined &&
    !laneGainedSince(ctx.events(), newest, lanes.claimed)
  ) {
    actions.push({
      kind: ACTION.relabel,
      item,
      remove: lanes.ready,
      add: lanes.claimed,
    });
    return {
      ...known,
      outcome: "clear-and-restore",
      reason: "checks passed while the marker left the item unclaimed",
      actions,
    };
  }
  return {
    ...known,
    outcome: "cleared",
    reason: "every required check passed for the marked head",
    actions,
  };
}

/**
 * Decide what one completed run means for its PR's work item. Reads only.
 * @param {{run: object, repository: string, contract: object, gh: Function}} input - Run and readers.
 * @returns {Plan} What to write, and why.
 */
export function planRedispatch({ run, repository, contract, gh }) {
  if (!SHA.test(run?.head_sha ?? ""))
    throw new Error("the run payload carries no concrete head SHA");
  if (String(repository).toLowerCase() !== contract.repository.toLowerCase())
    return stop(
      "foreign-repository",
      `run belongs to ${repository}, not ${contract.repository}`
    );
  const binding = resolveBinding(run, contract, gh);
  if (binding.stop) return { sha: run.head_sha, ...binding.stop };
  const { pr, item } = binding;
  const known = { pr, sha: run.head_sha, item };
  const view = readItem(item, contract.repository, gh);
  if (!view.open)
    return stop("work-item-closed", "the work item is closed", known);
  const checks = readRequiredChecks(pr, contract.repository, gh);
  if (checks === null)
    return stop("no-required-checks", "the PR has no required checks", known);
  const { verdict, failing } = classifyRequiredChecks(checks);
  const ctx = {
    ...known,
    view,
    failing,
    runId: run.id,
    lanes: contract.lifecycle,
    // Read lazily: only a lane repair or restore needs the label history.
    events: () => readEvents(view.number, contract.repository, gh),
  };
  if (verdict === "fail") return planFailure(ctx);
  if (verdict === "pass") return planClear(ctx);
  return stop(
    "checks-pending",
    "no required check has failed and some have not finished",
    known
  );
}

/**
 * Plan a recorded fixture: its event payload plus the gh answers it recorded.
 * @param {{event: object, gh: object}} fixture - Recorded fixture.
 * @param {object} contract - Tracker contract.
 * @returns {Plan} Plan.
 */
export function planFromFixture(fixture, contract) {
  return planFromEvent(fixture.event, contract, recordedGh(fixture.gh));
}

/**
 * Plan a `workflow_run` event payload (or a bare run object).
 * @param {object} event - Event payload.
 * @param {object} contract - Tracker contract.
 * @param {Function} gh - Runner.
 * @returns {Plan} Plan.
 */
function planFromEvent(event, contract, gh) {
  const run = event.workflow_run ?? event;
  const repository = run.repository?.full_name ?? event.repository?.full_name;
  return {
    repository: contract.repository,
    runId: run.id,
    ...planRedispatch({ run, repository, contract, gh }),
  };
}

/**
 * The gh argv and stdin for one planned write.
 * @param {object} action - Planned action.
 * @param {string} repo - Repository.
 * @returns {{args: string[], input?: string}} The call.
 */
function writeCall(action, repo) {
  const number = String(action.item ?? "").slice(
    String(action.item ?? "").lastIndexOf("#") + 1
  );
  if (action.kind === ACTION.comment)
    return {
      args: ["issue", "comment", number, "--repo", repo, "--body-file", "-"],
      input: action.body,
    };
  if (action.kind === ACTION.relabel)
    return {
      args: [
        "issue",
        "edit",
        number,
        "--repo",
        repo,
        "--remove-label",
        action.remove,
        "--add-label",
        action.add,
      ],
    };
  if (action.kind === ACTION.editComment)
    return {
      args: [
        "api",
        "-X",
        "PATCH",
        `repos/${repo}/issues/comments/${action.commentId}`,
        "--input",
        "-",
      ],
      input: JSON.stringify({ body: action.body }),
    };
  throw new Error(`unknown planned action: ${action.kind}`);
}

/**
 * Perform a plan's writes in order, stopping at the first failure.
 * @param {{repository: string, actions: object[]}} plan - Plan.
 * @param {Function} gh - Runner.
 * @returns {void}
 */
export function applyPlan(plan, gh) {
  for (const action of plan.actions) {
    const { args, input } = writeCall(action, plan.repository);
    const result = gh(args, { input, write: true });
    if (!result.ok)
      throw new Error(`gh ${args.join(" ")} failed: ${result.stderr}`);
  }
}

/**
 * Plain-language lines describing a plan.
 * @param {object} plan - Plan.
 * @param {boolean} dryRun - Whether nothing will be written.
 * @returns {string[]} Lines.
 */
function describePlan(plan, dryRun) {
  const prLabel = plan.pr ? `#${plan.pr}` : "(none)";
  const lines = [
    `run ${plan.runId ?? "?"} -> PR ${prLabel} -> work item ${plan.item ?? "(none)"}`,
    `outcome: ${plan.outcome} — ${plan.reason}${dryRun ? " (dry run: nothing written)" : ""}`,
  ];
  for (const action of plan.actions) {
    const verb = dryRun ? "planned" : "done";
    if (action.kind === ACTION.comment)
      lines.push(
        `${verb}: comment on ${action.item}: ${action.body.split("\n")[0]}`
      );
    if (action.kind === ACTION.relabel)
      lines.push(
        `${verb}: move ${action.item} from ${action.remove} to ${action.add}`
      );
    if (action.kind === ACTION.editComment)
      lines.push(`${verb}: mark comment ${action.commentId} cleared`);
  }
  return lines;
}

/**
 * Parse CLI flags.
 * @param {string[]} argv - Arguments.
 * @returns {{runId?: string, payload?: string, dryRun: boolean}} Options.
 */
function parseArgs(argv) {
  const options = { dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--dry-run") options.dryRun = true;
    else if (argv[i] === "--run-id") options.runId = argv[++i];
    else if (argv[i] === "--payload") options.payload = argv[++i];
    else throw new Error(`unknown argument: ${argv[i]}`);
  }
  if (!options.runId === !options.payload)
    throw new Error("pass exactly one of --run-id <id> or --payload <file>");
  if (options.runId !== undefined && !/^[1-9]\d*$/u.test(options.runId))
    throw new Error(
      `--run-id must be a positive integer, got '${options.runId}'`
    );
  return options;
}

/**
 * Load the event and choose the runner it is read through.
 * @param {{runId?: string, payload?: string, dryRun: boolean}} options - Options.
 * @param {object} contract - Tracker contract.
 * @param {Function} gh - Live runner.
 * @returns {{event: object, gh: Function}} Event and runner.
 */
function loadEvent(options, contract, gh) {
  if (options.runId)
    return {
      event: readJson(gh, [
        "api",
        `repos/${contract.repository}/actions/runs/${options.runId}`,
      ]),
      gh,
    };
  const data = JSON.parse(readFileSync(options.payload, "utf8"));
  if (data.gh === undefined) return { event: data, gh };
  if (!options.dryRun)
    throw new Error("a recorded fixture can only be replayed with --dry-run");
  return { event: data.event, gh: recordedGh(data.gh) };
}

/**
 * CLI entry: plan one run and, unless `--dry-run`, apply it.
 * @param {string[]} argv - Arguments.
 * @param {{gh?: Function, write?: Function, contract?: object}} [deps] - Injectables.
 * @returns {number} Exit code: 0 decided, 1 failed read/write, 2 bad usage.
 */
export function main(argv, deps = {}) {
  const write = deps.write ?? (line => process.stdout.write(`${line}\n`));
  let options;
  let source;
  try {
    options = parseArgs(argv);
    const contract = deps.contract ?? trackerContract();
    source = { contract, ...loadEvent(options, contract, deps.gh ?? liveGh) };
  } catch (error) {
    write(`lisa-ci-failure-redispatch: ${error.message}`);
    return 2;
  }
  try {
    const plan = planFromEvent(source.event, source.contract, source.gh);
    if (!options.dryRun) applyPlan(plan, source.gh);
    for (const line of describePlan(plan, options.dryRun)) write(line);
    write(JSON.stringify(plan, null, 2));
    return 0;
  } catch (error) {
    write(`lisa-ci-failure-redispatch: ${error.message}`);
    return 1;
  }
}

if (invokedAsScript(import.meta.url))
  process.exitCode = main(process.argv.slice(2));
