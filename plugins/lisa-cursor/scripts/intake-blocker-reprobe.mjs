#!/usr/bin/env node
/**
 * Blocker re-probe gate for pre-work build-intake candidates.
 *
 * A blocker is a claim with a timestamp, not a fact. It is written once, and it
 * decays the moment its condition goes true — a dependency lands on trunk, a
 * CVE gets patched, a package publishes. Nothing in the old intake loop ever
 * re-read one, so a discharged blocker held its item out of the queue forever.
 *
 * This module decides, per candidate, whether intake may select it. It never
 * probes anything itself: the caller runs the probe and hands back the result,
 * which keeps the decision auditable and testable apart from the network.
 */

import { isPreWorkLaneType } from "./intake-prework-denominator.mjs";

/** Marker a writer stamps on an item a human deliberately parked. */
export const HUMAN_GATE_MARKER = "[lisa-human-gate]";

/** Default label naming a block only a human can clear. */
export const DEFAULT_HUMAN_NEEDED_LABEL = "human-needed";

/**
 * @param {unknown} labels
 * @returns {readonly string[]}
 */
function normalizeLabels(labels) {
  return (Array.isArray(labels) ? labels : [])
    .map(label =>
      typeof label === "string"
        ? label
        : typeof label?.name === "string"
          ? label.name
          : ""
    )
    .map(label => label.trim().toLowerCase())
    .filter(label => label.length > 0);
}

/**
 * @param {{ labels?: unknown, body?: unknown, humanNeededLabel?: unknown }} input
 * @returns {boolean}
 */
