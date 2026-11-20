/**
 * After the writes of a stale-link clean-up (CodySwannGT/lisa#5065):
 *
 * - `stale-links-verify` reads the item back and says which planned
 *   removals are confirmed. Its comment covers ONLY those, and it records
 *   that comment as pending, so a comment that then fails to post is retried
 *   on its own instead of being lost with its already-removed link.
 * - `stale-links-pending` lists the comments still owed; `stale-links-posted`
 *   settles one after it posts (or, with `--failed`, counts a failed try).
 * - `stale-links-report` builds the cycle's summary from the verified
 *   results, never from the plan.
 *
 * `stale-links-verify` also records each item whose planned removals did not
 * happen, so the next plan puts it after every other candidate. It settles
 * the in-flight entry `stale-links-confirm` wrote before the deletes, and
 * only on success: a failed read-back leaves it for `stale-links-pending` to
 * list as unverified, so the next cycle verifies it again. Links it put back
 * (their blocker reopened) are recorded as owed restores until
 * `stale-links-restored` reads them back present; the queue holds those
 * items from dispatch meanwhile. Every record lives in the manager's state
 * directory (`stale-links-state.mjs`).
 * @module session-manager/cli-stale-links-results
 */
import {
  addPending,
  failedInFlight,
  failedPending,
  recordRemovalResult,
  recordRestores,
  settleInFlight,
  settlePending,
  settleRestores,
} from "../../../scripts/stale-blocker-pending.mjs";
import { restoreActions } from "../../../scripts/stale-blocker-restore.mjs";
import { summarizeVerifiedSweep } from "../../../scripts/stale-blocker-summary.mjs";
import { normalizeStaleLinkItem } from "../../../scripts/stale-blocker-sweep.mjs";
import { verifyStaleLinkRemoval } from "../../../scripts/stale-blocker-verify.mjs";
import { CliError, asSetupError, loadProject } from "./cli-runtime.mjs";
import { freshItem, judgingContext, trackerOf } from "./cli-stale-links.mjs";
import { readJsonFile } from "./json-input.mjs";
import { blockerReader } from "./stale-links-github.mjs";
import {
  readFailures,
  readInFlight,
  readPending,
  readRestores,
  withStateLock,
  writeFailures,
  writeInFlight,
  writePending,
  writeRestores,
} from "./stale-links-state.mjs";

/**
 * Each planned blocker as read NOW, after the delete. GitHub reads them
 * itself; Jira and Linear take `--blockers <file>`, a `{ref: rawIssue}` map
 * (a ref with no entry, or null, reads as unreadable and its link is put
 * back).
 * @param {object} ctx - CLI context
 * @param {string} tracker
 * @param {{ removed?: string[] }} plan
 * @returns {Record<string, object | null>}
 */
function removedBlockersNow(ctx, tracker, plan) {
  if (ctx.values.blockers) {
    const map = readJsonFile(ctx.values.blockers);
    if (!map || typeof map !== "object" || Array.isArray(map)) {
      throw new CliError(
        `${ctx.values.blockers}: expected {"<ref>": {...}}.`,
        2
      );
    }
    return map;
  }
  if (tracker !== "github") {
    throw new CliError(
      `stale-links-verify --tracker ${tracker} needs --blockers <file> with each removed blocker as read now.`,
      2
    );
  }
  const read = blockerReader(ctx);
  return Object.fromEntries((plan.removed ?? []).map(ref => [ref, read(ref)]));
}

/**
 * `stale-links-verify --tracker <t> --plan <file> [--input <file>]`.
 * @param {object} ctx - CLI context
 * @returns {{ json: object }} The verified result, plus `pending`
 */
export async function staleLinksVerify(ctx) {
  const project = loadProject(ctx.root);
  const tracker = trackerOf(ctx, project);
  if (!ctx.values.plan) {
    throw new CliError("stale-links-verify needs --plan <file>.", 2);
  }
  const plan = readJsonFile(ctx.values.plan);
  const result = await verifiedOrCounted(ctx, plan, () => {
    const after = freshItem(ctx, tracker, plan);
    const blockersNow = removedBlockersNow(ctx, tracker, plan);
    const context = judgingContext(project, tracker);
    return asSetupError(() =>
      verifyStaleLinkRemoval({ tracker, plan, after, blockersNow, ...context })
    );
  });
  const now = new Date().toISOString();
  await withStateLock(ctx.root, () => {
    writeFailures(
      ctx.root,
      recordRemovalResult(readFailures(ctx.root), result, now)
    );
    writeRestores(
      ctx.root,
      recordRestores(readRestores(ctx.root), result, plan.links ?? [], now)
    );
    if (result.comment !== null) {
      writePending(ctx.root, addPending(readPending(ctx.root), result, now));
    }
    // Last, and only once every record above is written: until then the
    // in-flight plan is the removed links' only recovery record.
    writeInFlight(ctx.root, settleInFlight(readInFlight(ctx.root), plan.ref));
  });
  return { json: { ...result, pending: result.comment !== null } };
}

