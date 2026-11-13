/**
 * Capture an operator's "wrongly escalated" verdict as a learning
 * (CodySwannGT/lisa#4657). Pure: no I/O, no clock, no config reads.
 *
 * An agent can put an item behind a human gate (`[lisa-human-gate]` plus the
 * human-needed label) for a decision it could have made itself. The
 * planning-miss loop (#4569) trusts that claim: a self-flagged gate counts as
 * the plan working. When a human disagrees, releases the hold and labels the
 * item with the configured wrongly-escalated label, that label is an explicit
 * ruling with the evidence attached: the strongest learning signal the
 * factory gets. This module turns each such item into exactly one
 * `lisa-persist-learning` candidate, and names the visible marker comment
 * that records the capture, so later cycles never capture it twice.
 *
 * The label is a classification, not a release: it moves no lane, so no
 * release authorization applies, and who applied it does not matter. An
 * automation identity applying it at an operator's direction counts.
 * @module session-manager/escalation-overruled
 */
import { createHash } from "node:crypto";

import {
  HUMAN_GATE_MARKER,
  HUMAN_GATE_RELEASE_MARKER,
  humanGateHolds,
  normalizeProviderMarkdown,
} from "../../../scripts/intake-blocker-reprobe.mjs";
import { QUESTION_MARKER } from "./human-needed.mjs";

/** The built-in label name, used when the tracker's config names none. */
export const DEFAULT_WRONGLY_ESCALATED_LABEL = "wrongly-escalated-to-human";

/**
 * Where each tracker keeps the label: next to `human_needed`, the way that
 * label is keyed (Jira's marker labels sit outside a workflow map; GitHub's
 * and Linear's sit under `labels.build`).
 */
export const WRONGLY_ESCALATED_CONFIG_PATHS = Object.freeze({
  jira: "jira.labels.wrongly_escalated",
  linear: "linear.labels.build.wrongly_escalated",
  github: "github.labels.build.wrongly_escalated",
});

/**
 * The visible capture marker. Visible text, not an HTML comment, because
 * Linear strips HTML comments and a stripped marker would defeat dedupe.
 */
export const OVERRULED_MARKER = "[lisa-escalation-overruled]";

/** The persist-learning `signal` a capture carries. */
export const WRONGLY_ESCALATED_SIGNAL = "wrongly-escalated";

/** The planning stage an overruled self-flagged gate points at. */
export const FILING_STAGE = "filing";

/** At most this many captures per cycle unless the caller says otherwise. */
export const DEFAULT_MAX_CAPTURES = 3;

/** Evidence excerpts are bounded so one long comment cannot flood a prompt. */
const EXCERPT_LIMIT = 600;

/**
 * Compare label names the way trackers behave: case and padding drift.
 * @param {unknown} value - A label name
 * @returns {string} Comparable form, empty when there is none
 */
const normalize = value =>
  typeof value === "string" ? value.trim().toLowerCase() : "";

/**
 * Label names off a tracker payload: strings or `{ name }` objects.
 * @param {unknown} labels - The item's labels
 * @returns {string[]} Their names
 */
function labelNames(labels) {
  return (Array.isArray(labels) ? labels : [])
    .map(entry => (typeof entry === "string" ? entry : entry?.name))
    .filter(name => typeof name === "string");
}

/**
 * Whether an item carries the label.
 * @param {unknown} labels - The item's labels
 * @param {string} label - The resolved wrongly-escalated label
 * @returns {boolean} True when present (case-insensitive)
 */
export function carriesWronglyEscalated(labels, label) {
  const wanted = normalize(label);
  if (wanted === "") return false;
  return labelNames(labels).some(name => normalize(name) === wanted);
}

/**
 * The stable dedupe key for one item: an item is captured once, however many
 * times it is labeled, released or re-read.
 * @param {string} ref - Canonical item ref
 * @returns {string} `eo-` plus 12 hex characters
 */
export function overruledFingerprint(ref) {
  const digest = createHash("sha256").update(String(ref)).digest("hex");
  return `eo-${digest.slice(0, 12)}`;
}

/**
 * Comment bodies off a tracker payload, keeping the id and url when present.
 * @param {unknown} comments - The item's comments
 * @returns {{body: string, id?: string, url?: string}[]} Normalized comments
 */
