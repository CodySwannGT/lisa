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
 * - Every required check PASSED when each bucket is `pass` or `skipping` AND
 *   every required context the PR's base-branch rulesets name has reported.
 *   `gh pr checks --required` lists only checks that reported, so a required
 *   context with no row — CI never dispatched, or not started — is pending,
 *   not passed (CodySwannGT/lisa#4711). A reported failure is still a failure
 *   however many contexts are missing.
 * - Anything else is still running: no write.
 *
 * What triggers a decision (CodySwannGT/lisa#4678): a CI workflow run, and
 * also a third-party required check (CodeRabbit, GitGuardian) completing on
 * its own schedule — a `check_run` or a `status` event. Those are gated first:
 * a pending status, a context that is not required on the default branch's
 * rulesets, and — defensively, since GitHub does not deliver `check_run` for
 * Actions-created suites and workflow_run covers CI jobs — an Actions-owned
 * check run all end with no write and no further read. A passing gate runs the same pipeline; the
 * decision logic is shared. `--head-sha` re-evaluates a past head by hand.
 *
 * Writes need positive evidence. A run for a superseded head, a fork PR, a PR
 * with no or a foreign `Work-Item:`, a closed item, or an item outside the
 * claimed lane all end with no write.
 *
 * Repo-only: this is the Lisa monorepo's own automation and is deliberately
 * NOT shipped to host projects (CodySwannGT/lisa#4607, Out of Scope).
 *
 * What supersedes a marker (CodySwannGT/lisa#4707): a later comment carrying
 * a Lisa marker that is not a claim, posted by a trusted author — the
 * workflow's identity, the item's author, or a configured
 * `sessionManager.trustedAuthorIds` entry. Supersession by trusted author was
 * chosen over explicit-only supersession (a `[lisa-ci-cleared]` edit or a
 * newer `[lisa-ci-failed]` marker) because a trusted human-gate hold posted
 * after the marker must still stop CI rework.
 * @module scripts/lisa-ci-failure-redispatch
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";

import { invokedAsScript } from "../all/copy-overwrite/scripts/lib/invoked-as-script.mjs";
import {
  soleWorkItem,
  trackerContract,
} from "../all/copy-overwrite/scripts/lisa-work-item.mjs";
import { parseIdEntries } from "../plugins/src/base/scripts/operator-id-kinds.mjs";

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
/**
 * Dispatch-bookkeeping markers: the lifecycle claim, build intake's legacy
 * claim, and the session manager's own notes (stop, release, worker failed,
 * answer delivered). None of them says anything about the PR's checks.
 */
const CLAIM_MARKERS =
  /\[(?:lisa-tracker-claim|claude-build-intake|lisa-session-manager)\]/gu;
/** A plain trusted-author entry that is a numeric account id. */
const ALL_DIGITS = /^\d+$/u;
const NO_REQUIRED = /no (?:required )?checks reported/iu;
/** Read every page of a REST list as one array of pages. */
const PAGINATE = Object.freeze(["--paginate", "--slurp"]);

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
 * @returns {{stop?: object, pr?: number, baseRef?: string, item?: string}} A stop decision or the binding.
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
    "number,state,body,headRefOid,isCrossRepository,baseRefName",
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
      baseRef: pr.baseRefName,
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
    ...PAGINATE,
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
 * True when every Lisa marker the comment carries is a claim marker. A claim
 * is dispatch bookkeeping: the session manager claims an item before its
 * worker reads the markers, and a re-claim can post another claim comment,
 * so a claim says nothing about the PR's checks and never supersedes.
 * @param {object} comment - Item comment.
 * @returns {boolean} Whether it is a claim-only comment.
 */
export function claimOnly(comment) {
  const body = String(comment.body ?? "");
  return (
    LISA_MARKER.test(body) &&
    !LISA_MARKER.test(body.replaceAll(CLAIM_MARKERS, ""))
  );
}

/**
 * True when a comment posted after an uncleared failure marker means the
 * marker no longer describes the item (CodySwannGT/lisa#4707). It must carry
 * a Lisa marker and not be claim-only; a failure marker counts only from
 * {@link MARKER_AUTHORS}, any other marker only from a `trust`ed author.
 * Anyone can comment on a public repository, so an outsider's `[lisa-x] hi`
 * must not turn CI rework off.
 * @param {object} comment - A later item comment.
 * @param {(comment: object) => boolean} trust - Whose markers count.
 * @returns {boolean} Whether it supersedes the marker.
 */
export function supersedes(comment, trust) {
  const body = String(comment.body ?? "");
  if (!LISA_MARKER.test(body) || claimOnly(comment)) return false;
  return FAILURE_MARKER.test(body) ? trustedAuthor(comment) : trust(comment);
}

/**
 * The kind a parsed trusted-author entry is matched as. Kind-keyed entries
 * keep their own kind; a plain entry keeps the meaning the answer matcher
 * gives it (#4571): all digits is a numeric account id only — anyone can
 * register an all-digit login — and anything else is a login.
 * @param {{kind: string, value?: string}} entry - Parsed entry.
 * @returns {string} `login`, `id`, or `invalid`.
 */
function entryKind(entry) {
  if (entry.kind !== "plain") return entry.kind;
  return ALL_DIGITS.test(entry.value) ? "id" : "login";
}

/**
 * Whether a configured `sessionManager.trustedAuthorIds` entry names a GitHub
 * comment author.
 * @param {{kind: string, value?: string}} entry - Parsed entry.
 * @param {{login?: string, id?: number|string}|undefined} user - Comment author.
 * @returns {boolean} Whether it matches.
 */
function entryNames(entry, user) {
  const kind = entryKind(entry);
  if (kind === "login")
    return typeof user?.login === "string" && user.login === entry.value;
  if (kind === "id") return user?.id != null && String(user.id) === entry.value;
  return false;
}

/**
 * True when two GitHub users are the same account: by numeric id when both
 * carry one, else by login.
 * @param {object|null|undefined} a - A user.
 * @param {object|null|undefined} b - Another user.
 * @returns {boolean} Whether they match.
 */
function sameUser(a, b) {
  if (!a || !b) return false;
  if (a.id != null && b.id != null) return String(a.id) === String(b.id);
  return typeof a.login === "string" && a.login !== "" && a.login === b.login;
}

/**
 * Build the trusted-author predicate for later non-failure markers: the
 * workflow's identity ({@link MARKER_AUTHORS}), a configured
 * `sessionManager.trustedAuthorIds` entry, or the item's author. The item's
 * author is read lazily — only when a later marker from someone else needs
 * judging — and at most once.
 * @param {{trustedAuthorIds?: unknown, itemAuthor: () => object|null}} input - Configured entries and the author reader.
 * @returns {(comment: object) => boolean} The predicate.
 */
export function markerTrust({ trustedAuthorIds, itemAuthor }) {
  const entries = parseIdEntries(trustedAuthorIds);
  const author = { read: false, user: null };
  return comment => {
    if (trustedAuthor(comment)) return true;
    if (entries.some(entry => entryNames(entry, comment.user))) return true;
    if (!author.read) Object.assign(author, { read: true, user: itemAuthor() });
    return sameUser(comment.user, author.user);
  };
}

/**
 * Read the work item's author (the REST issue's `user`). Throws naming the
 * call when the read fails, so a caller falls back the way it does for any
 * failed read.
 * @param {string} number - Issue number.
 * @param {string} repo - Repository.
 * @param {Function} gh - Runner.
 * @returns {object|null} The author, or null when the issue names none.
 */
export function readItemAuthor(number, repo, gh) {
  return readJson(gh, ["api", `repos/${repo}/issues/${number}`]).user ?? null;
}

/**
 * The configured `sessionManager.trustedAuthorIds`, the local override's list
 * first. Fails safe: a missing or malformed config, or a list that is not an
 * array, trusts nobody beyond the bot and the item's author.
 * @param {string} [root] - Project root.
 * @returns {unknown[]} Configured entries.
 */
export function readTrustedAuthorIds(root = process.cwd()) {
  const declared = [".lisa.config.local.json", ".lisa.config.json"]
    .map(name => {
      try {
        const config = JSON.parse(readFileSync(join(root, name), "utf8"));
        return config?.sessionManager?.trustedAuthorIds;
      } catch {
        return undefined;
      }
    })
    .find(list => list !== undefined);
  return Array.isArray(declared) ? declared : [];
}

/**
 * The tracker contract with the configured trusted authors attached, unless
 * the caller already supplied them. Both CLIs read through this so the two
 * dispatch paths trust the same people.
 * @param {object} contract - Tracker contract.
 * @param {string} [root] - Project root.
 * @returns {object} Contract carrying `trustedAuthorIds`.
 */
export function withTrustedAuthors(contract, root) {
  if (contract.trustedAuthorIds !== undefined) return contract;
  return { ...contract, trustedAuthorIds: readTrustedAuthorIds(root) };
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
    ...PAGINATE,
  ]).flat();
}

/**
 * True when `comment` is the newest counted Lisa marker on the item: no later
 * comment supersedes it (see {@link supersedes}). This is the one predicate
 * both dispatch paths use — the producer here and the route helper
 * `scripts/lisa-ci-rework-route.mjs` — so they cannot disagree
 * (CodySwannGT/lisa#4707).
 * @param {object[]} comments - Item comments, oldest first.
 * @param {object} comment - The marker comment.
 * @param {(comment: object) => boolean} [trust] - Whose non-failure markers
 *   count; build it with {@link markerTrust}. Defaults to the bot only.
 * @returns {boolean} Whether it is the newest.
 */
export function isNewestLisaMarker(comments, comment, trust = trustedAuthor) {
  const index = comments.findIndex(c => c.id === comment.id);
  return (
    index !== -1 && !comments.slice(index + 1).some(c => supersedes(c, trust))
  );
}

/**
 * True when nothing has happened to the item since `marker`, so a lane write
 * on its behalf is still safe: it is the newest counted marker (the shared
 * predicate the route helper uses), no trusted author has claimed the item
 * since, and the label history shows no claim since. A claim never makes the
 * marker stale for routing, but it does mean the lane has moved, so the lane
 * paths veto on it where the route helper does not.
 * @param {object} ctx - Resolved context.
 * @param {object} marker - The marker comment.
 * @returns {boolean} Whether the item is untouched since.
 */
function untouchedSince(ctx, marker) {
  const { view, lanes, trust } = ctx;
  const index = view.comments.findIndex(c => c.id === marker.id);
  const claimedSince = view.comments
    .slice(index + 1)
    .some(c => claimOnly(c) && trust(c));
  return (
    isNewestLisaMarker(view.comments, marker, trust) &&
    !claimedSince &&
    !laneGainedSince(ctx.events(), marker, lanes.claimed)
  );
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
      untouchedSince(ctx, existing)
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
  const newest = open.find(c =>
    isNewestLisaMarker(view.comments, c, ctx.trust)
  );
  if (unclaimed && newest !== undefined && untouchedSince(ctx, newest)) {
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
 * Hold a pass whose reported rows leave a required context unreported.
 *
 * `gh pr checks --required` lists only checks that have REPORTED, so a
 * required check that never ran — CI not dispatched on a conflicting PR, or
 * not started yet — is missing from the rows rather than failing in them
 * (CodySwannGT/lisa#4711). The base branch's rulesets are the authority on
 * what is required; a context they name with no row has not passed, so the
 * pass is pending. Read only on a pass, or when no required row has reported
 * at all: a reported failure is a failure whatever else is missing, and a
 * pending verdict is already pending.
 * @param {Array<{name: string}>} checks - Reported required rows.
 * @param {string} baseRef - The PR's base branch.
 * @param {object} contract - Tracker contract.
 * @param {Function} gh - Runner.
 * @param {object} known - Fields already known.
 * @returns {Plan|null} A `checks-pending` stop, or null when nothing is unreported.
 */
function holdUnreported(checks, baseRef, contract, gh, known) {
  if (typeof baseRef !== "string" || baseRef === "")
    throw new Error("the pull request read carries no base branch");
  const required = requiredContexts(contract.repository, baseRef, gh);
  const reported = new Set(checks.map(c => c.name));
  const unreported = [...required].filter(context => !reported.has(context));
  if (unreported.length === 0) return null;
  return stop(
    "checks-pending",
    `${unreported.length} of ${required.size} required checks on ${baseRef} have not reported on this head: ${unreported.join(", ")}`,
    known
  );
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
  // gh answers "no required checks reported" both when nothing is required
  // and when nothing required has reported YET; only the ruleset tells them
  // apart.
  if (checks === null)
    return (
      holdUnreported([], binding.baseRef, contract, gh, known) ??
      stop(
        "no-required-checks",
        `the rulesets on ${binding.baseRef} require no status checks`,
        known
      )
    );
  const { verdict, failing } = classifyRequiredChecks(checks);
  const ctx = {
    ...known,
    view,
    failing,
    runId: run.id,
    lanes: contract.lifecycle,
    // Read lazily: only a lane repair or restore needs the label history.
    events: () => readEvents(view.number, contract.repository, gh),
    // The same supersession rule the route helper applies (#4707).
    trust: markerTrust({
      trustedAuthorIds: contract.trustedAuthorIds,
      itemAuthor: () => readItemAuthor(view.number, contract.repository, gh),
    }),
  };
  if (verdict === "fail") return planFailure(ctx);
  if (verdict === "pass")
    return (
      holdUnreported(checks, binding.baseRef, contract, gh, known) ??
      planClear(ctx)
    );
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
 * @param {Record<string, string|undefined>} [env] - Environment (`GITHUB_RUN_ID`).
 * @returns {Plan} Plan.
 */
export function planFromFixture(fixture, contract, env = {}) {
  return planFromEvent(fixture.event, contract, recordedGh(fixture.gh), env);
}

/**
 * The Actions run that is making this decision, when the environment names
 * one. A third-party completion has no CI run of its own, so the run that
 * clears a marker is this re-dispatch run — linkable from the comment.
 * @param {Record<string, string|undefined>} env - Environment.
 * @returns {number|undefined} Positive run id, or undefined.
 */
function actingRunId(env) {
  const value = String(env.GITHUB_RUN_ID ?? "");
  return /^[1-9]\d*$/u.test(value) ? Number(value) : undefined;
}

/**
 * Reduce a `check_run` or `status` event to the run shape `planRedispatch`
 * reads, plus the context it reports and why it can be ignored outright.
 *
 * The cleared marker records `run=<digits>`, so every mode needs a numeric
 * run id: the acting Actions run (`GITHUB_RUN_ID`) when there is one, else the
 * event's own numeric id (the check run id, or the status id).
 * @param {object} event - Event payload.
 * @param {Record<string, string|undefined>} env - Environment.
 * @returns {{run: object, context: string, ignore?: object}|null} Null for any other event.
 */
function thirdPartyCompletion(event, env) {
  const repository = event.repository;
  if (event.check_run) {
    const check = event.check_run;
    return {
      context: check.name,
      run: {
        id: actingRunId(env) ?? check.id,
        head_sha: check.head_sha,
        pull_requests: check.pull_requests ?? [],
        repository,
      },
      ignore:
        check.app?.slug === "github-actions"
          ? stop(
              "ignored-actions-check",
              "a check run created by GitHub Actions is covered by workflow_run"
            )
          : undefined,
    };
  }
  if (typeof event.context === "string" && typeof event.state === "string")
    return {
      context: event.context,
      run: {
        id: actingRunId(env) ?? event.id,
        head_sha: event.sha,
        pull_requests: [],
        repository,
      },
      ignore:
        event.state === "pending"
          ? stop("ignored-pending-status", "a pending status has not finished")
          : undefined,
    };
  return null;
}

/**
 * The required status-check contexts on a branch, read from its rulesets.
 * Read live rather than hard-coded, so changing which checks are required
 * needs no change here.
 * @param {string} repo - Repository.
 * @param {string} branch - Branch the rulesets apply to.
 * @param {Function} gh - Runner.
 * @returns {Set<string>} Required contexts.
 */
function requiredContexts(repo, branch, gh) {
  const rules = readJson(gh, [
    "api",
    `repos/${repo}/rules/branches/${encodeURIComponent(branch)}`,
    ...PAGINATE,
  ]).flat();
  return new Set(
    rules
      .filter(rule => rule.type === "required_status_checks")
      .flatMap(rule => rule.parameters?.required_status_checks ?? [])
      .map(check => check.context)
  );
}

/**
 * Plan a `workflow_run`, `check_run` or `status` event payload (or a bare run
 * object). A check run or status first has to concern a finished, required,
 * non-Actions context; then it runs the same pipeline a `workflow_run` does.
 * @param {object} event - Event payload.
 * @param {object} contract - Tracker contract.
 * @param {Function} gh - Runner.
 * @param {Record<string, string|undefined>} [env] - Environment.
 * @returns {Plan} Plan.
 */
function planFromEvent(event, contract, gh, env = {}) {
  const completion = thirdPartyCompletion(event, env);
  const run = completion?.run ?? event.workflow_run ?? event;
  const repository = run.repository?.full_name ?? event.repository?.full_name;
  const base = { repository: contract.repository, runId: run.id };
  if (completion?.ignore) return { ...base, ...completion.ignore };
  if (completion) {
    const branch = event.repository?.default_branch ?? "main";
    if (
      !requiredContexts(contract.repository, branch, gh).has(completion.context)
    )
      return {
        ...base,
        ...stop(
          "not-required-context",
          `'${completion.context}' is not a required check on ${branch}`
        ),
      };
  }
  return { ...base, ...planRedispatch({ run, repository, contract, gh }) };
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
 * @returns {{runId?: string, payload?: string, headSha?: string, dryRun: boolean}} Options.
 */
function parseArgs(argv) {
  const options = { dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--dry-run") options.dryRun = true;
    else if (argv[i] === "--run-id") options.runId = argv[++i];
    else if (argv[i] === "--payload") options.payload = argv[++i];
    else if (argv[i] === "--head-sha") options.headSha = argv[++i];
    else throw new Error(`unknown argument: ${argv[i]}`);
  }
  const sources = [options.runId, options.payload, options.headSha];
  if (sources.filter(Boolean).length !== 1)
    throw new Error(
      "pass exactly one of --run-id <id>, --payload <file> or --head-sha <sha>"
    );
  if (options.runId !== undefined && !/^[1-9]\d*$/u.test(options.runId))
    throw new Error(
      `--run-id must be a positive integer, got '${options.runId}'`
    );
  if (options.headSha !== undefined && !SHA.test(options.headSha))
    throw new Error(
      `--head-sha must be a full 40-character lowercase commit SHA, got '${options.headSha}'`
    );
  return options;
}

/**
 * Load the event and choose the runner it is read through.
 *
 * `--head-sha` re-evaluates a head whose third-party check already completed
 * (a manual dry run against the past). It names no context, so it skips the
 * required-context gate and runs the pipeline as a bare run; the PR comes from
 * searching for the SHA, and the run id is the acting run (`GITHUB_RUN_ID`),
 * or 0 when there is none — numeric either way, so a cleared marker stays
 * well-formed.
 * @param {{runId?: string, payload?: string, headSha?: string, dryRun: boolean}} options - Options.
 * @param {object} contract - Tracker contract.
 * @param {Function} gh - Live runner.
 * @param {Record<string, string|undefined>} env - Environment.
 * @returns {{event: object, gh: Function}} Event and runner.
 */
function loadEvent(options, contract, gh, env) {
  if (options.headSha)
    return {
      event: {
        id: actingRunId(env) ?? 0,
        head_sha: options.headSha,
        pull_requests: [],
        repository: { full_name: contract.repository },
      },
      gh,
    };
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
 * @param {{gh?: Function, write?: Function, contract?: object, env?: Record<string, string|undefined>}} [deps] - Injectables.
 * @returns {number} Exit code: 0 decided, 1 failed read/write, 2 bad usage.
 */
export function main(argv, deps = {}) {
  const write = deps.write ?? (line => process.stdout.write(`${line}\n`));
  const env = deps.env ?? process.env;
  let options;
  let source;
  try {
    options = parseArgs(argv);
    const contract = withTrustedAuthors(deps.contract ?? trackerContract());
    source = {
      contract,
      ...loadEvent(options, contract, deps.gh ?? liveGh, env),
    };
  } catch (error) {
    write(`lisa-ci-failure-redispatch: ${error.message}`);
    return 2;
  }
  try {
    const plan = planFromEvent(source.event, source.contract, source.gh, env);
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
