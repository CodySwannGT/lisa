#!/usr/bin/env node
// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.
/**
 * Prove that a third-party review either RAN at the head commit, or that a
 * local adversarial review was posted in its place (issue #3591).
 *
 * @remarks
 * ## The measurement this exists for
 *
 * A third-party review app reports on the pull request head through a **commit
 * status** or a **check run**. When it is throttled, or declines to review at
 * all, it never blocks — a status still reports `state: success`, and a check
 * run concludes `neutral`, which GitHub counts as passing a required check. Only
 * the reviewer's own words distinguish a review that ran from one that never
 * started.
 *
 * Re-measured over the last 30 merged pull requests in this repository, reading
 * the reviewer's status on each pull request's head SHA:
 *
 * ```
 * success :: Review rate limited                                       19
 * success :: Review completed                                           6
 * success :: Review skipped: manual review required for this OSS repo    5
 * ```
 *
 * **24 of 30 merges passed a required review gate that reviewed nothing.** A
 * second repository sampled `success` on 50 of 50 and contributed a fourth
 * string, `Review skipped: NNN files exceed the limit of NNN`.
 *
 * ## Allowlist of ONE, fail closed
 *
 * Only a description the project declared as its reviewed-when phrase counts as
 * evidence a review happened. Anything else — throttled, skipped, absent,
 * empty, or a string nobody has seen before — means NOT REVIEWED.
 *
 * A denylist of known-bad phrases fails OPEN, and the vocabulary is open-ended:
 * four distinct strings are known already, from two repositories, and the vendor
 * decorates them at will. An unrecognised string must cost an extra local
 * review, never a free pass. `EVIDENCE_DEFAULTS.no_work` is therefore consulted
 * ONLY to word the explanation, and never to reach the verdict.
 *
 * ## The rollup cannot see this
 *
 * `gh pr view --json statusCheckRollup` returns a `StatusContext` entry with NO
 * `description` key at all — verified:
 *
 * ```json
 * {"__typename":"StatusContext","context":"…","state":"SUCCESS","targetUrl":""}
 * ```
 *
 * Hollow green is invisible there. The evidence read MUST come from
 * `repos/{owner}/{repo}/commits/{sha}/status` and use `.statuses[].description`.
 *
 * ## Two representations, one question (#4553)
 *
 * The same reviewer can move from statuses to check runs without notice.
 * Measured on this repository's last 30 merged pull requests: the 18 up to
 * 2026-10-26 carry a `CodeRabbit` commit status and no check run, and the 12
 * from 2026-10-27 carry a `CodeRabbit` check run and no status. A reader of
 * statuses alone reported `absent` at every one of those 12 heads — including
 * one the reviewer had approved — so every pull request needed a hand-written
 * substitute review.
 *
 * Both are read now, and statuses exactly as before. A check run is the
 * reviewer's evidence only when it carries the declared context as its name,
 * was reported for this exact head, and — when the gate pins `posted_by` — was
 * posted by that app; an unpinned gate accepts any app, which is GitHub's own
 * meaning of an unpinned required check. When such a run exists it is
 * authoritative over a status of the same name, and the newest run wins.
 *
 * Those two rules and the decoding below are the ones
 * `check-skipped-required-checks.mjs` applies (#4547). Four differences are
 * deliberate. The first three only keep a reviewer's real evidence from being
 * hidden; the fourth follows from the two provers reading different
 * declarations:
 *
 *  - a run from an app other than the pinned `posted_by` is set aside BEFORE
 *    the newest run is chosen, so another app's later run under the
 *    reviewer's name cannot shadow the reviewer's own (that prover reads no
 *    app at all);
 *  - when the check-run read fails, the reviewer's own status still counts,
 *    so a host whose token cannot read check runs keeps reading statuses
 *    exactly as before (that prover refuses the whole read);
 *  - a phrase is compared under this prover's existing normalisation — whole
 *    string, case-insensitive, whitespace-collapsed — as statuses always were;
 *  - the words that are denied first are Lisa's shipped no-work phrases, while
 *    that prover also denies phrases its own declaration configures
 *    (`no_work`, `waive`). A phrase only configured there is never one
 *    this prover's allowlist declares as proof unless a project declares the
 *    same words as both, which no shipped configuration does.
 *
 * A check run's title is often generic (`Finished`), so its result is read from
 * the FIRST line of its summary, exactly as #4547 reads it. Only
 * `Result: Success - Review completed`, on a run that completed with `success`,
 * stands for the proof phrase `Review completed`; every other result-shaped
 * first line stays authoritative, so a negative result can never fall back to a
 * positive title. Later lines, a generic title, and `success` alone grant
 * nothing — and a run that did not succeed grants nothing whatever it says.
 *
 * ## A review OBJECT is not a status CONTEXT
 *
 * An empty-bodied `APPROVED` review is an ordinary human approval, not hollow.
 * Empty-body reasoning belongs to status descriptions and must never leak onto
 * review objects — `classifyReviewObject` exists to keep the two apart. A
 * `CHANGES_REQUESTED` is a blocking objection whatever its body, because its
 * content commonly lives entirely in inline threads.
 *
 * ## Never re-request a review to refresh it
 *
 * Re-requesting OVERWRITES the existing status rather than adding to it. Under
 * a throttle that destroys a real review, one-way. Nothing here posts a review
 * request, and nothing downstream should add one.
 *
 * ## No reviewer configured is a FIRST-CLASS state
 *
 * Not every project uses a third-party reviewer. An absent or empty reviewer
 * list is a no-op that SAYS it is a no-op. A silent pass is the exact defect
 * this module exists to end, so it is not reproduced here.
 *
 * CLI:
 *   node scripts/check-third-party-review-evidence.mjs --sha <sha> [--json]
 *     [--context <context>] [--root <dir>] [--repo <owner/repo>]
 *
 * `--context` names the status context or check-run name that woke the run.
 * When it is given and belongs to no declared reviewer, the run is an explicit
 * no-op: a status or check run from some other app cannot change this answer,
 * and evaluating on one would report a reviewer as absent merely because it had
 * not posted yet.
 *
 * @module scripts/check-third-party-review-evidence
 */
import { boundedExecFileSync } from "./lib/bounded-spawn.mjs";
import { invokedAsScript } from "./lib/invoked-as-script.mjs";
import { EVIDENCE_DEFAULTS, PULL_REQUEST, readGates } from "./lisa-gates.mjs";

