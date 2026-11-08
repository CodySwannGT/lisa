#!/usr/bin/env node
/**
 * Decide whether a dispatched work item goes back to its existing PR.
 *
 * The gap (CodySwannGT/lisa#4677): when a required check fails on an agent's
 * PR, `lisa-ci-failure-redispatch` posts a bot-authored
 * `<!-- [lisa-ci-failed] pr=<n> sha=<head> -->` marker on the work item and
 * moves it back to the ready lane. Build intake reads that marker and sends the
 * agent back to the PR, but the session manager dispatches through
 * `lisa-implement` → `lisa-track`, which never looked — so a bounced item was
 * rebuilt from scratch and could open a second PR for the same work.
 *
 * This script is the one place the trust rules live, so both dispatch paths
 * (`lisa-track` Phase 3 and `lisa-github-build-intake` 3b) reach the same
 * answer. It reads the item's comments — which the caller must do BEFORE it
 * posts its own claim comment, a newer Lisa marker that would hide the signal —
 * and, when the newest counted marker is an uncleared failure marker, verifies
 * the PR it names. The marker patterns, the trusted-author predicate, the
 * newest-marker predicate and the comment reader are imported from the
 * producer script so the two cannot drift.
 *
 * Read-only: it never writes to the tracker. Every failed read routes to the
 * normal path, because building again is recoverable and a wrong route is not.
 *
 * Repo-only: like its producer, it lives in this repository's `scripts/` and
 * is NOT shipped to host projects; `lisa-track` runs it only when it exists.
 * @module scripts/lisa-ci-rework-route
 */
import { readFileSync } from "node:fs";
import process from "node:process";

import { invokedAsScript } from "../all/copy-overwrite/scripts/lib/invoked-as-script.mjs";
import {
  soleWorkItem,
  trackerContract,
} from "../all/copy-overwrite/scripts/lisa-work-item.mjs";
import {
  CLEARED_MARKER,
  FAILURE_MARKER,
  MARKER_AUTHORS,
  isNewestLisaMarker,
  liveGh,
  readItemComments,
  recordedGh,
  trustedAuthor,
} from "./lisa-ci-failure-redispatch.mjs";

/**
 * Bot-authored failure markers for one PR at which dispatch stops retrying and
 * blocks for a person. Mirrors build intake 3b's "3 or more" loop bound: every
 * bounce gives the item a fresh ready-lane entry, so without a bound a PR that
 * keeps failing would be re-dispatched forever.
 */
export const CI_LOOP_BOUND = 3;

/**
 * The one decision the CLI prints. `ci-rework` carries the PR to drive;
 * `blocked` is the loop bound; `implement` carries why the marker was ignored.
 * @typedef {object} RouteDecision
 * @property {"ci-rework"|"blocked"|"implement"} route - Where the work goes.
 * @property {string} [reason] - Reason code for `implement` and `blocked`.
 * @property {string} [detail] - Plain-language reason.
 * @property {string} [item] - Canonical work item.
 * @property {number} [pr] - The marker's pull request.
 * @property {string} [sha] - The head the failure was observed on.
 * @property {string} [headRefName] - The pull request's head branch.
 * @property {string[]} [failingChecks] - Failing check names from the marker comment.
 * @property {number} [markerCount] - Bot-authored failure markers for this PR.
 */

/** The first line the producer writes on a failure comment. */
const FAILURE_LINE =
  /^A required check failed on pull request #\d+ at commit [0-9a-f]{40}: (.+)\.$/mu;
