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
const keyOf = entry => `${entry.ref}|${[...entry.removed].sort().join(",")}`;

/**
 * Record the comment owed for one verified result. A result with nothing
 * confirmed owes nothing; recording the same removals twice keeps one entry.
 * @param {readonly PendingComment[]} pending
 * @param {import("./stale-blocker-verify.mjs").StaleLinkResult} result
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
 * Drop the comments now posted for an item.
 * @param {readonly PendingComment[]} pending
 * @param {string} ref
 * @returns {PendingComment[]}
 */
export const settlePending = (pending, ref) =>
  (Array.isArray(pending) ? pending : []).filter(one => one.ref !== ref);

/**
 * Count one more failed post for an item's pending comments.
 * @param {readonly PendingComment[]} pending
 * @param {string} ref
 * @returns {PendingComment[]}
 */
export const failedPending = (pending, ref) =>
  (Array.isArray(pending) ? pending : []).map(one =>
    one.ref === ref ? { ...one, attempts: Number(one.attempts ?? 0) + 1 } : one
  );
