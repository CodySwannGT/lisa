/**
 * Plan the session manager's "Orphans and holds" sweep (CodySwannGT/lisa#4722).
 * Pure: no I/O, no config reads; the clock arrives as `now`.
 *
 * Reconcile used to look only at the manager's own ledger, so items left in
 * the `claimed` (or `review`) role by an earlier manager session, a worker
 * that died or was stopped, or a completion step that never ran were never
 * revisited. On a live project most claimed items had no live worker, some
 * for days. This planner buckets each such orphan:
 *
 * - `doneReady`: its pull request merged; only completion is missing.
 * - `return`: no open or merged pull request; back to the `ready` role.
 * - `redispatch`: an open pull request and no owner; spawn a fresh attempt.
 * - `parked`: held for a person; leave it, but make sure it says why.
 * - `lookup`: the pull request is not known yet; the manager finds it first.
 *
 * It never touches an item the ledger shows live, one assigned to someone
 * other than "me" or an operator, or one updated within `staleHours`, which
 * protects a person running `/lisa:implement` by hand outside the manager.
 * The hold half lives in orphan-holds.mjs. Writes per cycle are capped at
 * `max`, shared across orphans and hold lifts, and the rest are `deferred`.
 * @module session-manager/orphan-sweep
 */
import {
  entryMatches,
  idComparableValues,
  parseIdEntries,
} from "../../../scripts/operator-id-kinds.mjs";
import { holdDigest, judgeHold } from "./orphan-holds.mjs";
import { FINISH_RETRY_HOURS, classifyOrphan } from "./orphan-buckets.mjs";

export {
  FINISH_REFUSED_PREFIX,
  FINISH_RETRY_HOURS,
  SWEEP_COMMENT_PREFIX,
} from "./orphan-buckets.mjs";

/** At most this many writes per cycle unless the caller says otherwise. */
export const DEFAULT_ORPHAN_MAX = 10;

/** An item updated more recently than this many hours is left alone. */
export const DEFAULT_STALE_HOURS = 6;

/** The order buckets spend the cap in. */
const CAPPED_BUCKETS = ["doneReady", "return", "redispatch", "parked"];

/**
 * A trimmed id string, or null. Numeric ids become strings.
 * @param {unknown} value - Raw id
 * @returns {string | null} Comparable id
 */
function idOrNull(value) {
  if (typeof value === "string" && value.trim() !== "") return value.trim();
  return Number.isSafeInteger(value) ? String(value) : null;
}

/**
 * The fields one assignee is compared on, the way `queue` compares them: a
 * plain string is the tracker's normalized id (GitHub login, Jira accountId,
 * Linear user id); a `{login, id}` object adds the kind-keyed fields.
 * @param {unknown} assignee - One assignee as the tracker gave it
 * @returns {{plain: string|null, login: string|null, id: string|null}} Fields
 */
function assigneeFields(assignee) {
  if (assignee !== null && typeof assignee === "object") {
    const login = idOrNull(assignee.login);
    const id = idOrNull(assignee.id ?? assignee.accountId);
    return { plain: login ?? id, login, id };
  }
  return { plain: idOrNull(assignee), login: null, id: null };
}

/**
 * Whether any assignee is neither "me" nor an operator.
 * @param {unknown} assignees - The item's assignees
 * @param {{me: string|null, operators: object[]}} who - Identities
 * @returns {boolean} True when someone else holds the item
 */
function heldBySomeoneElse(assignees, who) {
  return (Array.isArray(assignees) ? assignees : []).some(assignee => {
    const fields = assigneeFields(assignee);
    if (fields.plain === null) return false;
    if (who.me !== null && fields.plain === who.me) return false;
    return !who.operators.some(entry => entryMatches(entry, fields));
  });
}

/**
 * Resolve and check the options.
 * @param {object} opts - Caller options
 * @returns {object} Resolved policy
 */
