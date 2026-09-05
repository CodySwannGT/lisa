#!/usr/bin/env node
/**
 * Unarmed open pull request detection for `/lisa:queue-status` (#3903).
 *
 * ## The gap this closes
 *
 * A pull request can be fully green and permanently unmergeable because
 * `autoMergeRequest` is `null`, and nothing surfaces it. Green-and-unarmed and
 * green-and-waiting read identically on every surface anyone checks: the checks
 * list is green, `mergeStateStatus` is green, the PR page shows no complaint,
 * and the PR simply sits. **There is no failing signal to notice**, which is
 * why "waits forever" is accurate and why nobody catches it by watching for
 * failures.
 *
 * Gates answer *"is this change acceptable?"*. None of them asks *"is anything
 * going to act on the answer?"* — the observer that would notice sits outside
 * the gate entirely, which is where this module sits.
 *
 * ## Report-only, and why
 *
 * **This is a report surface, not a gate.** It is registered in no `gates`
 * block, runs on no commit/push/PR hook, and blocks nothing. Two reasons, both
 * load-bearing:
 *
 * 1. Arming is a decision with its own arm-time control (`block-blind-automerge`,
 *    #3806). #3903 is about VISIBILITY of the unarmed state and explicitly puts
 *    automatic arming out of scope; a control that blocked on this would be
 *    making the arming decision by the back door.
 * 2. Unarmed-ness is a property of the QUEUE, not of a change. Blocking a
 *    contributor's push because some other PR is unarmed punishes the wrong
 *    party. A governor about throughput fails open on its findings.
 *
 * ## But the MEASUREMENT fails closed
 *
 * The healthy state of this check is an EMPTY report — so a mistyped field
 * path, a wrong JSON accessor, or a filter that excludes everything returns
 * empty and looks exactly like a clean queue. That is the failure this module
 * is most prone to, so the two are never allowed to share a verdict:
 *
 * - `UNARMED` means *examined, and `autoMergeRequest` was `null`*.
 * - `NOT_EXAMINED` means *the arming state was never read* — the
 *   `autoMergeRequest` key is absent from the payload, which is what a caller
 *   that forgot the field in `gh pr list --json` produces. It is NOT `null`,
 *   and it must never be reported as armed or folded into a clean sweep.
 *
 * A sweep containing even one `NOT_EXAMINED` pull request returns
 * `NOT_MEASURED`, never `MEASURED_CLEAN`. `MEASURED_CLEAN` is a POSITIVE
 * ASSERTION — "I read the arming state of all N open pull requests and every
 * one is armed or deliberately unarmed" — not an absence of complaints. The CLI
 * exit codes carry the same split: 0 clean, 1 findings, **2 not measured**, so
 * a scheduled sweep whose query broke fails loudly instead of reporting a
 * healthy queue.
 *
 * ## Current state, never arming history
 *
 * Measured on this repository the night #3903 was built: a PR armed earlier in
 * the same session, and verbally confirmed as armed, was later observed with
 * `autoMergeRequest: null`; re-arming it succeeded immediately. **Arming can be
 * silently dropped after the fact** — most plausibly when the branch is updated
 * or force-updated underneath it. That defeats the obvious fix: arming at
 * PR-creation time is not sufficient if the latch can come off afterwards. So
 * this module classifies from CURRENT state only and has no notion of whether
 * an arm ever happened.
 *
 * `autoMergeRequest` is one of the few PR fields that is trustworthy — a stored
 * setting rather than a computed one, unlike `mergeStateStatus` (#3694). So
 * detection is cheap; nothing was asking.
 *
 * ## Deliberately unarmed
 *
 * `lisa-drive-pr-to-merge`'s `auto_merge=false` mode deliberately leaves a PR
 * open and unarmed for a human to merge. Reporting those would train operators
 * to ignore the report, so a deliberate hold is declarable — by the
 * `[lisa-auto-merge-off]` body marker (the same shape as Lisa's existing
 * `[lisa-human-gate]` marker: a token with no other meaning, so its presence
 * anywhere in the body IS the declaration) or by the `lisa:auto-merge-off`
 * label, for operators who prefer a surface visible in the PR list. Drafts are
 * excluded too: GitHub will not arm a draft, so an unarmed draft is the
 * expected state rather than a finding.
 *
 * **A held pull request is suppressed from the findings, never from the
 * report.** This is a suppression mechanism, and this repository has been bitten
 * by the shape before — an allowlist added to harden a guard became its bypass.
 * Anyone who wants a red sweep to go green now has a one-label remedy that will
 * look like housekeeping, so every held PR is counted AND named, on the clean
 * path as much as the findings path. "4 armed, 0 unarmed" and "4 armed, 0
 * unarmed, 9 held" describe very different queues, and only the second lets a
 * human notice the label spreading.
 *
 * The marker may carry `reason=<text>`, which the report prints. It is optional
 * on purpose — a required field on a suppression gets satisfied with `reason=x`
 * and buys nothing — but its absence is printed as "no reason declared", so an
 * unexplained hold is visibly cheaper than an explained one.
 */

