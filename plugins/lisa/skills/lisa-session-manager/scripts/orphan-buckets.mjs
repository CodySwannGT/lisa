/**
 * Classify one orphaned item for the "Orphans and holds" sweep
 * (CodySwannGT/lisa#4722), and word the comments the manager posts on it.
 * Pure: the clock arrives in the policy.
 *
 * Every comment starts with `[lisa-session-manager]`: `item-answer` ignores
 * machine comments by that tag, so a sweep comment is never read as a
 * person's answer.
 * @module session-manager/orphan-buckets
 */
import {
  HUMAN_GATE_MARKER,
  humanGateHolds,
  humanGateVerdict,
  normalizeProviderMarkdown,
} from "../../../scripts/intake-blocker-reprobe.mjs";
import { QUESTION_MARKER } from "./human-needed.mjs";

/** The tag every comment the manager posts starts with. */
export const SWEEP_COMMENT_PREFIX = "[lisa-session-manager]";

/**
 * How the comment the manager posts when `lisa-work-item.mjs finish`
 * refuses an item begins. A later cycle that sees it parks the item instead
 * of trying to finish it again every cycle.
 */
export const FINISH_REFUSED_PREFIX = `${SWEEP_COMMENT_PREFIX} Cannot complete:`;

/** Words in a manager comment that show it explains a hold. */
const HOLD_WORDS = /\b(?:parked|held|hold|waiting on a person)\b/iu;

/**
 * The comment bodies of an item.
 * @param {unknown} comments - Comments as strings or `{body}` objects
 * @returns {string[]} Bodies, provider escaping undone
 */
function bodies(comments) {
  return (Array.isArray(comments) ? comments : [])
    .map(entry => (typeof entry === "string" ? entry : entry?.body))
    .filter(body => typeof body === "string")
    .map(normalizeProviderMarkdown);
}

/**
 * Whether a body has a line starting with `marker`, after leading space and
 * an optional HTML comment opener.
 * @param {string} body - Comment body
 * @param {string} marker - Marker text
 * @returns {boolean} True when a line declares it
 */
function declares(body, marker) {
  return body
    .split("\n")
    .some(line => line.replace(/^\s*(?:<!--\s*)?/u, "").startsWith(marker));
}

/**
 * Whether the item already says why it is held: a `[lisa-human-gate]` body
 * marker or comment, the manager's question comment, or a
 * `[lisa-session-manager]` comment naming the hold.
 * @param {{body?: unknown, comments?: unknown}} item - The item
 * @returns {boolean} True when a reader can see the reason
 */
export function holdReasonOnItem(item) {
  if (humanGateHolds(item.body).length > 0) return true;
  return bodies(item.comments).some(
    body =>
      declares(body, HUMAN_GATE_MARKER) ||
      declares(body, QUESTION_MARKER) ||
      (declares(body, SWEEP_COMMENT_PREFIX) && HOLD_WORDS.test(body))
  );
}

/**
 * How long ago an item was last touched, in words: hours under two days.
 * @param {number} ms - Elapsed milliseconds
 * @returns {string} e.g. `for 9 hours`, `for 3 days`
 */
export function ageInWords(ms) {
  const hours = Math.max(0, Math.floor(ms / 3_600_000));
  if (hours < 48) return `for ${hours} ${hours === 1 ? "hour" : "hours"}`;
  return `for ${Math.floor(hours / 24)} days`;
}

/**
 * The parked entry: the reason, and a comment only when the item lacks one.
 * @param {{ref: string, labels?: unknown, body?: unknown, comments?: unknown}} item - Item
 * @param {object} policy - Resolved policy
 * @returns {object} Parked entry
 */
