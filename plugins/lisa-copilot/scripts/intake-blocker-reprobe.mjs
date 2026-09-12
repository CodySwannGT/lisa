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
 * Whitespace, blockquote arrows, list bullets or numbers, emphasis, a comment
 * hash, and an opening HTML comment. `#` is there on EVIDENCE rather than
 * taste: a shell script declares a hold as `# <marker> reason=…` — a bare
 * marker behind a SHELL comment, with no HTML comment anywhere — and that form
 * is in this repository's own guard fixtures. A single character class plus two
 * optional groups —
 * deliberately not a nested-quantifier pattern, because this runs over
 * untrusted work-item bodies and `sonarjs/slow-regex` is right about that
 * shape.
 */
const LEADING_DECORATION =
  /^[ \t>*_+#-]*(?:\d+[.)][ \t]*)?(?:<!--[ \t]*)?[ \t]*/u;

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
 * Whether an HTML comment on this line carries the given marker.
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
 * @param {string} marker - The literal marker to look for
 * @returns {boolean} True when a comment on this line contains the marker
 */
function commentCarriesMarker(line, marker) {
  const segments = line.split("<!--");
  for (let index = 1; index < segments.length; index += 1) {
    const close = segments[index].indexOf("-->");
    const inside =
      close === -1 ? segments[index] : segments[index].slice(0, close);
    if (inside.includes(marker)) return true;
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
 * @param {string} [marker] - The declaration marker to test for
 * @returns {boolean} True when the line declares with that marker
 */
function declaresOnLine(line, marker = HUMAN_GATE_MARKER) {
  if (line.replace(LEADING_DECORATION, "").startsWith(marker)) {
    return true;
  }
  return commentCarriesMarker(line, marker);
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
 * Marker a comment carries to DISCHARGE a hold.
 *
 * ## Why a comment and not the body
 *
 * The hold lives in the description, and the only description write this plugin
 * has is a whole-body replacement — re-read everything, change one line, write
 * it all back. On an item carrying acceptance criteria, a validation journey
 * and a managed usage section, "delete one HTML comment" is therefore "rewrite
 * the record and hope nothing was dropped". A release procedure whose only
 * implementation risks destroying what it releases is not a release procedure:
 * the rational move is always to leave the hold, so holds only accumulate
 * (CodySwannGT/lisa#3852).
 *
 * A comment is append-only. It cannot drop a section it never held, and the
 * same reader that reads the hold reads the discharge.
 *
 * ## Why it is not a superstring of the hold marker
 *
 * `HUMAN_GATE_MARKER` closes with `]`, so `[lisa-human-gate-release]` does not
 * contain it. That is load-bearing rather than incidental: a release record
 * that matched the hold test would declare a fresh hold every time one was
 * lifted, which is the same trap `NORMALIZATION_HOLD_NOTE_MARKER` documents.
 */
export const HUMAN_GATE_RELEASE_MARKER = "[lisa-human-gate-release]";

/** Structured key a hold and its release both name, so they pair up. */
const REASON_KEY = "reason=";

/**
 * The comparable form of a hold reason.
 *
 * Case and internal whitespace drift between the hand that writes the hold and
 * the hand that writes the release; the identity of the question does not.
 * @param {unknown} value - A raw reason string
 * @returns {string} Its comparable form, empty when there is none
 */
function normalizeReason(value) {
  return String(value ?? "")
    .replace(/\s+/gu, " ")
    .trim()
    .toLowerCase();
}

/**
 * The reason a declaring line names, or the empty key when it names none.
 *
 * A keyless declaration is not a defect to be rejected — markers in the wild
 * carry no `reason=` at all, which is why the hold test is not keyed on one.
 * The empty string is a real key here: a keyless hold is discharged by a
 * keyless release and by nothing else, so the two surfaces stay symmetric
 * whether or not a reason was ever written.
 * @param {string} line - A line already known to declare
 * @param {string} marker - The declaration marker it carries
 * @returns {string} The normalized reason key
 */
function reasonOnLine(line, marker) {
  const at = line.indexOf(marker);
  if (at === -1) return "";
  const tail = line.slice(at + marker.length).split("-->")[0];
  const key = tail.indexOf(REASON_KEY);
  if (key === -1) return "";
  return normalizeReason(tail.slice(key + REASON_KEY.length));
}

/**
 * The reason keys of every hold a body DECLARES, deduplicated.
 *
 * Reuses the precision rule rather than restating it, so a body that merely
 * discusses the marker yields no holds here for the same reason it reads as
 * unheld in {@link bodyDeclaresHold}.
 * @param {unknown} body - The item body
 * @returns {string[]} One key per declared hold
 */
export function humanGateHolds(body) {
  const keys = declarativeText(body)
    .split("\n")
    .filter(line => declaresOnLine(line))
    .map(line => reasonOnLine(line, HUMAN_GATE_MARKER));
  return [...new Set(keys)];
}

/**
 * Normalize stable provider IDs without case folding or trusting display names.
 * @param {unknown} value - Provider actor ID
 * @returns {string} Stable comparison key, or empty when invalid
 */
function stableActorId(value) {
  if (typeof value === "string") return value.trim();
  return Number.isSafeInteger(value) && value > 0 ? String(value) : "";
}

/**
 * Recognize explicit provider bot metadata even for an allowlisted identity.
 * @param {unknown} actor - Provider or normalized author metadata
 * @returns {boolean} Whether the metadata identifies automation
 */
function isKnownBot(actor) {
  if (!actor || typeof actor !== "object") return false;
  const kinds = [
    actor.type,
    actor.__typename,
    actor.accountType,
    actor.authorType,
  ];
  return (
    actor.isBot === true ||
    actor.bot === true ||
    kinds.some(kind => /^(?:bot|app)$/i.test(String(kind ?? "").trim()))
  );
}

/**
 * Require authenticated provider identity and separately supplied human trust.
 * Adapters may normalize the ID to authorId, but must preserve bot metadata.
 * Names, body text and self-asserted authorization flags never confer trust.
 * @param {unknown} comment - Structured provider comment
 * @param {ReadonlySet<string>} trustedIds - Explicitly trusted human actor IDs
 * @returns {boolean} Whether the comment may discharge a human hold
 */
function isTrustedHumanComment(comment, trustedIds) {
  if (!comment || typeof comment !== "object" || Array.isArray(comment))
    return false;
  if ([comment, comment.user, comment.author].some(isKnownBot)) return false;
  const id = stableActorId(
    comment.authorId ??
      comment.user?.id ??
      comment.author?.id ??
      comment.author?.accountId
  );
  return id.length > 0 && trustedIds.has(id);
}

/**
 * The reason keys released by explicitly trusted human authors, deduplicated.
 *
 * Comments must retain authenticated provider authorship: normalized authorId,
 * user.id, author.id or author.accountId. The caller supplies trusted human IDs
 * independently of comment content. Raw strings, missing IDs, known bots and
 * an absent or empty allowlist fail closed and cannot discharge a hold.
 * @param {unknown} comments - Structured comments, any order
 * @param {unknown} trustedHumanActorIds - Explicit trusted human provider IDs
 * @returns {string[]} One key per authorized recorded release
 */
export function humanGateReleases(comments, trustedHumanActorIds = []) {
  const trustedIds = new Set(
    (Array.isArray(trustedHumanActorIds) ? trustedHumanActorIds : [])
      .map(stableActorId)
      .filter(Boolean)
  );
  const bodies = (Array.isArray(comments) ? comments : [])
    .filter(entry => isTrustedHumanComment(entry, trustedIds))
    .map(entry => entry.body ?? "");
  const keys = bodies.flatMap(body =>
    declarativeText(body)
      .split("\n")
      .filter(line => declaresOnLine(line, HUMAN_GATE_RELEASE_MARKER))
      .map(line => reasonOnLine(line, HUMAN_GATE_RELEASE_MARKER))
  );
  return [...new Set(keys)];
}

/**
 * Whether every hold on this item has a release recorded against it.
 *
 * Matching is per-reason on purpose. A blanket "any release clears everything"
 * rule would make a hold declared AFTER a release be born discharged, which is
 * the unsafe direction — the one this fix must not introduce while correcting
 * the safe one. An item with no declared body hold is discharged only by a
 * keyless release, which is the form that pairs with a label-only hold.
 * @param {{ body?: unknown, comments?: unknown, trustedHumanActorIds?: unknown }} input - The item's surfaces
 * @returns {boolean} True when nothing is left outstanding
 */
export function humanGateDischarged(input = {}) {
  const released = new Set(
    humanGateReleases(input.comments, input.trustedHumanActorIds)
  );
  const holds = humanGateHolds(input.body);
  if (holds.length === 0) return released.has("");
  return holds.every(reason => released.has(reason));
}

/**
 * The full held-ness verdict for an item, on every surface that carries a hold.
 *
 * Split out of {@link isHumanGated} because the release path needs to know more
 * than yes-or-no: whether a hold existed at all, which reasons are still
 * outstanding, and whether the durable label needs removing. A caller that only
 * wants the boolean still gets exactly the boolean.
 *
 * The label is treated as a MIRROR of a declared body hold, never as a second
 * independent hold, because that is how it is written: the vendor writers stamp
 * both surfaces for one hold, and `planHumanGateReconciliation` adds the label
 * to an item already carrying the marker. Counting it separately would leave
 * every mirrored hold permanently outstanding under a keyed release — the exact
 * defect this function exists to end, one layer down. Only when the body
 * declares nothing does the label stand as a hold in its own right, and then it
 * is a keyless one.
 *
 * Fails CLOSED on an unreadable discharge: with no comments supplied there are
 * no releases, so a held item stays held. Holding a gate that may be stale
 * beats releasing one that is not, and every caller that never passes comments
 * keeps its current behaviour by construction.
 * @param {{ labels?: unknown, body?: unknown, comments?: unknown, trustedHumanActorIds?: unknown, humanNeededLabel?: unknown }} input - Candidate surfaces
 * @returns {{ held: boolean, reason: string, declared: number, outstanding: string[], released: string[], labelPresent: boolean }} Held-ness verdict
 */
export function humanGateVerdict(input = {}) {
  const configured = String(
    input.humanNeededLabel ?? DEFAULT_HUMAN_NEEDED_LABEL
  )
    .trim()
    .toLowerCase();
  const labelPresent =
    configured.length > 0 && normalizeLabels(input.labels).includes(configured);
  const released = humanGateReleases(
    input.comments,
    input.trustedHumanActorIds
  );
  const releasedSet = new Set(released);
  const holds = humanGateHolds(input.body);
  const outstanding = holds.filter(reason => !releasedSet.has(reason));
  const base = {
    declared: holds.length,
    released,
    labelPresent,
  };

  if (outstanding.length > 0) {
    return { held: true, reason: "hold-outstanding", outstanding, ...base };
  }
  if (holds.length > 0) {
    return { held: false, reason: "hold-released", outstanding: [], ...base };
  }
  if (labelPresent) {
    return releasedSet.has("")
      ? { held: false, reason: "hold-released", outstanding: [], ...base }
      : { held: true, reason: "hold-outstanding", outstanding: [""], ...base };
  }

  return { held: false, reason: "no-hold", outstanding: [], ...base };
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
 *
 * It is also the only place a hold ENDS, which is why the release lives behind
 * the same call rather than beside it: a reader that could see the hold but not
 * its discharge is how the gate became one-way in the first place. Pass the
 * item's structured comments and trustedHumanActorIds to honor an authorized
 * release; omit either and the item stays held.
 * @param {{ labels?: unknown, body?: unknown, comments?: unknown, trustedHumanActorIds?: unknown, humanNeededLabel?: unknown }} input - Candidate surfaces
 * @returns {boolean} True when a person is holding this item
 */
export function isHumanGated(input) {
  return humanGateVerdict(input).held;
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
 *   comments?: unknown
 *   trustedHumanActorIds?: unknown
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
 * @param {{ labels?: unknown, body?: unknown, comments?: unknown, trustedHumanActorIds?: unknown, humanNeededLabel?: unknown }} input - Candidate surfaces
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
 *   comments?: unknown
 *   trustedHumanActorIds?: unknown
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
 * Marker on the note the release path leaves, so a later cycle recognises its
 * own work instead of commenting again.
 *
 * A superstring of neither declaration marker, for the reason
 * {@link HUMAN_GATE_RELEASE_MARKER} gives: a note ABOUT a release must not read
 * as a release, or the note announcing one item's discharge would discharge
 * every item it names.
 */
export const HUMAN_GATE_RELEASE_NOTE_MARKER =
  "<!-- [lisa-human-gate-released] -->";

/**
 * The one sentence every hold note gives an operator to END the hold.
 *
 * One constant, two notes, because the instruction IS the release path as far
 * as the person reading it is concerned. Two copies of it drift, and a drifted
 * instruction sends someone to a mechanism that no longer exists — which is
 * worse than the prose it replaced, since that at least described something
 * real. It names a comment because the alternative it replaces — "remove the
 * hold note from the description" — asks for a whole-body rewrite the tooling
 * has no safe way to perform.
 */
const RESUME_INSTRUCTION = [
  "- To resume it: leave a comment on this item that starts with ",
  HUMAN_GATE_RELEASE_MARKER,
  " and repeats the reason the hold in the description names. The next sweep ",
  "puts it back in the queue on its own. Nothing else has to change — do not ",
  "edit the description, and do not move it by hand.",
].join("");

/**
 * Plan the state repair for an item whose hold has been discharged.
 *
 * The exact inverse of {@link planHumanGateReconciliation}, and deliberately
 * the same shape: that one takes the ready role away and adds the marker label,
 * this one takes the marker label away and puts the ready role back. A state
 * change with no inverse is the defect class this pair exists to close
 * (`state-changes-without-inverses`), and an inverse that is merely *possible*
 * is not one — it has to sit on a path something actually runs, which is why
 * this is a planner the intake sweeps call rather than an instruction to an
 * operator.
 *
 * Two refusals are load-bearing:
 *
 * - **A still-held item plans nothing.** Every outstanding reason holds the
 *   whole item, so an item whose second hold has not been answered is not
 *   half-released.
 * - **An item that was never held plans nothing.** Without that, this would be
 *   a path that adds the build-ready role to arbitrary items — a promotion
 *   mechanism wearing a release mechanism's name.
 *
 * The ready role is restored only when the item carries none of the configured
 * lifecycle labels, mirroring {@link planLabelNormalization}. An item that was
 * held and has since reached a terminal lane must not be dragged back to the
 * queue by its own release.
 *
 * Idempotent by state rather than by memory: an item already unmarked and
 * already back in the queue needs nothing, so asking twice yields no second
 * mutation.
 * @param {{
 *   labels?: unknown
 *   body?: unknown
 *   comments?: unknown
 *   trustedHumanActorIds?: unknown
 *   humanNeededLabel?: unknown
 *   readyLabel?: unknown
 *   lifecycleLabels?: unknown
 *   alreadyNotified?: unknown
 * }} input - Candidate surfaces plus the configured lane vocabulary
 * @returns {{ released: boolean, reason: string, discharged: string[], actions: { removeHumanNeededLabel: boolean, addReadyLabel: string | null, comment: boolean } }} Release plan
 */
export function planHumanGateRelease(input = {}) {
  const idle = Object.freeze({
    removeHumanNeededLabel: false,
    addReadyLabel: null,
    comment: false,
  });
  const verdict = humanGateVerdict(input);
  if (verdict.held) {
    return {
      released: false,
      reason: "hold-outstanding",
      discharged: [],
      actions: idle,
    };
  }
  if (verdict.declared === 0 && !verdict.labelPresent) {
    return {
      released: false,
      reason: "no-hold",
      discharged: [],
      actions: idle,
    };
  }

  const needed = String(input.humanNeededLabel ?? DEFAULT_HUMAN_NEEDED_LABEL)
    .trim()
    .toLowerCase();
  // The marker label is excluded from the lane test on both sides. It is one of
  // the configured lifecycle labels AND it is the label this plan removes, so
  // counting it would let the hold's own marker prove the item is already in a
  // lane and veto the restoration — the release would clear the flag and leave
  // the item in no queue at all, which is the original defect with one fewer
  // symptom.
  const labels = normalizeLabels(input.labels).filter(name => name !== needed);
  const lifecycle = normalizeLabels(input.lifecycleLabels).filter(
    name => name !== needed
  );
  const ready = trimmedString(input.readyLabel);
  const inLifecycle = lifecycle.some(name => labels.includes(name));
  const addReadyLabel =
    ready.length > 0 && !inLifecycle && !labels.includes(ready.toLowerCase())
      ? ready
      : null;
  const actions = {
    removeHumanNeededLabel: verdict.labelPresent,
    addReadyLabel,
    comment:
      input.alreadyNotified !== true &&
      (verdict.labelPresent || addReadyLabel !== null),
  };
  const changed =
    actions.removeHumanNeededLabel || addReadyLabel !== null || actions.comment;

  return {
    released: true,
    reason: changed ? "release" : "already-released",
    discharged: verdict.released,
    actions,
  };
}

/**
 * Render the discharge record a person or a skill leaves to END a hold.
 *
 * Generated rather than retyped, because the release names the hold it ends by
 * its reason and a mistyped reason discharges nothing while looking like it
 * did. The reason is echoed verbatim from the hold, so the pairing is visible
 * to a reader as well as to the matcher.
 * @param {{ reason?: unknown, decidedBy?: unknown, decision?: unknown }} discharge - What was decided, and by whom
 * @returns {string} Comment body carrying the release marker
 */
export function formatHumanGateRelease(discharge = {}) {
  const reason = trimmedString(discharge.reason);
  const declaration =
    reason.length > 0
      ? `${HUMAN_GATE_RELEASE_MARKER} ${REASON_KEY}${reason}`
      : HUMAN_GATE_RELEASE_MARKER;
  const lines = [declaration, "", "**The hold on this item is lifted.**", ""];
  lines.push(
    `- What was being asked: ${reason.length > 0 ? reason : "(the hold named no reason)"}`
  );
  const decision = trimmedString(discharge.decision);
  if (decision.length > 0) lines.push(`- What was decided: ${decision}`);
  const decidedBy = trimmedString(discharge.decidedBy);
  if (decidedBy.length > 0) lines.push(`- Decided by: ${decidedBy}`);
  lines.push(
    "- What happens next: this item goes back into the queue that agents build from."
  );

  return lines.join("\n");
}

/**
 * Render the notice for an item this sweep released.
 *
 * Distinct from {@link formatHumanGateNote} for the same reason
 * {@link formatNormalizationHoldNote} is: the two report opposite events, and
 * reusing one to report the other tells an operator the wrong thing happened.
 * @returns {string} Comment body, carrying the marker that keeps a re-run quiet
 */
export function formatHumanGateReleaseNote() {
  return [
    "**Back in the queue: the hold was answered**",
    "",
    "- What was found: this item was being held for a person, and the " +
      "decision it was waiting for has since been recorded on it.",
    "- What changed: the hold flag has been taken off and the item has been " +
      "put back into the queue that agents build from.",
    "- Nothing was rewritten: the description is exactly as it was, hold note " +
      "and all, so the history of why it was held stays readable.",
    "",
    HUMAN_GATE_RELEASE_NOTE_MARKER,
  ].join("\n");
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
 *   comments?: unknown
 *   trustedHumanActorIds?: unknown
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
    RESUME_INSTRUCTION,
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
    RESUME_INSTRUCTION,
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

/**
 * Render the cycle-summary line naming what was RELEASED.
 *
 * The counterpart of {@link summarizeHumanGateHolds}, printed even when it is
 * zero. Without it a release path that has stopped working is indistinguishable
 * from a cycle where nothing needed releasing — which is exactly how the
 * missing inverse went unnoticed for as long as it did, and a fix that cannot
 * be observed to fire is a fix nobody can tell has regressed.
 * @param {readonly unknown[]} released - Item references released this cycle
 * @returns {string} One summary line
 */
export function summarizeHumanGateReleases(released = []) {
  const names = (Array.isArray(released) ? released : [])
    .map(item => trimmedString(item))
    .filter(name => name.length > 0);
  if (names.length === 0) return "Released back to the queue: none.";
  return `Released back to the queue (${String(names.length)}): ${names.join(", ")}.`;
}