import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Per-pull-request arming verdicts. */
export const PR_ARMING_VERDICTS = Object.freeze([
  "ARMED",
  "UNARMED",
  "DELIBERATELY_UNARMED",
  "NOT_EXAMINED",
]);

/** Whole-sweep verdicts. */
export const PR_ARMING_SWEEP_VERDICTS = Object.freeze([
  "MEASURED_CLEAN",
  "UNARMED_PRS_FOUND",
  "NOT_MEASURED",
]);

/** Body marker declaring a pull request deliberately left unarmed. */
export const AUTO_MERGE_OFF_MARKER = "[lisa-auto-merge-off]";

/** Label spelling of the same declaration, for PR-list visibility. */
export const AUTO_MERGE_OFF_LABEL = "lisa:auto-merge-off";

/**
 * The `gh pr list --json` field selection this module needs.
 *
 * Exported so the skill that shells out and the tests that pin the contract
 * read the same list — a caller that drops `autoMergeRequest` from it produces
 * `NOT_EXAMINED`, which is the designed outcome rather than a silent pass.
 */
export const REQUIRED_PR_FIELDS = Object.freeze([
  "number",
  "title",
  "url",
  "isDraft",
  "labels",
  "body",
  "autoMergeRequest",
]);

/**
 * @typedef {"ARMED" | "UNARMED" | "DELIBERATELY_UNARMED" | "NOT_EXAMINED"} PullRequestArmingVerdict
 *
 * @typedef {{
 *   readonly number: number | null
 *   readonly title: string
 *   readonly url: string
 *   readonly verdict: PullRequestArmingVerdict
 *   readonly reason: string
 *   readonly declaredReason?: string | null
 *   readonly examined: boolean
 * }} PullRequestArming
 */

/**
 * Classify one pull request's CURRENT auto-merge arming state.
 *
 * The single most important line in this function is the `hasOwnProperty`
 * check: a payload with no `autoMergeRequest` key was never asked about arming,
 * and answering "unarmed" or "armed" for it would be an invented measurement.
 * `undefined` and `null` mean opposite things here and are never conflated.
 *
 * @param {Record<string, any>} pullRequest - One `gh pr view/list --json` object.
 * @returns {PullRequestArming} The verdict, with the reason that produced it.
 */
export function classifyPullRequestArming(pullRequest) {
  const source =
    pullRequest !== null && typeof pullRequest === "object" ? pullRequest : {};
  const identity = {
    number: Number.isFinite(Number(source.number))
      ? Number(source.number)
      : null,
    title: typeof source.title === "string" ? source.title : "",
    url: typeof source.url === "string" ? source.url : "",
  };

  if (
    !Object.hasOwn(source, "autoMergeRequest") ||
    source.autoMergeRequest === undefined
  ) {
    return {
      ...identity,
      verdict: "NOT_EXAMINED",
      reason: "auto-merge-field-absent",
      examined: false,
    };
  }

  if (typeof source.autoMergeRequest === "object") {
    if (source.autoMergeRequest !== null) {
      return {
        ...identity,
        verdict: "ARMED",
        reason: "auto-merge-request-present",
        examined: true,
      };
    }
  } else {
    // Neither `null` nor an auto-merge object. JSON from `gh` never produces
    // this, so it means the value came from somewhere other than the field
    // being asked about — an unanswered question, not an answer.
    return {
      ...identity,
      verdict: "NOT_EXAMINED",
      reason: "auto-merge-field-unrecognized",
      examined: false,
    };
  }

  const deliberate = deliberateHoldReason(source);
  if (deliberate) {
    return {
      ...identity,
      verdict: "DELIBERATELY_UNARMED",
      reason: deliberate.reason,
      declaredReason: deliberate.declaredReason,
      examined: true,
    };
  }

  return {
    ...identity,
    verdict: "UNARMED",
    reason: "auto-merge-request-null",
    examined: true,
  };
}

