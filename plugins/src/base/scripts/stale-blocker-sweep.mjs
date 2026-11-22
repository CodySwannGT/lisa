#!/usr/bin/env node
/**
 * Plan one cycle's clean-up of stale "blocked by" links (CodySwannGT/lisa#5065).
 *
 * A stale link is a "blocked by" relationship on an open item whose blocker
 * is resolved (`stale-blocker-edges.mjs` decides that). Left in place it makes
 * finished work look like it is still holding the queue, and an operator who
 * sees every item "waiting on" something cannot tell which ones really are.
 *
 * This module writes nothing. It returns, per item, the vendor action that
 * removes each stale link, the GitHub body with just those `Blocked by` refs
 * taken out, and one plain-English comment a non-technical operator can read.
 * The caller (the session manager's Reconcile step, or any agent's intake)
 * performs each action through its vendor access layer and reads it back.
 *
 * Never touched: a blocker that is still open, one in another project or
 * repository, and one that could not be read (reported instead). An item in
 * the blocked role is left to the Blocked sweep, which decides by branch
 * containment (`blocker-edge-resolution.mjs`) and escalates a cancelled
 * blocker rather than dropping it. Outside that role intake already ignores a
 * resolved blocker, so removing the link only removes a false signal.
 *
 * Idempotent: each comment carries one `[lisa-stale-blocker-link]` marker per
 * blocker. The caller posts it only after the removal reads back, so a marker
 * proves the link was removed once. A link that is back after that was put
 * back by a person; it is kept and reported, never removed twice.
 * @module stale-blocker-sweep
 */

import {
  blockerResolution,
  isRemovable,
  githubBlockerEdges,
  isResolved,
  jiraBlockerEdges,
  linearBlockerEdges,
  removeBlockedByRefs,
} from "./stale-blocker-edges.mjs";
import {
  commentsOf,
  formatStaleLinkComment,
  markedBlockers,
  staleLinkCommentAdf,
} from "./stale-blocker-comment.mjs";
import {
  normalizeGithubIssue,
  normalizeJiraIssue,
  normalizeLinearIssue,
} from "./ready-queue-order.mjs";
import { tallySweep } from "./stale-blocker-summary.mjs";

export {
  STALE_LINK_MARKER,
  STALE_LINK_POSTERS,
  formatStaleLinkComment,
  markerLine,
  staleLinkCommentAdf,
} from "./stale-blocker-comment.mjs";
export {
  summarizeStaleLinkSweep,
  summarizeVerifiedSweep,
} from "./stale-blocker-summary.mjs";

/**
 * One item's planned clean-up.
 * @typedef {object} StaleLinkPlan
 * @property {string} ref - The item
 * @property {{ op: string, linkId?: string, relationId?: string, endpoint?: string }[]} actions - Removals to perform
 * @property {string | null} body - GitHub body with the stale refs taken out, or null
 * @property {string[]} removed - Blocker refs whose links go
 * @property {string} comment - The one operator comment, posted after read-back
 * @property {{ type: "doc", version: 1, content: object[] } | null} commentAdf - The same comment as ADF, for Jira; null elsewhere
 * @property {number} remainingBlockers - Links left that still hold the item (open or unreadable)
 * @property {boolean} becomesClaimable - A ready leaf item with nothing left holding it
 * @property {string[]} edges - The planned links by identity ({@link edgeIdentity})
 * @property {{ blockerRef: string, source: string, actionId: string, linkType?: string }[]} links - The planned links, recreatable
 * @property {{ stale: {blockerRef: string, verdict: string}[], real: {blockerRef: string, verdict: string}[], crossProject: {blockerRef: string, verdict: string}[], inaccessible: {blockerRef: string, verdict: string}[] }} render - The judged links the comment describes
 */

/** Items cleaned per cycle by default; the rest wait for the next cycle. */
export const DEFAULT_MAX_STALE_ITEMS = 10;

/**
 * @param {unknown} value
 * @returns {string}
 */
const text = value => (typeof value === "string" ? value : "");

