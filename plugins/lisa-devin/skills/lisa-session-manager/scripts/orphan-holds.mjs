/**
 * The hold half of the session manager's "Orphans and holds" sweep
 * (CodySwannGT/lisa#4722). Pure: no I/O, no clock, no config reads.
 *
 * Items behind a human gate (the human-needed label or a `[lisa-human-gate]`
 * body marker) used to wait until someone noticed, even when the hold was a
 * decision an agent is allowed to make. Each cycle the manager re-judges every
 * hold with the shared `planHumanGateLift`, so the lift rule lives in one
 * place: a hold it may lift is lifted with a `Decision:` line saying why; a
 * hold only a person can act on goes into ONE consolidated operator list, the
 * digest, sent only when its fingerprint changes.
 * @module session-manager/orphan-holds
 */
import { createHash } from "node:crypto";

import { planHumanGateLift } from "../../../scripts/human-gate-lift.mjs";
import {
  classifyHumanGateReason,
  humanGateVerdict,
} from "../../../scripts/intake-blocker-reprobe.mjs";
import { findCredentialShape } from "./human-needed.mjs";

/** What the digest says for a hold carrying only the label. */
export const NO_STATED_REASON = "no stated reason";

/** Longest reason a digest line carries, so the list fits a phone screen. */
const REASON_LIMIT = 90;

/**
 * A hold slug in words: `stripe-api-key` reads as `stripe api key`.
 * @param {string} reason - Normalized hold reason
 * @returns {string} Plain words
 */
const words = reason => reason.replaceAll(/[-_]+/gu, " ").trim();

/**
 * One kept reason in plain language: the act a person must perform when the
 * reason names one, the slug in words otherwise.
 * @param {string} reason - Hold reason; empty for a label-only hold
 * @param {unknown} humanOnly - Project-declared human-only classes
 * @returns {string} Plain-language reason
 */
function describeKept(reason, humanOnly) {
  if (reason === "") return NO_STATED_REASON;
  if (findCredentialShape(reason) !== null) return "a reason that was withheld";
  const verdict = classifyHumanGateReason(reason, { humanOnly });
  const named = words(reason);
  return verdict.valid && verdict.label
    ? `${named} (a person must ${verdict.label})`
    : named;
}

/**
 * Cap a digest reason at {@link REASON_LIMIT} characters.
 * @param {string} text - Reason
 * @returns {string} Bounded reason
 */
function bounded(text) {
  return text.length > REASON_LIMIT
    ? `${text.slice(0, REASON_LIMIT - 1)}…`
    : text;
}

/**
 * The Decision line a lift carries: why an agent may decide the hold.
 * @param {string[]} lifted - The reasons lifted
 * @returns {string} One `Decision:` line
 */
function decisionLine(lifted) {
  const named = lifted.map(reason => `"${words(reason)}"`).join(", ");
  return (
    `Decision: ${named} is a choice an agent may make under the project's ` +
    "hold policy, since it names nothing only a person can do, so the hold " +
    "is lifted and whoever builds the item makes and records that choice."
  );
}

/**
 * The lift planner's input for one hold.
 * @param {{labels?: unknown, body?: unknown, comments?: unknown}} item - Hold
 * @param {object} policy - Resolved hold policy
 * @returns {object} planHumanGateLift input
 */
function liftInput(item, policy) {
  return {
    labels: item.labels,
    body: item.body,
    comments: item.comments,
    trustedHumanActorIds: policy.trustedHumanActorIds,
    humanNeededLabel: policy.humanNeededLabel,
    humanOnly: policy.humanOnly,
    readyLabel: policy.readyLabel,
    lifecycleLabels: policy.lifecycleLabels,
  };
}

/**
 * Judge one hold: lift it, keep it for a person, or skip it.
 * @param {{ref: string, labels?: unknown, body?: unknown, comments?: unknown}} item - Hold
 * @param {object} policy - Resolved hold policy
 * @returns {{kind: "lift"|"keep"|"skip", entry: object}} Verdict
 */
export function judgeHold(item, policy) {
  const input = liftInput(item, policy);
  const plan = planHumanGateLift(input);
  if (plan.reason === "lift" || plan.reason === "partial-lift") {
    const decision = decisionLine(plan.lifted);
    return {
      kind: "lift",
      entry: {
        ref: item.ref,
        reason: `the hold names only a decision an agent may make (${plan.lifted.map(words).join(", ")})`,
        comments: plan.comments.map(body => `${body}\n${decision}`),
        actions: plan.actions,
        decision,
      },
    };
  }
  if (plan.reason === "already-lifted") {
    return { kind: "skip", entry: { ref: item.ref, reason: "already-lifted" } };
  }
  const verdict = humanGateVerdict(input);
  if (!verdict.held) {
    return { kind: "skip", entry: { ref: item.ref, reason: "released" } };
  }
  const reason = bounded(
    verdict.outstanding
      .map(kept => describeKept(kept, policy.humanOnly))
      .join("; ")
  );
  return { kind: "keep", entry: { ref: item.ref, reason } };
}

/**
 * The one consolidated operator list of truly-human holds, and its
 * fingerprint. The fingerprint is the sha256 of the sorted `ref\treason`
 * lines, so the order holds arrive in never changes it.
 * @param {{ref: string, reason: string}[]} keep - Kept holds
 * @param {string | null | undefined} previous - Fingerprint last sent
 * @returns {{fingerprint: string | null, text: string, changed: boolean}}
 *   Digest; an empty list has a null fingerprint and empty text
 */
export function holdDigest(keep, previous) {
  const rows = [...keep].sort((a, b) =>
    a.ref < b.ref ? -1 : Number(a.ref > b.ref)
  );
  const fingerprint =
    rows.length === 0
      ? null
      : createHash("sha256")
          .update(rows.map(row => `${row.ref}\t${row.reason}`).join("\n"))
          .digest("hex");
  const text =
    rows.length === 0
      ? ""
      : [
          `Waiting on you (${rows.length}): only a person can do these.`,
          ...rows.map(row => `${row.ref}: ${row.reason}`),
        ].join("\n");
  return { fingerprint, text, changed: fingerprint !== (previous ?? null) };
}