/**
 * Why an unarmed pull request is a deliberate hold rather than a finding.
 *
 * @param {Record<string, any>} pullRequest
 * @returns {string | null} A reason slug, or `null` when the hold is undeclared.
 */
function deliberateHoldReason(pullRequest) {
  if (pullRequest.isDraft === true) {
    return { reason: "draft-pull-request", declaredReason: null };
  }

  const body = typeof pullRequest.body === "string" ? pullRequest.body : "";
  const declaration = DECLARATION_LINE.exec(declarativeText(body));
  if (declaration) {
    return {
      reason: "auto-merge-off-marker",
      declaredReason: declaredReasonIn(declaration[1]),
    };
  }

  const labels = Array.isArray(pullRequest.labels) ? pullRequest.labels : [];
  const names = labels.map(label =>
    typeof label === "string"
      ? label
      : typeof label?.name === "string"
        ? label.name
        : ""
  );
  if (names.some(name => name.trim().toLowerCase() === AUTO_MERGE_OFF_LABEL)) {
    return { reason: "auto-merge-off-label", declaredReason: null };
  }

  return null;
}

/**
 * The one shape that DECLARES a hold: the marker alone on a line, inside an
 * HTML comment, optionally carrying `reason=<text>`.
 *
 * Deliberately NOT "the marker appearing anywhere". Lisa's `[lisa-human-gate]`
 * marker is matched anywhere on the reasoning that it is a token with no other
 * meaning, so its presence IS the declaration. **That reasoning does not
 * transfer here, and this repository proved it the first time this control ran
 * live**: the pull request that introduced the marker was suppressed by its own
 * description, because the description explains what the marker is. A token
 * that appears in prose about itself has a second meaning — being discussed —
 * and matching it anywhere makes "write about the suppression" a way to be
 * suppressed. Same rule as `ready-role-filing`: before matching a token, ask
 * what it means in every position it can occupy.
 */
const DECLARATION_LINE =
  /^[ \t]*<!--[ \t]*\[lisa-auto-merge-off\][ \t]*(.*?)-->[ \t]*$/im;

/**
 * The body with code spans and fenced blocks removed.
 *
 * Documentation of the declaration is not a declaration. Fenced examples and
 * backticked mentions are how the marker is written ABOUT, so they are stripped
 * before the declaration is looked for — the same move `block-direct-issue-create.sh`
 * makes when it strips heredoc bodies before tokenising argv.
 *
 * @param {string} body - The raw pull request body.
 * @returns {string} The body with quoted/code regions blanked out.
 */
