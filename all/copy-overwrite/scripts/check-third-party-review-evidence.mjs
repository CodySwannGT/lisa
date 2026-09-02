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
 * A third-party review app posts a **commit status** on the pull request head.
 * When it is throttled, or declines to review at all, it still reports
 * `state: success` — it never blocks. Only the status `description`
 * distinguishes a review that ran from one that never started.
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
 * `--context` names the status context that woke the run. When it is given and
 * belongs to no declared reviewer, the run is an explicit no-op: a status from
 * some other app cannot change this answer, and evaluating on one would report
 * a reviewer as absent merely because it had not posted yet.
 *
 * @module scripts/check-third-party-review-evidence
 */
import { boundedExecFileSync } from "./lib/bounded-spawn.mjs";
import { invokedAsScript } from "./lib/invoked-as-script.mjs";
import { EVIDENCE_DEFAULTS, PULL_REQUEST, readGates } from "./lisa-gates.mjs";

/** How a reviewer's status at one commit reads. */
export const EVIDENCE_READINGS = Object.freeze({
  /** The description matched a declared reviewed-when phrase. */
  reviewed: "reviewed",
  /** No status for this context on the commit at all. */
  absent: "absent",
  /** A status with no description, or only whitespace. */
  empty: "empty",
  /** A description the vendor uses to say it did no work. */
  noWork: "no-work",
  /** A description in no declared list. Fails closed, deliberately. */
  unrecognised: "unrecognised",
  /** The reviewer has started and has not answered yet. Not an answer either way. */
  pending: "pending",
});

/** What the whole evaluation concluded. */
export const EVIDENCE_OUTCOMES = Object.freeze({
  /** No gate declares a third-party reviewer. An explicit no-op. */
  noReviewerConfigured: "no-reviewer-configured",
  /** The commit is nobody's pull request head. Nothing to review here. */
  notAPullRequestHead: "not-a-pull-request-head",
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
 * @param {object} options - Resolution inputs.
 * @param {object} options.gates - The `gates` block of `.lisa.config.json`.
 * @param {string} [options.moment] - Which moment to read. Defaults to the pull-request moment.
 * @returns {Array<{gateId: string, context: string, proof: string[]}>} Declared reviewers.
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
    });
  }
  return reviewers.sort((left, right) =>
    left.gateId.localeCompare(right.gateId)
  );
}

/**
 * Whether a description reads as the vendor saying it did no work.
 *
 * REPORTING ONLY. This never grants nor denies credit — the verdict is settled
 * by the allowlist above, and this only chooses between two ways of saying
 * "not reviewed" so an operator can tell a known vendor state from a string
 * nobody has seen. Wiring it into the verdict would turn the allowlist back
 * into a denylist, which is the fail-open shape this module refuses.
 * @param {string} normalised - An already-normalised description.
 * @returns {boolean} Whether a shipped no-work phrase appears in it.
 */
function readsAsNoWork(normalised) {
  return EVIDENCE_DEFAULTS.no_work.some(phrase =>
    normalised.includes(normalizeDescription(phrase))
  );
}

/**
 * Read one reviewer's evidence off the statuses on a commit.
 *
 * The verdict is `reviewed` only when the description matches a declared
 * reviewed-when phrase exactly. Every other shape — absent, empty, a known
 * no-work phrase, or an unrecognised string — is NOT REVIEWED, and the observed
 * string is carried back verbatim so the report can say what was actually seen.
 * @param {object} options - Reading inputs.
 * @param {{context: string, proof: string[]}} options.reviewer - One declared reviewer.
 * @param {ReadonlyArray<{context?: string, state?: string, description?: string}>} options.statuses -
 *   `.statuses` from `repos/{owner}/{repo}/commits/{sha}/status`, newest first.
 * @returns {{context: string, reviewed: boolean, reading: string, observed: string|null, state: string|null}} The reading.
 */
