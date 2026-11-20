#!/usr/bin/env node
/**
 * What a stale-link clean-up actually did, read back from the tracker after
 * the writes (CodySwannGT/lisa#5065).
 *
 * The marker comment says "I removed the link", and a later cycle trusts the
 * marker: a link that is back after its marker was posted is treated as put
 * back by a person and never removed again. So a marker may be posted ONLY
 * for a removal the read-back confirms. A deletion that failed (an outage, or
 * an MCP-only substrate that cannot delete links) leaves its link in place
 * with no marker, and the next cycle simply plans it again.
 *
 * A confirmed removal whose comment then fails to post is not lost: the
 * writer keeps it as a PENDING comment (`stale-blocker-pending.mjs`) and
 * retries just that comment on its own. Its link is already gone, so no
 * later plan would ever see it again, and it is never mistaken for a link a
 * person kept.
 * @module stale-blocker-verify
 */

import {
  formatStaleLinkComment,
  markedBlockers,
  staleLinkCommentAdf,
} from "./stale-blocker-comment.mjs";
import { isResolved } from "./stale-blocker-edges.mjs";
import { splitReopened, verdictNow } from "./stale-blocker-restore.mjs";
import {
  itemRoles,
  normalizeStaleLinkItem,
  sortEdges,
  unresolvedCount,
} from "./stale-blocker-sweep.mjs";

/**
 * The result of reading one item back after its writes.
 * @typedef {object} StaleLinkResult
 * @property {string} ref - The item
 * @property {string[]} confirmed - Planned removals the read-back shows gone
 * @property {string[]} stillPresent - Planned removals still on the item
 * @property {{ blockerRef: string, verdict: string }[]} restored - Removed links whose blocker reopened (or could not be read) after the confirm: put back, no marker
 * @property {object[]} restore - The vendor actions that put them back
 * @property {string | null} comment - The comment for the confirmed removals only, or null
 * @property {object | null} commentAdf - The same as ADF for Jira, else null
 * @property {boolean} becameReady - A ready leaf item that nothing holds any more
 * @property {{ real: number, inaccessible: string[] }} blockersBefore - The plan's view of what still held the item
 * @property {{ real: number, inaccessible: string[] }} blockersAfter - The read-back's view, with the later blocker reads applied
 */

/** Buckets whose edges a later, unresolved verdict moves into `real`. */
const KEPT_BUCKETS = ["stale", "crossProject", "keptByPerson", "landed"];

/**
 * Apply the blocker reads taken AFTER the item read-back to the links still
 * on the item: a planned removal whose delete failed may have reopened since
 * the read-back, and then it holds the item again. Membership stays as the
 * read-back shows it; only verdicts move.
 * @param {ReturnType<typeof sortEdges>} sorted
 * @param {Map<string, string>} later - Blocker ref -> verdict now
 * @returns {ReturnType<typeof sortEdges>}
 */
function withLaterVerdicts(sorted, later) {
  const moved = { real: [], inaccessible: [] };
  const out = { ...sorted };
  for (const bucket of KEPT_BUCKETS) {
    out[bucket] = (sorted[bucket] ?? []).filter(edge => {
      const verdict = later.get(edge.blockerRef);
      if (verdict === undefined || isResolved(verdict)) return true;
      const judged = { ...edge, verdict };
      if (verdict === "inaccessible") moved.inaccessible.push(judged);
      else moved.real.push(judged);
      return false;
    });
  }
  return {
    ...out,
    real: [...sorted.real, ...moved.real],
    inaccessible: [...sorted.inaccessible, ...moved.inaccessible],
  };
}

/**
 * @param {{ real?: readonly object[], inaccessible?: readonly { blockerRef: string }[] }} groups
 * @returns {{ real: number, inaccessible: string[] }}
 */
const holding = groups => ({
  real: (groups.real ?? []).length,
  inaccessible: (groups.inaccessible ?? []).map(edge => edge.blockerRef),
});

