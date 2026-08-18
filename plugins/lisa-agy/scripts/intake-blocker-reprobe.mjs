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