/**
 * One raw item in the shape the plan judges.
 * @param {string} tracker - `github`, `jira` or `linear`
 * @param {Record<string, any>} raw
 * @returns {{ ref: string, project: string, names: string[], edges: object[], body: string, repo: string, comments: object[], statusKnown: boolean, closed: boolean, relationsRead: boolean, container: boolean }}
 */
export function normalizeStaleLinkItem(tracker, raw) {
  return { ...itemShape(tracker, raw), ...itemFacts(tracker, raw) };
}

/** Linear state types that mean the item itself is finished. */
const LINEAR_CLOSED_TYPES = new Set(["completed", "canceled"]);

/**
 * What the sweep needs to know about the item itself, beyond its links:
 * - `closed`: finished since it was listed; confirm writes nothing to it.
 * - `relationsRead`: the read carried its blocker relation list at all. A
 *   read without one cannot show a link is gone, so nothing is confirmed
 *   from it (a present but empty list is a real "none left").
 * - `container`: the queue's own container rule, so "ready to start" means
 *   what the queue will actually offer.
 * @param {string} tracker
 * @param {Record<string, any>} raw
 * @returns {{ closed: boolean, relationsRead: boolean, container: boolean }}
 */
function itemFacts(tracker, raw) {
  if (tracker === "github") {
    const repo = text(raw?.repo).toLowerCase();
    return {
      closed: text(raw?.state).toLowerCase() === "closed",
      relationsRead:
        isList(raw?.nativeBlockers) &&
        Boolean(raw?.bodyBlockers) &&
        typeof raw.bodyBlockers === "object",
      container:
        normalizeGithubIssue(raw ?? {}, { repo })?.isContainer === true,
    };
  }
  if (tracker === "jira") {
    return {
      closed: raw?.fields?.status?.statusCategory?.key === "done",
      relationsRead: Array.isArray(raw?.fields?.issuelinks),
      container: normalizeJiraIssue(raw ?? {}).isContainer === true,
    };
  }
  return {
    closed: LINEAR_CLOSED_TYPES.has(text(raw?.state?.type).toLowerCase()),
    relationsRead: isList(raw?.inverseRelations),
    container: normalizeLinearIssue(raw ?? {}).isContainer === true,
  };
}

/**
 * @param {unknown} value
 * @returns {boolean} An array, or a `{nodes: [...]}` connection
 */
const isList = value =>
  Array.isArray(value) || Array.isArray(/** @type {any} */ (value)?.nodes);

/**
 * The item's ref, project, status names, edges, body and comments.
 * @param {string} tracker
 * @param {Record<string, any>} raw
 * @returns {{ ref: string, project: string, names: string[], edges: object[], body: string, repo: string, comments: object[], statusKnown: boolean }}
 */
function itemShape(tracker, raw) {
  if (tracker === "github") {
    const repo = text(raw?.repo).toLowerCase();
    return {
      ref: `${repo}#${raw?.number}`,
      project: repo,
      names: (raw?.labels ?? []).map(l => text(l?.name ?? l).toLowerCase()),
      edges: githubBlockerEdges(raw),
      body: text(raw?.body),
      repo,
      comments: commentsOf(raw),
      // A GitHub item's labels are its status, and having none is a real
      // answer ("not in any lane").
      statusKnown: true,
    };
  }
  const ref = tracker === "jira" ? text(raw?.key) : text(raw?.identifier);
  const state = tracker === "jira" ? raw?.fields?.status : raw?.state;
  const names = [text(state?.name).toLowerCase()].filter(Boolean);
  return {
    ref,
    project:
      text(raw?.team?.key).toUpperCase() || ref.split("-")[0].toUpperCase(),
    names,
    edges: tracker === "jira" ? jiraBlockerEdges(raw) : linearBlockerEdges(raw),
    body: "",
    repo: "",
    comments: commentsOf(raw),
    // Without its own status the item might be Blocked, and a Blocked item's
    // links belong to the Blocked sweep, so an unread status removes nothing.
    statusKnown: names.length > 0,
  };
}

/**
 * Sort one item's edges into what the sweep may remove and what it keeps.
 * @param {ReturnType<typeof normalizeStaleLinkItem>} item
 * @param {readonly string[]} doneRoles - Terminal done roles: a link to one is stale
 * @param {readonly string[]} [landedRoles] - Intermediate done roles: holds nothing, link kept
 * @returns {{ stale: object[], real: object[], crossProject: object[], inaccessible: object[], keptByPerson: object[], landed: object[] }}
 */