/** How a reviewer's evidence at one commit reads. */
export const EVIDENCE_READINGS = Object.freeze({
  /** The description matched a declared reviewed-when phrase. */
  reviewed: "reviewed",
  /** No status and no check run for this context on the commit at all. */
  absent: "absent",
  /** A status with no description, or only whitespace. */
  empty: "empty",
  /** A description the vendor uses to say it did no work. */
  noWork: "no-work",
  /** A description in no declared list. Fails closed, deliberately. */
  unrecognised: "unrecognised",
  /** The reviewer has started and has not answered yet. Not an answer either way. */
  pending: "pending",
  /** The reviewer's check run finished with a conclusion other than success. */
  unsuccessful: "unsuccessful",
  /** A read this answer depends on failed, so nothing could be seen. */
  unreadable: "unreadable",
});

/** Which representation a reading's evidence came from. */
export const EVIDENCE_SOURCES = Object.freeze({
  /** `repos/{repo}/commits/{sha}/status`. */
  status: "status",
  /** `repos/{repo}/commits/{sha}/check-runs`. */
  checkRun: "check-run",
});

/** What the whole evaluation concluded. */
export const EVIDENCE_OUTCOMES = Object.freeze({
  /** No gate declares a third-party reviewer. An explicit no-op. */
  noReviewerConfigured: "no-reviewer-configured",
  /** The commit is nobody's pull request head. Nothing to review here. */
  notAPullRequestHead: "not-a-pull-request-head",
  /** The pull requests could not be read. Nothing establishes head membership. */
  pullRequestsUnreadable: "pull-requests-unreadable",
  /** The triggering status belongs to no declared reviewer. An explicit no-op. */
  notAConfiguredReviewer: "not-a-configured-reviewer",
  /** A declared reviewer is still working. Not an answer, so not a verdict. */
  pending: "pending",
  /** Every declared reviewer showed real evidence. */
  satisfied: "satisfied",
  /** A reviewer showed none, and a posted substitute stands in its place. */
  substituted: "substituted",
  /** A reviewer showed none, and nothing stands in its place. */
  unsatisfied: "unsatisfied",
});

/** How a review OBJECT reads. Never described in status-description terms. */
export const REVIEW_OBJECT_VERDICTS = Object.freeze({
  approval: "approval",
  objection: "objection",
  comment: "comment",
});

/**
 * What each reading means, in a sentence an operator can act on.
 *
 * REPORT THE OBSERVATION, NEVER A GUESS AT THE CAUSE. Several different causes
 * produce the same reading and are indistinguishable from outside the vendor: a
 * quota throttle, a per-repository decline, and auto-review being disabled for
 * pull requests whose BASE IS NOT THE DEFAULT BRANCH all end with no evidence at
 * the head. The last of those is permanent rather than transient for the pull
 * requests it affects — a consumer targeting an integration branch would never
 * be reviewed — and it looks identical to the healthy case from here.
 *
 * The allowlist already handles all of them correctly, because none of them
 * produces a declared proof phrase, so NONE gets a special case. What the
 * operator needs is the observation stated precisely enough that they are not
 * left guessing between throttle, decline, and never-configured.
 */
export const READING_SENTENCES = Object.freeze({
  [EVIDENCE_READINGS.reviewed]:
    "the reviewer reported a description this project declares as proof it read the code",
  [EVIDENCE_READINGS.absent]:
    "no third-party status was present at this head at all — nothing from that reviewer, of any state, as a commit status or as a check run",
  [EVIDENCE_READINGS.empty]:
    "the reviewer posted a status carrying no description, so nothing says whether it read anything",
  [EVIDENCE_READINGS.noWork]:
    "the reviewer said in its own words that it did no work",
  [EVIDENCE_READINGS.unrecognised]:
    "the reviewer reported a description this project does not declare as proof, and which nothing here recognises",
  [EVIDENCE_READINGS.pending]:
    "the reviewer has started and has not answered yet",
  [EVIDENCE_READINGS.unsuccessful]:
    "the reviewer's check run finished without success, so nothing it reported counts as proof it read the code",
  [EVIDENCE_READINGS.unreadable]:
    "the reviewer's statuses or check runs at this head could not be read, so nothing here can say whether it reviewed",
});

/**
 * The marker a posted substitute review carries.
 *
 * An HTML comment so it renders as nothing, and machine-readable so CI can find
 * it without parsing prose. One marker per reviewer per head commit: evidence
 * for one reviewer never satisfies another, and a substitute written for an
 * earlier head says nothing about the code at this one.
 */
export const SUBSTITUTE_MARKER = "lisa:review-substitute";

/**
 * Normalise a description for whole-string comparison.
 *
 * Whole-string, case-insensitive, whitespace-collapsed. Never a substring: a
 * substring match GRANTS credit here, and `Review skipped` contains `review`.
 * @param {string|undefined|null} description - A status description.
 * @returns {string} The normalised form, or the empty string.
 */
export function normalizeDescription(description) {
  return String(description ?? "")
    .trim()
    .replace(/\s+/gu, " ")
    .toLowerCase();
}

/**
 * The third-party reviewers a project declares, in gate-id order.
 *
 * A reviewer is a gate that (a) awaits a status context and (b) marks that
 * awaited signal `evidence.reviewer: true`. Several gates may do so, and each
 * one must then show its own evidence — one reviewer's proof never covers
 * another's silence.
 *
 * The reviewed-when allowlist is the gate's merged `evidence.proof`: Lisa's
 * shipped phrases plus whatever the project adds. Extension, never replacement,
 * for the reason `mergeEvidence` records.
 *
 * `postedBy` is the gate's `posted_by` — the app a check run must come from to
 * speak for this reviewer — exactly as declared, and absent when the gate omits
 * it, which is unpinned. Any declared value is carried as written, so a
 * malformed pin such as `null` or a string id matches no app rather than
 * widening to every app; `validateGates` refuses it separately.
 * @param {object} options - Resolution inputs.
 * @param {object} options.gates - The `gates` block of `.lisa.config.json`.
 * @param {string} [options.moment] - Which moment to read. Defaults to the pull-request moment.
 * @returns {Array<{gateId: string, context: string, proof: string[], postedBy?: unknown}>} Declared reviewers.
 */