function commentsOf(comments) {
  return (Array.isArray(comments) ? comments : [])
    .map(entry =>
      typeof entry === "string"
        ? { body: entry }
        : {
            body: typeof entry?.body === "string" ? entry.body : "",
            ...(entry?.id != null ? { id: String(entry.id) } : {}),
            ...(typeof entry?.url === "string" ? { url: entry.url } : {}),
          }
    )
    .filter(comment => comment.body !== "");
}

/**
 * Whether a body has a line starting with `marker` (after leading space and
 * an optional HTML comment opener), so a comment that only discusses the
 * marker mid-sentence does not count. Provider escaping is undone first:
 * Linear stores `[` as `\[`, and a raw comparison would miss every marker
 * there, recapturing the item each cycle.
 * @param {string} body - Comment body
 * @param {string} marker - Marker text
 * @returns {boolean} True when some line declares it
 */
function declares(body, marker) {
  return normalizeProviderMarkdown(body)
    .split("\n")
    .some(line => line.replace(/^\s*(?:<!--\s*)?/u, "").startsWith(marker));
}

/**
 * Whether the item already carries this capture's marker comment.
 * @param {{body: string}[]} comments - Normalized comments
 * @param {string} fingerprint - The item's capture key
 * @returns {boolean} True when captured before
 */
function alreadyCaptured(comments, fingerprint) {
  const stamp = `${OVERRULED_MARKER} key=${fingerprint}`;
  return comments.some(comment => declares(comment.body, stamp));
}

/**
 * A bounded excerpt of evidence text.
 * @param {string} text - Source text
 * @returns {string} At most {@link EXCERPT_LIMIT} characters
 */
function excerpt(text) {
  const trimmed = text.trim();
  return trimmed.length > EXCERPT_LIMIT
    ? `${trimmed.slice(0, EXCERPT_LIMIT)}…`
    : trimmed;
}

/**
 * One evidence record: where it is, and a bounded excerpt of what it says.
 * @param {{body: string, id?: string, url?: string}} comment - Source comment
 * @param {string} source - `comment`
 * @returns {object} Evidence record
 */
function evidenceOf(comment, source) {
  return {
    source,
    ...(comment.id ? { id: comment.id } : {}),
    ...(comment.url ? { url: comment.url } : {}),
    excerpt: excerpt(comment.body),
  };
}

/**
 * The hold the human overruled: the `[lisa-human-gate]` body marker, a
 * hold comment, or the session manager's question comment; and the human's
 * release. Each is optional: the label alone is the ruling.
 * @param {{body?: unknown, comments: {body: string}[]}} item - The item
 * @returns {{holdReasons: string[], hold: object[], release: object[]}}
 *   Evidence, oldest first
 */
function collectEvidence({ body, comments }) {
  const text = typeof body === "string" ? body : "";
  const declared = humanGateHolds(text);
  const holdReasons = declared.filter(reason => reason !== "");
  const hold = [
    ...(declared.length > 0
      ? [{ source: "body", excerpt: excerpt(text) }]
      : []),
    ...comments
      .filter(
        comment =>
          declares(comment.body, HUMAN_GATE_MARKER) ||
          declares(comment.body, QUESTION_MARKER)
      )
      .map(comment => evidenceOf(comment, "comment")),
  ];
  const release = comments
    .filter(comment => declares(comment.body, HUMAN_GATE_RELEASE_MARKER))
    .map(comment => evidenceOf(comment, "comment"));
  return { holdReasons, hold, release };
}

/**
 * The draft rule: the filing check that would have kept the gate off. The
 * manager may sharpen it with the hold reason; the judge rewrites it.
 * @param {string[]} holdReasons - The overruled hold reasons
 * @returns {string} A `Planning (filing): …` rule within the contract caps
 */
function draftRule(holdReasons) {
  const named = holdReasons.length > 0 ? ` (seen: ${holdReasons[0]})` : "";
  const rule = `Planning (filing): file human_gate only for an act no agent can perform, such as a login or credential, spend, an external account, a legal signature, an account only a person holds; make an open decision yourself${named}.`;
  return rule.length > 240 ? `${rule.slice(0, 238)}.` : rule;
}

