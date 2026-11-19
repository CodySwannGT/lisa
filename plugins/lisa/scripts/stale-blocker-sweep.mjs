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
  githubBlockerEdges,
  isResolved,
  jiraBlockerEdges,
  linearBlockerEdges,
  removeBlockedByRefs,
} from "./stale-blocker-edges.mjs";
import { tallySweep } from "./stale-blocker-summary.mjs";

export { summarizeStaleLinkSweep } from "./stale-blocker-summary.mjs";

/**
 * One item's planned clean-up.
 * @typedef {object} StaleLinkPlan
 * @property {string} ref - The item
 * @property {{ op: string, linkId?: string, relationId?: string, endpoint?: string }[]} actions - Removals to perform
 * @property {string | null} body - GitHub body with the stale refs taken out, or null
 * @property {string[]} removed - Blocker refs whose links go
 * @property {string} comment - The one operator comment, posted after read-back
 * @property {number} remainingBlockers - Links this sweep leaves in place
 * @property {boolean} becomesClaimable - A ready item with nothing left holding it
 */

/** Visible marker, one per removed blocker, so a re-run never re-comments. */
export const STALE_LINK_MARKER = "[lisa-stale-blocker-link]";

/** Items cleaned per cycle by default; the rest wait for the next cycle. */
export const DEFAULT_MAX_STALE_ITEMS = 10;

/**
 * @param {unknown} value
 * @returns {string}
 */
const text = value => (typeof value === "string" ? value : "");

/**
 * The marker line for one blocker.
 * @param {string} blockerRef
 * @returns {string}
 */
export const markerLine = blockerRef =>
  `${STALE_LINK_MARKER} blocker=${blockerRef}`;

/**
 * Blockers this item's comments already record as removed.
 * @param {readonly { body?: string }[] | undefined} comments
 * @returns {Set<string>}
 */
function markedBlockers(comments) {
  const pattern = /\[lisa-stale-blocker-link\] blocker=(\S+)/g;
  return new Set(
    (comments ?? []).flatMap(comment =>
      [...text(comment?.body).matchAll(pattern)].map(match => match[1])
    )
  );
}

/**
 * One raw item in the shape the plan judges.
 * @param {string} tracker - `github`, `jira` or `linear`
 * @param {Record<string, any>} raw
 * @returns {{ ref: string, project: string, names: string[], edges: object[], body: string, repo: string, comments: object[] }}
 */
export function normalizeStaleLinkItem(tracker, raw) {
  if (tracker === "github") {
    const repo = text(raw?.repo).toLowerCase();
    return {
      ref: `${repo}#${raw?.number}`,
      project: repo,
      names: (raw?.labels ?? []).map(l => text(l?.name ?? l).toLowerCase()),
      edges: githubBlockerEdges(raw),
      body: text(raw?.body),
      repo,
      comments: raw?.comments ?? [],
    };
  }
  const ref = tracker === "jira" ? text(raw?.key) : text(raw?.identifier);
  const state = tracker === "jira" ? raw?.fields?.status : raw?.state;
  return {
    ref,
    project:
      text(raw?.team?.key).toUpperCase() || ref.split("-")[0].toUpperCase(),
    names: [text(state?.name).toLowerCase()].filter(Boolean),
    edges: tracker === "jira" ? jiraBlockerEdges(raw) : linearBlockerEdges(raw),
    body: "",
    repo: "",
    comments: raw?.comments ?? [],
  };
}

/**
 * Sort one item's edges into what the sweep may remove and what it keeps.
 * @param {ReturnType<typeof normalizeStaleLinkItem>} item
 * @param {readonly string[]} doneRoles
 * @returns {{ stale: object[], real: object[], crossProject: object[], inaccessible: object[], keptByPerson: object[] }}
 */