export function configuredReviewers({ gates, moment = PULL_REQUEST }) {
  const reviewers = [];
  for (const [gateId, gate] of Object.entries(gates ?? {})) {
    if (!gate || typeof gate !== "object" || Array.isArray(gate)) continue;
    const entry = gate[moment];
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    if (entry.evidence?.reviewer !== true) continue;
    if (typeof entry.await !== "string" || entry.await.trim() === "") continue;
    reviewers.push({
      gateId,
      context: entry.await,
      proof: [...EVIDENCE_DEFAULTS.proof, ...(entry.evidence.proof ?? [])].map(
        normalizeDescription
      ),
      ...(entry.posted_by === undefined ? {} : { postedBy: entry.posted_by }),
    });
  }
  return reviewers.sort((left, right) =>
    left.gateId.localeCompare(right.gateId)
  );
}

/**
 * Whether a description reads as the vendor saying it did no work.
 *
 * It NEVER GRANTS credit — the verdict is settled by the allowlist above. For
 * a status it only chooses between two ways of saying "not reviewed", so an
 * operator can tell a known vendor state from a string nobody has seen. For a
 * check run it also decides which of the run's words are read, denial first,
 * exactly as #4547 decodes a run: a no-work title or first line is read in
 * place of the structured result. That can only withhold credit. Wiring it in
 * anywhere it could grant credit would turn the allowlist back into a
 * denylist, which is the fail-open shape this module refuses.
 * @param {string} normalised - An already-normalised description.
 * @returns {boolean} Whether a shipped no-work phrase appears in it.
 */
function readsAsNoWork(normalised) {
  return EVIDENCE_DEFAULTS.no_work.some(phrase =>
    normalised.includes(normalizeDescription(phrase))
  );
}

/**
 * @typedef {object} ReviewerShape
 * @property {string} context - The status context or check-run name it reports under.
 * @property {string[]} proof - The normalised reviewed-when allowlist.
 * @property {unknown} [postedBy] - The app id a check run must come from, exactly as declared; absent for any app.
 */

/**
 * One row of `.check_runs` from `repos/{repo}/commits/{sha}/check-runs`, as the
 * API returns it. Every field is untrusted until read here.
 * @typedef {object} RawCheckRun
 * @property {unknown} [id] - The run id, which GitHub assigns in creation order.
 * @property {unknown} [name] - The check-run name; a reviewer's is its declared context.
 * @property {unknown} [head_sha] - The commit the run reports on.
 * @property {unknown} [status] - `queued`, `in_progress`, `completed`, ...
 * @property {unknown} [conclusion] - Set once completed: `success`, `neutral`, ...
 * @property {unknown} [created_at] - Absent from the API object; honoured if a source supplies it.
 * @property {{id?: unknown}|null} [app] - The app that posted the run.
 * @property {{title?: unknown, summary?: unknown}|null} [output] - What the run reported.
 */

/**
 * @typedef {object} EvidenceReading
 * @property {string} context - The reviewer's context.
 * @property {boolean} reviewed - Whether this is evidence the reviewer read the code.
 * @property {string} reading - One of {@link EVIDENCE_READINGS}.
 * @property {string|null} observed - The words that decided, verbatim.
 * @property {string|null} state - A status's state, or a check run's conclusion or lifecycle.
 * @property {string|null} source - One of {@link EVIDENCE_SOURCES}, or null when nothing was found.
 * @property {unknown} [checkRunId] - The run that decided, for a check-run reading.
 * @property {Array<{id: unknown, reason: string}>} ignoredCheckRuns - Runs under the reviewer's name that could not speak for it, and why.
 */

/**
 * The one structured first line that says a review completed.
 *
 * Byte-identical to the line `check-skipped-required-checks.mjs` recognises
 * (#4547), and matched the same way: exactly, as the first physical line, on a
 * run that completed with `success`. Duplicated rather than imported because
 * the two scripts ship from different template trees and a host that has this
 * one need not have that one; `tests/integration/third-party-review-check-run-cli`
 * holds both provers to the same answers.
 */
export const COMPLETED_REVIEW_RESULT = "Result: Success - Review completed";

/** The proof phrase that line stands for. */
const COMPLETED_REVIEW_PROOF = "Review completed";

/** What a summary that is present but not text is reported as. */
const MALFORMED_SUMMARY = "Malformed check-run summary";

/** Check-run lifecycle values that mean the reviewer has not answered yet. */
const UNSETTLED_RUN_STATUSES = new Set([
  "queued",
  "in_progress",
  "requested",
  "waiting",
  "pending",
]);

/**
 * Read one reviewer's evidence off the statuses on a commit.
 *
 * The verdict is `reviewed` only when the description matches a declared
 * reviewed-when phrase exactly. Every other shape — absent, empty, a known
 * no-work phrase, or an unrecognised string — is NOT REVIEWED, and the observed
 * string is carried back verbatim so the report can say what was actually seen.
 * @param {object} options - Reading inputs.
 * @param {ReviewerShape} options.reviewer - One declared reviewer.
 * @param {ReadonlyArray<{context?: string, state?: string, description?: string}>} options.statuses -
 *   `.statuses` from `repos/{owner}/{repo}/commits/{sha}/status`, newest first.
 * @returns {Omit<EvidenceReading, "ignoredCheckRuns">} The reading.
 */
function readStatusEvidence({ reviewer, statuses }) {
  const found = statuses.find(status => status?.context === reviewer.context);
  if (found === undefined) {
    return {
      context: reviewer.context,
      reviewed: false,
      reading: EVIDENCE_READINGS.absent,
      observed: null,
      state: null,
      source: null,
    };
  }
  const observed = found.description ?? null;
  const normalised = normalizeDescription(observed);
  const state = found.state ?? null;
  const answer = (
    /** @type {string} */ kind,
    /** @type {boolean} */ reviewed = false
  ) => ({
    context: reviewer.context,
    reviewed,
    reading: kind,
    observed,
    state,
    source: EVIDENCE_SOURCES.status,
  });
  // A reviewer posts several statuses on one head before the settled one —
  // measured `Review queued` then `Review in progress` then the verdict. Judging
  // an unsettled one would report a finding on every pull request, and a guard
  // that fires every time gets deleted rather than read.
  if (String(state).toLowerCase() === "pending") {
    return answer(EVIDENCE_READINGS.pending);
  }
  if (normalised === "") return answer(EVIDENCE_READINGS.empty);
  if (reviewer.proof.includes(normalised)) {
    return answer(EVIDENCE_READINGS.reviewed, true);
  }
  return answer(
    readsAsNoWork(normalised)
      ? EVIDENCE_READINGS.noWork
      : EVIDENCE_READINGS.unrecognised
  );
}