export function sortEdges(item, doneRoles, landedRoles = []) {
  const marked = markedBlockers(item.comments);
  const out = {
    stale: [],
    real: [],
    crossProject: [],
    inaccessible: [],
    keptByPerson: [],
    landed: [],
  };
  for (const edge of item.edges) {
    const verdict = blockerResolution(
      edge,
      doneRoles,
      item.project,
      landedRoles
    );
    const judged = { ...edge, verdict };
    if (verdict === "inaccessible") out.inaccessible.push(judged);
    else if (edge.project.toLowerCase() !== item.project.toLowerCase())
      out.crossProject.push(judged);
    else if (!isResolved(verdict)) out.real.push(judged);
    // Landed (an intermediate done rung): holds nothing, but the blocker is
    // not finished, so its link stays.
    else if (!isRemovable(verdict)) out.landed.push(judged);
    else if (marked.has(edge.blockerRef)) out.keptByPerson.push(judged);
    else out.stale.push(judged);
  }
  return out;
}

/**
 * The vendor action that removes one stale edge.
 * @param {string} tracker
 * @param {Record<string, any>} edge
 * @param {ReturnType<typeof normalizeStaleLinkItem>} item
 * @returns {Record<string, unknown> | null} null for a body ref (the body edit covers it)
 */
function removalAction(tracker, edge, item) {
  if (tracker === "jira") return { op: "unlink", linkId: edge.actionId };
  if (tracker === "linear") {
    return { op: "delete-relation", relationId: edge.actionId };
  }
  if (edge.source === "github-body") return null;
  const number = item.ref.split("#")[1];
  return {
    op: "delete-dependency",
    endpoint: `repos/${item.repo}/issues/${number}/dependencies/blocked_by/${edge.actionId}`,
  };
}

/**
 * One link's identity: where it lives and, for a vendor relation, its id.
 * @param {{ blockerRef: string, source?: string, actionId?: string }} edge
 * @returns {string}
 */
export const edgeIdentity = edge =>
  [text(edge.source), text(edge.actionId), edge.blockerRef].join("|");

/**
 * The parts of a judged edge the comment needs.
 * @param {{ blockerRef: string, verdict: string }} edge
 * @returns {{ blockerRef: string, verdict: string }}
 */
const judgedRef = edge => ({
  blockerRef: edge.blockerRef,
  verdict: edge.verdict,
});

/**
 * How many of an item's links still hold it up: an open blocker (in this
 * project or another) or one that could not be read. A resolved link the
 * sweep leaves in place, cross-project or put back by a person, holds
 * nothing, exactly as `countUnresolvedBlockers` counts it for the queue.
 * @param {ReturnType<typeof sortEdges>} sorted
 * @returns {number}
 */
export const unresolvedCount = sorted =>
  sorted.real.length +
  sorted.inaccessible.length +
  sorted.crossProject.filter(edge => !isResolved(edge.verdict)).length;

/**
 * The plan for one item with at least one stale edge.
 * @param {{ tracker: string, item: ReturnType<typeof normalizeStaleLinkItem>, sorted: ReturnType<typeof sortEdges>, ready: boolean, poster?: string, posterName?: string }} input
 * @returns {StaleLinkPlan}
 */