const ITEM_NUMBER = /^[1-9]\d*$/u;
const ITEM_REF = /^([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)#([1-9]\d*)$/u;
const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;

/**
 * A decision to resolve and implement the item the normal way.
 * @param {string} reason - Short reason code.
 * @param {string} detail - Plain-language reason.
 * @returns {RouteDecision} Decision.
 */
function implement(reason, detail) {
  return { route: "implement", reason, detail };
}

/**
 * The failing check names on a failure comment's first line.
 * @param {string} body - Comment body.
 * @returns {string[]} Check names; empty when the line is not the producer's.
 */
export function failingChecksFrom(body) {
  const match = FAILURE_LINE.exec(String(body ?? ""));
  return match === null ? [] : match[1].split(", ");
}

/**
 * True when the comment carries a failure marker, whoever wrote it.
 * @param {object} comment - Item comment.
 * @returns {boolean} Whether it carries one.
 */
function carriesFailure(comment) {
  return FAILURE_MARKER.test(comment.body ?? "");
}

/**
 * Pick the failure marker that could count, or say why none does.
 * @param {object[]} comments - Item comments, oldest first.
 * @returns {{marker?: object, decision?: object}} The marker or a decision.
 */
function judgeMarker(comments) {
  const marker = comments
    .filter(c => carriesFailure(c) && trustedAuthor(c))
    .at(-1);
  if (marker === undefined) {
    const forged = comments.findLast(carriesFailure);
    if (forged === undefined)
      return {
        decision: implement(
          "no-marker",
          "the item carries no [lisa-ci-failed] marker"
        ),
      };
    return {
      decision: implement(
        "untrusted-author",
        `the [lisa-ci-failed] marker was posted by ${forged.user?.login ?? "an unknown author"}, not ${MARKER_AUTHORS.join(" or ")}; ignored`
      ),
    };
  }
  if (!isNewestLisaMarker(comments, marker))
    return {
      decision: implement(
        "not-newest",
        "a newer Lisa marker was posted after the [lisa-ci-failed] marker, so it no longer describes the item"
      ),
    };
  if (CLEARED_MARKER.test(marker.body))
    return {
      decision: implement(
        "cleared",
        "the [lisa-ci-failed] marker is cleared: a later run passed every required check"
      ),
    };
  return { marker };
}

/**
 * Check the named PR is open, same-repository and bound to this item.
 * @param {object} view - `gh pr view` JSON.
 * @param {string} item - Canonical `owner/repo#n`.
 * @param {object} contract - Tracker contract scoped to the item's repository.
 * @returns {RouteDecision|null} An implement decision, or null when the PR checks out.
 */
function judgePull(view, item, contract) {
  if (view.state !== "OPEN")
    return implement(
      "pull-request-not-open",
      `the marker's pull request is ${view.state}`
    );
  if (view.isCrossRepository)
    return implement(
      "fork-pull-request",
      "the marker's pull request comes from a fork"
    );
  let bound;
  try {
    bound = soleWorkItem(view.body ?? "", contract, "pull-request body");
  } catch (error) {
    return implement("other-work-item", String(error.message));
  }
  if (bound.toLowerCase() !== item.toLowerCase())
    return implement(
      "other-work-item",
      `the marker's pull request is bound to ${bound}, not ${item}`
    );
  return null;
}

/**
 * Read one gh JSON answer, or throw naming the call.
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
 * Route a counted marker: verify its PR, then apply the loop bound.
 * @param {{marker: object, comments: object[], item: string, repository: string, contract: object, gh: Function}} ctx - Context.
 * @returns {RouteDecision} Decision.
 */
function routeMarker({ marker, comments, item, repository, contract, gh }) {
  const [, prText, sha] = FAILURE_MARKER.exec(marker.body);
  const pr = Number(prText);
  const view = readJson(gh, [
    "pr",
    "view",
    prText,
    "--repo",
    repository,
    "--json",
    "state,isCrossRepository,body,headRefName",
  ]);
  const refused = judgePull(view, item, { ...contract, repository });
  if (refused) return refused;
  const markerCount = comments.filter(
    c =>
      trustedAuthor(c) && Number(FAILURE_MARKER.exec(c.body ?? "")?.[1]) === pr
  ).length;
  const failingChecks = failingChecksFrom(marker.body);
  if (markerCount >= CI_LOOP_BOUND)
    return {
      route: "blocked",
      reason: "ci-loop-bound",
      detail: `pull request #${pr} has failed its required checks ${markerCount} times; stop retrying and ask a person`,
      item,
      pr,
      sha,
      failingChecks,
      markerCount,
    };
  return {
    route: "ci-rework",
    item,
    pr,
    sha,
    headRefName: view.headRefName,
    failingChecks,
    markerCount,
  };
}

/**
 * Decide the dispatch route for one GitHub work item. Reads only.
 * @param {{item: string, contract: object, gh: Function, repository?: string}} input - Item number, contract, runner.
 * @returns {RouteDecision} `ci-rework`, `blocked`, or `implement` decision.
 */
export function decideRoute({ item, contract, gh, repository }) {
  if (contract?.provider !== "github")
    return implement(
      "tracker-not-github",
      "only the GitHub tracker carries [lisa-ci-failed] markers"
    );
  const repo = repository ?? contract.repository;
  const ref = `${repo}#${item}`;
  try {
    const comments = readItemComments(String(item), repo, gh);
    const { marker, decision } = judgeMarker(comments);
    if (decision) return decision;
    return routeMarker({
      marker,
      comments,
      item: ref,
      repository: repo,
      contract,
      gh,
    });
  } catch (error) {
    return implement(
      "read-failed",
      `could not read the item or its pull request: ${error.message}`
    );
  }
}

/**
 * Decide the route from a recorded fixture: the gh answers it recorded.
 * @param {{gh: object}} fixture - Recorded fixture.
 * @param {string} item - Item number.
 * @param {object} contract - Tracker contract.
 * @returns {RouteDecision} Decision.
 */
export function routeFromFixture(fixture, item, contract) {
  return decideRoute({ item, contract, gh: recordedGh(fixture.gh) });
}

/**
 * Parse CLI flags.
 * @param {string[]} argv - Arguments.
 * @returns {{item: string, repository?: string, payload?: string}} Options.
 */
function parseArgs(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i += 2) {
    const [flag, value] = [argv[i], argv[i + 1]];
    if (!["--item", "--repo", "--payload"].includes(flag))
      throw new Error(`unknown argument: ${flag}`);
    if (value === undefined) throw new Error(`${flag} needs a value`);
    flags[flag.slice(2)] = value;
  }
  const ref = ITEM_REF.exec(flags.item ?? "");
  if (ref === null && !ITEM_NUMBER.test(flags.item ?? ""))
    throw new Error("pass --item <n> or --item <owner>/<repo>#<n>");
  if (flags.repo !== undefined && !REPO.test(flags.repo))
    throw new Error(`--repo must be <owner>/<repo>, got '${flags.repo}'`);
  if (ref && flags.repo && ref[1].toLowerCase() !== flags.repo.toLowerCase())
    throw new Error(`--item ${flags.item} is not in --repo ${flags.repo}`);
  return {
    item: ref ? ref[2] : flags.item,
    repository: flags.repo ?? ref?.[1],
    payload: flags.payload,
  };
}

/**
 * CLI entry: print one JSON decision line.
 * @param {string[]} argv - Arguments.
 * @param {{gh?: Function, write?: Function, contract?: object}} [deps] - Injectables.
 * @returns {number} Exit code: 0 decided (any route), 2 bad usage or configuration.
 */
export function main(argv, deps = {}) {
  const write = deps.write ?? (line => process.stdout.write(`${line}\n`));
  try {
    const options = parseArgs(argv);
    const contract = deps.contract ?? trackerContract();
    const gh = options.payload
      ? recordedGh(JSON.parse(readFileSync(options.payload, "utf8")).gh)
      : (deps.gh ?? liveGh);
    write(JSON.stringify(decideRoute({ ...options, contract, gh })));
    return 0;
  } catch (error) {
    write(`lisa-ci-rework-route: ${error.message}`);
    return 2;
  }
}

if (invokedAsScript(import.meta.url))
  process.exitCode = main(process.argv.slice(2));