/**
 * Whether a line is shaped like a structured result, however it is decorated.
 *
 * The same two tests `check-skipped-required-checks.mjs` applies. Such a line is
 * authoritative even when it is not the one positive form, which is what stops
 * a negative or malformed result from falling back to a positive title.
 * @param {string} line - A first summary line.
 * @returns {boolean} True for anything that reads as a result line.
 */
function looksLikeResult(line) {
  return /^[\s>#|]*Result\b/iu.test(line) || /\bResult\s*[:=-]/iu.test(line);
}

/**
 * What a check run says, in the place a status carries its description.
 *
 * The decoding #4547 shipped for the registration prover, applied unchanged:
 *
 *  1. A title that reads as no-work decides first — a denial is never
 *     overridden by later text.
 *  2. No summary keeps the title, the representation's own description slot.
 *  3. A summary that is not text is never read: it stands for no phrase, and
 *     the report carries the value it actually was.
 *  4. A first summary line that reads as no-work decides next.
 *  5. `Result: Success - Review completed`, as the whole first line of a run
 *     that completed with `success`, stands for the proof phrase
 *     `Review completed`. This is the ONLY route from a summary to credit.
 *  6. Any other result-shaped first line is authoritative as it stands, so a
 *     failed or unknown result cannot inherit a positive title.
 *  7. A plain first line keeps the title, and later lines are never read.
 *
 * `text` is what decided, verbatim, for the report; `canonical` is what the
 * allowlist compares. They differ only in rules 3 and 5.
 * @param {RawCheckRun} run - One raw check run.
 * @returns {{text: string, canonical: string}} The run's words.
 */
export function checkRunResult(run) {
  const output = run?.output ?? {};
  const title = typeof output.title === "string" ? output.title : "";
  const said = (/** @type {string} */ text) => ({ text, canonical: text });
  if (readsAsNoWork(normalizeDescription(title))) return said(title);
  const summary = output.summary;
  if (summary === null || summary === undefined) return said(title);
  if (typeof summary !== "string") {
    return { text: JSON.stringify(summary), canonical: MALFORMED_SUMMARY };
  }
  const firstLine = summary.split(/\r?\n/u, 1)[0] ?? "";
  if (readsAsNoWork(normalizeDescription(firstLine))) return said(firstLine);
  if (
    run?.status === "completed" &&
    run?.conclusion === "success" &&
    firstLine === COMPLETED_REVIEW_RESULT
  ) {
    return { text: firstLine, canonical: COMPLETED_REVIEW_PROOF };
  }
  if (looksLikeResult(firstLine)) return said(firstLine);
  return said(title);
}

/**
 * Order two runs by creation, newest last.
 *
 * Creation time first and id second, as `newestCheckRuns` in
 * `check-skipped-required-checks.mjs` orders them. The API object carries no
 * `created_at` — measured — so in practice the id decides, and GitHub assigns
 * ids in creation order.
 * @param {RawCheckRun} run - One run.
 * @returns {[number, number]} Its creation time and id, zero when unknown.
 */
function runRank(run) {
  const created =
    typeof run.created_at === "string" ? Date.parse(run.created_at) : NaN;
  return [Number.isFinite(created) ? created : 0, Number(run.id) || 0];
}

/**
 * Why a run under the reviewer's name cannot speak for it, or null if it can.
 * @param {object} options - The run and what it must match.
 * @param {ReviewerShape} options.reviewer - One declared reviewer.
 * @param {RawCheckRun} options.run - A run carrying the reviewer's name.
 * @param {string|undefined} options.sha - The head commit.
 * @returns {string|null} The reason, or null when the run is the reviewer's.
 */
function whyNotTheReviewers({ reviewer, run, sha }) {
  if (typeof sha !== "string" || run.head_sha !== sha) {
    return `reported for head ${JSON.stringify(run.head_sha ?? null)}, not ${JSON.stringify(sha ?? null)}`;
  }
  // Absent means unpinned. Anything declared — a malformed `null` included —
  // must match exactly, so a broken pin narrows to no app instead of widening
  // to every app.
  const pin = reviewer.postedBy;
  if (pin !== undefined && run.app?.id !== pin) {
    return `posted by app ${JSON.stringify(run.app?.id ?? null)}, not the declared ${JSON.stringify(pin)}`;
  }
  return null;
}

/**
 * The check run that speaks for one reviewer at one head, if any.
 *
 * A run counts only when it carries the reviewer's context as its name, was
 * reported for this exact head, and — when the gate pins `posted_by` — came
 * from that app. Anything else under the reviewer's name is set aside WITH its
 * reason rather than dropped in silence: a run another app posted under the
 * reviewer's name is the case an operator most needs explained. Of the runs
 * that count, the newest decides.
 * @param {object} options - Selection inputs.
 * @param {ReviewerShape} options.reviewer - One declared reviewer.
 * @param {ReadonlyArray<RawCheckRun>|null|undefined} options.runs - Runs read for its name; null when the read failed.
 * @param {string|undefined} options.sha - The head commit.
 * @returns {{run: RawCheckRun|null, ignored: Array<{id: unknown, reason: string}>}} The run, and those set aside.
 */
export function selectReviewerCheckRun({ reviewer, runs, sha }) {
  /** @type {Array<{id: unknown, reason: string}>} */
  const ignored = [];
  /** @type {RawCheckRun|null} */
  let selected = null;
  for (const run of Array.isArray(runs) ? runs : []) {
    if (run?.name !== reviewer.context) continue;
    const reason = whyNotTheReviewers({ reviewer, run, sha });
    if (reason !== null) {
      ignored.push({ id: run.id ?? null, reason });
      continue;
    }
    if (selected === null) {
      selected = run;
      continue;
    }
    const [time, id] = runRank(run);
    const [selectedTime, selectedId] = runRank(selected);
    if (time > selectedTime || (time === selectedTime && id > selectedId)) {
      selected = run;
    }
  }
  return { run: selected, ignored };
}

/**
 * Read one reviewer's evidence off the check run that speaks for it.
 *
 * Credit needs all three: the run completed, it concluded `success`, and what
 * it said is a declared reviewed-when phrase. A run that has not finished is
 * pending — not an answer either way — and one that finished any other way
 * grants nothing, whatever its words.
 *
 * The lifecycle and conclusion are compared exactly as GitHub sends them,
 * lowercase, the way the registration prover compares them. A value in any
 * other spelling is not one GitHub defines, so it is read as unknown rather
 * than folded into one that grants credit.
 * @param {object} options - Reading inputs.
 * @param {ReviewerShape} options.reviewer - One declared reviewer.
 * @param {RawCheckRun} options.run - The run selected for it.
 * @returns {Omit<EvidenceReading, "ignoredCheckRuns">} The reading.
 */
function readCheckRunEvidence({ reviewer, run }) {
  const status = typeof run.status === "string" ? run.status : "";
  const conclusion = typeof run.conclusion === "string" ? run.conclusion : null;
  const { text, canonical } = checkRunResult(run);
  const settled = status === "completed";
  const normalised = normalizeDescription(text);
  let reading = EVIDENCE_READINGS.unrecognised;
  if (UNSETTLED_RUN_STATUSES.has(status)) {
    reading = EVIDENCE_READINGS.pending;
  } else if (!settled) {
    reading = EVIDENCE_READINGS.unrecognised;
  } else if (
    conclusion === "success" &&
    reviewer.proof.includes(normalizeDescription(canonical))
  ) {
    reading = EVIDENCE_READINGS.reviewed;
  } else if (readsAsNoWork(normalised)) {
    reading = EVIDENCE_READINGS.noWork;
  } else if (conclusion !== "success") {
    reading = EVIDENCE_READINGS.unsuccessful;
  } else if (normalised === "") {
    reading = EVIDENCE_READINGS.empty;
  }
  return {
    context: reviewer.context,
    reviewed: reading === EVIDENCE_READINGS.reviewed,
    reading,
    observed: text,
    state: settled ? (conclusion ?? status) : status || null,
    source: EVIDENCE_SOURCES.checkRun,
    checkRunId: run.id ?? null,
  };
}

/**
 * Read one reviewer's evidence at one commit, from both representations.
 *
 * A check run that speaks for the reviewer is authoritative; otherwise its
 * status is read exactly as before. A read that failed is never reported as
 * an absence: when nothing stands and a read this answer depended on failed,
 * the reading is `unreadable`, because "nothing was there" and "nothing could
 * be seen" call for different operator actions. A failed check-run read never
 * takes away a status's credit — reviewers that still post statuses keep
 * reading exactly as they did.
 * @param {object} options - Reading inputs.
 * @param {ReviewerShape} options.reviewer - One declared reviewer.
 * @param {ReadonlyArray<{context?: string, state?: string, description?: string}>|null} [options.statuses] -
 *   `.statuses` from `repos/{owner}/{repo}/commits/{sha}/status`, newest first; null when the read failed.
 * @param {ReadonlyArray<RawCheckRun>|null} [options.checkRuns] - Runs read for the reviewer's name; null when the read failed, absent when none were read.
 * @param {string} [options.sha] - The head commit, which every check run must report on.
 * @returns {EvidenceReading} The reading.
 */
export function readReviewerEvidence({ reviewer, statuses, checkRuns, sha }) {
  const { run, ignored } = selectReviewerCheckRun({
    reviewer,
    runs: checkRuns,
    sha,
  });
  if (run !== null) {
    return {
      ...readCheckRunEvidence({ reviewer, run }),
      ignoredCheckRuns: ignored,
    };
  }
  const fromStatus = readStatusEvidence({ reviewer, statuses: statuses ?? [] });
  const unreadable =
    fromStatus.reading === EVIDENCE_READINGS.absent &&
    (checkRuns === null || statuses === null);
  return {
    ...fromStatus,
    ...(unreadable ? { reading: EVIDENCE_READINGS.unreadable } : {}),
    ignoredCheckRuns: ignored,
  };
}

/**
 * The marker line a substitute review carries for one reviewer at one commit.
 * @param {object} options - Marker inputs.
 * @param {string} options.context - The reviewer's status context.
 * @param {string} options.sha - The head commit the substitute reviewed.
 * @returns {string} The HTML-comment marker.
 */
export function substituteMarker({ context, sha }) {
  return `<!-- ${SUBSTITUTE_MARKER} context="${context}" head="${sha}" -->`;
}

/**
 * Whether a substitute review was posted for this reviewer at this commit.
 *
 * Both halves must match. A substitute posted for a different reviewer says
 * nothing about this one, and one posted against an earlier head reviewed code
 * that is no longer what would merge — review evidence decays on every push.
 * @param {object} options - Search inputs.
 * @param {ReadonlyArray<{body?: string}>} options.comments - Issue comments on the pull request.
 * @param {string} options.context - The reviewer's status context.
 * @param {string} options.sha - The head commit.
 * @returns {boolean} Whether a matching substitute exists.
 */
export function substitutePosted({ comments, context, sha }) {
  const marker = substituteMarker({ context, sha });
  return (comments ?? []).some(comment =>
    String(comment?.body ?? "").includes(marker)
  );
}

/**
 * Classify a review OBJECT — never a status description.
 *
 * Deliberately separate from everything above, and deliberately blind to body
 * emptiness. An empty-bodied `APPROVED` is a normal human approval; treating it
 * as hollow because the status-description logic treats an empty description as
 * hollow would reject real approvals. A `CHANGES_REQUESTED` is a blocking
 * objection whatever its body, because its content commonly lives entirely in
 * inline threads rather than the review body.
 * @param {{state?: string}} review - One review object.
 * @returns {string} One of {@link REVIEW_OBJECT_VERDICTS}.
 */
export function classifyReviewObject(review) {
  const state = String(review?.state ?? "").toUpperCase();
  if (state === "CHANGES_REQUESTED") return REVIEW_OBJECT_VERDICTS.objection;
  if (state === "APPROVED") return REVIEW_OBJECT_VERDICTS.approval;
  return REVIEW_OBJECT_VERDICTS.comment;
}

/**
 * The review objects that actually looked at this commit.
 *
 * Filtered on `commit_id`, and the filter has to run in BOTH directions —
 * writing it for one is the easy bug:
 *
 *  - a stale `APPROVED` from an older commit reads as fresh approval of code it
 *    never saw;
 *  - a stale `CHANGES_REQUESTED` reads as a current objection and blocks work a
 *    newer head already fixed.
 *
 * Neither direction is the safe one to leave out. A review whose `commit_id` is
 * missing is dropped too: unknown is not "at this head", and admitting it would
 * reinstate whichever of the two staleness bugs its state happens to cause.
 * @param {ReadonlyArray<{commit_id?: string}>} reviews - Review objects from the reviews API.
 * @param {string} sha - The head commit.
 * @returns {ReadonlyArray<object>} Only the reviews submitted against `sha`.
 */
export function reviewsAtHead(reviews, sha) {
  return (reviews ?? []).filter(review => review?.commit_id === sha);
}

/**
 * What the review objects at this head say, approvals and objections apart.
 *
 * ## "No review object" and "unreviewed" are different propositions
 *
 * Conflating them is a measured incident, not a hypothetical: a lane counted the
 * absence of a THIRD-PARTY review object across 15 pull requests, read it as
 * "12 of 15 have no approving review", and froze merging fleet-wide. A pull
 * request carrying a genuine human approval and no third-party object is
 * reviewed. So this function answers only "what did the reviews at this head
 * say", and says nothing at all about third-party status evidence — which is
 * `reviewEvidenceVerdict`'s separate question, over a separate data source.
 * @param {object} options - Standing inputs.
 * @param {ReadonlyArray<object>} options.reviews - Review objects from the reviews API.
 * @param {string} options.sha - The head commit.
 * @returns {{approvals: number, objections: number, staleDropped: number}} The standing at head.
 */
export function reviewStanding({ reviews, sha }) {
  const atHead = reviewsAtHead(reviews, sha);
  const verdicts = atHead.map(classifyReviewObject);
  return {
    approvals: verdicts.filter(
      verdict => verdict === REVIEW_OBJECT_VERDICTS.approval
    ).length,
    objections: verdicts.filter(
      verdict => verdict === REVIEW_OBJECT_VERDICTS.objection
    ).length,
    staleDropped: (reviews ?? []).length - atHead.length,
  };
}

/**
 * Decide the whole question for one commit.
 *
 * A no-op is not a pass. `no-reviewer-configured` means
 * this project declared no third-party reviewer, which is a legitimate state
 * that must be SAID rather than passed through in silence.
 * @param {object} options - Decision inputs.
 * @param {Array<{gateId: string, context: string, proof: string[], postedBy?: unknown}>} options.reviewers - Declared reviewers.
 * @param {ReadonlyArray<object>|null} options.statuses - Statuses on the head commit; null when the read failed.
 * @param {Record<string, ReadonlyArray<RawCheckRun>|null>} [options.checkRuns] -
 *   Check runs read for each reviewer's context, keyed by that context; a null
 *   entry is a read that failed, and a missing key is a reviewer whose runs
 *   were not read.
 * @param {ReadonlyArray<{body?: string}>} options.comments - Issue comments on the pull request.
 * @param {string} options.sha - The head commit.
 * @param {boolean|null} [options.isPullRequestHead] - Whether an open pull request has this commit as its head; null when the read failed.
 * @returns {{outcome: string, sha: string, readings: Array<EvidenceReading & {gateId: string, substituted: boolean}>}} The verdict.
 */
export function reviewEvidenceVerdict({
  reviewers,
  statuses,
  checkRuns,
  comments,
  sha,
  isPullRequestHead = true,
}) {
  if ((reviewers ?? []).length === 0) {
    return {
      outcome: EVIDENCE_OUTCOMES.noReviewerConfigured,
      sha,
      readings: [],
    };
  }
  if (isPullRequestHead === null) {
    return {
      outcome: EVIDENCE_OUTCOMES.pullRequestsUnreadable,
      sha,
      readings: [],
    };
  }
  if (!isPullRequestHead) {
    return {
      outcome: EVIDENCE_OUTCOMES.notAPullRequestHead,
      sha,
      readings: [],
    };
  }
  const readings = reviewers.map(reviewer => {
    const reading = readReviewerEvidence({
      reviewer,
      statuses,
      checkRuns:
        checkRuns && Object.hasOwn(checkRuns, reviewer.context)
          ? checkRuns[reviewer.context]
          : undefined,
      sha,
    });
    return {
      ...reading,
      gateId: reviewer.gateId,
      substituted:
        !reading.reviewed &&
        substitutePosted({ comments, context: reviewer.context, sha }),
    };
  });
  if (readings.every(reading => reading.reviewed)) {
    return { outcome: EVIDENCE_OUTCOMES.satisfied, sha, readings };
  }
  // Deferred, not passed. The settled status fires its own event, and the
  // pull-request-event arm of this pair is what catches a reviewer that never
  // settles at all — one covers hollowness, the other covers silence.
  if (
    readings.some(
      reading =>
        reading.reading === EVIDENCE_READINGS.pending && !reading.substituted
    )
  ) {
    return { outcome: EVIDENCE_OUTCOMES.pending, sha, readings };
  }
  if (readings.every(reading => reading.reviewed || reading.substituted)) {
    return { outcome: EVIDENCE_OUTCOMES.substituted, sha, readings };
  }
  return { outcome: EVIDENCE_OUTCOMES.unsatisfied, sha, readings };
}

/**
 * A reading as the report prints it.
 * @typedef {object} ReportedReading
 * @property {string} context - The reviewer's context.
 * @property {boolean} reviewed - Whether it is evidence of a review.
 * @property {string} reading - One of {@link EVIDENCE_READINGS}.
 * @property {string|null} observed - The words that decided, verbatim.
 * @property {string|null} state - The state, conclusion or lifecycle seen.
 * @property {string|null} [source] - One of {@link EVIDENCE_SOURCES}.
 * @property {boolean} [substituted] - Whether a substitute stands in.
 * @property {Array<{id: unknown, reason: string}>} [ignoredCheckRuns] - Runs set aside, and why.
 */

/**
 * One operator-readable line per reviewer, plus the headline.
 * @param {{outcome: string, sha: string, readings: ReadonlyArray<ReportedReading>}} verdict - A verdict.
 * @returns {string} The report.
 */
export function humanReport(verdict) {
  if (verdict.outcome === EVIDENCE_OUTCOMES.noReviewerConfigured) {
    return (
      `NO-OP — no third-party reviewer is configured.\n` +
      `No gate in .lisa.config.json declares evidence.reviewer at the ` +
      `pull-request moment, so there is no third-party review for this commit ` +
      `to be missing. This is a no-op, NOT a pass: nothing was read, and ` +
      `nothing here asserts the code was reviewed.`
    );
  }
  if (verdict.outcome === EVIDENCE_OUTCOMES.notAConfiguredReviewer) {
    return (
      `NO-OP — the triggering status or check run belongs to no declared reviewer.\n` +
      `Reviewers ARE configured; this one is not one of theirs, so it ` +
      `cannot change the answer. This is a no-op, NOT a pass.`
    );
  }
  if (verdict.outcome === EVIDENCE_OUTCOMES.pullRequestsUnreadable) {
    return (
      `UNREADABLE — the open pull requests for ${verdict.sha} could not be read, ` +
      `so nothing here can say whether it is a pull request head. ` +
      `This is NOT a no-op.`
    );
  }
  if (verdict.outcome === EVIDENCE_OUTCOMES.notAPullRequestHead) {
    return (
      `NO-OP — ${verdict.sha} is not the head of any open pull request.\n` +
      `A reviewer IS configured; this commit is simply not the thing that ` +
      `would merge. This is a no-op, NOT a pass.`
    );
  }
  const lines = verdict.readings.map(reading => {
    const seen = describeSeen(reading);
    const ignored = (reading.ignoredCheckRuns ?? []).map(
      entry => `    ignored check run ${String(entry.id)}: ${entry.reason}`
    );
    if (reading.reviewed) {
      return [`  reviewed     ${reading.context}: ${seen}`, ...ignored].join(
        "\n"
      );
    }
    const stood = reading.substituted
      ? "a local adversarial review was posted in its place"
      : "NOTHING stands in its place";
    return [
      `  NOT REVIEWED ${reading.context} (${reading.reading}): ${seen}`,
      `    observed: ${READING_SENTENCES[reading.reading]}`,
      `    ${stood}`,
      ...ignored,
    ].join("\n");
  });
  return `${verdict.outcome.toUpperCase()} at ${verdict.sha}\n${lines.join("\n")}`;
}

/**
 * What was seen for one reviewer, in the words the report prints.
 *
 * A reading without a `source` — one built before check runs were read — is
 * placed by whether it observed anything, which is how it was always printed.
 * @param {{reading: string, observed: string|null, state: string|null, source?: string|null}} reading - One reading.
 * @returns {string} The observation.
 */
function describeSeen(reading) {
  if (reading.reading === EVIDENCE_READINGS.unreadable) {
    return "its statuses or check runs could not be read";
  }
  const source =
    reading.source ??
    (reading.observed === null ? null : EVIDENCE_SOURCES.status);
  const words = `${reading.state ?? "?"} — ${JSON.stringify(reading.observed)}`;
  if (source === EVIDENCE_SOURCES.checkRun) return `check run ${words}`;
  if (source === EVIDENCE_SOURCES.status) return words;
  return "no status or check run posted";
}

/**
 * Parse the CLI arguments.
 * @param {string[]} argv - Arguments after the script path.
 * @returns {{sha: string|null, context: string|null, root: string, repo: string|null, json: boolean}} Options.
 */
export function parseArgs(argv) {
  const opts = {
    sha: null,
    context: null,
    root: process.cwd(),
    repo: null,
    json: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") {
      opts.json = true;
      continue;
    }
    const [flag, inline] = arg.startsWith("--") ? splitFlag(arg) : [null, null];
    if (flag === null) continue;
    let value = inline;
    if (value === null) {
      index += 1;
      value = argv[index] ?? null;
    }
    if (flag in opts) opts[flag] = value;
  }
  return opts;
}