/**
 * Read one item back after its writes and say what is confirmed.
 * @param {{
 *   tracker: "github" | "jira" | "linear",
 *   plan: { ref: string, removed: readonly string[], links?: readonly { blockerRef: string, source: string, actionId: string, linkType?: string }[], render: Record<string, { blockerRef: string, verdict: string }[]> },
 *   after: Record<string, any>,
 *   blockersNow: Record<string, Record<string, any> | null>,
 *   doneRoles: readonly string[],
 *   landedRoles?: readonly string[],
 *   roles: { ready?: string, blocked?: string },
 *   poster?: "session-manager" | "build-intake",
 *   posterName?: string,
 * }} input - `after` is the raw item read after the writes, with its blockers
 * @returns {StaleLinkResult}
 */
export function verifyStaleLinkRemoval(input) {
  const item = normalizeStaleLinkItem(input.tracker, input.after);
  if (item.ref !== input.plan.ref) {
    throw new Error(
      `The read-back is ${item.ref}, but the plan is for ${input.plan.ref}.`
    );
  }
  if (!item.relationsRead) {
    // probe-direction: fail-closed — a read-back with no relation list would
    // make every planned link look gone, so nothing is confirmed from it and
    // the next cycle plans the removals again.
    throw new Error(
      `The read-back of ${item.ref} has no blocker relation list; read it with its links.`
    );
  }
  if (!input.blockersNow || typeof input.blockersNow !== "object") {
    // probe-direction: fail-closed — without each removed blocker read again
    // after the delete, a blocker reopened in between cannot be told apart.
    throw new Error(
      `Verifying ${item.ref} needs each removed blocker as read after the delete (blockersNow).`
    );
  }
  const present = new Set(item.edges.map(edge => edge.blockerRef));
  const gone = input.plan.removed.filter(ref => !present.has(ref));
  const stillPresent = input.plan.removed.filter(ref => present.has(ref));
  const { confirmed, restored, restore } = splitReopened({
    tracker: input.tracker,
    item,
    gone,
    links: input.plan.links ?? [],
    blockersNow: input.blockersNow,
    doneRoles: input.doneRoles,
    landedRoles: input.landedRoles,
  });
  // A comment already posted for a removal (its marker is live on the item:
  // a saved plan verified again after it posted) is never owed twice.
  const marked = markedBlockers(item.comments);
  const done = new Set(confirmed.filter(ref => !marked.has(ref)));
  const render = input.plan.render ?? {};
  const later = new Map(
    stillPresent
      .filter(ref => Object.hasOwn(input.blockersNow, ref))
      .map(ref => [
        ref,
        verdictNow(input.tracker, item, ref, input.blockersNow[ref], input),
      ])
  );
  // The removed links keep their planned reasons; everything still on the
  // item is described as the read-back shows it now, with the later blocker
  // reads applied: the same view that decides `becameReady`.
  const sorted = withLaterVerdicts(
    sortEdges(item, input.doneRoles, input.landedRoles),
    later
  );
  const comment =
    done.size === 0
      ? null
      : formatStaleLinkComment(
          {
            stale: (render.stale ?? []).filter(e => done.has(e.blockerRef)),
            real: sorted.real,
            crossProject: sorted.crossProject,
            inaccessible: sorted.inaccessible,
          },
          input.poster,
          input.posterName
        );
  return {
    ref: item.ref,
    confirmed,
    stillPresent,
    restored,
    restore,
    comment,
    commentAdf:
      comment !== null && input.tracker === "jira"
        ? staleLinkCommentAdf(comment)
        : null,
    becameReady:
      confirmed.length > 0 &&
      itemRoles(item, input.roles).ready &&
      !item.container &&
      restored.length === 0 &&
      unresolvedCount(sorted) === 0,
    blockersBefore: holding(render),
    blockersAfter: holding(sorted),
  };
}