/**
 * Run the read-back and verdict; when either throws (after the deletes may
 * have run), count the failed try on the item's in-flight entry and
 * rethrow, so the entry stays listed as unverified for the next cycle.
 * @template T
 * @param {object} ctx - CLI context
 * @param {{ ref: string }} plan - The confirmed plan entry
 * @param {() => T} verify
 * @returns {Promise<T>}
 */
async function verifiedOrCounted(ctx, plan, verify) {
  try {
    return verify();
  } catch (error) {
    await withStateLock(ctx.root, () =>
      writeInFlight(ctx.root, failedInFlight(readInFlight(ctx.root), plan.ref))
    );
    throw error;
  }
}

/**
 * `stale-links-pending`: what earlier writes still owe — comments not yet
 * posted, confirmed plans whose read-back has not succeeded (`unverified`,
 * each with the plan entry to verify again), and links owed back
 * (`restores`, by item ref).
 * @param {object} ctx - CLI context
 * @returns {{ json: object }} `{pending,unverified,restores}`
 */
export function staleLinksPending(ctx) {
  return {
    json: {
      pending: readPending(ctx.root),
      unverified: Object.values(readInFlight(ctx.root)),
      restores: readRestores(ctx.root),
    },
  };
}

/**
 * `stale-links-restored --ref <ref> [--tracker <t>] [--input <file>]`: read
 * the item back after its restores and settle each owed link now present.
 * GitHub reads the item itself; Jira and Linear take it in `--input`. The
 * links still missing come back with fresh `restore` actions built from
 * this read, to perform before the item can dispatch.
 * @param {object} ctx - CLI context
 * @returns {Promise<{ json: object }>} `{ref,owed,restore}`
 */
export async function staleLinksRestored(ctx) {
  const ref = ctx.values.ref;
  if (!ref) {
    throw new CliError("stale-links-restored needs --ref <ref>.", 2);
  }
  const tracker = trackerOf(ctx, loadProject(ctx.root));
  const item = normalizeStaleLinkItem(
    tracker,
    freshItem(ctx, tracker, { ref })
  );
  if (item.ref !== ref || !item.relationsRead) {
    // probe-direction: fail-closed — a read of another item, or one without
    // its relation list, cannot show a link is back, so nothing is settled.
    throw new CliError(
      `stale-links-restored: the read of ${ref} must be that item with its blocker links.`,
      1
    );
  }
  const present = new Set(item.edges.map(edge => edge.blockerRef));
  const left = await withStateLock(ctx.root, () => {
    const updated = settleRestores(readRestores(ctx.root), ref, present);
    writeRestores(ctx.root, updated);
    return updated[ref]?.links ?? [];
  });
  return {
    json: { ref, owed: left, restore: restoreActions(tracker, item, left) },
  };
}

/**
 * `stale-links-posted --ref <ref> [--failed]`.
 * @param {object} ctx - CLI context
 * @returns {{ json: object }} `{ref,pending}` after the update
 */
export async function staleLinksPosted(ctx) {
  const ref = ctx.values.ref;
  const removed = String(ctx.values.removed ?? "")
    .split(",")
    .map(one => one.trim())
    .filter(Boolean);
  if (!ref || removed.length === 0) {
    throw new CliError(
      "stale-links-posted needs --ref <ref> --removed <blocker,...> (the entry's `removed`).",
      2
    );
  }
  const next = await withStateLock(ctx.root, () => {
    const current = readPending(ctx.root);
    const updated = ctx.values.failed
      ? failedPending(current, ref, removed)
      : settlePending(current, ref, removed);
    writePending(ctx.root, updated);
    return updated;
  });
  return { json: { ref, removed, pending: next } };
}

/**
 * `stale-links-report --input <file>`: `{report, results, planned?}`, where
 * `report` is the plan's and `results` are the verify outputs.
 * @param {object} ctx - CLI context
 * @returns {{ json: object }} `{summary}`
 */
export function staleLinksReport(ctx) {
  if (!ctx.values.input) {
    throw new CliError("stale-links-report needs --input <file>.", 2);
  }
  const input = readJsonFile(ctx.values.input);
  if (!input?.report || !Array.isArray(input.results)) {
    throw new CliError(
      `${ctx.values.input}: expected {"report":{...},"results":[...]}.`,
      2
    );
  }
  return {
    json: {
      summary: summarizeVerifiedSweep(input.report, input.results, {
        planned: input.planned,
      }),
    },
  };
}