function declarativeText(body) {
  return body.replace(/```[\s\S]*?```/g, "").replace(/`[^`\n]*`/g, "");
}

/**
 * Read the `reason=<text>` a declaration carries, if it carries one.
 *
 * A bare marker is a claim; a reason costs the writer something to write, which
 * is what makes a declaration in this repository worth trusting. The reason is
 * OPTIONAL rather than required — a required field on a suppression mechanism
 * gets satisfied with `reason=x` and buys nothing — but its absence is carried
 * through to the report and shown as "no reason declared", so a queue full of
 * unexplained holds is visible as one.
 *
 * @param {string} tail - The declaration's text after the marker.
 * @returns {string | null} The declared reason, or `null` when none was given.
 */
function declaredReasonIn(tail) {
  const match = /^\s*reason[=:]\s*(.+)$/i.exec(String(tail ?? "").trim());
  if (!match) return null;
  const reason = match[1].replace(/--+>?\s*$/, "").trim();
  return reason.length > 0 ? reason : null;
}

/**
 * Sweep the open pull requests and report the unarmed ones.
 *
 * Read-only and total: it mutates nothing, reaches nothing over the network,
 * and returns every finding rather than the first.
 *
 * @param {readonly Record<string, any>[] | {
 *   readonly pullRequests?: readonly Record<string, any>[]
 *   readonly fetchError?: string | null
 * }} input - A bare `gh pr list --json` array, or the same wrapped with an
 *   optional `fetchError` describing a query that failed.
 * @returns {{
 *   readonly verdict: "MEASURED_CLEAN" | "UNARMED_PRS_FOUND" | "NOT_MEASURED"
 *   readonly reasons: readonly string[]
 *   readonly examinedCount: number
 *   readonly unarmed: readonly PullRequestArming[]
 *   readonly deliberatelyUnarmed: readonly PullRequestArming[]
 *   readonly armed: readonly PullRequestArming[]
 *   readonly notExamined: readonly PullRequestArming[]
 *   readonly reportOnly: true
 * }}
 */
export function sweepPullRequestArming(input = []) {
  const wrapped = Array.isArray(input)
    ? { pullRequests: input }
    : (input ?? {});
  const fetchError =
    typeof wrapped.fetchError === "string" &&
    wrapped.fetchError.trim().length > 0
      ? wrapped.fetchError.trim()
      : null;
  const list = Array.isArray(wrapped.pullRequests)
    ? wrapped.pullRequests
    : null;

  if (fetchError !== null || list === null) {
    return {
      verdict: "NOT_MEASURED",
      reasons: [
        fetchError !== null
          ? "pull-request-query-failed"
          : "pull-request-list-unavailable",
      ],
      examinedCount: 0,
      unarmed: [],
      deliberatelyUnarmed: [],
      armed: [],
      notExamined: [],
      reportOnly: true,
    };
  }

  const classified = list.map(classifyPullRequestArming);
  const bucket = verdict =>
    classified.filter(entry => entry.verdict === verdict);
  const buckets = {
    unarmed: bucket("UNARMED"),
    deliberatelyUnarmed: bucket("DELIBERATELY_UNARMED"),
    armed: bucket("ARMED"),
    notExamined: bucket("NOT_EXAMINED"),
  };
  const examinedCount = classified.filter(entry => entry.examined).length;

  // Blindness outranks findings. A sweep that could not read part of the queue
  // has no standing to call the rest of it clean, and must not print the
  // reassuring answer for pull requests it never looked at.
  if (buckets.notExamined.length > 0) {
    return {
      verdict: "NOT_MEASURED",
      reasons: [...new Set(buckets.notExamined.map(entry => entry.reason))],
      examinedCount,
      ...buckets,
      reportOnly: true,
    };
  }

  if (buckets.unarmed.length > 0) {
    return {
      verdict: "UNARMED_PRS_FOUND",
      reasons: ["unarmed-open-pull-requests"],
      examinedCount,
      ...buckets,
      reportOnly: true,
    };
  }

  return {
    verdict: "MEASURED_CLEAN",
    reasons: ["all-open-pull-requests-armed-or-deliberately-unarmed"],
    examinedCount,
    ...buckets,
    reportOnly: true,
  };
}

/**
 * The CLI exit status for a sweep.
 *
 * `2` is the load-bearing one: an unmeasurable sweep must not exit `0` beside
 * an empty finding list, because that is indistinguishable from a healthy
 * queue — the exact confusion #3903 is about.
 *
 * @param {{ readonly verdict?: string }} sweep
 * @returns {0 | 1 | 2}
 */
export function pullRequestArmingExitCode(sweep) {
  if (sweep?.verdict === "MEASURED_CLEAN") return 0;
  if (sweep?.verdict === "UNARMED_PRS_FOUND") return 1;
  return 2;
}

/**
 * Render the sweep as an operator-readable report.
 *
 * The clean line states what was examined rather than saying nothing, so an
 * operator can tell a measured clean queue from a query that returned nothing.
 *
 * @param {ReturnType<typeof sweepPullRequestArming>} sweep
 * @returns {string} A terminal-first report, newline-terminated.
 */
export function formatPullRequestArmingReport(sweep) {
  const lines = [`Auto-merge arming: ${sweep.verdict}`];

  if (sweep.verdict === "NOT_MEASURED") {
    lines.push(
      sweep.notExamined.length > 0
        ? `Arming state was NOT read for ${sweep.notExamined.length} open pull request(s) (${sweep.reasons.join(", ")}).`
        : `The open pull request list could not be read at all (${sweep.reasons.join(", ")}).`,
      `This is not a clean queue — it is an unanswered question. Re-run the query with --json ${REQUIRED_PR_FIELDS.join(",")}.`
    );
    for (const entry of sweep.notExamined) {
      lines.push(`  ? #${entry.number ?? "?"} ${entry.title}`.trimEnd());
    }
    return `${lines.join("\n")}\n`;
  }

  lines.push(
    `Examined ${sweep.examinedCount} open pull request(s): ${sweep.armed.length} armed, ${sweep.unarmed.length} unarmed, ${sweep.deliberatelyUnarmed.length} deliberately unarmed.`
  );

  if (sweep.verdict === "MEASURED_CLEAN") {
    lines.push(
      "Every open pull request is armed or deliberately unarmed. Nothing is waiting on an absent latch."
    );
    lines.push(...heldLines(sweep));
    return `${lines.join("\n")}\n`;
  }

  lines.push(
    "These pull requests will never merge on their own. Arm each, or declare the hold:"
  );
  for (const entry of sweep.unarmed) {
    lines.push(`  ! #${entry.number ?? "?"} ${entry.title}`.trimEnd());
    if (entry.url) lines.push(`      ${entry.url}`);
  }
  lines.push(
    `Arm: gh pr merge <n> --auto --merge, then read it back with gh pr view <n> --json autoMergeRequest.`,
    `Declare a deliberate hold: add the ${AUTO_MERGE_OFF_LABEL} label, or the ${AUTO_MERGE_OFF_MARKER} marker to the body.`
  );
  lines.push(...heldLines(sweep));
  return `${lines.join("\n")}\n`;
}