export function itemPlan({ tracker, item, sorted, ready, poster, posterName }) {
  const bodyRefs = sorted.stale
    .filter(edge => edge.source === "github-body")
    .map(edge => edge.blockerRef);
  const holds = unresolvedCount(sorted);
  const comment = formatStaleLinkComment(sorted, poster, posterName);
  return {
    ref: item.ref,
    actions: sorted.stale
      .map(edge => removalAction(tracker, edge, item))
      .filter(Boolean),
    body:
      bodyRefs.length > 0
        ? removeBlockedByRefs(item.body, bodyRefs, item.repo)
        : null,
    removed: [...new Set(sorted.stale.map(edge => edge.blockerRef))],
    comment,
    // Jira Cloud's REST v3 comment body is ADF; the other trackers take text.
    commentAdf: tracker === "jira" ? staleLinkCommentAdf(comment) : null,
    remainingBlockers: holds,
    // What the comment describes, so a writer can re-render it for only the
    // removals that read back as done (`stale-blocker-verify.mjs`).
    render: {
      stale: sorted.stale.map(edge => judgedRef(edge)),
      real: sorted.real.map(edge => judgedRef(edge)),
      crossProject: sorted.crossProject.map(edge => judgedRef(edge)),
      inaccessible: sorted.inaccessible.map(edge => judgedRef(edge)),
    },
    // The removals the confirm step may still make, by relationship, so a
    // link added since the plan to the same blocker is never swept up.
    edges: sorted.stale.map(edgeIdentity),
    // Enough of each planned link to recreate it if its blocker reopens
    // between the confirm and the delete (`stale-blocker-restore.mjs`).
    links: sorted.stale.map(edge => ({
      blockerRef: edge.blockerRef,
      source: edge.source,
      actionId: edge.actionId,
      ...(edge.linkType ? { linkType: edge.linkType } : {}),
    })),
    becomesClaimable: ready && holds === 0 && !item.container,
  };
}

/**
 * Whether an item is in the ready role, and whether in the blocked role.
 * @param {ReturnType<typeof normalizeStaleLinkItem>} item
 * @param {{ ready?: string, blocked?: string } | undefined} roles
 * @returns {{ ready: boolean, inBlocked: boolean }}
 */
export function itemRoles(item, roles) {
  const ready = text(roles?.ready).toLowerCase();
  const blocked = text(roles?.blocked).toLowerCase();
  return {
    ready: ready !== "" && item.names.includes(ready),
    inBlocked: blocked !== "" && item.names.includes(blocked),
  };
}

/**
 * Plan this cycle's stale-link clean-up. Writes nothing.
 * @param {{
 *   tracker: "github" | "jira" | "linear",
 *   items: readonly Record<string, any>[],
 *   doneRoles: readonly string[],
 *   landedRoles?: readonly string[],
 *   roles: { ready?: string, blocked?: string },
 *   max?: number,
 *   poster?: "session-manager" | "build-intake",
 *   posterName?: string,
 *   failures?: Record<string, { attempts?: number }>,
 * }} input - `failures` is the record of items whose planned removals did
 *   not happen (`stale-blocker-pending.mjs`); they go after every other
 *   candidate, so a removal that keeps failing cannot spend the cap
 * @returns {{ plans: StaleLinkPlan[], deferred: string[], report: import("./stale-blocker-summary.mjs").StaleLinkReport }}
 */
export function planStaleLinkSweep(input) {
  const max = input.max ?? DEFAULT_MAX_STALE_ITEMS;
  const failed = ref => Number(input.failures?.[ref]?.attempts ?? 0);
  const judged = (input.items ?? [])
    .map(raw => normalizeStaleLinkItem(input.tracker, raw))
    .map(item => ({
      item,
      ...itemRoles(item, input.roles),
      sorted: sortEdges(item, input.doneRoles, input.landedRoles),
    }));
  const candidates = judged
    .filter(
      entry =>
        // An item whose blocker list could not be read (a failed native
        // dependency read) plans nothing: it is reported, never touched.
        entry.item.relationsRead &&
        // An item closed since it was listed is never cleaned (Out of
        // Scope), so it never takes a cap slot either; confirm refuses it too.
        !entry.item.closed &&
        entry.item.statusKnown &&
        !entry.inBlocked &&
        entry.sorted.stale.length > 0
    )
    .sort(
      (a, b) =>
        failed(a.item.ref) - failed(b.item.ref) ||
        Number(b.ready) - Number(a.ready) ||
        a.item.ref.localeCompare(b.item.ref)
    );
  const taken = candidates.slice(0, Math.max(0, max));
  const plans = taken.map(entry =>
    itemPlan({
      tracker: input.tracker,
      ...entry,
      poster: input.poster,
      posterName: input.posterName,
    })
  );
  const deferred = candidates.slice(taken.length).map(entry => entry.item.ref);
  return { plans, deferred, report: tallySweep(judged, plans, deferred) };
}
