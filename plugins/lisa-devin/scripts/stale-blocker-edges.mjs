#!/usr/bin/env node
/**
 * Is a "blocked by" edge still a real blocker? One answer for every tracker.
 *
 * ## The failure this answers (CodySwannGT/lisa#5065)
 *
 * In a host project every ticket in the queue showed as waiting on another
 * ticket. 70 "blocked by" links across 40 open tickets pointed at tickets that
 * were already finished; only 29 tickets had a real blocker. The links were
 * true once and nobody removed them when the blocker finished, so the operator
 * could not see which items were really stuck, and work stayed out of the
 * factory until a person asked an agent to clean up.
 *
 * ## The rule
 *
 * A blocker is RESOLVED when it is closed in its tracker (GitHub `closed`,
 * Jira status category `done`, Linear state type `completed` or `canceled`)
 * or when it sits in the project's configured terminal done role
 * (`.lisa.config.json`, resolved through `resolveBuildLifecycleRoles`: the
 * `production` rung of an env-keyed `done` map, or the `done` value itself).
 * Names are never hardcoded: a promotion workflow can type its done state
 * `started`, so the configured name is what says "finished" there.
 *
 * A blocker in any OTHER configured done role (an intermediate rung of the
 * env-aware `done` map, such as `status:on-dev` or `On Stg`) is LANDED: its
 * code has merged to a non-production environment, and dependents are meant
 * to proceed, so it holds nothing. Its link is not stale, though: the
 * blocker is not finished, so the sweep never deletes that link
 * ({@link REMOVABLE}). "Holds the item" and "safe to delete" are separate
 * questions with separate answers.
 *
 * A blocker that was CANCELLED (GitHub `not_planned` / `duplicate`, Linear
 * `canceled`) is resolved too: build intake already ignores it, the item can
 * never be unblocked by it, and the operator comment says it was cancelled.
 * Jira cannot tell "won't do" from "done" without naming a resolution, so a
 * done-category Jira blocker reads as closed.
 *
 * An unreadable blocker is INACCESSIBLE: it is reported and never resolved.
 *
 * This module only judges. `stale-blocker-sweep.mjs` plans the removals and
 * the operator comment; the vendor access layers perform them. It is plain
 * Node with no runtime-specific imports, so any agent can run it.
 * @module stale-blocker-edges
 */

import { resolveBuildLifecycleRoles } from "./queue-contract-resolution.mjs";

/** Every verdict {@link blockerResolution} can return. */
export const RESOLUTIONS = Object.freeze([
  "done",
  "landed",
  "closed",
  "cancelled",
  "open",
  "inaccessible",
]);

/** Verdicts that mean the blocker can no longer hold anything up. */
const RESOLVED = new Set(["done", "landed", "closed", "cancelled"]);

/** Verdicts whose link the sweep may delete: the blocker is finished. */
const REMOVABLE = new Set(["done", "closed", "cancelled"]);

/** GitHub closure reasons for work that will not be built. */
const GITHUB_CANCELLED_REASONS = new Set(["not_planned", "duplicate"]);

/** Jira link types whose inward side reads "this item is blocked by". */
const JIRA_BLOCKED_BY = /blocked by/i;

/** A `Blocked by` line as `lisa-github-write-issue` writes it. */
const BLOCKED_BY_LINE = /^(\s*(?:[-*]\s+)?blocked by:?\s+)(.+?)\s*$/i;

/**
 * What separates refs on a `Blocked by` line: a comma, or the word "and"
 * with whitespace on both sides, so an `and` inside a repository name
 * (`org/and#10`) is never a separator.
 */
const REF_SEPARATOR = /\s*,\s*|\s+and\s+/i;