/**
 * Split `--name=value` or `--name` into its two halves.
 * @param {string} arg - One argument.
 * @returns {[string, string|null]} The flag name and any inline value.
 */
function splitFlag(arg) {
  const body = arg.slice(2);
  const equals = body.indexOf("=");
  return equals === -1
    ? [body, null]
    : [body.slice(0, equals), body.slice(equals + 1)];
}

/**
 * One `gh api` read, parsed as JSON.
 *
 * `gh` is asked for a path rather than handed a query, and the child is bounded
 * — a guard whose child never returned would otherwise report a verdict it
 * never reached. A failed read returns `null`. A failed pull-request, status
 * or check-run read is reported as unreadable rather than as evidence of
 * anything — except that a
 * failed check-run read leaves the reviewer's own status standing, so a host
 * whose token cannot read check runs keeps reading statuses as before.
 * @param {string} path - The API path.
 * @returns {unknown} The parsed body, or null.
 */
function ghJson(path) {
  try {
    return JSON.parse(
      boundedExecFileSync("gh", ["api", path], { encoding: "utf8" })
    );
  } catch {
    return null;
  }
}

/**
 * The combined status on one commit.
 *
 * `repos/{repo}/commits/{sha}/status` and NOT `gh pr view --json
 * statusCheckRollup` — verified, the rollup returns a `StatusContext` with no
 * `description` key at all, so hollow green is invisible through it.
 * A read that failed returns null rather than an empty list, so the reading
 * can say the statuses could not be read instead of claiming there were none.
 * @param {string} repo - `owner/repo`.
 * @param {string} sha - The commit.
 * @returns {ReadonlyArray<object>|null} The statuses, newest first, or null.
 */
