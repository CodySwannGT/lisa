#!/usr/bin/env node
/**
 * Comments owed for stale-link removals that are already confirmed
 * (CodySwannGT/lisa#5065).
 *
 * Once a removal reads back as done, its link is gone and no later plan will
 * see it again. If posting the comment then fails, or the writer is stopped
 * before it posts, the operator would never learn why the link went. So each
 * confirmed removal is recorded here as pending until its comment is posted,
 * and pending comments are retried on their own, separately from any new
 * plan. The record is plain JSON so any agent can keep it in its state
 * directory; the functions here are pure and do no I/O.
 *
 * The same directory keeps a second record: the items whose planned
 * removals did NOT happen. Their links are still there, so every cycle plans
 * them again; without the record, items that keep failing and sort first
 * would spend the per-cycle cap every time and starve later items. The
 * planner puts a recorded item after every other candidate
 * (`planStaleLinkSweep({failures})`), and a removal that later succeeds
 * clears its record, so it returns to the normal order.
 * @module stale-blocker-pending
 */

/**
 * One comment still owed.
 * @typedef {object} PendingComment
 * @property {string} ref - The item
 * @property {string[]} removed - Its confirmed removals
 * @property {string} comment - The comment to post
 * @property {object | null} commentAdf - The same as ADF for Jira, else null
 * @property {string} since - When the removal was confirmed (ISO time)
 * @property {number} attempts - Failed posts so far
 */

/**
 * @param {{ ref: string, removed: readonly string[] }} entry
 * @returns {string} Identity of a pending comment
 */
const keyOf = entry =>
  `${entry.ref}|${[...(entry.removed ?? [])].sort().join(",")}`;

/**
 * Record the comment owed for one verified result. A result with nothing
 * confirmed owes nothing; recording the same removals twice keeps one entry.
 * @param {readonly PendingComment[]} pending
 * @param {Pick<import("./stale-blocker-verify.mjs").StaleLinkResult, "ref" | "confirmed" | "comment"> & { commentAdf?: object | null }} result - A verify result
 * @param {string} now - ISO time
 * @returns {PendingComment[]}
 */
export function addPending(pending, result, now) {
  const list = Array.isArray(pending) ? [...pending] : [];
  if (!result?.comment || result.confirmed.length === 0) return list;
  const entry = {
    ref: result.ref,
    removed: [...result.confirmed],
    comment: result.comment,
    commentAdf: result.commentAdf ?? null,
    since: now,
    attempts: 0,
  };
  return list.some(one => keyOf(one) === keyOf(entry))
    ? list
    : [...list, entry];
}

/**
 * Drop the ONE comment that just posted: an item can owe more than one (a
 * post failed, then a later cycle confirmed other removals), and each is
 * identified by its item and its removed set, as {@link addPending} keys it.
 * @param {readonly PendingComment[]} pending
 * @param {string} ref
 * @param {readonly string[]} removed - The posted comment's `removed`
 * @returns {PendingComment[]}
 */
export const settlePending = (pending, ref, removed) => {
  const key = keyOf({ ref, removed });
  return (Array.isArray(pending) ? pending : []).filter(
    one => keyOf(one) !== key
  );
};

/**
 * Count one more failed post for that one comment.
 * @param {readonly PendingComment[]} pending
 * @param {string} ref
 * @param {readonly string[]} removed - The comment's `removed`
 * @returns {PendingComment[]}
 */
export const failedPending = (pending, ref, removed) => {
  const key = keyOf({ ref, removed });
  return (Array.isArray(pending) ? pending : []).map(one =>
    keyOf(one) === key
      ? { ...one, attempts: Number(one.attempts ?? 0) + 1 }
      : one
  );
};

/**
 * Items whose planned removals did not happen, by ref.
 * @typedef {Record<string, { attempts: number, since: string, stillPresent: string[] }>} RemovalFailures
 */

/**
 * Update the failure record from one verified result: a planned removal
 * still on the item counts one more failure; none left clears the record.
 * @param {RemovalFailures | undefined} failures
 * @param {{ ref: string, stillPresent: readonly string[] }} result
 * @param {string} now - ISO time
 * @returns {RemovalFailures}
 */
export function recordRemovalResult(failures, result, now) {
  const current =
    failures && typeof failures === "object" && !Array.isArray(failures)
      ? failures
      : {};
  const { [result.ref]: previous, ...rest } = current;
  if (result.stillPresent.length === 0) return rest;
  return {
    ...rest,
    [result.ref]: {
      attempts: Number(previous?.attempts ?? 0) + 1,
      since: previous?.since ?? now,
      stillPresent: [...result.stillPresent],
    },
  };
}