function parkedEntry(item, policy) {
  const label = policy.humanNeededLabel ?? "human-needed";
  const reason = "held for a person, with no live worker";
  if (holdReasonOnItem(item)) {
    return { ref: item.ref, reason, reasonOnItem: true };
  }
  return {
    ref: item.ref,
    reason,
    reasonOnItem: false,
    comment:
      `${SWEEP_COMMENT_PREFIX} Parked: this item carries the \`${label}\` ` +
      "label, so it is waiting on a person, and no worker is on it. It stays " +
      "where it is until a person acts or releases the hold.",
  };
}

/**
 * Whether an orphan is held: the human-needed label, or the shared hold
 * verdict (a declared body hold not yet released or lifted).
 * @param {object} item - Item
 * @param {object} policy - Resolved policy
 * @returns {boolean} True when held
 */
function isHeld(item, policy) {
  const verdict = humanGateVerdict({
    labels: item.labels,
    body: item.body,
    comments: item.comments,
    trustedHumanActorIds: policy.trustedHumanActorIds,
    humanNeededLabel: policy.humanNeededLabel,
    humanOnly: policy.humanOnly,
  });
  return verdict.held || verdict.labelPresent;
}

/**
 * Whether the manager already posted a refused completion on the item.
 * @param {{comments?: unknown}} item - Item
 * @returns {boolean} True when a comment line starts {@link FINISH_REFUSED_PREFIX}
 */
function completionRefused(item) {
  return bodies(item.comments).some(body =>
    declares(body, FINISH_REFUSED_PREFIX)
  );
}

/**
 * The bucket for a merged item: finish it, unless completion was already
 * refused, in which case it waits for whatever the refusal named.
 * @param {{ref: string, pr: {url?: string}}} item - Item
 * @returns {{bucket: string, entry: object}} Bucket and its entry
 */
function mergedBucket(item) {
  const { ref, pr } = item;
  if (completionRefused(item)) {
    const reason =
      "its pull request merged but completion was refused; the refusal on the item says why";
    return { bucket: "parked", entry: { ref, reason, reasonOnItem: true } };
  }
  const reason = "its pull request merged; only completion is missing";
  return { bucket: "doneReady", entry: { ref, prUrl: pr.url, reason } };
}

/**
 * The bucket for an item with an open pull request: only the `claimed` role
 * re-dispatches; an item in the `review` role waits on review or merge.
 * @param {{ref: string, role?: unknown, pr: {url?: string}}} item - Item
 * @returns {{bucket: string, entry: object}} Bucket and its entry
 */
function openBucket(item) {
  const { ref, pr } = item;
  if (item.role === "review") {
    const reason =
      "in review: waiting on review or merge of its open pull request";
    return { bucket: "parked", entry: { ref, reason, reasonOnItem: true } };
  }
  const reason = "an open pull request with no live worker";
  return { bucket: "redispatch", entry: { ref, prUrl: pr.url, reason } };
}

/**
 * Bucket one orphan that passed the live, foreign and fresh checks. A merged
 * pull request wins over a hold: the work is done, only completion is left.
 * @param {{ref: string, role?: unknown, pr?: unknown, updatedAt?: unknown,
 *   comments?: unknown}} item - Item
 * @param {{now: number}} policy - Resolved policy
 * @returns {{bucket: string, entry: object}} Bucket and its entry
 */
export function classifyOrphan(item, policy) {
  const { ref, pr } = item;
  if (pr === undefined) {
    return {
      bucket: "lookup",
      entry: { ref, reason: "its pull request has not been looked up yet" },
    };
  }
  const state = pr === null ? null : String(pr.state ?? "").toLowerCase();
  if (state === "merged") return mergedBucket(item);
  if (isHeld(item, policy)) {
    return { bucket: "parked", entry: parkedEntry(item, policy) };
  }
  if (state === "open") return openBucket(item);
  const age = ageInWords(policy.now - new Date(item.updatedAt).getTime());
  return {
    bucket: "return",
    entry: {
      ref,
      reason: "no live worker and no open or merged pull request",
      comment: `${SWEEP_COMMENT_PREFIX} Returned to Ready: claimed ${age} with no live worker and no open or merged pull request.`,
    },
  };
}