function readStatuses(repo, sha) {
  const body = /** @type {{statuses?: unknown}|null} */ (
    ghJson(`repos/${repo}/commits/${sha}/status`)
  );
  return Array.isArray(body?.statuses) ? body.statuses : null;
}

/**
 * The check runs on one commit that carry one reviewer's name.
 *
 * Filtered by name at the source: a head here carries around sixty check runs,
 * past the endpoint's default page of thirty, so an unfiltered first page can
 * simply not contain the reviewer's run. A response that admits to more rows
 * than it returned is incomplete, and an incomplete read is reported as a
 * failed one — the newest run could be on the page that was not read.
 * @param {string} repo - `owner/repo`.
 * @param {string} sha - The commit.
 * @param {string} context - The reviewer's declared context, which is its run name.
 * @returns {ReadonlyArray<RawCheckRun>|null} The runs, or null when they could not all be read.
 */
function readCheckRuns(repo, sha, context) {
  const body =
    /** @type {{total_count?: unknown, check_runs?: unknown}|null} */ (
      ghJson(
        `repos/${repo}/commits/${sha}/check-runs?check_name=${encodeURIComponent(context)}&per_page=100`
      )
    );
  if (!Array.isArray(body?.check_runs)) return null;
  const total = body?.total_count;
  if (typeof total === "number" && total > body.check_runs.length) return null;
  return body.check_runs;
}