function resolveOptions(opts = {}) {
  const now = new Date(opts.now ?? Number.NaN).getTime();
  if (!Number.isFinite(now)) throw new Error("now must be a valid time");
  const max = opts.max ?? DEFAULT_ORPHAN_MAX;
  if (!Number.isInteger(max) || max < 0) {
    throw new Error("max must be a non-negative integer");
  }
  const staleHours = opts.staleHours ?? DEFAULT_STALE_HOURS;
  if (typeof staleHours !== "number" || !(staleHours >= 0)) {
    throw new Error("staleHours must be a non-negative number");
  }
  return {
    now,
    max,
    staleMs: staleHours * 3_600_000,
    live: new Set(Array.isArray(opts.liveRefs) ? opts.liveRefs : []),
    who: {
      me: idOrNull(opts.me),
      operators: parseIdEntries(opts.operatorIds),
    },
    trustedHumanActorIds: idComparableValues(opts.trustedAuthorIds),
    humanNeededLabel: opts.humanNeededLabel,
    humanOnly: opts.humanOnly,
    readyLabel: opts.readyLabel,
    lifecycleLabels: opts.lifecycleLabels,
    roleLabels: opts.roleLabels ?? {},
    rolesAreStates: opts.rolesAreStates === true,
    finishRetryMs: FINISH_RETRY_HOURS * 3_600_000,
    previousDigest: opts.previousDigest ?? null,
  };
}

/**
 * Why an orphan candidate is left alone, or null when the sweep may act.
 * @param {object} item - Candidate with a ref
 * @param {object} policy - Resolved policy
 * @returns {string | null} Skip reason
 */
function skipReason(item, policy) {
  if (policy.live.has(item.ref)) return "live";
  if (heldBySomeoneElse(item.assignees, policy.who)) return "foreign";
  const updated = new Date(item.updatedAt ?? Number.NaN).getTime();
  if (!Number.isFinite(updated)) return "undated";
  return policy.now - updated < policy.staleMs ? "fresh" : null;
}

/**
 * The canonical ref of a raw entry, or empty.
 * @param {unknown} raw - Raw entry
 * @returns {string} Trimmed ref
 */
const refOf = raw => (typeof raw?.ref === "string" ? raw.ref.trim() : "");

/**
 * Sort orphan candidates into skips and buckets, uncapped.
 * @param {unknown} items - Raw candidates
 * @param {object} policy - Resolved policy
 * @returns {{skipped: object[], buckets: Record<string, object[]>}} Sorted
 */
function sortOrphans(items, policy) {
  const skipped = [];
  const buckets = {
    lookup: [],
    doneReady: [],
    return: [],
    redispatch: [],
    parked: [],
  };
  for (const raw of Array.isArray(items) ? items : []) {
    const ref = refOf(raw);
    const reason = ref === "" ? "no ref" : skipReason({ ...raw, ref }, policy);
    if (reason !== null) {
      skipped.push({ ref: ref === "" ? null : ref, reason });
      continue;
    }
    const { bucket, entry } = classifyOrphan({ ...raw, ref }, policy);
    buckets[bucket].push(entry);
  }
  return { skipped, buckets };
}

/**
 * Judge every hold, once per ref.
 * @param {unknown} holds - Raw hold candidates
 * @param {object} policy - Resolved policy
 * @returns {{lift: object[], keep: object[], skipped: object[]}} Judged
 */
function sortHolds(holds, policy) {
  const judged = { lift: [], keep: [], skipped: [] };
  const seen = new Set();
  for (const raw of Array.isArray(holds) ? holds : []) {
    const ref = refOf(raw);
    if (ref === "" || seen.has(ref)) continue;
    seen.add(ref);
    // A worker is on it, or a person's answer is awaited: not ours to judge,
    // and never on the operator's list a second time.
    if (policy.live.has(ref)) {
      judged.skipped.push({ ref, reason: "live" });
      continue;
    }
    const { kind, entry, keep } = judgeHold({ ...raw, ref }, policy);
    judged[kind === "skip" ? "skipped" : kind].push(entry);
    if (keep) judged.keep.push(keep);
  }
  return judged;
}

/**
 * Whether an entry spends the cap: a parked item already explaining its hold
 * needs no write, so it never does.
 * @param {string} bucket - Bucket name
 * @param {object} entry - Bucket entry
 * @returns {boolean} True when it costs a write
 */
const costs = (bucket, entry) =>
  bucket !== "parked" || entry.reasonOnItem === false;

/**
 * Spend the cap across buckets in order, deferring the overflow.
 * @param {[string, object[]][]} queue - Buckets in spending order
 * @param {number} max - Cap
 * @returns {{kept: Record<string, object[]>, deferred: object[]}} Capped
 */