/**
 * The visible marker comment the manager posts after routing the candidate.
 * @param {string} fingerprint - Capture key
 * @param {string} label - The label the human applied
 * @returns {string} Comment body
 */
export function overruledMarkerComment(fingerprint, label) {
  return `${OVERRULED_MARKER} key=${fingerprint} This item carries the \`${label}\` label, so its escalation to a human was ruled wrong. The session manager sent that ruling to the learning loop once, as evidence for a filing check; it changes nothing about this item.`;
}

/**
 * One evidence record the candidate carries.
 * @typedef {object} OverruledEvidence
 * @property {string} source - `body` or `comment`
 * @property {string} [id] - Comment id, when the tracker gave one
 * @property {string} [url] - Comment url, when the tracker gave one
 * @property {string} excerpt - Bounded excerpt of the text
 */

/**
 * One capture: the persist-learning candidate and the marker comment.
 * @typedef {object} OverruledCapture
 * @property {string} ref - The item
 * @property {string} fingerprint - Its capture key
 * @property {string} comment - The marker comment to post afterwards
 * @property {{signal: string, triggering_issue: string,
 *   provenance: string[], scope_hint: string, stage_hint: string,
 *   label: string, rule: string, why: string, evidence_links: string[],
 *   hold_reasons: string[], evidence: {hold: OverruledEvidence[],
 *   release: OverruledEvidence[]}}} candidate - The candidate
 */

/**
 * The capture for one labeled, uncaptured item.
 * @param {{ref: string, body?: unknown, comments: object[]}} item - The item
 * @param {string} label - Resolved label
 * @returns {OverruledCapture} The capture
 */
function captureFor(item, label) {
  const fingerprint = overruledFingerprint(item.ref);
  const evidence = collectEvidence(item);
  const links = [...evidence.hold, ...evidence.release]
    .map(entry => entry.url)
    .filter(Boolean);
  return {
    ref: item.ref,
    fingerprint,
    comment: overruledMarkerComment(fingerprint, label),
    candidate: {
      signal: WRONGLY_ESCALATED_SIGNAL,
      triggering_issue: item.ref,
      provenance: [item.ref],
      scope_hint: "project",
      stage_hint: FILING_STAGE,
      label,
      rule: draftRule(evidence.holdReasons),
      why: `A human ruled this escalation wrong by applying the \`${label}\` label: the hold asked a person for something an agent could have decided, so the filing check let it through.`,
      evidence_links: [item.ref, ...links],
      hold_reasons: evidence.holdReasons,
      evidence: { hold: evidence.hold, release: evidence.release },
    },
  };
}

/**
 * Plan this cycle's captures. Items without the label are skipped; items
 * already carrying their capture marker are skipped; at most `max` captures
 * are returned and the rest are `deferred` to a later cycle.
 * @param {{items?: unknown, label?: string, max?: number}} input - The
 *   listed items (`{ref, labels, body, comments}`), the resolved label and
 *   the per-cycle cap
 * @returns {{label: string, captures: OverruledCapture[],
 *   skipped: {ref: string | null, reason: string}[],
 *   deferred: string[]}} Plan
 */
export function planOverruledCaptures({
  items,
  label = DEFAULT_WRONGLY_ESCALATED_LABEL,
  max = DEFAULT_MAX_CAPTURES,
}) {
  if (!Number.isInteger(max) || max < 0) {
    throw new Error("max must be a non-negative integer");
  }
  const captures = [];
  const skipped = [];
  const deferred = [];
  for (const raw of Array.isArray(items) ? items : []) {
    const ref = typeof raw?.ref === "string" ? raw.ref.trim() : "";
    if (ref === "") {
      skipped.push({ ref: null, reason: "no ref" });
      continue;
    }
    if (!carriesWronglyEscalated(raw.labels, label)) {
      skipped.push({ ref, reason: "no wrongly-escalated label" });
      continue;
    }
    const comments = commentsOf(raw.comments);
    if (alreadyCaptured(comments, overruledFingerprint(ref))) {
      skipped.push({ ref, reason: "already captured" });
      continue;
    }
    if (captures.length >= max) {
      deferred.push(ref);
      continue;
    }
    captures.push(captureFor({ ref, body: raw.body, comments }, label));
  }
  return { label, captures, skipped, deferred };
}