/**
 * The open pull requests whose HEAD is this commit.
 *
 * Head, not "associated with". A commit that merely appears in a pull request's
 * history is not what would merge, and judging review evidence on it would
 * redden pull requests for their ancestors' statuses.
 * @param {string} repo - `owner/repo`.
 * @param {string} sha - The commit.
 * @returns {number[]|null} The pull request numbers, or null when the read failed or was not a list.
 */
function readHeadPulls(repo, sha) {
  const pulls = ghJson(`repos/${repo}/commits/${sha}/pulls`);
  if (!Array.isArray(pulls)) return null;
  return pulls
    .filter(
      pull =>
        pull?.head?.sha === sha &&
        pull?.state === "open" &&
        Number.isInteger(pull?.number)
    )
    .map(pull => pull.number);
}

/**
 * Issue comments on the given pull requests.
 * @param {string} repo - `owner/repo`.
 * @param {number[]} numbers - Pull request numbers.
 * @returns {ReadonlyArray<object>} The comments.
 */
function readComments(repo, numbers) {
  return numbers.flatMap(number => {
    const comments = ghJson(
      `repos/${repo}/issues/${number}/comments?per_page=100`
    );
    return Array.isArray(comments) ? comments : [];
  });
}

/**
 * Which check-run reader a run uses.
 *
 * A caller that injected the status reader supplies the evidence itself, so it
 * gets no check runs rather than a live read mixed into its fixture.
 * @param {{statuses?: unknown, checkRuns?: (sha: string, context: string) => ReadonlyArray<RawCheckRun>|null}} io - Injected side effects.
 * @param {string} repo - `owner/repo`.
 * @returns {(sha: string, context: string) => ReadonlyArray<RawCheckRun>|null} The reader.
 */
