#!/usr/bin/env node
/**
 * Counts and the one-line cycle summary for the stale-link sweep
 * (CodySwannGT/lisa#5065), split from `stale-blocker-sweep.mjs` to keep each
 * file within its line budget. The summary is what the session manager's
 * cycle status line says: how many stale links it cleared and how many real
 * blockers remain, in words an operator can act on.
 * @module stale-blocker-summary
 */

/**
 * What one sweep found.
 * @typedef {object} StaleLinkReport
 * @property {number} scanned - Items read
 * @property {number} skippedBlockedRole - Items left to the Blocked sweep
 * @property {number} cleared - Links planned for removal
 * @property {number} itemsCleared - Items with a planned removal
 * @property {string[]} claimable - Ready items nothing holds any more
 * @property {string[]} deferred - Items left for the next cycle
 * @property {number} realBlockers - Open blockers in the same project
 * @property {number} itemsWithRealBlockers - Items with one
 * @property {number} crossProject - Links to another project, left alone
 * @property {{ ref: string, blocker: string }[]} inaccessible - Blockers that could not be read
 * @property {{ ref: string, blocker: string }[]} keptByPerson - Links a person put back
 */

/**
 * @param {readonly object[]} list
 * @returns {number}
 */
const size = list => list.length;

/**
 * Pairs of item and blocker refs, for the report.
 * @param {string} ref
 * @param {readonly { blockerRef: string }[]} edges
 * @returns {{ ref: string, blocker: string }[]}
 */
const pairs = (ref, edges) =>
  edges.map(edge => ({ ref, blocker: edge.blockerRef }));

/**
 * Tally the sweep over every judged item.
 * @param {readonly { item: { ref: string }, inBlocked: boolean, sorted: Record<string, object[]> }[]} judged
 * @param {readonly { removed: string[], becomesClaimable: boolean, ref: string }[]} plans
 * @param {readonly string[]} deferred
 * @returns {StaleLinkReport}
 */
export function tallySweep(judged, plans, deferred) {
  const open = judged.filter(entry => !entry.inBlocked);
  return {
    scanned: judged.length,
    skippedBlockedRole: judged.length - open.length,
    cleared: plans.reduce((sum, plan) => sum + plan.removed.length, 0),
    itemsCleared: plans.length,
    claimable: plans
      .filter(plan => plan.becomesClaimable)
      .map(plan => plan.ref),
    deferred: [...deferred],
    realBlockers: open.reduce((sum, e) => sum + size(e.sorted.real), 0),
    itemsWithRealBlockers: open.filter(e => size(e.sorted.real) > 0).length,
    crossProject: open.reduce((sum, e) => sum + size(e.sorted.crossProject), 0),
    inaccessible: open.flatMap(e => pairs(e.item.ref, e.sorted.inaccessible)),
    keptByPerson: open.flatMap(e => pairs(e.item.ref, e.sorted.keptByPerson)),
  };
}

/**
 * @param {number} count
 * @param {string} one
 * @param {string} many
 * @returns {string}
 */
const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;

/**
 * The parts every summary line shares: what is left for the next cycle, the
 * real blockers, and the blockers that could not be opened.
 * @param {StaleLinkReport} report
 * @returns {string[]}
 */
function tail(report) {
  const parts = [];
  if (report.deferred.length > 0) {
    parts.push(
      `${plural(report.deferred.length, "item", "items")} left for the next cycle`
    );
  }
  parts.push(
    `${plural(report.realBlockers, "real blocker remains", "real blockers remain")} on ${plural(report.itemsWithRealBlockers, "item", "items")}`
  );
  if (report.inaccessible.length > 0) {
    const list = report.inaccessible
      .map(pair => `${pair.blocker} (on ${pair.ref})`)
      .join(", ");
    parts.push(`could not open ${list}`);
  }
  return parts;
}

/**
 * One plain line describing the PLAN. Nothing has been written yet, so it
 * says "planned" and "would become ready", never "cleared".
 * @param {StaleLinkReport} report
 * @returns {string}
 */
export function summarizeStaleLinkSweep(report) {
  const parts = [
    `planned removal of ${plural(report.cleared, "stale blocker link", "stale blocker links")} on ${plural(report.itemsCleared, "item", "items")}`,
  ];
  if (report.claimable.length > 0) {
    parts.push(`${report.claimable.length} would become ready to start`);
  }
  return `stale links (plan): ${[...parts, ...tail(report)].join("; ")}.`;
}

/**
 * One plain line for the cycle summary, built from what the read-backs
 * confirmed. Planned removals that did not happen and items deferred to the
 * next cycle are counted separately, never as cleared.
 * @param {StaleLinkReport} report - The plan's report
 * @param {readonly { confirmed: string[], stillPresent: string[], becameReady: boolean }[]} results - One per item acted on
 * @param {{ planned?: number }} [counts] - Planned removals, when they differ
 *   from the report (a plan entry confirmed down to fewer links)
 * @returns {string}
 */
export function summarizeVerifiedSweep(report, results, counts = {}) {
  const cleared = results.reduce((sum, r) => sum + r.confirmed.length, 0);
  const items = results.filter(r => r.confirmed.length > 0).length;
  const ready = results.filter(r => r.becameReady).length;
  const planned = counts.planned ?? report.cleared;
  const notDone = Math.max(0, planned - cleared);
  const parts = [
    `cleared ${plural(cleared, "stale blocker link", "stale blocker links")} on ${plural(items, "item", "items")}`,
  ];
  if (ready > 0) parts.push(`${ready} now ready to start`);
  if (notDone > 0) {
    parts.push(
      `${plural(notDone, "planned removal", "planned removals")} not done (retried next cycle)`
    );
  }
  return `stale links: ${[...parts, ...tail(report)].join("; ")}.`;
}