export function readReviewerEvidence({ reviewer, statuses }) {
  const found = (statuses ?? []).find(
    status => status?.context === reviewer.context
  );
  if (found === undefined) {
    return {
      context: reviewer.context,
      reviewed: false,
      reading: EVIDENCE_READINGS.absent,
      observed: null,
      state: null,
    };
  }
  const observed = found.description ?? null;
  const normalised = normalizeDescription(observed);
  const state = found.state ?? null;
  // A reviewer posts several statuses on one head before the settled one —
  // measured `Review queued` then `Review in progress` then the verdict. Judging
  // an unsettled one would report a finding on every pull request, and a guard
  // that fires every time gets deleted rather than read.
  if (String(state).toLowerCase() === "pending") {
    return {
      context: reviewer.context,
      reviewed: false,
      reading: EVIDENCE_READINGS.pending,
      observed,
      state,
    };
  }
  if (normalised === "") {
    return {
      context: reviewer.context,
      reviewed: false,
      reading: EVIDENCE_READINGS.empty,
      observed,
      state,
    };
  }
  if (reviewer.proof.includes(normalised)) {
    return {
      context: reviewer.context,
      reviewed: true,
      reading: EVIDENCE_READINGS.reviewed,
      observed,
      state,
    };
  }
  return {
    context: reviewer.context,
    reviewed: false,
    reading: readsAsNoWork(normalised)
      ? EVIDENCE_READINGS.noWork
      : EVIDENCE_READINGS.unrecognised,
    observed,
    state,
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
 * Decide the whole question for one commit.
 *
 * Four outcomes, and the first is not a pass. `no-reviewer-configured` means
 * this project declared no third-party reviewer, which is a legitimate state
 * that must be SAID rather than passed through in silence.
 * @param {object} options - Decision inputs.
 * @param {Array<{gateId: string, context: string, proof: string[]}>} options.reviewers - Declared reviewers.
 * @param {ReadonlyArray<object>} options.statuses - Statuses on the head commit.
 * @param {ReadonlyArray<{body?: string}>} options.comments - Issue comments on the pull request.
 * @param {string} options.sha - The head commit.
 * @param {boolean} [options.isPullRequestHead] - Whether an open pull request has this commit as its head.
 * @returns {{outcome: string, sha: string, readings: Array<object>}} The verdict.
 */
export function reviewEvidenceVerdict({
  reviewers,
  statuses,
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
  if (!isPullRequestHead) {
    return {
      outcome: EVIDENCE_OUTCOMES.notAPullRequestHead,
      sha,
      readings: [],
    };
  }
  const readings = reviewers.map(reviewer => {
    const reading = readReviewerEvidence({ reviewer, statuses });
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
 * One operator-readable line per reviewer, plus the headline.
 * @param {{outcome: string, sha: string, readings: Array<object>}} verdict - A verdict.
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
      `NO-OP — the triggering status belongs to no declared reviewer.\n` +
      `Reviewers ARE configured; this status is not one of theirs, so it ` +
      `cannot change the answer. This is a no-op, NOT a pass.`
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
    const seen =
      reading.observed === null
        ? "no status posted"
        : `${reading.state ?? "?"} — ${JSON.stringify(reading.observed)}`;
    if (reading.reviewed) return `  reviewed     ${reading.context}: ${seen}`;
    const stood = reading.substituted
      ? "a local adversarial review was posted in its place"
      : "NOTHING stands in its place";
    return `  NOT REVIEWED ${reading.context} (${reading.reading}): ${seen}; ${stood}`;
  });
  return `${verdict.outcome.toUpperCase()} at ${verdict.sha}\n${lines.join("\n")}`;
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
 * never reached. A failed read returns `null`, which the callers turn into
 * "absent", so a broken read can only ever make this stricter.
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
 * @param {string} repo - `owner/repo`.
 * @param {string} sha - The commit.
 * @returns {ReadonlyArray<object>} The statuses, newest first.
 */
function readStatuses(repo, sha) {
  const body = ghJson(`repos/${repo}/commits/${sha}/status`);
  return Array.isArray(body?.statuses) ? body.statuses : [];
}

/**
 * The open pull requests whose HEAD is this commit.
 *
 * Head, not "associated with". A commit that merely appears in a pull request's
 * history is not what would merge, and judging review evidence on it would
 * redden pull requests for their ancestors' statuses.
 * @param {string} repo - `owner/repo`.
 * @param {string} sha - The commit.
 * @returns {number[]} The pull request numbers.
 */
function readHeadPulls(repo, sha) {
  const pulls = ghJson(`repos/${repo}/commits/${sha}/pulls`);
  if (!Array.isArray(pulls)) return [];
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
 * The CLI body.
 * @param {string[]} argv - Arguments after the script path.
 * @param {object} [io] - Injected side effects, for tests.
 * @param {object} [io.gates] - The gates block, read from disk when absent.
 * @param {(sha: string) => number[]} [io.pulls] - Head-pull-request reader.
 * @param {(sha: string) => ReadonlyArray<object>} [io.statuses] - Status reader.
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
  // A status from some other app cannot change this answer, and evaluating on
  // one would read a reviewer as absent merely because it had not posted yet —
  // a finding on every pull request, which is how a guard gets deleted.
  const woken =
    reviewers.length === 0 ||
    opts.context === null ||
    reviewers.some(reviewer => reviewer.context === opts.context);
  // Nothing is read at all when nothing is configured. A no-op that still
  // spends three API calls invites someone to "optimise" it by dropping the
  // report rather than the calls.
  const pulls =
    reviewers.length === 0 || !woken
      ? []
      : (io.pulls ?? (sha => readHeadPulls(repo, sha)))(opts.sha);
  const evaluated = reviewers.length > 0 && woken && pulls.length > 0;
  const verdict = !woken
    ? {
        outcome: EVIDENCE_OUTCOMES.notAConfiguredReviewer,
        sha: opts.sha,
        readings: [],
      }
    : reviewEvidenceVerdict({
        reviewers,
        statuses: evaluated
          ? (io.statuses ?? (sha => readStatuses(repo, sha)))(opts.sha)
          : [],
        comments: evaluated
          ? (io.comments ?? (numbers => readComments(repo, numbers)))(pulls)
          : [],
        sha: opts.sha,
        isPullRequestHead: pulls.length > 0,
      });
  out.write(
    `${opts.json ? JSON.stringify(verdict, null, 2) : humanReport(verdict)}\n`
  );
  return verdict.outcome === EVIDENCE_OUTCOMES.unsatisfied ? 1 : 0;
}

if (invokedAsScript(import.meta.url)) {
  // exitCode (not process.exit): when stdout is a pipe, writes are async and
  // process.exit() truncates the report mid-flush.
  process.exitCode = main(process.argv.slice(2));
}