/** One GitHub issue reference inside a `Blocked by` line. */
const GITHUB_REF =
  /^(?:https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/issues\/(\d+)|(?:([\w.-]+\/[\w.-]+))?#(\d+))$/i;

/**
 * @param {unknown} value
 * @returns {string}
 */
const text = value => (typeof value === "string" ? value : "");

/**
 * @param {unknown} list
 * @returns {any[]}
 */
const nodesOf = list => {
  if (Array.isArray(list)) return list;
  return Array.isArray(list?.nodes) ? list.nodes : [];
};

/**
 * Label or state names as lower-case strings.
 * @param {unknown} list
 * @returns {string[]}
 */
const namesOf = list =>
  nodesOf(list)
    .map(entry => (typeof entry === "string" ? entry : text(entry?.name)))
    .filter(Boolean)
    .map(name => name.toLowerCase());

/**
 * The project's terminal done role names for one tracker.
 *
 * Each rung resolves on its own, local before committed before the built-in
 * default, exactly as `resolveRole` resolves one environment: a local map
 * that overrides only `dev` never hides the committed `production` rung. A
 * plain string is a single, non-staged done role, so it stands for the
 * `production` rung. The terminal role is the `production` rung, else the
 * last rung: an intermediate rung (`status:on-dev`) has not finished, so it
 * never counts.
 * @param {{ tracker: string, global?: object, local?: object }} input
 * @returns {string[]} Lower-case names
 */
export function terminalDoneRoles(input) {
  const rungs = Object.entries(mergedDoneRungs(input));
  if (rungs.length === 0) return [];
  const production = rungs.find(([key]) => key === "production");
  return [(production ?? rungs[rungs.length - 1])[1].toLowerCase()];
}

/**
 * Every configured done role that is NOT terminal: the intermediate rungs of
 * the env-aware `done` map (`status:on-dev`, `On Stg`), resolved per rung
 * exactly as {@link terminalDoneRoles} resolves them. A blocker in one of
 * these holds nothing, but its link is never deleted.
 * @param {{ tracker: string, global?: object, local?: object }} input
 * @returns {string[]} Lower-case names
 */
export function landedDoneRoles(input) {
  const terminal = new Set(terminalDoneRoles(input));
  return [
    ...new Set(
      Object.values(mergedDoneRungs(input)).map(name => name.toLowerCase())
    ),
  ].filter(name => !terminal.has(name));
}

/**
 * The `done` rungs, each resolved local, then committed, then built-in.
 * @param {{ tracker: string, global?: object, local?: object }} input
 * @returns {Record<string, string>}
 */
function mergedDoneRungs({ tracker, global, local }) {
  // The built-in defaults come from the one resolver every surface shares;
  // it is asked with an empty config so a project's other roles can never
  // make this read fail.
  return {
    ...doneRungs(resolveBuildLifecycleRoles({}, tracker).roles.done),
    ...doneRungs(rawDone(global ?? {}, tracker)),
    ...doneRungs(rawDone(local ?? {}, tracker)),
  };
}

/**
 * One config's `done` value as its non-empty rungs.
 * @param {unknown} done - A string, an env-keyed map, or nothing
 * @returns {Record<string, string>}
 */
function doneRungs(done) {
  if (typeof done === "string") return done ? { production: done } : {};
  if (!done || typeof done !== "object") return {};
  return Object.fromEntries(
    Object.entries(done).filter(
      ([, value]) => typeof value === "string" && value
    )
  );
}

/**
 * The `done` value one config sets for a tracker, or undefined.
 * @param {Record<string, any>} config
 * @param {string} tracker
 * @returns {unknown}
 */
function rawDone(config, tracker) {
  if (tracker === "github") return config.github?.labels?.build?.done;
  return config[tracker]?.workflow?.done;
}

/**
 * Judge one normalized edge's blocker.
 *
 * The configured done names belong to the project that configures them, so a
 * name match counts only for a blocker in that project (`scope`). A blocker
 * in another Jira project or Linear team that happens to have a status of the
 * same name is finished only when its own tracker says so (closed, done
 * category, completed). With no scope, a name match counts anywhere.
 * @param {{ accessible?: boolean, closed?: boolean, cancelled?: boolean, names?: readonly string[], project?: string }} edge
 * @param {readonly string[]} doneRoles - From {@link terminalDoneRoles}
 * @param {string} [scope] - The project or team that declares `doneRoles`
 * @param {readonly string[]} [landedRoles] - From {@link landedDoneRoles}
 * @returns {"done"|"landed"|"closed"|"cancelled"|"open"|"inaccessible"} Verdict
 */
export function blockerResolution(edge, doneRoles, scope, landedRoles = []) {
  if (!edge || edge.accessible === false) return "inaccessible";
  if (edge.cancelled === true) return "cancelled";
  const inScope =
    !scope || text(edge.project).toLowerCase() === scope.toLowerCase();
  const done = new Set(doneRoles.map(name => name.toLowerCase()));
  if (
    inScope &&
    (edge.names ?? []).some(name => done.has(name.toLowerCase()))
  ) {
    return "done";
  }
  if (edge.closed === true) return "closed";
  const landed = new Set(landedRoles.map(name => name.toLowerCase()));
  return inScope && (edge.names ?? []).some(name => landed.has(name))
    ? "landed"
    : "open";
}

/**
 * Whether a verdict means the blocker can no longer hold anything up.
 * @param {string} verdict
 * @returns {boolean}
 */
export const isResolved = verdict => RESOLVED.has(verdict);

/**
 * Whether a verdict means the blocker is finished, so its link may go.
 * @param {string} verdict
 * @returns {boolean}
 */
export const isRemovable = verdict => REMOVABLE.has(verdict);

/**
 * How many edges still hold their item up: open, or unreadable (an unread
 * blocker is never assumed finished).
 * @param {readonly object[]} edges - Normalized edges
 * @param {readonly string[]} doneRoles - From {@link terminalDoneRoles}
 * @param {string} [scope] - The project or team that declares `doneRoles`
 * @param {readonly string[]} [landedRoles] - From {@link landedDoneRoles}
 * @returns {number}
 */
export const countUnresolvedBlockers = (edges, doneRoles, scope, landedRoles) =>
  edges.filter(
    edge => !isResolved(blockerResolution(edge, doneRoles, scope, landedRoles))
  ).length;

/**
 * The project key of a Jira or Linear key (`ABC-12` → `ABC`).
 * @param {string} key
 * @returns {string}
 */
const keyProject = key => text(key).split("-")[0].toUpperCase();

/**
 * "Blocked by" edges of one raw Jira issue (`issuelinks`, inward side).
 * @param {Record<string, any>} issue - Issue with `key` and `fields`
 * @returns {object[]} Normalized edges
 */
export function jiraBlockerEdges(issue) {
  return nodesOf(issue?.fields?.issuelinks)
    .filter(
      link => link?.inwardIssue && JIRA_BLOCKED_BY.test(text(link.type?.inward))
    )
    .map(link => {
      const status = link.inwardIssue.fields?.status;
      return {
        blockerRef: text(link.inwardIssue.key),
        project: keyProject(link.inwardIssue.key),
        source: "jira-link",
        actionId: text(link.id),
        accessible: Boolean(status),
        closed: status?.statusCategory?.key === "done",
        cancelled: false,
        names: namesOf([status]),
      };
    });
}

/**
 * "Blocked by" edges of one raw Linear issue. Linear has no blocked-by
 * relation type: B blocked by A is A's `blocks` relation, read from B as an
 * inverse relation.
 * @param {Record<string, any>} issue - Issue node
 * @returns {object[]} Normalized edges
 */
export function linearBlockerEdges(issue) {
  return nodesOf(issue?.inverseRelations)
    .filter(relation => relation?.type === "blocks")
    .map(relation => {
      const state = relation.issue?.state;
      const ref = text(relation.issue?.identifier);
      return {
        blockerRef: ref,
        project:
          text(relation.issue?.team?.key).toUpperCase() || keyProject(ref),
        source: "linear-relation",
        actionId: text(relation.id),
        accessible: Boolean(state?.type),
        closed: state?.type === "completed" || state?.type === "canceled",
        cancelled: state?.type === "canceled",
        names: namesOf([state]),
      };
    });
}

/**
 * Canonical `owner/repo#n` for one reference token, or null.
 * @param {string} token - `#12`, `owner/repo#12` or an issue URL
 * @param {string} repo - The item's own `owner/repo`
 * @returns {string | null}
 */
export function canonicalGithubRef(token, repo) {
  const match = GITHUB_REF.exec(token.trim());
  if (!match) return null;
  const owner = match[1] ?? match[3] ?? repo;
  return `${owner.toLowerCase()}#${match[2] ?? match[4]}`;
}

/**
 * Every blocker the body's `Blocked by` lines name, canonicalized.
 * @param {string} body
 * @param {string} repo - The item's own `owner/repo`
 * @returns {string[]} Unique refs, in body order
 */
export function parseBlockedByRefs(body, repo) {
  const refs = text(body)
    .split("\n")
    .flatMap(line => {
      const match = BLOCKED_BY_LINE.exec(line);
      if (!match) return [];
      return match[2]
        .split(REF_SEPARATOR)
        .map(token => canonicalGithubRef(token, repo))
        .filter(Boolean);
    });
  return [...new Set(refs)];
}

/**
 * The body with the given refs removed from its `Blocked by` lines. A line
 * left with no ref is dropped; every other line is untouched.
 * @param {string} body
 * @param {readonly string[]} refs - Canonical refs to remove
 * @param {string} repo - The item's own `owner/repo`
 * @returns {string}
 */
export function removeBlockedByRefs(body, refs, repo) {
  const drop = new Set(refs);
  return text(body)
    .split("\n")
    .flatMap(line => {
      const match = BLOCKED_BY_LINE.exec(line);
      if (!match) return [line];
      const tokens = match[2].split(REF_SEPARATOR);
      const kept = tokens.filter(
        token => !drop.has(canonicalGithubRef(token, repo) ?? "")
      );
      if (kept.length === tokens.length) return [line];
      return kept.length === 0 ? [] : [`${match[1]}${kept.join(", ")}`];
    })
    .join("\n");
}

/**
 * One GitHub blocker as an edge. `blocker` is the REST issue, or null when it
 * could not be read.
 * @param {string} ref - Canonical blocker ref
 * @param {Record<string, any> | null | undefined} blocker
 * @param {string} source - `github-native` or `github-body`
 * @returns {object} Normalized edge
 */
function githubEdge(ref, blocker, source) {
  const state = text(blocker?.state).toLowerCase();
  return {
    blockerRef: ref,
    project: ref.split("#")[0],
    source,
    actionId: blocker?.id === undefined ? "" : String(blocker.id),
    accessible: state === "open" || state === "closed",
    closed: state === "closed",
    cancelled:
      state === "closed" &&
      GITHUB_CANCELLED_REASONS.has(text(blocker?.state_reason).toLowerCase()),
    names: namesOf(blocker?.labels),
  };
}

/** Placeholder repo for a native blocker whose repository is not named. */
export const UNKNOWN_REPO = "unknown-repo";

/**
 * The `owner/repo` a native blocker lives in. The dependencies API returns
 * both `repository.full_name` and `repository_url`; either is read, as
 * `normalizeGithubIssue` reads `repository_url`. A blocker that names
 * neither is never assumed to be local: it gets {@link UNKNOWN_REPO}, which
 * matches no item's repo, so the sweep treats it as cross-project and leaves
 * it alone.
 * @param {Record<string, any>} blocker - REST issue
 * @returns {string}
 */
function blockerRepo(blocker) {
  const named =
    text(blocker?.repository?.full_name) ||
    text(blocker?.repository_url).split("/repos/")[1] ||
    "";
  return named || UNKNOWN_REPO;
}

/**
 * "Blocked by" edges of one GitHub issue: native dependencies
 * (`nativeBlockers`, the REST `dependencies/blocked_by` list) and the body
 * convention (`bodyBlockers`, each named ref's REST issue or null).
 * @param {{ repo: string, body?: string, nativeBlockers?: object[], bodyBlockers?: Record<string, object | null> }} issue
 * @returns {object[]} Normalized edges
 */
export function githubBlockerEdges(issue) {
  const repo = text(issue?.repo).toLowerCase();
  const native = nodesOf(issue?.nativeBlockers).map(blocker => {
    const owner = blockerRepo(blocker);
    return githubEdge(
      `${owner.toLowerCase()}#${blocker.number}`,
      blocker,
      "github-native"
    );
  });
  const found = issue?.bodyBlockers ?? {};
  const body = parseBlockedByRefs(issue?.body, repo).map(ref =>
    githubEdge(
      ref,
      Object.hasOwn(found, ref) ? found[ref] : null,
      "github-body"
    )
  );
  return [...native, ...body];
}
