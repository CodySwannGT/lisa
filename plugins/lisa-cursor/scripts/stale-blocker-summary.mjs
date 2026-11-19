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
 * @property {string[]} unknownStatus - Items left alone because their own status was not read
 * @property {number} cleared - Links planned for removal
 * @property {number} itemsCleared - Items with a planned removal
 * @property {string[]} claimable - Ready items nothing holds any more
 * @property {string[]} deferred - Items left for the next cycle
 * @property {number} realBlockers - Open blockers in the same project
 * @property {number} itemsWithRealBlockers - Items with one
 * @property {number} crossProject - Links to another project, left alone
 * @property {{ ref: string, blocker: string }[]} inaccessible - Blockers that could not be read
 * @property {{ ref: string, blocker: string }[]} keptByPerson - Links a person put back
 * @property {number} [landed] - Links kept to work merged but not yet in production (they hold nothing)
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

/** How an item whose own blocker list could not be read is reported. */
export const UNREAD_LIST = "its blocker list";

/**
 * Tally the sweep over every judged item.
 * @param {readonly { item: { ref: string, statusKnown?: boolean, relationsRead?: boolean }, inBlocked: boolean, sorted: Record<string, object[]> }[]} judged
 * @param {readonly { removed: string[], becomesClaimable: boolean, ref: string }[]} plans
 * @param {readonly string[]} deferred
 * @returns {StaleLinkReport}
 */
export function tallySweep(judged, plans, deferred) {
  const known = judged.filter(entry => entry.item.statusKnown !== false);
  const open = known.filter(entry => !entry.inBlocked);
  return {
    scanned: judged.length,
    skippedBlockedRole: known.length - open.length,
    unknownStatus: judged
      .filter(entry => entry.item.statusKnown === false)
      .map(entry => entry.item.ref),
    cleared: plans.reduce((sum, plan) => sum + plan.removed.length, 0),
    itemsCleared: plans.length,
    claimable: plans
      .filter(plan => plan.becomesClaimable)
      .map(plan => plan.ref),
    deferred: [...deferred],
    realBlockers: open.reduce((sum, e) => sum + size(e.sorted.real), 0),
    itemsWithRealBlockers: open.filter(e => size(e.sorted.real) > 0).length,
    crossProject: open.reduce((sum, e) => sum + size(e.sorted.crossProject), 0),
    inaccessible: [
      ...open
        .filter(e => e.item.relationsRead === false)
        .map(e => ({ ref: e.item.ref, blocker: UNREAD_LIST })),
      ...open.flatMap(e => pairs(e.item.ref, e.sorted.inaccessible)),
    ],
    keptByPerson: open.flatMap(e => pairs(e.item.ref, e.sorted.keptByPerson)),
    landed: open.reduce((sum, e) => sum + size(e.sorted.landed ?? []), 0),
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
  const landed = report.landed ?? 0;
  if (landed > 0) {
    parts.push(
      `kept ${plural(landed, "link", "links")} to work merged but not yet in production (not holding anything)`
    );
  }
  const unknown = report.unknownStatus ?? [];
  if (unknown.length > 0) {
    parts.push(
      `left ${unknown.join(", ")} alone because ${unknown.length === 1 ? "its" : "their"} status could not be read`
    );
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
 * @param {readonly { ref?: string, confirmed: string[], stillPresent: string[], becameReady: boolean, restored?: readonly object[], blockersBefore?: { real: number, inaccessible: string[] }, blockersAfter?: { real: number, inaccessible: string[] } }[]} results - One per item acted on
 * @param {{ planned?: number }} [counts] - Planned removals, when they differ
 *   from the report (a plan entry confirmed down to fewer links)
 * @returns {string}
 */
export function summarizeVerifiedSweep(report, results, counts = {}) {
  const cleared = results.reduce((sum, r) => sum + r.confirmed.length, 0);
  const items = results.filter(r => r.confirmed.length > 0).length;
  const ready = results.filter(r => r.becameReady).length;
  const putBack = results.reduce(
    (sum, r) => sum + (r.restored?.length ?? 0),
    0
  );
  const planned = counts.planned ?? report.cleared;
  const notDone = Math.max(0, planned - cleared - putBack);
  const parts = [
    `cleared ${plural(cleared, "stale blocker link", "stale blocker links")} on ${plural(items, "item", "items")}`,
  ];
  if (ready > 0) parts.push(`${ready} now ready to start`);
  if (putBack > 0) {
    parts.push(
      `put back ${plural(putBack, "link", "links")} whose blocker reopened`
    );
  }
  if (notDone > 0) {
    parts.push(
      `${plural(notDone, "planned removal", "planned removals")} not done (retried next cycle)`
    );
  }
  return `stale links: ${[...parts, ...tail(refreshed(report, results))].join("; ")}.`;
}

/**
 * The plan's report with each acted-on item's blocker totals replaced by its
 * read-back's (`blockersBefore` -> `blockersAfter`): a blocker that finished,
 * or reopened, since the plan is counted as it is now. Items with no newer
 * observation keep their planning-time contribution.
 * @param {StaleLinkReport} report
 * @param {readonly { ref?: string, blockersBefore?: { real: number, inaccessible: string[] }, blockersAfter?: { real: number, inaccessible: string[] } }[]} results
 * @returns {StaleLinkReport}
 */
function refreshed(report, results) {
  const seen = results.filter(
    r => r.ref && r.blockersBefore && r.blockersAfter
  );
  if (seen.length === 0) return report;
  const acted = new Set(seen.map(r => r.ref));
  const sum = (pick, list) => list.reduce((total, r) => total + pick(r), 0);
  const holds = side => r => (r[side].real > 0 ? 1 : 0);
  return {
    ...report,
    realBlockers: Math.max(
      0,
      report.realBlockers -
        sum(r => r.blockersBefore.real, seen) +
        sum(r => r.blockersAfter.real, seen)
    ),
    itemsWithRealBlockers: Math.max(
      0,
      report.itemsWithRealBlockers -
        sum(holds("blockersBefore"), seen) +
        sum(holds("blockersAfter"), seen)
    ),
    inaccessible: [
      ...report.inaccessible.filter(pair => !acted.has(pair.ref)),
      ...seen.flatMap(r =>
        r.blockersAfter.inaccessible.map(blocker => ({ ref: r.ref, blocker }))
      ),
    ],
  };
}