function isHumanGated(input) {
  const configured = String(
    input.humanNeededLabel ?? DEFAULT_HUMAN_NEEDED_LABEL
  )
    .trim()
    .toLowerCase();
  if (
    configured.length > 0 &&
    normalizeLabels(input.labels).includes(configured)
  ) {
    return true;
  }

  return String(input.body ?? "").includes(HUMAN_GATE_MARKER);
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function trimmedString(value) {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * @param {{ discharged?: unknown, evidence?: unknown }} probe
 * @returns {{ selectable: boolean, reason: string, evidence: string }}
 */
function judgeProbe(probe) {
  const evidence = trimmedString(probe.evidence);

  if (probe.discharged !== true) {
    return {
      selectable: false,
      reason: "blocker-holds",
      evidence,
    };
  }
  if (evidence.length === 0) {
    return {
      selectable: false,
      reason: "blocker-discharge-unevidenced",
      evidence,
    };
  }

  return { selectable: true, reason: "blocker-discharged", evidence };
}

/**
 * Decide whether a pre-work item may be selected as a build candidate.
 *
 * Order is load-bearing. The human gate is checked before anything else, so no
 * probe result — however conclusive — can promote an item a human parked.
 *
 * @param {{
 *   laneType?: unknown
 *   labels?: unknown
 *   body?: unknown
 *   humanNeededLabel?: unknown
 *   statedBlocker?: unknown
 *   probe?: { discharged?: unknown, evidence?: unknown } | null
 * }} input
 * @returns {{ selectable: boolean, reason: string, humanGated: boolean, evidence: string }}
 */
export function classifyPreWorkCandidate(input = {}) {
  if (isHumanGated(input)) {
    return {
      selectable: false,
      reason: "human-gate",
      humanGated: true,
      evidence: "",
    };
  }
  if (!isPreWorkLaneType(input.laneType)) {
    return {
      selectable: false,
      reason: "not-pre-work",
      humanGated: false,
      evidence: "",
    };
  }
  if (trimmedString(input.statedBlocker).length === 0) {
    return {
      selectable: true,
      reason: "no-blocker",
      humanGated: false,
      evidence: "",
    };
  }
  if (!input.probe || typeof input.probe !== "object") {
    return {
      selectable: false,
      reason: "blocker-unprobed",
      humanGated: false,
      evidence: "",
    };
  }

  return { ...judgeProbe(input.probe), humanGated: false };
}

/** Plain-English wording for each verdict, for the note left on the item. */
const REASON_COPY = Object.freeze({
  "human-gate": "A person parked this one on purpose, so intake left it alone.",
  "not-pre-work": "This item is not sitting in a not-yet-started lane.",
  "no-blocker": "No blocker was written on this item, so it is buildable.",
  "blocker-unprobed":
    "This item states a blocker that was not re-checked this cycle, so it stays put.",
  "blocker-holds":
    "The blocker was re-checked and still holds, so it stays put.",
  "blocker-discharge-unevidenced":
    "The blocker looked clear but no proof was recorded, so it stays put.",
  "blocker-discharged":
    "The blocker was re-checked and no longer applies, so this item is buildable again.",
});

/**
 * Render the re-probe result to leave on the item, so the next cycle reads the
 * answer instead of deriving it again.
 *
 * @param {{
 *   statedBlocker?: unknown
 *   checkedAt?: string | Date
 * }} candidate
 * @param {{ reason: string, evidence?: string }} verdict
 * @returns {string}
 */
export function formatReprobeNote(candidate = {}, verdict) {
  const checkedAt =
    candidate.checkedAt instanceof Date
      ? candidate.checkedAt.toISOString()
      : trimmedString(candidate.checkedAt) || new Date().toISOString();
  const lines = [
    "**Blocker re-check**",
    "",
    `- What has to be true: ${trimmedString(candidate.statedBlocker) || "(none written on this item)"}`,
    `- What we found: ${REASON_COPY[verdict.reason] ?? verdict.reason}`,
  ];
  const evidence = trimmedString(verdict.evidence);
  if (evidence.length > 0) {
    lines.push(`- Proof: ${evidence}`);
  }
  lines.push(`- Checked at: ${checkedAt}`);

  return lines.join("\n");
}

/**
 * Marker on the note this module leaves, so a later cycle recognises its own
 * work instead of commenting again.
 */
export const HUMAN_GATE_NOTE_MARKER = "<!-- [lisa-human-gate-reconciled] -->";

/**
 * Decide whether a candidate ALREADY IN THE READY LANE may be claimed.
 *
 * `classifyPreWorkCandidate` was the only caller of the human-gate test, and it
 * runs on candidates outside the ready lane. An item that reached the ready
 * lane was therefore claimed with the gate never consulted — the check was
 * correct and simply unreachable from the path that matters.
 *
 * This shares `isHumanGated` with the pre-work classifier deliberately. Two
 * copies of a substring test drift, and a drifted gate fails silently: it stops
 * matching, and nothing reports that it stopped.
 *
 * The test stays a plain literal-substring match and is NOT keyed on `reason=`.
 * Markers in the wild carry no `reason=` at all and sit anywhere in the body, so
 * a parser keyed on the structured field would miss those while appearing to
 * work on every item that happens to have one — reproducing this defect one
 * layer down.
 * @param {{ labels?: unknown, body?: unknown, humanNeededLabel?: unknown }} input - Candidate surfaces
 * @returns {{ claimable: boolean, reason: string, humanGated: boolean }} Claim verdict
 */
export function classifyReadyCandidate(input = {}) {
  if (isHumanGated(input)) {
    return { claimable: false, reason: "human-gate", humanGated: true };
  }
  return { claimable: true, reason: "ready-eligible", humanGated: false };
}

/**
 * Plan the state repair for a ready-lane item that is held for a person.
 *
 * Skipping such an item is not enough. `lisa-repair-intake` sweeps items that
 * are NOT in the ready role and excludes gated ones outright, so a ready AND
 * gated item falls outside its filter twice over. Skipping alone would leave it
 * re-evaluated and re-rejected every cycle forever, seen by nothing — trading a
 * loud failure for a silent one.
 *
 * So the lane is reconciled to match the hold: the item leaves the pickup queue
 * and gains the human-needed marker. That is the same repair the leaf-only gate
 * already performs for a ready item that must not be dispatched.
 *
 * Idempotent by state rather than by memory: an item already out of the queue
 * and already marked needs nothing, so asking twice yields no second mutation.
 * @param {{
 *   labels?: unknown
 *   body?: unknown
 *   humanNeededLabel?: unknown
 *   readyLabel?: unknown
 *   alreadyNotified?: unknown
 * }} input - Candidate surfaces plus the configured lane and marker labels
 * @returns {{ gated: boolean, reason: string, actions: { removeReadyRole: boolean, addHumanNeededLabel: boolean, comment: boolean } }} Repair plan
 */
export function planHumanGateReconciliation(input = {}) {
  const idle = Object.freeze({
    removeReadyRole: false,
    addHumanNeededLabel: false,
    comment: false,
  });
  if (!isHumanGated(input)) {
    return { gated: false, reason: "not-gated", actions: idle };
  }

  const labels = normalizeLabels(input.labels);
  const needed = String(input.humanNeededLabel ?? DEFAULT_HUMAN_NEEDED_LABEL)
    .trim()
    .toLowerCase();
  const ready = String(input.readyLabel ?? "")
    .trim()
    .toLowerCase();
  const inReadyLane = ready.length > 0 && labels.includes(ready);
  const marked = needed.length > 0 && labels.includes(needed);
  const actions = {
    removeReadyRole: inReadyLane,
    addHumanNeededLabel: needed.length > 0 && !marked,
    comment:
      input.alreadyNotified !== true &&
      (inReadyLane || (needed.length > 0 && !marked)),
  };
  const changed =
    actions.removeReadyRole || actions.addHumanNeededLabel || actions.comment;

  return {
    gated: true,
    reason: changed ? "reconcile" : "already-reconciled",
    actions,
  };
}

/**
 * Render the hold notice for a reader who does not know this subsystem.
 *
 * Written for a non-technical operator on purpose — that is who stands at this
 * gate. It names what was found, what changed, and how to undo it, and uses no
 * skill name, label syntax, or phase number, none of which a reader can act on.
 * @returns {string} Comment body, carrying the marker that keeps a re-run quiet
 */
export function formatHumanGateNote() {
  return [
    "**On hold for a person**",
    "",
    "- What was found: this item is marked as held for a person, but it was " +
      "also sitting in the queue that agents build from — so it would have " +
      "been picked up and built anyway.",
    "- What changed: it has been taken out of that queue and flagged as " +
      "needing a person, so nothing will build it automatically.",
    "- To resume it: remove the hold note from the description and put it " +
      "back in the build queue.",
    "",
    HUMAN_GATE_NOTE_MARKER,
  ].join("\n");
}

/**
 * Render the cycle-summary line naming what was held.
 *
 * A lane mutation nobody can see afterwards is the same class of problem as the
 * one this fixes, so the run says what it moved — and it keeps "nothing was
 * eligible" distinguishable from "something eligible was held".
 * @param {readonly unknown[]} held - Item references held this cycle
 * @returns {string} One summary line
 */
export function summarizeHumanGateHolds(held = []) {
  const names = (Array.isArray(held) ? held : [])
    .map(item => trimmedString(item))
    .filter(name => name.length > 0);
  if (names.length === 0) return "Held for a person: none.";
  return `Held for a person (${String(names.length)}): ${names.join(", ")}.`;
}
