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
 * happen, so the next plan puts it after every other candidate. Both records
 * live in the manager's state directory (`stale-links-state.mjs`).
 * @module session-manager/cli-stale-links-results
 */
import {
  addPending,
  failedPending,
  recordRemovalResult,
  settlePending,
} from "../../../scripts/stale-blocker-pending.mjs";
import { summarizeVerifiedSweep } from "../../../scripts/stale-blocker-summary.mjs";
import { verifyStaleLinkRemoval } from "../../../scripts/stale-blocker-verify.mjs";
import { CliError, asSetupError, loadProject } from "./cli-runtime.mjs";
import { freshItem, judgingContext, trackerOf } from "./cli-stale-links.mjs";
import { readJsonFile } from "./json-input.mjs";
import { blockerReader } from "./stale-links-github.mjs";
import {
  readFailures,
  readPending,
  withStateLock,
  writeFailures,
  writePending,
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
  const after = freshItem(ctx, tracker, plan);
  const blockersNow = removedBlockersNow(ctx, tracker, plan);
  const context = judgingContext(project, tracker);
  const result = asSetupError(() =>
    verifyStaleLinkRemoval({ tracker, plan, after, blockersNow, ...context })
  );
  const now = new Date().toISOString();
  await withStateLock(ctx.root, () => {
    writeFailures(
      ctx.root,
      recordRemovalResult(readFailures(ctx.root), result, now)
    );
    if (result.comment !== null) {
      writePending(ctx.root, addPending(readPending(ctx.root), result, now));
    }
  });
  return { json: { ...result, pending: result.comment !== null } };
}

/**
 * `stale-links-pending`: the comments still owed.
 * @param {object} ctx - CLI context
 * @returns {{ json: object }} `{pending}`
 */
export function staleLinksPending(ctx) {
  return { json: { pending: readPending(ctx.root) } };
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