function checkRunReader(io, repo) {
  if (io.checkRuns) return io.checkRuns;
  if (io.statuses) return () => [];
  return (sha, context) => readCheckRuns(repo, sha, context);
}

/**
 * Which status reader a run uses — the same rule, the other way round.
 * @param {{statuses?: (sha: string) => ReadonlyArray<object>|null, checkRuns?: unknown}} io - Injected side effects.
 * @param {string} repo - `owner/repo`.
 * @returns {(sha: string) => ReadonlyArray<object>|null} The reader.
 */
function statusReader(io, repo) {
  if (io.statuses) return io.statuses;
  if (io.checkRuns) return () => [];
  return sha => readStatuses(repo, sha);
}

/**
 * Read each declared reviewer's check runs once, keyed by its context.
 *
 * Two gates may await one context; that is one read, not two.
 * @param {ReadonlyArray<{context: string}>} reviewers - Declared reviewers.
 * @param {string} sha - The head commit.
 * @param {(sha: string, context: string) => ReadonlyArray<RawCheckRun>|null} read - The reader.
 * @returns {Record<string, ReadonlyArray<RawCheckRun>|null>} Runs per context; null for a failed read.
 */
function checkRunsByContext(reviewers, sha, read) {
  /** @type {Record<string, ReadonlyArray<RawCheckRun>|null>} */
  const runs = Object.create(null);
  for (const { context } of reviewers) {
    if (Object.hasOwn(runs, context)) continue;
    runs[context] = read(sha, context);
  }
  return runs;
}

/**
 * The CLI body.
 * @param {string[]} argv - Arguments after the script path.
 * @param {object} [io] - Injected side effects, for tests.
 * @param {object} [io.gates] - The gates block, read from disk when absent.
 * @param {(sha: string) => number[]|null} [io.pulls] - Head-pull-request reader; null when the read failed.
 * @param {(sha: string) => ReadonlyArray<object>|null} [io.statuses] - Status reader.
 * @param {(sha: string, context: string) => ReadonlyArray<RawCheckRun>|null} [io.checkRuns] -
 *   Check-run reader for one reviewer's name. When a caller injects either
 *   reader and not the other, the other reads nothing: an injected reader
 *   means the caller supplies the evidence, and mixing a live read into it
 *   would judge a fixture against the network.
 * @param {(numbers: number[]) => ReadonlyArray<object>} [io.comments] - Comment reader.
 * @param {{write: (text: string) => void}} [io.out] - Stdout.
 * @param {{write: (text: string) => void}} [io.err] - Stderr.
 * @returns {number} The exit code.
 */
export function main(argv, io = {}) {
  const out = io.out ?? process.stdout;
  const err = io.err ?? process.stderr;
  const opts = parseArgs(argv);
  if (!opts.sha) {
    err.write("error: --sha <commit> is required\n");
    return 2;
  }
  const gates = io.gates ?? readGates(opts.root).gates;
  const reviewers = configuredReviewers({ gates });
  const repo = opts.repo ?? process.env.GITHUB_REPOSITORY ?? "";
  // A status or check run from some other app cannot change this answer, and
  // evaluating on one would read a reviewer as absent merely because it had
  // not posted yet — a finding on every pull request, which is how a guard
  // gets deleted.
  const woken =
    reviewers.length === 0 ||
    opts.context === null ||
    reviewers.some(reviewer => reviewer.context === opts.context);
  if (reviewers.length > 0 && woken && !/^[^/\s]+\/[^/\s]+$/.test(repo)) {
    err.write(
      "error: repository must be owner/repo; pass --repo <owner>/<repo> or set GITHUB_REPOSITORY\n"
    );
    return 2;
  }
  // Nothing is read at all when nothing is configured. A no-op that still
  // spends three API calls invites someone to "optimise" it by dropping the
  // report rather than the calls.
  const pulls =
    reviewers.length === 0 || !woken
      ? []
      : (io.pulls ?? (sha => readHeadPulls(repo, sha)))(opts.sha);
  const isPullRequestHead = pulls === null ? null : pulls.length > 0;
  const evaluated = reviewers.length > 0 && woken && isPullRequestHead === true;
  const verdict = !woken
    ? {
        outcome: EVIDENCE_OUTCOMES.notAConfiguredReviewer,
        sha: opts.sha,
        readings: [],
      }
    : reviewEvidenceVerdict({
        reviewers,
        statuses: evaluated ? statusReader(io, repo)(opts.sha) : [],
        checkRuns: evaluated
          ? checkRunsByContext(reviewers, opts.sha, checkRunReader(io, repo))
          : {},
        comments: evaluated
          ? (io.comments ?? (numbers => readComments(repo, numbers)))(
              pulls ?? []
            )
          : [],
        sha: opts.sha,
        isPullRequestHead,
      });
  out.write(
    `${opts.json ? JSON.stringify(verdict, null, 2) : humanReport(verdict)}\n`
  );
  return verdict.outcome === EVIDENCE_OUTCOMES.unsatisfied ||
    verdict.outcome === EVIDENCE_OUTCOMES.pullRequestsUnreadable
    ? 1
    : 0;
}

if (invokedAsScript(import.meta.url)) {
  // exitCode (not process.exit): when stdout is a pipe, writes are async and
  // process.exit() truncates the report mid-flush.
  process.exitCode = main(process.argv.slice(2));
}
