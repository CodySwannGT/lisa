#!/usr/bin/env node
/**
 * Re-check one planned stale-link clean-up against a fresh read, right before
 * the writes (CodySwannGT/lisa#5065).
 *
 * A plan is a snapshot. Between planning and writing, a blocker can be
 * reopened (its link is real again and must stay), a person can edit the
 * item's body (a precomputed body would overwrite that edit), or the item can
 * move to the blocked role (the Blocked sweep owns it then). So the writer
 * re-reads the item AND each of its blockers, and this module rebuilds the
 * plan from that fresh read:
 *
 * - only links the original plan removes, and that are still stale now, are
 *   removed; the rest are reported in `skipped` with the reason;
 * - the GitHub body is rebuilt by `removeBlockedByRefs` on the FRESH body, so
 *   a concurrent edit is kept;
 * - the comment describes the fresh state.
 *
 * A link that became stale only after the plan is left for the next cycle's
 * plan, so a confirmation never widens what a plan does.
 * @module stale-blocker-confirm
 */

import {
  itemPlan,
  itemRoles,
  normalizeStaleLinkItem,
  edgeIdentity,
  sortEdges,
} from "./stale-blocker-sweep.mjs";

/**
 * Why a planned removal is no longer made.
 * @param {string} blockerRef
 * @param {ReturnType<typeof sortEdges>} sorted
 * @returns {"blocker-not-resolved" | "link-changed" | "link-already-gone"}
 */
function skipReason(blockerRef, sorted) {
  // Still stale, but not the relationship the plan named (a new native
  // dependency in place of a planned body ref, say): left for the next plan.
  if (sorted.stale.some(edge => edge.blockerRef === blockerRef)) {
    return "link-changed";
  }
  const present = [
    ...sorted.real,
    ...sorted.crossProject,
    ...sorted.inaccessible,
    ...sorted.keptByPerson,
    // Moved back to an intermediate done rung: not finished, link kept.
    ...sorted.landed,
  ].some(edge => edge.blockerRef === blockerRef);
  return present ? "blocker-not-resolved" : "link-already-gone";
}

/**
 * Why the whole item is left alone now, or "" when it is not.
 * @param {ReturnType<typeof normalizeStaleLinkItem>} item
 * @param {{ inBlocked: boolean }} roles
 * @returns {"" | "item-closed" | "status-unknown" | "blocked-role"}
 */
function holdReason(item, roles) {
  // The sweep is scoped to open items: one closed since the plan is not
  // edited.
  if (item.closed) return "item-closed";
  if (!item.statusKnown) return "status-unknown";
  return roles.inBlocked ? "blocked-role" : "";
}

/**
 * Rebuild one item's plan from a fresh read of the item and its blockers.
 * @param {{
 *   tracker: "github" | "jira" | "linear",
 *   plan: { ref: string, removed: readonly string[], edges?: readonly string[] },
 *   fresh: Record<string, any>,
 *   doneRoles: readonly string[],
 *   landedRoles?: readonly string[],
 *   roles: { ready?: string, blocked?: string },
 *   poster?: "session-manager" | "build-intake",
 *   posterName?: string,
 * }} input - `fresh` is the raw item in the same shape the plan read it
 * @returns {{ plan: import("./stale-blocker-sweep.mjs").StaleLinkPlan | null, skipped: { blocker: string, reason: string }[] }}
 */
export function confirmStaleLinkPlan(input) {
  const item = normalizeStaleLinkItem(input.tracker, input.fresh);
  if (item.ref !== input.plan.ref) {
    throw new Error(
      `The fresh read is ${item.ref}, but the plan is for ${input.plan.ref}.`
    );
  }
  if (!item.relationsRead) {
    // probe-direction: fail-closed — a read with no relation list cannot say
    // which links are still there, so nothing is confirmed from it.
    throw new Error(
      `The fresh read of ${item.ref} has no blocker relation list; read it with its links.`
    );
  }
  const planned = new Set(input.plan.removed);
  const roles = itemRoles(item, input.roles);
  const hold = holdReason(item, roles);
  if (hold) {
    return {
      plan: null,
      skipped: [...planned].map(blocker => ({ blocker, reason: hold })),
    };
  }
  const sorted = sortEdges(item, input.doneRoles, input.landedRoles);
  // Only the planned relationships: a link added since the plan, even to the
  // same blocker (a native dependency beside a planned body ref), was never
  // authorized and stays.
  const identities = new Set(input.plan.edges ?? []);
  const stale = sorted.stale.filter(
    edge => planned.has(edge.blockerRef) && identities.has(edgeIdentity(edge))
  );
  const kept = new Set(stale.map(edge => edge.blockerRef));
  const skipped = [...planned]
    .filter(blocker => !kept.has(blocker))
    .map(blocker => ({ blocker, reason: skipReason(blocker, sorted) }));
  if (stale.length === 0) return { plan: null, skipped };
  return {
    plan: itemPlan({
      tracker: input.tracker,
      item,
      sorted: { ...sorted, stale },
      ready: roles.ready,
      poster: input.poster,
      posterName: input.posterName,
    }),
    skipped,
  };
}
