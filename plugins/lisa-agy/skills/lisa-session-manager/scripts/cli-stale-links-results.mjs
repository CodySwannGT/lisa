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
 * The pending record lives in the manager's state directory
 * (`.lisa/session-manager/stale-links-pending.json`).
 * @module session-manager/cli-stale-links-results
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  addPending,
  failedPending,
  settlePending,
} from "../../../scripts/stale-blocker-pending.mjs";
import { summarizeVerifiedSweep } from "../../../scripts/stale-blocker-summary.mjs";
import { verifyStaleLinkRemoval } from "../../../scripts/stale-blocker-verify.mjs";
import { CliError, asSetupError, loadProject } from "./cli-runtime.mjs";
import { freshItem, judgingContext, trackerOf } from "./cli-stale-links.mjs";
import { readJsonFile } from "./json-input.mjs";

/**
 * @param {string} root - Project root
 * @returns {string} The pending-comments file
 */
export const pendingPath = root =>
  path.join(root, ".lisa", "session-manager", "stale-links-pending.json");

/**
 * The pending comments, or none when the file does not exist yet.
 * @param {string} root
 * @returns {import("../../../scripts/stale-blocker-pending.mjs").PendingComment[]}
 */
function readPending(root) {
  try {
    const parsed = JSON.parse(readFileSync(pendingPath(root), "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    // probe-direction: fail-closed — only a missing file reads as "nothing
    // owed"; an unreadable or corrupt one throws, so no owed comment is lost.
    if (error?.code === "ENOENT") return [];
    throw new CliError(`${pendingPath(root)}: ${error.message}`, 1);
  }
}

/**
 * Replace the pending file atomically.
 * @param {string} root
 * @param {readonly object[]} pending
 * @returns {void}
 */
function writePending(root, pending) {
  const file = pendingPath(root);
  mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(pending, null, 2)}\n`);
  renameSync(temp, file);
}

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
  const pending = addPending(
    readPending(ctx.root),
    result,
    new Date().toISOString()
  );
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
