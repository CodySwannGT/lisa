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
import {
  readFailures,
  readPending,
  writeFailures,
  writePending,
} from "./stale-links-state.mjs";

/**
 * `stale-links-verify --tracker <t> --plan <file> [--input <file>]`.
 * @param {object} ctx - CLI context
 * @returns {{ json: object }} The verified result, plus `pending`
 */
export function staleLinksVerify(ctx) {
  const project = loadProject(ctx.root);
  const tracker = trackerOf(ctx, project);
  if (!ctx.values.plan) {
    throw new CliError("stale-links-verify needs --plan <file>.", 2);
  }
  const plan = readJsonFile(ctx.values.plan);
  const after = freshItem(ctx, tracker, plan);
  const context = judgingContext(project, tracker);
  const result = asSetupError(() =>
    verifyStaleLinkRemoval({ tracker, plan, after, ...context })
  );
  const now = new Date().toISOString();
  writeFailures(
    ctx.root,
    recordRemovalResult(readFailures(ctx.root), result, now)
  );
  const pending = addPending(readPending(ctx.root), result, now);
  if (result.comment !== null) writePending(ctx.root, pending);
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
export function staleLinksPosted(ctx) {
  const ref = ctx.values.ref;
  if (!ref) throw new CliError("stale-links-posted needs --ref <ref>.", 2);
  const current = readPending(ctx.root);
  const next = ctx.values.failed
    ? failedPending(current, ref)
    : settlePending(current, ref);
  writePending(ctx.root, next);
  return { json: { ref, pending: next } };
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