/**
 * The held-pull-request block, which is never omitted when the bucket is
 * non-empty.
 *
 * A suppression mechanism that hides what it suppresses is the next defect,
 * not the fix for this one. This repository has already been bitten by the
 * shape: an allowlist added to harden a guard BECAME its bypass. `lisa:auto-merge-off`
 * is a one-label remedy for a red sweep and will look like housekeeping to
 * whoever applies it, so every held pull request is COUNTED AND NAMED. "4 armed,
 * 0 unarmed" and "4 armed, 0 unarmed, 9 held" describe very different queues,
 * and only the second lets a human notice the label spreading.
 *
 * @param {ReturnType<typeof sweepPullRequestArming>} sweep
 * @returns {string[]} Report lines, empty when nothing is held.
 */
function heldLines(sweep) {
  if (sweep.deliberatelyUnarmed.length === 0) return [];

  return [
    `Held (declared, not merging): ${sweep.deliberatelyUnarmed.length}. Each is suppressed from the finding list above:`,
    ...sweep.deliberatelyUnarmed.map(entry => {
      const why = entry.declaredReason
        ? `reason: ${entry.declaredReason}`
        : entry.reason === "draft-pull-request"
          ? "draft"
          : "no reason declared";
      const label = `#${entry.number ?? "?"} ${entry.title}`.trim();
      return `  - ${label} (${why})`;
    }),
  ];
}

/**
 * CLI: read `gh pr list --json <fields>` output on stdin, print the report.
 *
 * @returns {Promise<void>}
 */
async function main() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();

  let sweep;
  try {
    sweep = sweepPullRequestArming(raw.length === 0 ? {} : JSON.parse(raw));
  } catch (error) {
    sweep = sweepPullRequestArming({ fetchError: error.message });
  }

  const asJson = process.argv.includes("--json");
  process.stdout.write(
    asJson
      ? `${JSON.stringify(sweep, null, 2)}\n`
      : formatPullRequestArmingReport(sweep)
  );
  process.exitCode = pullRequestArmingExitCode(sweep);
}

/**
 * True when `moduleUrl` names the module node was asked to run.
 *
 * Written out rather than imported: this is a plugin payload, which has no
 * `./lib/` to resolve against. Same rule and reasoning as
 * `scripts/lib/invoked-as-script.mjs` and `scoping-label-audit.mjs`.
 *
 * @param {string} moduleUrl - The caller's own `import.meta.url`.
 * @param {string | undefined} [argv1] - Entry path; defaults to `process.argv[1]`.
 * @returns {boolean} Whether the caller should run its CLI body.
 */
export function invokedAsScript(moduleUrl, argv1 = process.argv[1]) {
  if (!argv1) return false;
  try {
    return realpathSync(argv1) === realpathSync(fileURLToPath(moduleUrl));
  } catch {
    return false;
  }
}

if (invokedAsScript(import.meta.url)) {
  main().catch(error => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 2;
  });
}