export function sortEdges(item, doneRoles) {
  const marked = markedBlockers(item.comments);
  const out = {
    stale: [],
    real: [],
    crossProject: [],
    inaccessible: [],
    keptByPerson: [],
  };
  for (const edge of item.edges) {
    const verdict = blockerResolution(edge, doneRoles);
    const judged = { ...edge, verdict };
    if (verdict === "inaccessible") out.inaccessible.push(judged);
    else if (edge.project.toLowerCase() !== item.project.toLowerCase())
      out.crossProject.push(judged);
    else if (!isResolved(verdict)) out.real.push(judged);
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
 * A plain-English list: "A", "A and B", "A, B and C".
 * @param {readonly string[]} refs
 * @returns {string}
 */
const listOf = refs =>
  refs.length < 2
    ? refs.join("")
    : `${refs.slice(0, -1).join(", ")} and ${refs[refs.length - 1]}`;

/**
 * The one comment an operator reads for this item's clean-up.
 * @param {{ stale: object[], real: object[], inaccessible: object[] }} sorted
 * @returns {string}
 */
export function formatStaleLinkComment(sorted) {
  const unique = list => [...new Set(list.map(edge => edge.blockerRef))];
  const finished = unique(sorted.stale.filter(e => e.verdict !== "cancelled"));
  const cancelled = unique(sorted.stale.filter(e => e.verdict === "cancelled"));
  const removed = unique(sorted.stale);
  const lines = ["[lisa-session-manager] Cleared waiting-on links."];
  if (finished.length > 0) {
    const verb = finished.length === 1 ? "is" : "are";
    lines.push(
      `This was marked as waiting on ${listOf(finished)}, which ${verb} finished.`
    );
  }
  if (cancelled.length > 0) {
    lines.push(
      `It was also marked as waiting on ${listOf(cancelled)}, which was cancelled and will not be built, so it cannot hold this up.`
    );
  }
  lines.push(
    `I removed ${removed.length === 1 ? "the link" : "those links"}. Nothing else changed.`
  );
  const real = unique(sorted.real);
  if (real.length > 0) {
    lines.push(
      `It is still waiting on ${listOf(real)}, which is not finished yet.`
    );
  }
  const unreadable = unique(sorted.inaccessible);
  if (unreadable.length > 0) {
    lines.push(
      `I could not open ${listOf(unreadable)}, so I left that link alone.`
    );
  }
  return [lines.join(" "), "", ...removed.map(markerLine)].join("\n");
}

/**
 * The plan for one item with at least one stale edge.
 * @param {string} tracker
 * @param {ReturnType<typeof normalizeStaleLinkItem>} item
 * @param {ReturnType<typeof sortEdges>} sorted
 * @param {boolean} ready - Whether the item is in the ready role
 * @returns {StaleLinkPlan}
 */
function itemPlan(tracker, item, sorted, ready) {
  const bodyRefs = sorted.stale
    .filter(edge => edge.source === "github-body")
    .map(edge => edge.blockerRef);
  const holds =
    sorted.real.length +
    sorted.crossProject.length +
    sorted.inaccessible.length;
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
    comment: formatStaleLinkComment(sorted),
    remainingBlockers: holds + sorted.keptByPerson.length,
    becomesClaimable: ready && holds + sorted.keptByPerson.length === 0,
  };
}

/**
 * Plan this cycle's stale-link clean-up. Writes nothing.
 * @param {{
 *   tracker: "github" | "jira" | "linear",
 *   items: readonly Record<string, any>[],
 *   doneRoles: readonly string[],
 *   roles: { ready?: string, blocked?: string },
 *   max?: number,
 * }} input
 * @returns {{ plans: StaleLinkPlan[], deferred: string[], report: import("./stale-blocker-summary.mjs").StaleLinkReport }}
 */
export function planStaleLinkSweep(input) {
  const roleName = value => text(value).toLowerCase();
  const ready = roleName(input.roles?.ready);
  const blocked = roleName(input.roles?.blocked);
  const max = input.max ?? DEFAULT_MAX_STALE_ITEMS;
  const judged = (input.items ?? [])
    .map(raw => normalizeStaleLinkItem(input.tracker, raw))
    .map(item => ({
      item,
      inBlocked: blocked !== "" && item.names.includes(blocked),
      ready: ready !== "" && item.names.includes(ready),
      sorted: sortEdges(item, input.doneRoles),
    }));
  const candidates = judged
    .filter(entry => !entry.inBlocked && entry.sorted.stale.length > 0)
    .sort(
      (a, b) =>
        Number(b.ready) - Number(a.ready) ||
        a.item.ref.localeCompare(b.item.ref)
    );
  const taken = candidates.slice(0, Math.max(0, max));
  const plans = taken.map(entry =>
    itemPlan(input.tracker, entry.item, entry.sorted, entry.ready)
  );
  const deferred = candidates.slice(taken.length).map(entry => entry.item.ref);
  return { plans, deferred, report: tallySweep(judged, plans, deferred) };
}