function spendCap(queue, max) {
  let spent = 0;
  const kept = {};
  const deferred = [];
  for (const [bucket, entries] of queue) {
    kept[bucket] = [];
    for (const entry of entries) {
      if (costs(bucket, entry) && spent >= max) {
        deferred.push({ ref: entry.ref, bucket });
        continue;
      }
      if (costs(bucket, entry)) spent += 1;
      kept[bucket].push(entry);
    }
  }
  return { kept, deferred };
}

/**
 * One orphan the sweep acts on, or asks a PR lookup for.
 * @typedef {object} OrphanEntry
 * @property {string} ref - Canonical item ref
 * @property {string} reason - Plain-English reason for the bucket
 * @property {string} [prUrl] - The pull request (`doneReady`, `redispatch`)
 * @property {string} [comment] - The comment to post (`return`, and `parked`
 *   when `reasonOnItem` is false); starts with `[lisa-session-manager]`
 * @property {boolean} [reasonOnItem] - `parked` only: the item already says
 *   why it is held
 */

/**
 * One hold the sweep lifts.
 * @typedef {object} HoldLift
 * @property {string} ref - Canonical item ref
 * @property {string} reason - Plain-English reason
 * @property {string[]} comments - Lift comments, each ending with `decision`
 * @property {{removeHumanNeededLabel: boolean, addReadyLabel: string|null}}
 *   actions - Label writes after the comments
 * @property {string} decision - The `Decision:` line
 */

/**
 * The plan `planOrphanSweep` returns; it writes nothing.
 * @typedef {object} OrphanSweepPlan
 * @property {OrphanEntry[]} doneReady - Merged PR; finish completion
 * @property {OrphanEntry[]} return - Back to the `ready` role
 * @property {OrphanEntry[]} redispatch - Open PR; spawn a fresh attempt
 * @property {OrphanEntry[]} parked - Held for a person; leave it
 * @property {OrphanEntry[]} lookup - Find the PR, then plan again
 * @property {{ref: string|null, reason: string}[]} skipped - Left alone
 * @property {{lift: HoldLift[], keep: {ref: string, reason: string}[],
 *   digest: {fingerprint: string|null, text: string, changed: boolean}}}
 *   holds - Lifts, truly-human holds and the operator's list
 * @property {{ref: string, bucket: string}[]} deferred - Over the cap
 */

/**
 * Plan this cycle's orphan and hold sweep.
 * @param {{items?: unknown, holds?: unknown}} input - Items in the `claimed`
 *   (and configured `review`) role as `{ref, role, labels, body, comments,
 *   assignees, updatedAt, pr}` (`pr` undefined when not looked up, null when
 *   none was found, else `{url, state}`), and held items as
 *   `{ref, role?, labels, body, comments}`
 * @param {{liveRefs?: string[], me?: string|null, operatorIds?: unknown,
 *   now: string|number|Date, staleHours?: number, max?: number,
 *   trustedAuthorIds?: unknown, humanNeededLabel?: string, humanOnly?: unknown,
 *   readyLabel?: string, lifecycleLabels?: string[],
 *   roleLabels?: Record<string, string | string[]>,
 *   rolesAreStates?: boolean,
 *   previousDigest?: string|null}} opts - Ledger-derived live refs,
 *   identities, the clock, the cap and the hold policy
 * @returns {OrphanSweepPlan} Plan; it writes nothing
 */
export function planOrphanSweep(input = {}, opts = {}) {
  const policy = resolveOptions(opts);
  const orphans = sortOrphans(input.items, policy);
  const holds = sortHolds(input.holds, policy);
  const lookup = orphans.buckets.lookup;
  const capped = spendCap(
    [
      ...CAPPED_BUCKETS.map(bucket => [bucket, orphans.buckets[bucket]]),
      ["lift", holds.lift],
    ],
    policy.max
  );
  return {
    doneReady: capped.kept.doneReady,
    return: capped.kept.return,
    redispatch: capped.kept.redispatch,
    parked: capped.kept.parked,
    lookup: lookup.slice(0, policy.max),
    skipped: [...orphans.skipped, ...holds.skipped],
    holds: {
      lift: capped.kept.lift,
      keep: holds.keep,
      digest: holdDigest(holds.keep, policy.previousDigest),
    },
    deferred: [
      ...capped.deferred,
      ...lookup.slice(policy.max).map(entry => ({
        ref: entry.ref,
        bucket: "lookup",
      })),
    ],
  };
}
