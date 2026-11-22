/**
 * The reads the in-memory hosting platform answers
 * (CodySwannGT/lisa#4997).
 *
 * Each route answers the one kind of path it recognises and leaves every
 * other to the next. The last one hands whatever is left to the stand-in
 * `lisa controls protect` uses, which holds the merge-protection settings.
 * @module tests/unit/controls/support/fake-canary-reads
 */
import {
  NOT_FOUND,
  conclusions,
  ok,
  pullAt,
  pullDocument,
  type Call,
  type Route,
  type State,
} from "./fake-canary-state.js";
import { ACTIONS_APP_ID, type FakeGhResult } from "./fake-github.js";

/** What a route answers: nothing when the path is not its own. */
type Answer = FakeGhResult | undefined;

/**
 * The repository itself: its default branch and what the account may do.
 * @param state - What the platform holds
 * @param call - The request
 * @returns The answer, or nothing when the path is not this one
 */
function readRepository(state: State, call: Call): Answer {
  const { push } = state.options;
  return call.resource === ""
    ? ok({
        full_name: state.options.repo,
        default_branch: "main",
        ...(push === null
          ? {}
          : { permissions: { admin: false, push: push ?? true } }),
      })
    : undefined;
}

/**
 * The commit one branch points at.
 * @param state - What the platform holds
 * @param call - The request
 * @returns The answer, or nothing when the path is not this one
 */
function readRef(state: State, call: Call): Answer {
  const name = /^git\/ref\/heads\/(.+)$/u.exec(call.resource)?.[1];
  if (name === undefined) return undefined;
  const sha = state.refs.get(name);
  return sha === undefined
    ? NOT_FOUND
    : ok({ ref: `refs/heads/${name}`, object: { sha } });
}

/**
 * Every branch whose name starts with a prefix.
 * @param state - What the platform holds
 * @param call - The request
 * @returns The answer, or nothing when the path is not this one
 */
function readMatchingRefs(state: State, call: Call): Answer {
  const prefix = /^git\/matching-refs\/heads\/(.*)$/u.exec(call.resource)?.[1];
  return prefix === undefined
    ? undefined
    : ok(
        [...state.refs]
          .filter(([name]) => name.startsWith(prefix))
          .map(([name, sha]) => ({
            ref: `refs/heads/${name}`,
            object: { sha },
          }))
      );
}

/**
 * One commit, tree or file.
 * @param state - What the platform holds
 * @param call - The request
 * @returns The answer, or nothing when the path is not this one
 */
function readObject(state: State, call: Call): Answer {
  const [, kind, sha = ""] =
    /^git\/(commits|trees|blobs)\/(.+)$/u.exec(call.resource) ?? [];
  const { objects } = state;
  const commit = objects.commits.get(sha);
  const found: Readonly<Record<string, unknown>> = {
    commits:
      commit === undefined
        ? undefined
        : { sha, tree: { sha: commit.tree }, message: commit.message },
    trees: objects.trees.has(sha)
      ? { sha, tree: objects.trees.get(sha), truncated: false }
      : undefined,
    blobs: objects.blobs.has(sha)
      ? { sha, content: objects.blobs.get(sha), encoding: "base64" }
      : undefined,
  };
  if (kind === undefined) return undefined;
  return found[kind] === undefined ? NOT_FOUND : ok(found[kind]);
}

/**
 * The open pull requests, or the ones from one head branch.
 * @param state - What the platform holds
 * @param call - The request
 * @returns The answer, or nothing when the path is not this one
 */
function readPulls(state: State, call: Call): Answer {
  if (call.resource !== "pulls") return undefined;
  const head = decodeURIComponent(/head=([^&]*)/u.exec(call.query)?.[1] ?? "");
  return ok(
    state.pulls
      .filter(pull => pull.state === "open")
      .filter(
        pull =>
          state.options.ignoresHeadFilter === true ||
          head === "" ||
          head.endsWith(`:${pull.head}`)
      )
      .map(pull => pullDocument(state, pull))
  );
}

/**
 * One pull request, with the platform's word on whether it could merge.
 * @param state - What the platform holds
 * @param call - The request
 * @returns The answer, or nothing when the path is not this one
 */
function readPull(state: State, call: Call): Answer {
  if (!/^pulls\/\d+$/u.test(call.resource)) return undefined;
  const pull = pullAt(state, call.resource);
  if (pull === undefined) return NOT_FOUND;
  if (state.options.mergedByTheHost === true && !pull.merged) {
    // The platform's own doing, not a request anybody sent.
    state.refs.set(pull.base, pull.sha);
    pull.state = "closed";
    pull.merged = true;
  }
  return ok(pullDocument(state, pull));
}

/**
 * What the checks concluded on a commit the platform holds.
 * @param state - What the platform holds
 * @param call - The request
 * @returns The answer, or nothing when the path is not this one
 */
function readChecks(state: State, call: Call): Answer {
  const [, sha = "", surface] =
    /^commits\/([0-9a-f]+)\/(check-runs|status)$/u.exec(call.resource) ?? [];
  if (surface === "status") return ok({ total_count: 0, statuses: [] });
  if (surface === undefined || !state.objects.commits.has(sha)) {
    return undefined;
  }
  const seen = state.looks.get(sha) ?? 0;
  const finished = seen >= state.pendingLooks;
  const runs = Object.entries(conclusions(state, sha)).map(
    ([name, conclusion], index) => ({
      id: index + 1,
      name,
      app: { id: state.options.reportedBy ?? ACTIONS_APP_ID },
      status: finished ? "completed" : "in_progress",
      conclusion: finished ? conclusion : null,
    })
  );
  state.looks.set(sha, seen + 1);
  return ok({ total_count: runs.length, check_runs: runs });
}

/**
 * Everything else: the merge-protection settings.
 * @param state - What the platform holds
 * @param call - The request
 * @returns The answer the settings stand-in gives
 */
function readSettings(state: State, call: Call): Answer {
  return state.settings.gh([
    "api",
    `repos/${state.options.repo}/${call.resource}`,
  ]);
}

/** Every read, in the order they are tried. */
export const READS: readonly Route[] = [
  readRepository,
  readRef,
  readMatchingRefs,
  readObject,
  readPulls,
  readPull,
  readChecks,
  readSettings,
];