/**
 * Confirmed plan entries whose writes are about to run, by item ref. A
 * confirm records its entry here BEFORE any delete, and only a verify that
 * read the item back settles it. So a read-back that fails after the
 * deletes ran (or a writer stopped in between) leaves the removals
 * recoverable: the entry is verified again on the next cycle instead of its
 * links vanishing with no comment and no restore check.
 * @typedef {Record<string, { plan: object, since: string, attempts: number }>} InFlight
 */

/**
 * @param {unknown} value
 * @returns {Record<string, any>}
 */
const recordOf = value =>
  value && typeof value === "object" && !Array.isArray(value) ? value : {};

/**
 * Record one confirmed plan entry as in flight (replacing an older one).
 * @param {InFlight | undefined} inflight
 * @param {{ ref: string }} plan - The confirmed plan entry
 * @param {string} now - ISO time
 * @returns {InFlight}
 */
export function recordInFlight(inflight, plan, now) {
  return {
    ...recordOf(inflight),
    [plan.ref]: { plan, since: now, attempts: 0 },
  };
}

/**
 * Settle an item's in-flight entry after a verify read it back.
 * @param {InFlight | undefined} inflight
 * @param {string} ref
 * @returns {InFlight}
 */
export function settleInFlight(inflight, ref) {
  const { [ref]: _settled, ...rest } = recordOf(inflight);
  return rest;
}

/**
 * Count one more failed verify for an item's in-flight entry.
 * @param {InFlight | undefined} inflight
 * @param {string} ref
 * @returns {InFlight}
 */
export function failedInFlight(inflight, ref) {
  const current = recordOf(inflight);
  if (!Object.hasOwn(current, ref)) return current;
  return {
    ...current,
    [ref]: {
      ...current[ref],
      attempts: Number(current[ref].attempts ?? 0) + 1,
    },
  };
}

/**
 * Links owed back to an item, by ref: removed links whose blocker reopened
 * before the delete. Each stays owed until a read-back shows it present
 * again, and the queue holds its item from dispatch meanwhile, because the
 * item would otherwise look unblocked while its blocker is open.
 * Only the links are kept: the actions that put them back are computed from
 * a fresh read each time (`restoreActions`), so a re-added `Blocked by` line
 * never overwrites a body edited since.
 * @typedef {Record<string, { links: { blockerRef: string, source: string, actionId: string, linkType?: string }[], since: string, attempts: number }>} OwedRestores
 */

/**
 * Record the restores one verify result owes (merging with any already owed
 * for the item).
 * @param {OwedRestores | undefined} owed
 * @param {{ ref: string, restored: readonly { blockerRef: string }[] }} result
 * @param {readonly { blockerRef: string, source: string, actionId: string, linkType?: string }[]} links - The plan's links
 * @param {string} now - ISO time
 * @returns {OwedRestores}
 */
export function recordRestores(owed, result, links, now) {
  const current = recordOf(owed);
  if ((result.restored ?? []).length === 0) return current;
  const back = new Set(result.restored.map(one => one.blockerRef));
  const previous = current[result.ref];
  const merged = [
    ...(previous?.links ?? []).filter(link => !back.has(link.blockerRef)),
    ...links.filter(link => back.has(link.blockerRef)),
  ];
  return {
    ...current,
    [result.ref]: {
      links: merged,
      since: previous?.since ?? now,
      attempts: Number(previous?.attempts ?? 0),
    },
  };
}

/**
 * Settle the owed restores a read-back shows done: each owed link whose
 * blocker is linked again is dropped; the item's entry goes once none is
 * left, and otherwise counts one more failed try.
 * @param {OwedRestores | undefined} owed
 * @param {string} ref
 * @param {ReadonlySet<string>} present - Blocker refs linked on the item now
 * @returns {OwedRestores}
 */
export function settleRestores(owed, ref, present) {
  const current = recordOf(owed);
  const entry = current[ref];
  if (!entry) return current;
  const { [ref]: _entry, ...rest } = current;
  const left = entry.links.filter(link => !present.has(link.blockerRef));
  if (left.length === 0) return rest;
  return {
    ...rest,
    [ref]: {
      ...entry,
      links: left,
      attempts: Number(entry.attempts ?? 0) + 1,
    },
  };
}
