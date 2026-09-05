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
 * Decoration a declaration may sit behind, and nothing more.
 *
 * Whitespace, blockquote arrows, list bullets or numbers, emphasis, and an
 * opening HTML comment. A single character class plus two optional groups —
 * deliberately not a nested-quantifier pattern, because this runs over
 * untrusted work-item bodies and `sonarjs/slow-regex` is right about that
 * shape.
 */
const LEADING_DECORATION =
  /^[ \t>*_+-]*(?:\d+[.)][ \t]*)?(?:<!--[ \t]*)?[ \t]*/u;

/**
 * The body with fenced blocks and inline code spans removed.
 *
 * Documentation of a declaration is not a declaration, and a fenced example is
 * how the declaration form gets written ABOUT. The same move
 * `pr-arming-sweep.mjs` makes for the auto-merge-off marker
 * (CodySwannGT/lisa#3986), and the same one `block-direct-issue-create.sh`
 * makes when it strips heredoc bodies before tokenising argv.
 * @param {unknown} body - The raw item body
 * @returns {string} The body with quoted and code regions blanked out
 */
function declarativeText(body) {
  return String(body ?? "")
    .replace(/```[\s\S]*?```/gu, "")
    .replace(/`[^`\n]*`/gu, "");
}

/**
 * Whether an HTML comment on this line carries the marker.
 *
 * The second declaration form, and it is not a concession: an HTML comment is
 * invisible when the body is rendered, so nobody writes one to TALK about the
 * marker — a quotation has to be visible to be a quotation. Prose about the
 * marker is written in sentences, code spans and fenced examples, all of which
 * this rule already excludes.
 *
 * Scanned rather than pattern-matched. A regular expression with two lazy
 * `[^\n]*?` runs around a literal is the ambiguous shape this module avoids
 * elsewhere, and an indexOf walk is both linear and easier to be sure about.
 * @param {string} line - One line of the body
 * @returns {boolean} True when a comment on this line contains the marker
 */
function commentCarriesMarker(line) {
  const segments = line.split("<!--");
  for (let index = 1; index < segments.length; index += 1) {
    const close = segments[index].indexOf("-->");
    const inside =
      close === -1 ? segments[index] : segments[index].slice(0, close);
    if (inside.includes(HUMAN_GATE_MARKER)) return true;
  }
  return false;
}

/**
 * Whether one line DECLARES a hold rather than mentioning one.
 *
 * Two accepted forms, and the corpus says they cost nothing to combine:
 * measured over this repository's 42 matching bodies, line-leading alone and
 * line-leading-or-comment hold the SAME 29. The comment branch exists because
 * the filing guard reads inputs that are not markdown documents — a one-line
 * `--body` string and a shell script — where a declaration legitimately sits
 * after other text on its line.
 * @param {string} line - One line of the body
 * @returns {boolean} True when the line declares a hold
 */
function declaresOnLine(line) {
  if (line.replace(LEADING_DECORATION, "").startsWith(HUMAN_GATE_MARKER)) {
    return true;
  }
  return commentCarriesMarker(line);
}

/**
 * Count what a body says about the hold marker, split by what it MEANS.
 *
 * ## Why the substring test had to go
 *
 * `isHumanGated` asked one question — does the body contain the marker
 * anywhere — and that form was deliberate, documented, and correct when it was
 * written: *"it is a marker with no other meaning, so its presence IS the
 * declaration."* The premise expired. The marker acquired a second meaning —
 * **being discussed** — the moment the feature became something people file
 * tickets about, so a sentence quoting it, a Gherkin line naming it, and a
 * ticket about it all read as declared holds (CodySwannGT/lisa#3815).
 *
 * The consequence is not one skipped cycle. `planHumanGateReconciliation`
 * removes the ready role and applies the human-needed label, so a false
 * positive rewrites the item's own metadata and every later sweep agrees with
 * the first. And the affected population GROWS with the documentation: 38
 * matching bodies measured 2026-09-04, 42 on 2026-09-05.
 *
 * ## The rule
 *
 * A declaration is POSITIONAL — the marker leads its line, behind at most
 * blockquote, list, emphasis or opening-comment decoration — evaluated after
 * code regions are removed. Measured over this repository's 42 matching bodies:
 * this holds 29 of them and correctly releases the two live ready-lane items
 * that only discussed the marker.
 *
 * The stricter HTML-comment-only rule was measured and REJECTED: it holds only
 * 18, dropping declarations that carry `human-needed` today. Losing a real hold
 * is the unsafe direction and would need a retrofit of the tracker.
 *
 * ## Why it counts rather than answering yes or no
 *
 * A heuristic that silently drops candidates is indistinguishable from one that
 * found none. Every occurrence this rule declines to honour is counted and
 * reported, so "the rule demoted 33 mentions" is a fact an operator can read
 * rather than an absence they must infer.
 * @param {unknown} body - The item body
 * @returns {{ total: number, declared: number, demoted: number }} Occurrences,
 *   those that declare a hold, and those demoted to mentions
 */
export function humanGateMentions(body) {
  const raw = String(body ?? "");
  const total = raw.split(HUMAN_GATE_MARKER).length - 1;
  const declared = declarativeText(raw)
    .split("\n")
    .filter(line => declaresOnLine(line)).length;
  return { total, declared, demoted: total - declared };
}

/**
 * Whether a body declares a hold, as opposed to discussing one.
 * @param {unknown} body - The item body
 * @returns {boolean} True when at least one line declares a hold
 */
export function bodyDeclaresHold(body) {
  return humanGateMentions(body).declared > 0;
}

/**
 * Whether an item is held for a person, on either surface.
 *
 * Exported deliberately, and it is the ONLY answer to that question anywhere in
 * the intake machinery. Every selection and promotion path calls this rather
 * than inspecting labels itself, because the label surface alone is a partial
 * answer: the vendor writers stamp the body marker on a deliberate hold, so an
 * item held exactly as the filing contract instructs carries no label at all.
 * A path that read labels alone judged such an item unheld and promoted it —
 * which is #3805, and is why this is a shared function rather than a shared
 * convention.
 * @param {{ labels?: unknown, body?: unknown, humanNeededLabel?: unknown }} input - Candidate surfaces
 * @returns {boolean} True when a person is holding this item
 */
export function isHumanGated(input) {
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

  return bodyDeclaresHold(input.body);
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
 * Marker on the note the normalization sweep leaves, so a later cycle
 * recognises its own work instead of commenting again.
 *
 * Deliberately NOT the hold marker and deliberately not a superstring of it:
 * `HUMAN_GATE_MARKER` closes with `]`, so neither this nor
 * `HUMAN_GATE_NOTE_MARKER` matches it. A note that read as a hold declaration
 * would make every reported item look held to the next body-reading sweep,
 * including items the report merely names.
 */
export const NORMALIZATION_HOLD_NOTE_MARKER =
  "<!-- [lisa-human-gate-normalization-held] -->";

/**
 * Decide whether an item carrying NO configured lifecycle label may be
 * normalized into a ready lane.
 *
 * This is the promotion path, and it was keyed on labels alone. The configured
 * `human_needed` label is one of the lifecycle labels whose *absence* the sweep
 * enumerates on, so an item held only by the body marker was a member of the
 * swept population by definition and got the build-ready label applied to it.
 * The `[lisa-human-gate]` exclusion existed, in a different and read-only sweep
 * further down the same contract: the one sweep that writes was the one that
 * could not see the marker.
 *
 * Order is load-bearing for the same reason it is in `classifyPreWorkCandidate`:
 * the hold is checked before lane membership and before any classification, so
 * nothing downstream — however confident — can promote an item a person parked.
 *
 * On a match this plans NO write of its own. `planHumanGateReconciliation`
 * turns a match into durable state, so a false positive there latches and every
 * later cycle agrees with the first. The gate test is a plain substring match
 * whose imprecision is tracked separately, so this path refuses and reports
 * read-only instead — the same treatment the ungated-filing sweep already gives
 * a hold it finds.
 * @param {{
 *   labels?: unknown
 *   body?: unknown
 *   humanNeededLabel?: unknown
 *   lifecycleLabels?: unknown
 *   readyLabel?: unknown
 * }} input - Candidate surfaces plus the configured lifecycle vocabulary
 * @returns {{ normalize: boolean, reason: string, humanGated: boolean, actions: { addReadyLabel: string | null, reportHold: boolean } }} Normalization plan
 */
export function planLabelNormalization(input = {}) {
  const idle = Object.freeze({ addReadyLabel: null, reportHold: false });
  if (isHumanGated(input)) {
    return {
      normalize: false,
      reason: "human-gate",
      humanGated: true,
      actions: Object.freeze({ addReadyLabel: null, reportHold: true }),
    };
  }

  const labels = normalizeLabels(input.labels);
  if (normalizeLabels(input.lifecycleLabels).some(l => labels.includes(l))) {
    return {
      normalize: false,
      reason: "already-in-lifecycle",
      humanGated: false,
      actions: idle,
    };
  }

  const ready = trimmedString(input.readyLabel);
  if (ready.length === 0) {
    return {
      normalize: false,
      reason: "no-ready-label",
      humanGated: false,
      actions: idle,
    };
  }

  return {
    normalize: true,
    reason: "normalize",
    humanGated: false,
    actions: Object.freeze({ addReadyLabel: ready, reportHold: false }),
  };
}

/**
 * Render the notice for an item the normalization sweep left alone.
 *
 * Distinct from `formatHumanGateNote` because the two say opposite things
 * about what happened: that one reports a lane that WAS changed, this one
 * reports a promotion that was declined and nothing else. Reusing it would tell
 * an operator their item had been moved when it had not.
 * @returns {string} Comment body, carrying the marker that keeps a re-run quiet
 */
export function formatNormalizationHoldNote() {
  return [
    "**Left alone: a person is holding this**",
    "",
    "- What was found: the description says a person is holding this one, so " +
      "it was not put into the queue that agents work from.",
    "- What changed: nothing at all. It was left exactly as it is, and " +
      "nothing will pick it up on its own.",
    "- To resume it: remove the hold note from the description, then put it " +
      "into the build queue.",
    "",
    NORMALIZATION_HOLD_NOTE_MARKER,
  ].join("\n");
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
/**
 * Render the cycle-summary line naming what the precision rule DEMOTED.
 *
 * The counterpart of {@link summarizeHumanGateHolds}, and it exists for the
 * same reason: a mutation nobody can see afterwards is the problem this whole
 * area keeps having. A rule that quietly declines to honour half the marker
 * occurrences it sees reads exactly like a rule that saw none, so the count is
 * printed even when it is zero — measured across this repository's matching
 * bodies, 33 of 62 occurrences are mentions rather than declarations.
 * @param {unknown} demoted - How many occurrences were mentions, not declarations
 * @returns {string} One summary line
 */
export function summarizeHumanGateMentions(demoted = 0) {
  const count = Number.isFinite(Number(demoted))
    ? Math.trunc(Number(demoted))
    : 0;
  const shown = count > 0 ? String(count) : "none";
  return `Marker mentions demoted (not declarations): ${shown}.`;
}

export function summarizeHumanGateHolds(held = []) {
  const names = (Array.isArray(held) ? held : [])
    .map(item => trimmedString(item))
    .filter(name => name.length > 0);
  if (names.length === 0) return "Held for a person: none.";
  return `Held for a person (${String(names.length)}): ${names.join(", ")}.`;
}
