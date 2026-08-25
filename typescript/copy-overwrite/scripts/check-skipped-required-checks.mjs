#!/usr/bin/env node
// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/**
 * check-skipped-required-checks — refuse a required status check that satisfies
 * without proving anything.
 *
 * Shipped by Lisa (copy-overwrite). Generalized from acmeorgd's TUN-402 guard: the
 * logic is Lisa's and gets updated fleet-wide, the two REVIEWED SNAPSHOTS it
 * rests on are per-repo and live in `.github/required-checks.json` (create-only,
 * yours to edit).
 *
 * Usage:
 *   node scripts/check-skipped-required-checks.mjs [rootDir] [--remote] [--json]
 *   node scripts/check-skipped-required-checks.mjs --vacuity [--fail-on-vacuous]
 *   node scripts/check-skipped-required-checks.mjs --pr=1234 [--repo=OWNER/NAME]
 *
 * `--vacuity` is the WIRED form of the third bullet: it resolves the pull
 * request itself (`--pr`, else the Actions event payload, else `GITHUB_REF`,
 * else the current branch), waits for the declared checks to settle, and
 * REFUSES rather than reporting all-clear when it inspected nothing. See
 * "`--vacuity` — why a flag nobody passes is the same defect" below.
 *
 * ## The family this guard covers
 *
 * **Required-and-red is loud; required-and-vacuous is not; advisory-and-stale is
 * invisible.** All three are the same defect wearing different clothes — a gate
 * that reports satisfied without having proven anything — and the useful
 * question is never "did the check pass" but "did the check do anything".
 *
 * Two of the three live here:
 *
 *  - **Skipped** (`--remote` / offline arm, below): GitHub counts a `skipped`
 *    required check as SATISFIED, so a `skip_jobs` token makes the gate
 *    decorative. Static, offline, BLOCKING.
 *  - **Vacuous** (`--pr` arm): the check really ran and really reported
 *    `success`, having done no work — measured on CodeRabbit posting
 *    `success — "Review rate limited"`. Live, per-PR, REPORTING ONLY.
 *
 * ## Where this runs
 *
 * Lisa's `quality.yml` runs the OFFLINE arm on every pull request, and the
 * shipped `required-checks-drift.yml` runs `--remote` on a weekly schedule.
 * That split is deliberate and is argued under "Why this is a DECLARATION
 * guard" below: the enforced PR path may not depend on network or `gh` auth,
 * and the snapshot it enforces may not be allowed to rot unwatched.
 *
 * ## `enforcement`
 *
 * A declaration may set `"enforcement": "warn"` to report violations without
 * failing the build. The seeds Lisa ships start there ON PURPOSE: a seed cannot
 * know which contexts a given repository's ruleset requires, so a seeded repo
 * that has never been reviewed would otherwise go red on its first Lisa update
 * for skips that may be entirely legitimate — and a gate that reddens a
 * repository the day it arrives gets deleted, not fixed. Absent the key the
 * guard ENFORCES: a declaration somebody hand-wrote is an opt-in.
 *
 * `warn` is a ramp, not a licence: `skipped_required_check` — the repository's
 * own declaration stating that a token it really skips silences a context its
 * ruleset really requires — blocks in every mode.
 *
 * ## `required_contexts` is a CACHE, and an unstamped cache is NOT AN ANSWER
 *
 * The single worst thing this guard can do is render a confident verdict from a
 * list nobody ever compared against a real ruleset. Measured (#2476): the seed
 * Lisa shipped claimed `🔗 Work-Item Traceability` was required — no ruleset
 * required it — and OMITTED SIX contexts that genuinely were. A guard reading
 * that would clear a genuinely-skipped required check and flag a non-required
 * one. That is worse than a guard nobody runs, because it teaches people to
 * trust it.
 *
 * So `required_contexts` is treated as a cache of a live fetch, not as
 * testimony. It is trusted only while `ruleset.baseline_fetched_at` carries a
 * parseable timestamp no older than SNAPSHOT_MAX_AGE_DAYS. Untranscribed or
 * expired, the guard REFUSES to answer: every rule that depends on
 * `required_contexts` is skipped, no ✅ is printed, and the report says NOT
 * CHECKED and why. The rules that do NOT read `required_contexts` — an
 * undeclared token, a token written with whitespace — still run, because they
 * are true regardless of what the ruleset requires.
 *
 * Refusal is exit 1, so an explicit `npm run check:skipped-required-checks`
 * cannot be mistaken for a pass. Under `"enforcement": "warn"` — which is what
 * Lisa's seeds ship, and only its seeds — refusal is loud and exit 0, because
 * reddening every repository in a fleet the day an untranscribed seed arrives
 * is how a gate gets deleted rather than transcribed.
 *
 * ## Why this exists
 *
 * **GitHub counts a `skipped` required status check as SATISFIED.** A job named
 * in a reusable workflow's `skip_jobs` input still reports a green checkmark
 * against its required context, having run zero steps in zero seconds. The merge
 * gate is then decorative: it can never be red, so it can never block anything.
 * A repository in that state looks fully gated while shipping code past a check
 * nobody ever ran.
 *
 * This is measured, not theoretical, in at least two repositories in this
 * portfolio — acmeorgd (`🔍 Quality Checks / 🧪 Run E2E Tests`, TUN-402) and gemini
 * (ruleset 14297996 requiring `🔍 Quality Checks / 🎭 Playwright E2E Tests`,
 * which `ci.yml` skipped unconditionally, so the ruleset enforced nothing).
 *
 * ## Why this is a DECLARATION guard, not a derivation guard
 *
 * The `skip_jobs` token → context-name map is not derivable inside an adopting
 * repository: the callee workflow is not vendored there, the mapping is not a
 * mechanical transform (one token can silence TWO jobs), and the required-context
 * list exists in NO repo file — it lives in the GitHub ruleset, which humans edit
 * in an admin console.
 *
 * So the guard commits two reviewed snapshots — `required_contexts` and
 * `skip_job_declarations` — and makes them POLICE EACH OTHER. Neither is
 * authoritative alone; the coherence rules below are what stop either rotting
 * into decoration.
 *
 * That mutual policing has one blind spot, and `--remote` exists for it: two
 * snapshots in one repo can only catch each other drifting from the CODE.
 * Neither can see the ruleset itself change in the admin console — which is
 * exactly how acmeorgd's list silently went from ten contexts to eleven, with every
 * test still green, because the "independent" transcription was made from the
 * same reading at the same moment.
 *
 * `--remote` is opt-in so the ENFORCED path stays offline. A guard that needed
 * network and `gh` auth on every run would flake, and a flaky guard gets
 * skipped — which reintroduces exactly the false-green class this file refuses.
 *
 * ## `--pr` — the VACUOUS arm, and why it only ever reports
 *
 * Measured (CodySwannGT/lisa#2497): `CodeRabbit` was in this repository's
 * required set, and on PRs #2483 and #2484 it posted `success` with the
 * description `Review rate limited` having performed ZERO reviews. Both merged
 * on that green, both carried security-relevant changes, both shipped in tag
 * `v3.5.1`. Branch protection recorded "reviewed" for work nothing reviewed.
 *
 * The failure is silent by construction, and this is the whole point:
 *
 * ```
 * gh pr checks <PR> | grep -i coderabbit
 * CodeRabbit    pass    0    Review rate limited     <- hollow
 * CodeRabbit    pass    1    Review completed        <- real
 * ```
 *
 * **The status column says `pass` either way. Only the description
 * distinguishes them.** So anything gating on such a check must read the
 * description, and `--pr` is the machine-readable form of that one-line triage.
 *
 * ## `--vacuity` — why a flag nobody passes is the same defect
 *
 * MEASURED (CodySwannGT/lisa#2928): for the whole life of this arm, NOTHING
 * INVOKED IT. `quality.yml` ran the offline arm with no `--pr`, the shipped
 * `required-checks-drift.yml` ran `--remote`, and the package script named
 * `check:vacuous-required-checks` was a bare invocation — so the command named
 * for the vacuous check reported on SKIPS and said nothing about vacuity unless
 * a caller happened to remember `-- --pr=1234`. A rule that runs only when
 * somebody types a flag is `declared-but-uncallable`: exactly the family this
 * file exists to describe, reproduced one level up inside its own shipping.
 *
 * `--vacuity` closes it, and three properties are what make it a gate rather
 * than a second flag to forget:
 *
 *  1. **It resolves the pull request itself.** `--pr`, else the `pull_request`
 *     event payload at `GITHUB_EVENT_PATH`, else `refs/pull/N/merge` in
 *     `GITHUB_REF`, else `gh pr view` on the current branch.
 *  2. **It waits for the declared checks to SETTLE.** A review bot posts
 *     `pending — "Review queued"` and `pending — "Review in progress"` before
 *     it settles, in about nine seconds, and identically on a pull request it
 *     reviews and one it rate-limits. Both intermediate strings are in the
 *     `no_work` vocabulary, so evaluating on the `pull_request` event without
 *     waiting manufactures a finding on EVERY pull request — and a guard that
 *     fires every time gets deleted rather than read.
 *
 *     RE-MEASURED (CodySwannGT/lisa#3221) across the last 40 merged pull
 *     requests: EVERY one carried multiple `CodeRabbit` statuses on the same
 *     head SHA — the sequence `Review queued` -> `Review in progress` -> the
 *     verdict, and SEVEN statuses on one of them, because a re-request restarts
 *     the sequence on the same commit. Only the LAST settled status is the
 *     verdict; reading any earlier one reports a hollow review on a pull
 *     request that may have been genuinely reviewed. Anyone tempted to drop
 *     `--settle-timeout`/`--settle-interval` for a single immediate read is
 *     re-introducing exactly that.
 *  3. **It REFUSES rather than reporting all-clear from an empty inspection.**
 *     An unresolvable pull request, a `gh` that could not be read, a roster
 *     with no checks in it, or a declaration naming no evidence-bearing check
 *     all print the same "nothing vacuous here" as a genuinely clean run. That
 *     collapse is this file's own thesis, so the four causes are separated and
 *     named — see `VACUITY_REFUSALS`. `gh pr checks` in particular resolves the
 *     rollup through `checkSuite.workflowRun` and therefore needs `actions:
 *     read`; without it `gh` exits non-zero with EMPTY STDOUT, which reads as a
 *     content problem and never says the word "permission".
 *
 * A refusal is not a finding: it fails, and under `"enforcement": "warn"` it is
 * loud and exits 0, matching what an untranscribed snapshot already does.
 *
 * ## `--fail-on-vacuous` — the supported exit code
 *
 * This arm NEVER blocks — `NEVER_BLOCKING`, enforced regardless of the
 * declaration's `enforcement` mode. Two independent reasons, both load-bearing:
 *
 *  1. A review bot's availability can depend on an org-wide SPENDING CAP. A
 *     blocking check that fires on a billing state makes merges hostage to
 *     accounting, which is a worse gate than the one it replaces.
 *  2. Whether a review bot belongs in the required set at all is a governance
 *     decision an owner has to make. Shipping the gate before the decision
 *     would pre-empt it. Detection is what is uncontroversial; act on it.
 *
 * Neither argument says the finding must be UNREPORTABLE. A consumer who has
 * made the governance call and wants a red job asks for one with
 * `--fail-on-vacuous`, which is opt-in and changes nothing for anybody who does
 * not pass it. Before that flag existed the only way to get an exit code was a
 * wrapper reading `--json` — every consumer writing the same twelve lines, and
 * the ones who did not write them got a finding that lived only in a log.
 *
 * ## Proof is matched STRICTLY, no-work LOOSELY
 *
 * The two description lists are deliberately asymmetric, because their errors
 * are not symmetric:
 *
 *  - A `proof` phrase must match the whole description (case-insensitive,
 *    trimmed). Matching here GRANTS CREDIT, and a loose match that grants
 *    credit is exactly the false green this file exists to refuse.
 *  - A `no_work` phrase matches as a substring. Matching here DENIES credit,
 *    so breadth is safe — and it survives a vendor appending detail
 *    (`Review rate limited (retry in 12m)`).
 *
 * Anything matching neither is `unproven` — reported, never silently passed. A
 * vocabulary nobody enumerated must not read as a pass.
 *
 * Unlike `required_contexts`, this vocabulary is NOT repo-specific: `Review
 * rate limited` is the vendor's own product string, identical in every
 * repository. That is why shipping it as a default is safe where shipping a
 * guessed ruleset was not (#2476) — and why a wrong guess here costs one line
 * of report rather than a red build.
 *
 * ## Exact string equality, everywhere
 *
 * Every comparison here is `===`. Repos routinely carry confusable pairs — an
 * external app's REQUIRED `GitGuardian Security Checks` beside a skippable,
 * not-required in-workflow `🔐 Credential Leakage` that proves the same
 * property; `🧹 Lint` beside `🐢 Slow Lint Rules`, whose skip tokens `lint`
 * and `lint_slow` are a strict prefix pair. A `includes` / `startsWith` /
 * case-folded match would report a false positive on a legitimate skip, and the
 * natural fix for a false alarm is to delete the guard.
 *
 * The example this used to give — `SonarCloud Code Analysis` beside
 * `🔍 SonarCloud SAST` — stopped being confusable when that job was renamed
 * to `🔍 Static Security Analysis`. Two strings colliding because both named
 * the same vendor is the failure mode the naming ruling removes; two strings
 * colliding because one is a prefix of the other is not, which is why the
 * remaining examples are the ones kept.
 *
 * Lisa's `quality.yml` used to carry the worst pair of all — a NOT-required
 * `🧪 Run Tests` beside the required `🧪 Run Unit Tests` — and it merged red on
 * two PRs because "Run Tests failed" reads like the required test gate failing.
 * That job was deleted outright in #2485 rather than renamed: it was pure
 * duplication of the two coverage-carrying required contexts. If your own repo
 * still has a near-duplicate advisory check, prefer deleting it to relying on a
 * reader to tell three similar names apart.
 *
 * @module scripts/check-skipped-required-checks
 */

import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { boundedExecFileSync } from "./lib/bounded-spawn.mjs";
import { invokedAsScript } from "./lib/invoked-as-script.mjs";

/** Repo-relative path of the per-repo declaration file. */
export const DECLARATION_PATH = ".github/required-checks.json";

/**
 * How long a transcribed `required_contexts` snapshot stays trustworthy.
 *
 * A SOURCE CONSTANT, not an input: a ceiling somebody can widen from a config
 * file fails open on exactly the runs nobody tests. Rulesets are edited in an
 * admin console with no signal in the repository, so an old transcription is
 * not evidence — it is a memory of evidence. Ninety days is long enough that
 * the weekly `--remote` run refreshes it many times over, and short enough that
 * an abandoned repository stops being told its skips are fine.
 */
export const SNAPSHOT_MAX_AGE_DAYS = 90;

/**
 * Matches a `skip_jobs:` key and captures everything after the colon.
 *
 * The `^` anchor is load-bearing, not decoration. Without it the naive form
 * (`/skip_jobs\s*:\s*(.*)$/`) matches a key sitting inside a YAML COMMENT — and
 * workflow headers routinely quote `skip_jobs` in prose, so the unanchored
 * version really does harvest tokens out of documentation.
 *
 * `[ \t]` rather than `\s`: this matches one already-split LINE, so `\s`'s
 * newline class buys nothing and three adjacent `\s*` runs give a backtracking
 * engine work to do for no gain.
 *
 * The capture is `(?:\S.*)?` rather than `.*` for the same reason, one step
 * further. `[ \t]*(.*)` lets both halves claim the same run of spaces, so the
 * engine has a choice to make at every one of them and the match is
 * super-linear in the line's length — S5852, on lines that arrive from a
 * workflow file. Requiring the capture to OPEN on a non-space makes the two
 * halves disjoint, so there is nothing to choose and nothing to give back. An
 * all-whitespace tail still captures the empty string, exactly as before,
 * because `[ \t]*` has already eaten it.
 */
const SKIP_JOBS_LINE = /^[ \t]*skip_jobs[ \t]*:[ \t]*((?:\S.*)?)$/;

/** Matches the tail permitted after a quoted scalar's closing quote. */
const TRAILING_COMMENT_ONLY = /^\s*(?:#.*)?$/;

/** Matches a value that is a GitHub Actions expression, optionally quoted. */
const GITHUB_EXPRESSION = /^(['"]?)\$\{\{([\s\S]*)\}\}\1\s*(?:#.*)?$/;

/**
 * Matches a comparison and its operand — `== 'schedule'`, `!= 'main'`.
 *
 * Deleted from an expression BEFORE literals are read. Without this a
 * condition's own operand reads as a value, and `schedule` / `main` get reported
 * as skip tokens that silence nothing.
 */
const COMPARISON_OPERAND = /[=!]=[ \t]*'[^']*'/g;

/** Matches a single-quoted literal in value position. */
const QUOTED_LITERAL = /'([^']*)'/g;

/** Violation kinds, as stable tokens the tests assert on. */
export const VIOLATIONS = Object.freeze({
  undeclared: "undeclared_skip_token",
  suppressesRequired: "skipped_required_check",
  incoherent: "declaration_understates_requirement",
  stale: "declaration_overstates_requirement",
  orphaned: "orphaned_exemption",
  badExemption: "exemption_without_valid_ticket",
  remoteDrift: "ruleset_snapshot_drift",
  whitespace: "whitespace_in_skip_token",
  vacuous: "vacuous_required_check",
  unproven: "unproven_required_check",
  reviewWaived: "review_evidence_waived",
  reviewUnsatisfied: "review_evidence_unsatisfied",
});

/**
 * The shipped description vocabulary for review-bot style checks.
 *
 * `proof` is matched STRICTLY (whole description, case-insensitive, trimmed)
 * because a match grants credit. `no_work` is matched LOOSELY (substring)
 * because a match denies it. See the header for why that asymmetry is the safe
 * direction.
 *
 * Every string here was read off a real check on a real PR in this fleet, not
 * invented: `Review rate limited` (#2483, #2484, #2495), `Review approved`
 * (#2350). A repository may extend either list per check without losing these.
 */
export const REVIEW_DESCRIPTION_DEFAULTS = Object.freeze({
  proof: Object.freeze([
    "review approved",
    "review completed",
    "changes requested",
    "comments posted",
  ]),
  no_work: Object.freeze([
    "rate limited",
    "review queued",
    "review skipped",
    "skipped",
    "queued",
    "waiting",
    "in progress",
    "no review",
    "disabled",
    "quota",
    "billing",
  ]),
});

/**
 * Verdicts `classifyCheckDescription` returns.
 *
 * `unproven` is the FALLBACK on purpose: the absence of a recognised phrase is
 * the absence of evidence, and this file's whole thesis is that those are not
 * the same as a pass.
 */
export const DESCRIPTION_VERDICTS = Object.freeze({
  proved: "proved",
  noWork: "no-work",
  unproven: "unproven",
});

/** Enforcement modes a declaration may select. */
const ENFORCEMENT_MODES = Object.freeze(["error", "warn"]);

/**
 * Violation kinds that block even under `"enforcement": "warn"`.
 *
 * `warn` is an ADOPTION RAMP for hygiene findings — an undeclared token, a
 * snapshot that has drifted from the code — in a repository nobody has reviewed
 * yet. It is not a licence for a PROVEN false green. Reaching
 * `skipped_required_check` requires the repository's own declaration to say
 * both that a context is ruleset-required AND that a token it actually skips
 * silences it; that is a reviewed state, and shipping past it is the exact
 * defect this file exists to refuse.
 *
 * `ruleset_snapshot_drift` blocks for the same reason: it only fires under an
 * explicit `--remote` on a repository that filled in its ruleset ids, and it is
 * measured against live truth rather than inferred from a seed.
 */
const ALWAYS_BLOCKING = Object.freeze([
  VIOLATIONS.suppressesRequired,
  VIOLATIONS.remoteDrift,
]);

/**
 * Violation kinds that NEVER fail the build, in any enforcement mode.
 *
 * The vacuity arm reports and stops there. A required check can go hollow
 * because a vendor hit an org-wide SPENDING CAP, and a gate that reddens every
 * PR the moment a bill goes unpaid is a worse gate than the one it is
 * criticising. Whether such a check belongs in the required set at all is a
 * governance decision an owner makes in an admin console, not one this script
 * may pre-empt by turning its own finding into a blocker.
 *
 * Detection is the uncontroversial half, and it is the half that was missing:
 * nothing anywhere could previously tell "the check reported success" apart
 * from "the check did anything".
 *
 * This list is checked BEFORE `ALWAYS_BLOCKING` and before the enforcement
 * mode, so deleting the `enforcement` key cannot silently arm it.
 */
export const NEVER_BLOCKING = Object.freeze([
  VIOLATIONS.vacuous,
  VIOLATIONS.unproven,
  // A waiver is the gate saying "the check told me it could not review". It is
  // REPORTED every time — a waived pull request is an unreviewed one and the
  // operator must see that — and it never fails the build, which is the whole
  // content of the owner's ruling on CodySwannGT/lisa#3221.
  VIOLATIONS.reviewWaived,
]);

/**
 * Kinds the review gate blocks on, and only when a caller asks it to.
 *
 * Separate from {@link ALWAYS_BLOCKING} because the gate is opt-in per
 * repository: `--require-review-evidence` is what turns the finding into an
 * exit code. Separate from {@link NEVER_BLOCKING} because, unlike the vacuity
 * findings, this one is MEANT to block once a repository has switched it on —
 * that is the difference between reporting a hollow review and refusing one.
 */
export const REVIEW_GATE_BLOCKING = Object.freeze([
  VIOLATIONS.reviewUnsatisfied,
]);

/**
 * Why the vacuity arm could not inspect anything, as stable tokens.
 *
 * A REFUSAL IS NOT A FINDING, and the distinction is the whole point.
 * `NEVER_BLOCKING` covers the findings — a check that reported success having
 * done no work — and it is deliberate that those never redden a build. These
 * are the other thing entirely: the arm did not run. An empty inspection and a
 * genuinely clean pull request print the same "nothing vacuous here", which is
 * this file's own thesis applied to itself, so the causes are separated and
 * each one names itself (#2928).
 *
 * They are separated from each other for the same reason. A red job caused by a
 * missing `actions: read` means NOBODY LOOKED; a red job caused by a hollow
 * review means the review was fake. Reported through one message they are
 * indistinguishable, and the first gets misreported as the second.
 */
export const VACUITY_REFUSALS = Object.freeze({
  unresolvedPr: "vacuity_pr_unresolved",
  unreadableChecks: "vacuity_checks_unreadable",
  emptyRoster: "vacuity_no_checks_reported",
  noneDeclared: "vacuity_none_declared",
});

/**
 * Ceiling, in seconds, on waiting for the declared checks to settle.
 *
 * Only `--vacuity` waits. An ad-hoc `--pr=1234` is a human triaging one pull
 * request and answers immediately, exactly as it always has; the wait exists
 * for the unattended run that starts the instant the pull request opens, when
 * the bot has not posted anything yet.
 */
export const SETTLE_TIMEOUT_SECONDS = 300;

/** Seconds between polls while waiting for the declared checks to settle. */
export const SETTLE_INTERVAL_SECONDS = 15;

/** Matches the `GITHUB_REF` a `pull_request` event run carries. */
const REF_PULL = /^refs\/pull\/(\d+)\/(?:merge|head)$/u;

/**
 * Reads `--name=value` or `--name value` out of argv.
 *
 * Returns `undefined` for an absent flag and for `--name` with no value, so a
 * typo cannot be read as an empty PR number and silently examine nothing.
 *
 * @param {ReadonlyArray<string>} argv - CLI arguments
 * @param {string} name - The flag, including its leading dashes
 * @returns {string|undefined} The value, or undefined
 */
export function readFlagValue(argv, name) {
  const inline = argv.find(arg => arg.startsWith(`${name}=`));
  if (inline !== undefined) {
    const value = inline.slice(name.length + 1).trim();
    return value === "" ? undefined : value;
  }
  const at = argv.indexOf(name);
  if (at === -1) return undefined;
  const next = argv[at + 1];
  return next === undefined || next.startsWith("--") ? undefined : next;
}

/**
 * True when a line is a whole-line YAML comment.
 *
 * Redundant with `SKIP_JOBS_LINE`'s anchor today, and kept anyway: the anchor is
 * one character a refactor can delete without noticing, and comment exclusion is
 * the property that actually matters.
 *
 * @param {string} line - A single line
 * @returns {boolean} True when the whole line is a comment
 */
function isCommentLine(line) {
  return line.trimStart().startsWith("#");
}

/**
 * True when text after the colon is not an inline scalar this reader decodes.
 *
 * @param {string} rawValue - Trimmed text after the colon
 * @returns {boolean} True when the value cannot be read inline
 */
function isUnreadableScalar(rawValue) {
  return (
    rawValue === "" ||
    rawValue.startsWith(">") ||
    rawValue.startsWith("|") ||
    rawValue.startsWith("#")
  );
}

/**
 * Strips a surrounding matched quote pair and a trailing ` #` comment.
 *
 * Inside a quoted scalar a `#` is DATA, so the closing quote is located as the
 * first quote whose remainder is empty or a comment. That keeps `'a#b'` intact
 * while still reading `'a,b' # note` — a naive scan truncates the former, and an
 * `endsWith(quote)` test rejects the latter outright and falls through to the
 * bare branch, emitting `'a` and `b'` as two bogus tokens.
 *
 * @param {string} rawValue - Text after the colon, already trimmed
 * @returns {string} The scalar's value, unquoted and un-commented
 */
export function unquoteScalar(rawValue) {
  const quote = rawValue.slice(0, 1);
  if (quote === "'" || quote === '"') {
    for (let at = rawValue.indexOf(quote, 1); at > 0; ) {
      if (TRAILING_COMMENT_ONLY.test(rawValue.slice(at + 1))) {
        return rawValue.slice(1, at);
      }
      at = rawValue.indexOf(quote, at + 1);
    }
  }
  const commentAt = rawValue.indexOf(" #");
  return commentAt === -1 ? rawValue : rawValue.slice(0, commentAt).trim();
}

/**
 * Splits a comma list into unique, non-empty tokens.
 *
 * `preserveWhitespace` keeps each token EXACTLY as written, which is the only
 * way to see the defect in `skip_jobs: 'test, test:e2e'`. GitHub Actions has no
 * string-replace in expression syntax, so the sentinel-comma idiom
 * (`contains(format(',{0},', inputs.skip_jobs), ',test:e2e,')`) compares raw
 * bytes: the token there is `" test:e2e"`, which never matches `,test:e2e,` and
 * the job runs. That fails CLOSED, so it is a papercut rather than a hole — but
 * it silently does not do what the operator asked, and nothing else in the
 * pipeline can see it, because by the time the guard has trimmed it looks
 * identical to a correctly written skip.
 *
 * @param {string} commaList - Tokens joined by commas
 * @param {boolean} [preserveWhitespace] - Return tokens exactly as written
 * @returns {string[]} Unique tokens in first-seen order
 */
function tokenize(commaList, preserveWhitespace = false) {
  const out = [];
  for (const part of commaList.split(",")) {
    const token = preserveWhitespace ? part : part.trim();
    if (token.trim() !== "" && !out.includes(token)) out.push(token);
  }
  return out;
}

/**
 * Reads every `skip_jobs` token declared in one workflow file.
 *
 * A `${{ … }}` expression is read CONSERVATIVELY: comparison operands are
 * deleted, every remaining single-quoted literal is tokenized, and all of it is
 * treated as reachable. A conditional that skips e2e only on the nightly
 * schedule therefore still demands a declaration. That over-reports rather than
 * under-reports on purpose — an under-reporting guard is the failure mode this
 * file exists to prevent, and the cost of over-reporting is one line in
 * `skip_job_declarations` explaining why the skip is fine.
 *
 * @param {string} contents - Full text of a workflow file
 * @param {string} sourcePath - Repo-relative path, used only to name the file in
 *   a throw. Never an absolute path.
 * @param {{preserveWhitespace?: boolean}} [options] - `preserveWhitespace`
 *   returns each token exactly as written instead of trimmed
 * @returns {string[]} Every declared skip token, de-duplicated
 * @throws {Error} When a `skip_jobs` key is not an inline scalar
 */
export function readSkipJobs(contents, sourcePath, options = {}) {
  const all = [];
  contents.split("\n").forEach((line, index) => {
    if (isCommentLine(line)) return;
    const match = SKIP_JOBS_LINE.exec(line);
    if (match === null) return;

    const rawValue = (match[1] ?? "").trim();
    if (isUnreadableScalar(rawValue)) {
      throw new Error(
        `check-skipped-required-checks: cannot read the \`skip_jobs\` value on line ${index + 1} of ${sourcePath} as an inline scalar. Only the inline form (\`skip_jobs: 'a,b'\`, double-quoted, or bare) is understood — a block scalar, a sequence, or a bare key would otherwise read as "nothing is skipped", which is a silent pass rather than a check.`
      );
    }

    const expression = GITHUB_EXPRESSION.exec(rawValue);
    const source =
      expression === null
        ? unquoteScalar(rawValue)
        : [
            ...expression[2]
              .replace(COMPARISON_OPERAND, " ")
              .matchAll(QUOTED_LITERAL),
          ]
            .map(found => found[1])
            .join(",");

    for (const token of tokenize(source, options.preserveWhitespace === true)) {
      if (!all.includes(token)) all.push(token);
    }
  });
  return all;
}

/**
 * Loads and validates the per-repo declaration.
 *
 * @param {string} rootDir - Repository root
 * @returns {object} The parsed declaration
 * @throws {Error} When the file is absent or structurally unusable
 */
export function loadDeclaration(rootDir) {
  const path = resolve(rootDir, DECLARATION_PATH);
  if (!existsSync(path)) {
    throw new Error(
      `check-skipped-required-checks: ${DECLARATION_PATH} does not exist. This guard rests on two REVIEWED SNAPSHOTS that cannot be derived from the repository — the ruleset's required contexts, and what each \`skip_jobs\` token silences. Create it (Lisa ships a seed) rather than deleting the guard.`
    );
  }
  const declaration = JSON.parse(readFileSync(path, "utf8"));
  for (const key of [
    "required_contexts",
    "workflows",
    "skip_job_declarations",
  ]) {
    if (declaration[key] === undefined) {
      throw new Error(
        `check-skipped-required-checks: ${DECLARATION_PATH} is missing \`${key}\`.`
      );
    }
  }
  if (!Array.isArray(declaration.required_contexts)) {
    throw new Error(
      `check-skipped-required-checks: \`required_contexts\` must be an array of context strings, transcribed byte for byte from the ruleset (emoji and the \` / \` separator included).`
    );
  }
  if (
    !Array.isArray(declaration.workflows) ||
    declaration.workflows.length === 0
  ) {
    throw new Error(
      `check-skipped-required-checks: \`workflows\` must list at least one workflow file whose \`skip_jobs\` this guard reads.`
    );
  }
  if (
    declaration.enforcement !== undefined &&
    !ENFORCEMENT_MODES.includes(declaration.enforcement)
  ) {
    throw new Error(
      `check-skipped-required-checks: \`enforcement\` must be one of ${ENFORCEMENT_MODES.map(mode => `"${mode}"`).join(", ")}, not ${JSON.stringify(declaration.enforcement)}. Omit it to enforce — a typo silently downgrading this guard to advice is the fail-open shape it exists to refuse.`
    );
  }

  // Validate the SHAPE of every declaration, not just its presence. A truthy
  // non-object entry (`"test:e2e": true`, or a string) reads as "declared" at
  // the point of use, then yields `suppressed_contexts: undefined` — no hits,
  // no violation. The guard silently becomes a no-op for exactly the token
  // someone was trying to document, which is the fail-open class this file
  // exists to refuse. A bad snapshot fails loudly HERE instead, where it is
  // unambiguously a configuration error rather than a clean bill of health.
  for (const [token, entry] of Object.entries(
    declaration.skip_job_declarations
  )) {
    if (
      typeof entry !== "object" ||
      entry === null ||
      Array.isArray(entry) ||
      !Array.isArray(entry.suppressed_contexts) ||
      typeof entry.ruleset_required !== "boolean"
    ) {
      throw new Error(
        `check-skipped-required-checks: the declaration for \`${token}\` in ${DECLARATION_PATH} is malformed. Each entry must be an object with an array \`suppressed_contexts\` and a boolean \`ruleset_required\`. A malformed entry still counts as "declared" where it is used, which turns this guard into a no-op for that exact token.`
      );
    }
    if (entry.suppressed_contexts.some(name => typeof name !== "string")) {
      throw new Error(
        `check-skipped-required-checks: \`${token}.suppressed_contexts\` must contain only context strings — they are compared byte for byte against \`required_contexts\`.`
      );
    }
  }

  // Same reasoning for the vacuity declarations: a non-object entry would read
  // as "declared" and then yield an empty vocabulary, quietly examining the
  // check against defaults the author thought they had overridden.
  for (const [name, entry] of Object.entries(
    declaration.evidence_bearing_checks ?? {}
  )) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      throw new Error(
        `check-skipped-required-checks: the declaration for \`${name}\` in \`evidence_bearing_checks\` must be an object — use \`{}\` to accept the shipped description vocabulary.`
      );
    }
    for (const list of ["proof", "no_work", "satisfy", "waive"]) {
      if (entry[list] === undefined) continue;
      if (
        !Array.isArray(entry[list]) ||
        entry[list].some(phrase => typeof phrase !== "string")
      ) {
        throw new Error(
          `check-skipped-required-checks: \`evidence_bearing_checks.${name}.${list}\` must be an array of description strings.`
        );
      }
      if (entry[list].some(phrase => normalizeDescription(phrase) === "")) {
        throw new Error(
          `check-skipped-required-checks: \`evidence_bearing_checks.${name}.${list}\` must not contain an empty or whitespace-only description. An empty phrase can match missing evidence or every description, depending on how the vocabulary is consumed.`
        );
      }
    }

    // Resolve the shipped defaults before checking disjointness. A custom
    // satisfaction that names a shipped waiver (or the reverse) is just as
    // ambiguous as overlap between two custom lists. Satisfaction is checked
    // first at runtime, so accepting overlap would silently upgrade an explicit
    // waiver into evidence that a review completed.
    const satisfactions = new Set(
      [...REVIEW_SATISFACTIONS, ...(entry.satisfy ?? [])].map(
        normalizeDescription
      )
    );
    const waivers = new Set(
      [...ENTITLEMENT_WAIVERS, ...(entry.waive ?? [])].map(normalizeDescription)
    );
    const overlap = [...satisfactions].filter(phrase => waivers.has(phrase));
    if (overlap.length > 0) {
      throw new Error(
        `check-skipped-required-checks: \`evidence_bearing_checks.${name}.satisfy\` and \`.waive\` must be disjoint after shipped defaults are applied. These phrases appear in both: ${overlap.map(phrase => JSON.stringify(phrase)).join(", ")}. A phrase cannot mean both "review completed" and "review did not run".`
      );
    }
  }
  return declaration;
}

/**
 * Reads every skip token across every declared workflow.
 *
 * A declared workflow that does not exist is an ERROR, not an empty read: a
 * guard that silently reads nothing reports a clean bill of health for a
 * repository it never looked at.
 *
 * A token written with surrounding whitespace is reported HERE rather than
 * downstream, because trimming has already erased the evidence by the time the
 * coherence rules run. The trimmed form is still carried into the evaluation:
 * over-reporting a skip that does not actually happen is the safe direction,
 * and the whitespace violation beside it explains why the token appeared.
 *
 * @param {string} rootDir - Repository root
 * @param {ReadonlyArray<string>} workflows - Repo-relative workflow paths
 * @returns {{tokens: string[], sources: Record<string, string[]>, violations: object[]}} Tokens, where each came from, and how each was written
 */
export function collectSkipJobTokens(rootDir, workflows) {
  const tokens = [];
  /** @type {Record<string, string[]>} */
  const sources = {};
  const violations = [];
  for (const relative of workflows) {
    const path = resolve(rootDir, relative);
    if (!existsSync(path)) {
      throw new Error(
        `check-skipped-required-checks: \`workflows\` names ${relative}, which does not exist. A guard that reads nothing reports a clean bill of health for a repository it never looked at.`
      );
    }
    const contents = readFileSync(path, "utf8");
    for (const token of readSkipJobs(contents, relative)) {
      if (!tokens.includes(token)) tokens.push(token);
      sources[token] = [...(sources[token] ?? []), relative];
    }
    for (const raw of readSkipJobs(contents, relative, {
      preserveWhitespace: true,
    })) {
      if (raw === raw.trim()) continue;
      violations.push({
        kind: VIOLATIONS.whitespace,
        token: raw.trim(),
        message: `\`skip_jobs\` in ${relative} lists ${JSON.stringify(raw)} — the token carries whitespace. GitHub Actions expression syntax has no string-replace, so \`skip_jobs\` is matched as an exact comma-delimited token and the surrounding space makes it match NOTHING: the job runs as if you had never listed it. That fails closed, so nothing unverified ships — but the skip you asked for silently did not happen. Write the list with no spaces: \`skip_jobs: 'a,b'\`, never \`skip_jobs: 'a, b'\`.`,
      });
    }
  }
  return { tokens, sources, violations };
}

/**
 * Decides whether `required_contexts` may be believed at all.
 *
 * The stamp is `ruleset.baseline_fetched_at`, and it means one specific thing:
 * somebody read this list off a live ruleset on that date. An empty stamp is
 * the state Lisa's seeds ship in, and the seeds are a GUESS — a guess that was
 * measured wrong (#2476). No stamp, no answer.
 *
 * @param {object} declaration - The per-repo declaration
 * @param {number} [now] - Current epoch milliseconds, injectable for tests
 * @returns {{trusted: boolean, reason: string}} Whether to believe the snapshot, and why not
 */
export function snapshotTrust(declaration, now = Date.now()) {
  const stamp = declaration.ruleset?.baseline_fetched_at;
  if (typeof stamp !== "string" || stamp.trim() === "") {
    return {
      trusted: false,
      reason: `\`ruleset.baseline_fetched_at\` is empty, so \`required_contexts\` has never been transcribed from a live ruleset. Lisa's seed ships a GUESS, and the guess was measured WRONG in this fleet: it claimed "🔍 Quality Checks / 🔗 Work-Item Traceability" was required when no ruleset required it, and omitted six contexts that were. Transcribe the real list, stamp the date, and this guard starts answering.`,
    };
  }
  const fetchedAt = Date.parse(stamp);
  if (Number.isNaN(fetchedAt)) {
    return {
      trusted: false,
      reason: `\`ruleset.baseline_fetched_at\` is ${JSON.stringify(stamp)}, which is not a date this can read. Use an ISO-8601 timestamp, e.g. "2026-08-13".`,
    };
  }
  const ageDays = (now - fetchedAt) / 86_400_000;
  if (ageDays > SNAPSHOT_MAX_AGE_DAYS) {
    return {
      trusted: false,
      reason: `\`required_contexts\` was last transcribed ${Math.floor(ageDays)} days ago, past the ${SNAPSHOT_MAX_AGE_DAYS}-day ceiling. Rulesets are edited in an admin console with no signal in this repository, so a stale transcription is a memory of evidence rather than evidence.`,
    };
  }
  return { trusted: true, reason: "" };
}

/**
 * The transcription instructions, printed wherever the snapshot is refused.
 *
 * @param {object} declaration - The per-repo declaration
 * @returns {string} A copy-pasteable recipe
 */
export function transcriptionRecipe(declaration) {
  const repo = declaration.ruleset?.repo || "OWNER/NAME";
  return [
    `  gh api repos/${repo}/rulesets --jq '.[] | "\\(.id) \\(.name)"'`,
    `  gh api repos/${repo}/rulesets/RULESET_ID --jq '.rules[] | select(.type=="required_status_checks") | .parameters.required_status_checks[].context'`,
    `Paste the output into \`required_contexts\` byte for byte, record the ids in \`ruleset.ids\`, and set \`ruleset.baseline_fetched_at\` to today.`,
  ].join("\n");
}

/**
 * The whole verdict, as a pure function of the two snapshots and what the
 * workflows actually declare.
 *
 * The coherence rules are what stop either snapshot rotting into decoration:
 *
 *  1. Every token a workflow skips must be DECLARED. An undeclared skip is a
 *     skip nobody reviewed.
 *  2. A declaration whose `suppressed_contexts` intersect `required_contexts`
 *     but whose `ruleset_required` says `false` is INCOHERENT — the declaration
 *     is out of date with the ruleset snapshot beside it.
 *  3. A declaration claiming `ruleset_required: true` whose contexts intersect
 *     nothing is STALE — the context was de-required or renamed, and the
 *     declaration is now describing a world that no longer exists.
 *  4. A token that is ACTUALLY SKIPPED and suppresses a required context is the
 *     false green this guard exists to refuse. It fails unless it carries an
 *     exemption naming a real tracker ticket — an exemption is a decision
 *     someone owns, not a way to silence the check.
 *  5. An exemption for a token nobody skips any more is ORPHANED. Deleting it is
 *     one line, and leaving it teaches readers the exemption list is fiction.
 *
 * Rules 2, 3 and 4 all read `required_contexts`, so all three are SUPPRESSED
 * when `trustRequiredContexts` is false. Rules 1 and 5 do not read it and keep
 * running: whether a token was reviewed, and whether an exemption still refers
 * to a real skip, are true regardless of what any ruleset requires. Suppressing
 * a rule is not the same as passing it — the caller reports NOT CHECKED.
 *
 * @param {object} declaration - The per-repo declaration
 * @param {ReadonlyArray<string>} skipped - Tokens the workflows actually skip
 * @param {{trustRequiredContexts?: boolean}} [options] - Set
 *   `trustRequiredContexts: false` to suppress every rule that reads the
 *   `required_contexts` snapshot
 * @returns {{violations: object[], checked: number}} Violations and how many tokens were examined
 */
export function evaluateSkippedRequiredChecks(
  declaration,
  skipped,
  options = {}
) {
  const trustRequired = options.trustRequiredContexts !== false;
  const required = new Set(declaration.required_contexts);
  const declarations = declaration.skip_job_declarations ?? {};
  const ticketPattern = new RegExp(
    declaration.exemption_ticket_pattern ?? "^[A-Z][A-Z0-9]+-\\d+$"
  );
  const violations = [];

  for (const token of skipped) {
    const entry = declarations[token];
    if (!entry) {
      violations.push({
        kind: VIOLATIONS.undeclared,
        token,
        message: `\`${token}\` is skipped but not declared in ${DECLARATION_PATH}. Declare what it silences and whether any of that is ruleset-required — an undeclared skip is a skip nobody reviewed.`,
      });
      continue;
    }
    if (!trustRequired) continue;
    const suppressed = entry.suppressed_contexts ?? [];
    const hits = suppressed.filter(context => required.has(context));

    if (hits.length > 0 && entry.ruleset_required !== true) {
      violations.push({
        kind: VIOLATIONS.incoherent,
        token,
        message: `\`${token}\` declares \`ruleset_required: false\`, but it suppresses ${hits.map(hit => `"${hit}"`).join(", ")}, which \`required_contexts\` says IS required. One of the two snapshots is out of date — fix the one that is wrong, do not delete the check.`,
      });
    }
    if (hits.length === 0 && entry.ruleset_required === true) {
      violations.push({
        kind: VIOLATIONS.stale,
        token,
        message: `\`${token}\` declares \`ruleset_required: true\`, but none of ${suppressed.map(name => `"${name}"`).join(", ") || "(nothing)"} appears in \`required_contexts\`. The context was renamed or de-required and this declaration now describes a world that no longer exists.`,
      });
    }
    if (hits.length > 0) {
      const exemption = entry.exemption;
      if (!exemption) {
        violations.push({
          kind: VIOLATIONS.suppressesRequired,
          token,
          contexts: hits,
          message: `\`${token}\` silences the ruleset-required context(s) ${hits.map(hit => `"${hit}"`).join(", ")}. GitHub counts a SKIPPED required check as SATISFIED, so that context reports green having run zero steps — the gate is decorative. Fix the suite, de-require the context, or record an exemption with a tracker ticket.`,
        });
      } else if (
        typeof exemption.ticket !== "string" ||
        !ticketPattern.test(exemption.ticket)
      ) {
        violations.push({
          kind: VIOLATIONS.badExemption,
          token,
          message: `\`${token}\` carries an exemption whose ticket ${JSON.stringify(exemption.ticket)} does not match ${ticketPattern}. An exemption is a decision someone owns; without a ticket it is just a way to silence this guard.`,
        });
      }
    }
  }

  for (const [token, entry] of Object.entries(declarations)) {
    if (entry.exemption && !skipped.includes(token)) {
      violations.push({
        kind: VIOLATIONS.orphaned,
        token,
        message: `\`${token}\` carries an exemption but is no longer skipped anywhere. Delete the exemption — leaving it teaches readers that the exemption list is fiction.`,
      });
    }
  }

  return { violations, checked: skipped.length };
}

/**
 * Decides whether a check's description proves the check did any work.
 *
 * @param {string|undefined} description - The check's description, verbatim
 * @param {{proof?: ReadonlyArray<string>, no_work?: ReadonlyArray<string>}} [vocabulary] -
 *   Per-check additions. Merged WITH the shipped defaults rather than replacing
 *   them, so a repository naming one extra proof phrase does not silently lose
 *   the no-work list that catches the measured defect.
 * @returns {string} One of `DESCRIPTION_VERDICTS`
 */
export function classifyCheckDescription(description, vocabulary = {}) {
  const text = (description ?? "").trim().toLowerCase();
  if (text === "") return DESCRIPTION_VERDICTS.unproven;

  // No-work is tested FIRST. The lists are asserted non-overlapping in the
  // suite, so order cannot change a verdict today — testing the denying rule
  // first means a future overlap fails safe (denied) rather than granting
  // credit, which is the direction that matters.
  const noWork = [
    ...REVIEW_DESCRIPTION_DEFAULTS.no_work,
    ...(vocabulary.no_work ?? []),
  ];
  if (noWork.some(phrase => text.includes(phrase.trim().toLowerCase()))) {
    return DESCRIPTION_VERDICTS.noWork;
  }

  const proof = [
    ...REVIEW_DESCRIPTION_DEFAULTS.proof,
    ...(vocabulary.proof ?? []),
  ];
  if (proof.some(phrase => text === phrase.trim().toLowerCase())) {
    return DESCRIPTION_VERDICTS.proved;
  }
  return DESCRIPTION_VERDICTS.unproven;
}

/**
 * Reports every declared evidence-bearing check that satisfied without proving
 * it did work.
 *
 * A check is examined only when the repository named it in
 * `evidence_bearing_checks` — matched by EXACT name, like every other
 * comparison in this file. Most CI jobs ship an empty description, so
 * flagging them all would bury the one finding that matters, and the obvious
 * fix for a noisy guard is to delete it.
 *
 * Four outcomes per declared check:
 *
 *  - Green + a `proof` description → nothing. This is the case the whole
 *    machine exists to reach.
 *  - Green + a `no_work` description → `vacuous_required_check`. The measured
 *    #2483/#2484 defect.
 *  - Green + anything else → `unproven_required_check`. Not an accusation: a
 *    statement that this run produced no evidence either way.
 *  - Absent entirely → `unproven_required_check`. Measured on #2493/#2491/
 *    #2488, where the bot posted no context at all; "no unresolved review
 *    threads" there means nobody looked, not that nothing was wrong.
 *
 * A RED check is deliberately ignored. Required-and-red is the loud case and
 * needs no help from here; reporting it too would make this arm indistinguish-
 * able from ordinary CI noise.
 *
 * `required_contexts` changes only the WORDING — whether branch protection
 * actually recorded this hollow green as a satisfied gate. When that snapshot
 * is untrusted the finding still stands; the guard just declines to claim
 * required-ness it has not transcribed.
 *
 * @param {object} declaration - The per-repo declaration
 * @param {ReadonlyArray<{name: string, state: string, bucket?: string, description?: string}>} checks -
 *   Checks as `gh pr checks --json name,state,bucket,description` returns them
 * @param {{trustRequiredContexts?: boolean, headSha?: string}} [options] - Set
 *   `trustRequiredContexts: false` to stop asserting whether a check is required;
 *   `headSha` is the commit the checks were read at, cited in every finding
 * @returns {{violations: object[], checked: number}} Violations and how many declared checks were examined
 */
export function evaluateVacuousChecks(declaration, checks, options = {}) {
  const declared = declaration.evidence_bearing_checks ?? {};
  const trustRequired = options.trustRequiredContexts !== false;
  // Every finding names the commit it was read at. A description is a property
  // of a SHA, not of a pull request — see {@link resolveHeadSha}.
  const at = citeHeadSha(options.headSha);
  const required = new Set(declaration.required_contexts ?? []);
  const violations = [];
  let checked = 0;

  for (const [name, entry] of Object.entries(declared)) {
    checked += 1;
    const vocabulary = typeof entry === "object" && entry !== null ? entry : {};
    const found = checks.find(check => check.name === name);

    if (found === undefined) {
      violations.push({
        kind: VIOLATIONS.unproven,
        token: name,
        message: `\`${name}\` is declared evidence-bearing but did not report on this pull request at all.${at} A report of "no unresolved review threads" from this PR means NOBODY LOOKED, not that nothing was wrong — say which one you observed. (If the context was renamed, fix \`evidence_bearing_checks\`; names are compared byte for byte.)`,
      });
      continue;
    }

    const state = String(found.state ?? "").toUpperCase();
    if (state === "FAILURE" || state === "ERROR") continue;

    const verdict = classifyCheckDescription(found.description, vocabulary);
    if (verdict === DESCRIPTION_VERDICTS.proved && state === "SUCCESS") {
      continue;
    }

    const requiredNote = !trustRequired
      ? " Whether it is ruleset-required is NOT KNOWN here — `required_contexts` has not been transcribed, so this cannot say what the merge gate recorded."
      : required.has(name)
        ? " This context IS ruleset-required, so branch protection recorded a satisfied review gate for a review that did not happen."
        : " This context is not in `required_contexts`, so no merge gate was falsified — but nothing reviewed this either.";

    violations.push(
      verdict === DESCRIPTION_VERDICTS.noWork && state === "SUCCESS"
        ? {
            kind: VIOLATIONS.vacuous,
            token: name,
            contexts: [name],
            message: `\`${name}\` reported ${state} with the description ${JSON.stringify(found.description ?? "")}, which says it DID NO WORK.${at}${requiredNote} \`gh pr checks\` prints \`pass\` for this exactly as it does for a real review — the description is the only thing that tells them apart. Treat this PR as UNREVIEWED.`,
          }
        : {
            kind: VIOLATIONS.unproven,
            token: name,
            message: `\`${name}\` reported ${state} with the description ${JSON.stringify(found.description ?? "")}, which proves neither that it reviewed anything nor that it did not.${at}${requiredNote} Read the check itself before treating this PR as reviewed, or add the phrase to \`evidence_bearing_checks.${name}.proof\` once you have confirmed what it means.`,
          }
    );
  }

  return { violations, checked };
}

/**
 * Descriptions that WAIVE the review gate, matched whole and case-insensitively.
 *
 * Ruled by the repository owner on CodySwannGT/lisa#3221: CodeRabbit stays a
 * required context, and the gate waives when CodeRabbit ITSELF says it could not
 * review. Both strings below trace to the same free-OSS entitlement — the bot
 * reports `Plan: Pro Plus` while saying the free OSS reviews are exhausted — so
 * they are one condition reported two ways, not a limit and a configuration.
 *
 * MEASURED 2026-08-25 across the last 40 merged pull requests, reading the
 * status on each PR's head SHA. All 40 reported `state: success`:
 *
 *     Review skipped: manual review required for this OSS repository   29
 *     Review rate limited                                              10
 *     Review completed                                                  1
 *
 * ## Why this is NOT `REVIEW_DESCRIPTION_DEFAULTS.no_work`
 *
 * The asymmetry in {@link classifyCheckDescription} INVERTS here, and reusing
 * the loose list would be the bypass. `no_work` matches as a SUBSTRING, and that
 * is safe there because matching DENIES credit — over-matching only produces
 * more findings. Here, matching GRANTS PERMISSION TO MERGE, so over-matching
 * waives a pull request that should have blocked. `no_work` contains bare
 * `skipped`, `queued`, `waiting`, `disabled`, `quota` and `billing`; a future
 * description like "Review completed, 3 files skipped" contains one of them and
 * would sail through a substring waiver.
 *
 * So this list is matched the way `proof` is — whole description, trimmed,
 * case-insensitive — for exactly the reason `proof` is: a loose match that
 * grants credit is the false green this file exists to refuse.
 *
 * A repository extends it through `evidence_bearing_checks.<name>.waive`, which
 * is a deliberate act with a name attached, not a substring that happened to
 * match.
 */
export const ENTITLEMENT_WAIVERS = Object.freeze([
  "review rate limited",
  "review skipped: manual review required for this oss repository",
]);

/**
 * Descriptions that SATISFY the review gate, matched whole.
 *
 * Deliberately narrower than {@link REVIEW_DESCRIPTION_DEFAULTS}.proof, and the
 * difference is the point. `proof` answers "did this check do work?", so it
 * counts `changes requested` — a review that ran and objected DID work. This
 * list answers "may this merge?", where a review that ran and objected is the
 * one case that must BLOCK. The two questions have different answers on the same
 * string, so they get different lists rather than one list with an exception.
 *
 * One entry, because the owner named one: `Review completed`. Anything else
 * green SURFACES rather than waiving — including plausible-looking siblings such
 * as `Review approved`, which nobody has yet confirmed means what it appears to.
 * Widening satisfaction is the dangerous direction; a repository that has
 * confirmed a phrase adds it through `evidence_bearing_checks.<name>.satisfy`.
 */
export const REVIEW_SATISFACTIONS = Object.freeze(["review completed"]);

/**
 * What the review gate concluded about one declared evidence-bearing check.
 *
 * Three states, never two. Collapsing `absent` into `waived` would make the gate
 * permanently inert the moment it read the wrong commit — measured on #3221,
 * 40 of 40 MERGE COMMITS carried no `CodeRabbit` status at all, so a check keyed
 * on the merge commit sees `absent` every single time and an
 * absent-means-waived gate would pass forever while reporting nothing.
 */
export const REVIEW_GATE_STATES = Object.freeze({
  satisfied: "satisfied",
  waived: "waived",
  unsatisfied: "unsatisfied",
});

/**
 * Normalises a description for whole-string comparison.
 *
 * @param {string|undefined} description - The status description
 * @returns {string} Trimmed, lower-cased text
 */
function normalizeDescription(description) {
  return String(description ?? "")
    .trim()
    .toLowerCase();
}

/**
 * Decide what one evidence-bearing check permits.
 *
 * Pure, and separate from the constants it reads, so it can be exercised
 * against readings this repository cannot currently produce — the
 * review-ran-and-objected path has no live example here, and a path with no
 * example and no test is a path nobody has watched work.
 *
 * @param {{present: boolean, state?: string, description?: string}} reading - One check
 * @param {{waive?: readonly string[], satisfy?: readonly string[]}} [vocabulary] - Per-check extensions
 * @returns {{state: string, why: string}} The gate state and a one-line reason
 */
export function reviewGateState(reading, vocabulary = {}) {
  if (!reading.present) {
    return {
      state: REVIEW_GATE_STATES.unsatisfied,
      why: "did not report on this pull request at all. ABSENT is not the same as waived: nothing said it could not review, so nothing accounts for the silence. A guard that read absence as permission would pass forever the first time it looked at the wrong commit.",
    };
  }
  const state = String(reading.state ?? "").toUpperCase();
  const text = normalizeDescription(reading.description);
  if (state === "FAILURE" || state === "ERROR") {
    return {
      state: REVIEW_GATE_STATES.unsatisfied,
      why: `reported ${state}${text === "" ? "" : ` — ${JSON.stringify(reading.description ?? "")}`}. A review that RAN AND OBJECTED is the case this gate exists to let through to a human, and it is the one thing no waiver covers.`,
    };
  }
  if (state !== "SUCCESS") {
    return {
      state: REVIEW_GATE_STATES.unsatisfied,
      why: `is still ${state === "" ? "unreported" : state} after the settle window. An unsettled check has not said anything yet, and the gate does not guess on its behalf.`,
    };
  }
  const satisfies = [...REVIEW_SATISFACTIONS, ...(vocabulary.satisfy ?? [])];
  if (satisfies.some(phrase => text === normalizeDescription(phrase))) {
    return {
      state: REVIEW_GATE_STATES.satisfied,
      why: `reported ${JSON.stringify(reading.description ?? "")}, which is a review that ran.`,
    };
  }
  const waivers = [...ENTITLEMENT_WAIVERS, ...(vocabulary.waive ?? [])];
  if (waivers.some(phrase => text === normalizeDescription(phrase))) {
    return {
      state: REVIEW_GATE_STATES.waived,
      why: `reported ${JSON.stringify(reading.description ?? "")} — the check saying, in its own words, that it could not review. WAIVED, not satisfied: this pull request is UNREVIEWED and merging it is a decision taken on that basis. The waiver clears the moment the entitlement behind it is fixed, at which point this gate starts biting with no code change.`,
    };
  }
  return {
    state: REVIEW_GATE_STATES.unsatisfied,
    why: `reported SUCCESS with the description ${JSON.stringify(reading.description ?? "")}, which is neither a review that ran nor one of the named waivers. An UNRECOGNISED description is surfaced rather than waived — a gate that waived on "anything that is not a completed review" would waive a genuine failure and every phrase the vendor has not invented yet. If this string is legitimate, add it to \`evidence_bearing_checks\` under \`satisfy\` or \`waive\`, deliberately and by name.`,
  };
}

/**
 * Run the review gate over every declared evidence-bearing check.
 *
 * Produces a finding for BOTH non-satisfied states, and that is deliberate: a
 * waived pull request is an unreviewed pull request, and the operator has to be
 * able to see that without reading raw commit statuses. The waiver changes the
 * EXIT CODE, never the visibility.
 *
 * @param {object} declaration - The per-repo declaration
 * @param {ReadonlyArray<{name: string, state: string, description?: string}>} checks - The checks
 * @param {{headSha?: string}} [options] - `headSha` is cited in every finding
 * @returns {{violations: object[], states: Record<string, string>, checked: number}} Findings, per-check state, and how many were examined
 */
export function evaluateReviewGate(declaration, checks, options = {}) {
  const declared = declaration.evidence_bearing_checks ?? {};
  const at = citeHeadSha(options.headSha);
  const violations = [];
  const states = {};
  let checked = 0;

  for (const [name, entry] of Object.entries(declared)) {
    checked += 1;
    const vocabulary = typeof entry === "object" && entry !== null ? entry : {};
    const found = checks.find(check => check.name === name);
    const verdict = reviewGateState(
      found === undefined
        ? { present: false }
        : {
            present: true,
            state: found.state,
            description: found.description,
          },
      vocabulary
    );
    states[name] = verdict.state;
    if (verdict.state === REVIEW_GATE_STATES.satisfied) continue;
    violations.push({
      kind:
        verdict.state === REVIEW_GATE_STATES.waived
          ? VIOLATIONS.reviewWaived
          : VIOLATIONS.reviewUnsatisfied,
      token: name,
      contexts: [name],
      message: `\`${name}\` ${verdict.why}${at}`,
    });
  }

  return { violations, states, checked };
}

/**
 * Reads one pull request's checks, descriptions included.
 *
 * `--json` is what makes this usable: the plain `gh pr checks` table is the
 * human triage, and the description column is the load-bearing one, but only
 * the JSON form survives being parsed. Both CheckRuns and legacy commit
 * StatusContexts come back through this single call — CodeRabbit posts the
 * latter, which `gh pr view --json statusCheckRollup` returns WITHOUT a
 * description, so that route cannot see the defect at all.
 *
 * A non-zero exit is expected and ignored: `gh pr checks` exits 8 while checks
 * are pending and 1 when any check failed, and both are perfectly readable
 * states for this arm. Only unparseable output is an error.
 *
 * @param {string|number} pr - Pull request number or URL
 * @param {string} [repo] - `OWNER/NAME`; defaults to the current repository
 * @returns {Array<{name: string, state: string, bucket?: string, description?: string}>} The checks
 * @throws {Error} When `gh` is unavailable or its output cannot be parsed
 */
export function fetchPullRequestChecks(pr, repo) {
  const args = [
    "pr",
    "checks",
    String(pr),
    "--json",
    "name,state,bucket,description",
  ];
  if (repo) args.push("--repo", repo);
  let raw;
  try {
    raw = boundedExecFileSync("gh", args, { encoding: "utf8" });
  } catch (error) {
    raw = typeof error?.stdout === "string" ? error.stdout : "";
    if (raw.trim() === "") {
      // MEASURED (#2928): this is what a missing `actions: read` looks like.
      // `gh pr checks` resolves the rollup through `checkSuite.workflowRun`, so
      // without that scope it exits non-zero with EMPTY STDOUT — a failure
      // shaped exactly like unreadable content, which never says the word
      // "permission". The commit-status route below needs no `actions` scope
      // and carries the description this arm reads, so try it before refusing.
      return fetchChecksViaApi(pr, repo, error);
    }
  }
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new TypeError("not an array");
    return parsed;
  } catch (error) {
    throw new Error(
      `check-skipped-required-checks: \`gh pr checks --json\` returned output this cannot parse (${error instanceof Error ? error.message : String(error)}). Refusing to report "nothing vacuous" from output nobody read.`
    );
  }
}

/**
 * Resolves `OWNER/NAME` for the repository this run is about.
 *
 * @param {string} [repo] - An explicit `--repo` value, returned unchanged
 * @param {NodeJS.ProcessEnv} [env] - Environment, injectable for tests
 * @returns {string|undefined} The slug, or undefined when nothing resolves it
 */
export function resolveRepoSlug(repo, env = process.env) {
  if (repo) return repo;
  if (env.GITHUB_REPOSITORY) return env.GITHUB_REPOSITORY;
  try {
    const raw = boundedExecFileSync(
      "gh",
      ["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"],
      { encoding: "utf8" }
    ).trim();
    return raw === "" ? undefined : raw;
  } catch {
    return undefined;
  }
}

/**
 * The commit this pull request's checks were read at.
 *
 * Named in every finding, and that is not decoration. A status DESCRIPTION is
 * not stable within a pull request: measured on CodySwannGT/lisa#3221, a head
 * commit carried `Review rate limited` while a commit pushed to the same branch
 * moments later carried `Review skipped: manual review required`, and whichever
 * one is head at merge time is the one branch protection recorded. Two readers
 * quoting the same pull request confidently disagreed; neither had misread
 * anything, and both had omitted the only fact that reconciles them.
 *
 * The PR HEAD is the right commit to read, and that was measured rather than
 * assumed: across the last 40 merged pull requests here, the MERGE COMMIT
 * carried no `CodeRabbit` status at all, 40 times out of 40. A guard keyed on
 * the merge commit would have read "absent" on every one of them.
 *
 * Returns undefined rather than throwing. The settlement reader treats that as
 * an unreadable snapshot and retries; it never evaluates evidence until this
 * function names one concrete commit.
 *
 * @param {string|number} pr - Pull request number
 * @param {string} [repo] - `OWNER/NAME`, or undefined to resolve it
 * @returns {string|undefined} The head commit SHA, or undefined when unresolvable
 */
export function resolveHeadSha(pr, repo) {
  const slug = resolveRepoSlug(repo);
  if (slug === undefined) return undefined;
  try {
    const raw = boundedExecFileSync(
      "gh",
      [
        "pr",
        "view",
        String(pr),
        "--repo",
        slug,
        "--json",
        "headRefOid",
        "--jq",
        ".headRefOid",
      ],
      { encoding: "utf8" }
    ).trim();
    return raw === "" ? undefined : raw;
  } catch {
    return undefined;
  }
}

/**
 * How a finding cites the commit its evidence was read at.
 *
 * @param {string|undefined} headSha - The resolved head SHA, if any
 * @returns {string} A sentence naming the commit, or naming its absence
 */
export function citeHeadSha(headSha) {
  return headSha === undefined
    ? " The head commit could NOT be resolved for this run, so this finding cannot be pinned to a SHA — treat it as unlocated evidence and re-read the pull request before quoting it."
    : ` Read at head commit ${headSha}.`;
}

/**
 * Reads every page from one `gh api` list route.
 *
 * `gh api --paginate` invokes `--jq` once per response page. Encoding each
 * page's selected rows with `@json` keeps one parseable array per output line,
 * including when a description itself contains newlines.
 *
 * @param {string} endpoint - REST endpoint, including `per_page=100`
 * @param {string} query - jq expression that selects an array from one page
 * @returns {object[]} The selected rows from every page
 */
function ghApiPaginatedArray(endpoint, query) {
  const raw = boundedExecFileSync(
    "gh",
    ["api", endpoint, "--paginate", "--jq", `${query} | @json`],
    { encoding: "utf8" }
  );
  return raw
    .split("\n")
    .map(line => line.trim())
    .filter(Boolean)
    .flatMap(line => {
      const page = JSON.parse(line);
      if (!Array.isArray(page)) throw new TypeError("page is not an array");
      return page;
    });
}

/**
 * The permission-light route to the same rows, for when `gh pr checks` cannot.
 *
 * Two calls, neither of which needs `actions: read`: the combined commit status
 * (`statuses: read`), which is where a legacy status like CodeRabbit's lives
 * and is the ONLY route that carries its description, and the check-run list
 * (`checks: read`). `gh pr checks` is still the primary because it is one call
 * and already normalises both families; this exists so a repository that has
 * not granted the rollup scope gets an ANSWER rather than a refusal it will
 * misread as a detection.
 *
 * A check run with no conclusion yet is reported `PENDING` rather than by its
 * `status` string, so the settle test sees one vocabulary from both routes.
 *
 * @param {string|number} pr - Pull request number
 * @param {string|undefined} repo - `OWNER/NAME`, or undefined to resolve it
 * @param {unknown} cause - The `gh pr checks` failure this is falling back from
 * @returns {Array<{name: string, state: string, bucket?: string, description?: string}>} The checks
 * @throws {Error} When the fallback cannot answer either
 */
export function fetchChecksViaApi(pr, repo, cause) {
  const slug = resolveRepoSlug(repo);
  const why = cause instanceof Error ? cause.message : String(cause ?? "");
  if (slug === undefined) {
    throw new Error(
      `check-skipped-required-checks: could not read checks for PR ${pr} — \`gh pr checks\` failed (${why}) and the commit-status fallback has no OWNER/NAME to query. Pass \`--repo=OWNER/NAME\`, or set GITHUB_REPOSITORY.`
    );
  }
  try {
    const sha = boundedExecFileSync(
      "gh",
      [
        "pr",
        "view",
        String(pr),
        "--repo",
        slug,
        "--json",
        "headRefOid",
        "--jq",
        ".headRefOid",
      ],
      { encoding: "utf8" }
    ).trim();
    return fetchChecksForCommit(sha, slug);
  } catch (error) {
    throw new Error(
      `check-skipped-required-checks: could not read checks for PR ${pr} in ${slug}. \`gh pr checks\` failed (${why}) — which is what a missing \`actions: read\` looks like, because it resolves the rollup through \`checkSuite.workflowRun\` and exits non-zero with empty output — and the commit-status fallback also failed (${error instanceof Error ? error.message : String(error)}). NOBODY LOOKED at this pull request; that is not the same as nothing being wrong with it.`
    );
  }
}

/**
 * Reads the evidence-bearing rows for one exact commit.
 *
 * The vacuity arm settles a pull request over time, but the rows themselves are
 * commit data. Keeping this reader SHA-addressed prevents a branch push from
 * changing the object underneath an in-flight inspection.
 *
 * @param {string} sha - Exact commit whose statuses and check runs to read
 * @param {string|undefined} repo - `OWNER/NAME`, or undefined to resolve it
 * @returns {Array<{name: string, state: string, bucket?: string, description?: string}>} The checks
 */
export function fetchChecksForCommit(sha, repo) {
  const slug = resolveRepoSlug(repo);
  if (slug === undefined) {
    throw new Error(
      `check-skipped-required-checks: cannot read commit ${sha} without an OWNER/NAME. Pass \`--repo=OWNER/NAME\`, or set GITHUB_REPOSITORY.`
    );
  }
  const statuses = ghApiPaginatedArray(
    `repos/${slug}/commits/${sha}/status?per_page=100`,
    "[.statuses[] | {name: .context, state: .state, description: .description}]"
  );
  const runs = ghApiPaginatedArray(
    `repos/${slug}/commits/${sha}/check-runs?per_page=100`,
    '[.check_runs[] | {name: .name, conclusion: .conclusion, description: (.output.title // "")}]'
  );
  return mergeCheckRows(
    statuses.map(row =>
      normalizeCheckRow(row.name, row.state, row.description)
    ),
    runs.map(row =>
      normalizeCheckRow(row.name, row.conclusion, row.description)
    )
  );
}

/**
 * Collapse GitHub's two reporter APIs into one authoritative row per name.
 *
 * A required context can appear as both a commit status and a check run. The
 * ruleset's integration id identifies the check-run reporter, so that row is
 * authoritative when the names collide. Without this merge, the earlier
 * status row could hide a pending check run and make settlement read the wrong
 * evidence description.
 *
 * @param {ReadonlyArray<{name: string, state: string, bucket?: string, description?: string}>} statuses - Normalized commit statuses
 * @param {ReadonlyArray<{name: string, state: string, bucket?: string, description?: string}>} runs - Normalized check runs
 * @returns {Array<{name: string, state: string, bucket?: string, description?: string}>} One row per context name
 */
export function mergeCheckRows(statuses, runs) {
  const rows = new Map();
  for (const row of statuses) rows.set(row.name, row);
  for (const row of runs) rows.set(row.name, row);
  return [...rows.values()];
}

/**
 * Puts one row from either API route into the shape this file evaluates.
 *
 * @param {string} name - Context or check-run name
 * @param {string|null|undefined} outcome - Status state, or a run's conclusion
 * @param {string|undefined} description - The description, verbatim
 * @returns {{name: string, state: string, bucket: string, description: string}} One row
 */
function normalizeCheckRow(name, outcome, description) {
  const state =
    outcome === null || outcome === undefined || outcome === ""
      ? "PENDING"
      : String(outcome).toUpperCase();
  const bucket =
    state === "PENDING" ? "pending" : state === "SUCCESS" ? "pass" : "fail";
  return { name: String(name), state, bucket, description: description ?? "" };
}

/**
 * The check names a declaration says carry evidence.
 *
 * @param {object} declaration - The per-repo declaration
 * @returns {string[]} Declared evidence-bearing check names
 */
export function declaredEvidenceChecks(declaration) {
  return Object.keys(declaration.evidence_bearing_checks ?? {});
}

/**
 * True when every declared evidence-bearing check has reached a terminal state.
 *
 * MEASURED (#2928): a review bot posts `pending — "Review queued"`, then
 * `pending — "Review in progress"`, and only then settles — in about nine
 * seconds, and IDENTICALLY on a pull request it goes on to review and one it
 * rate-limits. Both intermediate descriptions are in the shipped `no_work`
 * vocabulary, so an arm that evaluates the moment a pull request opens
 * manufactures a `vacuous_required_check` on EVERY pull request. A guard that
 * fires every time is indistinguishable from one that fires at random.
 *
 * A check that has posted NOTHING is unsettled for the same reason rather than
 * a different one: the bot has seconds of latency before its first status
 * exists, and "absent" is the shape that latency takes. Absent AFTER the wait
 * is a real finding — that is the measured #2493/#2491/#2488 case — so this
 * only decides when to stop waiting, never what the verdict is.
 *
 * @param {object} declaration - The per-repo declaration
 * @param {ReadonlyArray<{name: string, state: string, bucket?: string}>} checks - Rows
 * @returns {boolean} True when nothing declared is still in flight
 */
export function checksSettled(declaration, checks) {
  return declaredEvidenceChecks(declaration).every(name => {
    const found = checks.find(check => check.name === name);
    if (found === undefined) return false;
    if (String(found.bucket ?? "").toLowerCase() === "pending") return false;
    return String(found.state ?? "").toUpperCase() !== "PENDING";
  });
}

/**
 * Blocks this thread for `ms` without turning the event loop.
 *
 * `Atomics.wait` rather than a busy loop or an `await`: every other child start
 * in this file is synchronous, and making `main` async to sleep would change
 * the exit-code path that the rest of it works to keep meaningful.
 *
 * @param {number} ms - Milliseconds to sleep; non-positive returns at once
 * @returns {void}
 */
function sleepSync(ms) {
  if (ms <= 0) return;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Reads a pull request's checks, re-reading until the declared ones settle.
 *
 * @param {object} declaration - The per-repo declaration
 * @param {string|number} pr - Pull request number
 * @param {string|undefined} repo - `OWNER/NAME`, or undefined
 * @param {{timeoutSeconds?: number, intervalSeconds?: number, fetch?: Function, now?: Function, sleep?: Function, headSha?: Function}} [options] -
 *   Injection seams; the suite drives the whole loop through them so nothing
 *   here has to sleep in real time
 * @returns {{checks: object[], settled: boolean, headSha: string|undefined}} The rows, whether they settled, and the head they were read at
 */
export function fetchSettledChecks(declaration, pr, repo, options = {}) {
  const timeoutMs = (options.timeoutSeconds ?? SETTLE_TIMEOUT_SECONDS) * 1000;
  const intervalMs =
    (options.intervalSeconds ?? SETTLE_INTERVAL_SECONDS) * 1000;
  const read =
    options.fetch ??
    ((_request, slug, headSha) => {
      if (headSha === undefined) {
        throw new Error(
          "check-skipped-required-checks: cannot read review evidence without a concrete head commit."
        );
      }
      return fetchChecksForCommit(headSha, slug);
    });
  const resolveHead = options.headSha ?? resolveHeadSha;
  const clock = options.now ?? Date.now;
  const sleep = options.sleep ?? sleepSync;
  const deadline = clock() + timeoutMs;

  // Bracket every roster read with head reads. `gh pr checks` targets the PR's
  // current head but does not return the SHA it used, and the permission-light
  // fallback resolves the head internally. A push between either route and a
  // later provenance lookup used to make findings cite a commit whose checks
  // were never evaluated. Matching observations on both sides bind the roster
  // to that head; a mismatch is discarded and re-read, never reported.
  const snapshot = () => {
    const before = resolveHead(pr, repo);
    if (before === undefined) {
      return {
        checks: [],
        headSha: undefined,
        stable: false,
        after: undefined,
      };
    }
    const checks = read(pr, repo, before);
    const after = resolveHead(pr, repo);
    return {
      checks,
      headSha: before,
      stable: after !== undefined && before === after,
      after,
    };
  };

  let observed = snapshot();
  while (
    (!observed.stable || !checksSettled(declaration, observed.checks)) &&
    clock() < deadline
  ) {
    sleep(Math.min(intervalMs, deadline - clock()));
    observed = snapshot();
  }
  if (!observed.stable) {
    throw new Error(
      `check-skipped-required-checks: the pull request head changed while its checks were being read (${observed.headSha ?? "unresolved"} -> ${observed.after ?? "unresolved"}). Refusing to attach one commit's review evidence to another; re-read the pull request after the push settles.`
    );
  }
  return {
    checks: observed.checks,
    settled: checksSettled(declaration, observed.checks),
    headSha: observed.headSha,
  };
}

/**
 * Finds the open pull request for the checked-out branch, when nothing named one.
 *
 * `gh pr list --head` rather than `gh pr view`: the latter infers the branch
 * only when no `--repo` is passed, and REJECTS the combination outright, so the
 * one call that has to tolerate both shapes cannot use it.
 *
 * Streams are captured rather than inherited. The failure here is expected and
 * ordinary — a branch with no pull request is most of the branches there are —
 * and letting `gh`'s usage text reach stderr would put a scary block above a
 * report that is about to explain the situation in a sentence.
 *
 * @param {string} [repo] - `OWNER/NAME`, or undefined for the current repo
 * @returns {string|undefined} The number as written, or undefined
 */
function currentBranchPullRequest(repo) {
  try {
    const branch = boundedExecFileSync(
      "git",
      ["rev-parse", "--abbrev-ref", "HEAD"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
    ).trim();
    if (branch === "" || branch === "HEAD") return undefined;
    const args = [
      "pr",
      "list",
      "--head",
      branch,
      "--state",
      "open",
      "--limit",
      "1",
      "--json",
      "number",
      "--jq",
      ".[0].number // empty",
    ];
    if (repo) args.push("--repo", repo);
    const raw = boundedExecFileSync("gh", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
    return /^\d+$/u.test(raw) ? raw : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Parses a JSON file, returning null rather than throwing.
 *
 * @param {string} file - Absolute path
 * @returns {object|null} The parsed value, or null
 */
function readJsonOrNull(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

/**
 * Resolves the pull request this run is about, without being told.
 *
 * The order is most-explicit-first, and every step is a fact about the run
 * rather than a guess: an operator's `--pr`, the event payload Actions wrote
 * for THIS run, the ref that run checked out, and finally the branch a human
 * has checked out locally. Returning `undefined` is a real answer — the caller
 * refuses on it rather than examining a pull request it picked.
 *
 * @param {ReadonlyArray<string>} argv - CLI arguments
 * @param {NodeJS.ProcessEnv} [env] - Environment, injectable for tests
 * @param {{probeBranch?: Function}} [options] - Injection seam for the last step
 * @returns {{pr: string|undefined, source: string|null}} The number and where it came from
 */
export function resolvePullRequestNumber(
  argv,
  env = process.env,
  options = {}
) {
  const explicit = readFlagValue(argv, "--pr");
  if (explicit !== undefined) return { pr: explicit, source: "--pr" };

  const eventPath = env.GITHUB_EVENT_PATH;
  if (eventPath !== undefined && eventPath !== "" && existsSync(eventPath)) {
    const payload = readJsonOrNull(eventPath);
    const number = payload?.pull_request?.number ?? payload?.number;
    if (Number.isInteger(number)) {
      return { pr: String(number), source: "GITHUB_EVENT_PATH" };
    }
  }

  const ref = REF_PULL.exec(env.GITHUB_REF ?? "");
  if (ref !== null) return { pr: ref[1], source: "GITHUB_REF" };

  const probe = options.probeBranch ?? currentBranchPullRequest;
  const found = probe(readFlagValue(argv, "--repo"));
  return found === undefined
    ? { pr: undefined, source: null }
    : { pr: found, source: "gh pr view" };
}

/**
 * Names the reason this run inspected nothing, or null when it inspected.
 *
 * Ordered by how early the inspection died, so the message names the FIRST
 * thing that went wrong rather than a downstream symptom of it.
 *
 * @param {{declaration: object, pr?: string, checks?: ReadonlyArray<object>, error?: unknown}} input -
 *   What the arm managed to obtain
 * @returns {{kind: string, reason: string}|null} The refusal, or null
 */
export function vacuityRefusal(input) {
  const { declaration, pr, checks, error } = input;
  if (pr === undefined) {
    return {
      kind: VACUITY_REFUSALS.unresolvedPr,
      reason: `No pull request could be resolved, so no check was read and this arm examined NOTHING. It looked at \`--pr\`, the \`pull_request\` payload at GITHUB_EVENT_PATH, \`refs/pull/N/merge\` in GITHUB_REF, and \`gh pr list --head\` for the checked-out branch. Reporting a clean bill of health here would be indistinguishable from a pull request whose review really did happen — which is the exact collapse this guard exists to refuse.`,
    };
  }
  if (error !== undefined) {
    return {
      kind: VACUITY_REFUSALS.unreadableChecks,
      reason: `${error instanceof Error ? error.message : String(error)}\n  NOBODY LOOKED at PR #${pr}. That is a different fact from "the review was hollow", and this job being red says only the first.`,
    };
  }
  if ((checks ?? []).length === 0) {
    return {
      kind: VACUITY_REFUSALS.emptyRoster,
      reason: `PR #${pr} reported ZERO checks of any kind. A pull request with no checks and a pull request whose checks are all honest produce the same silence from this arm, so it refuses rather than picking one. Confirm the token can read checks (\`actions: read\` for the \`gh pr checks\` rollup, or \`checks: read\` + \`statuses: read\` for the fallback) before believing this.`,
    };
  }
  if (declaredEvidenceChecks(declaration).length === 0) {
    return {
      kind: VACUITY_REFUSALS.noneDeclared,
      reason: `\`evidence_bearing_checks\` in ${DECLARATION_PATH} is empty, so this repository has declared that NO check's green means anything reviewed the code — and the vacuity arm examined nothing on PR #${pr}. If that is true, say so by removing the arm from your workflow. If it is not, name the checks: \`"evidence_bearing_checks": { "CodeRabbit": {} }\`.`,
    };
  }
  return null;
}

/**
 * Fetches the live required contexts for every declared ruleset.
 *
 * @param {object} ruleset - `{ repo, ids }` from the declaration
 * @returns {string[]} Live contexts across all declared rulesets
 * @throws {Error} When `gh` is unavailable or the API cannot be read
 */
export function fetchLiveRequiredContexts(ruleset) {
  if (
    !ruleset?.repo ||
    !Array.isArray(ruleset.ids) ||
    ruleset.ids.length === 0
  ) {
    throw new Error(
      `check-skipped-required-checks: --remote needs \`ruleset.repo\` and \`ruleset.ids\` in ${DECLARATION_PATH}.`
    );
  }
  const contexts = [];
  for (const id of ruleset.ids) {
    const raw = boundedExecFileSync(
      "gh",
      [
        "api",
        `repos/${ruleset.repo}/rulesets/${id}`,
        "--jq",
        '.rules[] | select(.type=="required_status_checks") | .parameters.required_status_checks[].context',
      ],
      { encoding: "utf8" }
    );
    for (const line of raw.split("\n").map(value => value.trim())) {
      if (line !== "" && !contexts.includes(line)) contexts.push(line);
    }
  }
  return contexts;
}

/**
 * Diffs the committed snapshot against the live ruleset, in BOTH directions.
 *
 * Both directions matter. A context added in the admin console makes the
 * snapshot UNDER-detect (acmeorgd's ten-to-eleven drift, unnoticed for a day with
 * every test green). A context removed there makes it OVER-detect, and the
 * obvious fix for a false alarm is to weaken the guard.
 *
 * @param {ReadonlyArray<string>} snapshot - Committed contexts
 * @param {ReadonlyArray<string>} live - Contexts from the API
 * @returns {object[]} Drift violations
 */
export function compareRulesetBaseline(snapshot, live) {
  const added = live.filter(context => !snapshot.includes(context));
  const removed = snapshot.filter(context => !live.includes(context));
  if (added.length === 0 && removed.length === 0) return [];
  return [
    {
      kind: VIOLATIONS.remoteDrift,
      token: null,
      message: `\`required_contexts\` has drifted from the live ruleset.${added.length ? `\n  Live but not committed (the snapshot UNDER-detects): ${added.map(name => `"${name}"`).join(", ")}` : ""}${removed.length ? `\n  Committed but not live (the snapshot OVER-detects): ${removed.map(name => `"${name}"`).join(", ")}` : ""}\n  Update the snapshot and re-read what it now implies about the skip declarations.`,
    },
  ];
}

/**
 * Reads a `--name=<seconds>` flag, falling back when absent or unreadable.
 *
 * @param {ReadonlyArray<string>} argv - CLI arguments
 * @param {string} name - The flag, including its leading dashes
 * @param {number} fallback - Value to use when the flag is absent
 * @returns {number} A non-negative number of seconds
 */
function readSecondsFlag(argv, name, fallback) {
  const raw = readFlagValue(argv, name);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

/**
 * Runs the vacuity arm, refusing rather than reporting an empty inspection.
 *
 * Returns `undefined` when the arm was not asked for at all — which is the only
 * way this stays silent. Every other outcome, including "I could not look", is
 * a reported one.
 *
 * The settle wait is armed by `--vacuity` and NOT by a bare `--pr`, because the
 * two are different situations: `--pr=1234` is a human triaging one pull
 * request who wants today's instant answer, and `--vacuity` is an unattended
 * run that starts the moment a pull request opens, before the bot has posted
 * anything at all.
 *
 * @param {ReadonlyArray<string>} argv - CLI arguments
 * @param {object} declaration - The per-repo declaration
 * @param {{trustRequiredContexts?: boolean, env?: NodeJS.ProcessEnv, fetch?: Function, probeBranch?: Function, now?: Function, sleep?: Function, headSha?: Function}} [options] -
 *   Injection seams for the suite
 * @returns {{pr: string|undefined, prSource: string|null, headSha: string|undefined, checked: number, violations: object[], settled: boolean, refusal: {kind: string, reason: string}|null}|undefined} The inspection
 */
export function inspectVacuity(argv, declaration, options = {}) {
  const wired = argv.includes("--vacuity");
  if (!wired && readFlagValue(argv, "--pr") === undefined) return undefined;

  const { pr, source } = resolvePullRequestNumber(
    argv,
    options.env ?? process.env,
    options
  );
  const empty = {
    pr,
    prSource: source,
    checked: 0,
    violations: [],
    settled: false,
  };
  if (pr === undefined) {
    return { ...empty, refusal: vacuityRefusal({ declaration, pr }) };
  }

  const repo = readFlagValue(argv, "--repo");
  let read;
  try {
    read = fetchSettledChecks(declaration, pr, repo, {
      timeoutSeconds: readSecondsFlag(
        argv,
        "--settle-timeout",
        wired ? SETTLE_TIMEOUT_SECONDS : 0
      ),
      intervalSeconds: readSecondsFlag(
        argv,
        "--settle-interval",
        SETTLE_INTERVAL_SECONDS
      ),
      fetch: options.fetch,
      now: options.now,
      sleep: options.sleep,
      headSha: options.headSha,
    });
  } catch (error) {
    return { ...empty, refusal: vacuityRefusal({ declaration, pr, error }) };
  }

  const refusal = vacuityRefusal({ declaration, pr, checks: read.checks });
  if (refusal !== null) {
    return {
      ...empty,
      headSha: read.headSha,
      settled: read.settled,
      refusal,
    };
  }
  const evaluated = evaluateVacuousChecks(declaration, read.checks, {
    trustRequiredContexts: options.trustRequiredContexts,
    headSha: read.headSha,
  });
  // The gate is evaluated on EVERY run, not only when a caller asked it to
  // block. Its findings are what make a waiver visible, and a waiver that is
  // only computed when somebody opted in would be invisible on exactly the
  // repositories that have not opted in yet.
  const gate = evaluateReviewGate(declaration, read.checks, {
    headSha: read.headSha,
  });
  return {
    pr,
    prSource: source,
    headSha: read.headSha,
    checked: evaluated.checked,
    violations: [...evaluated.violations, ...gate.violations],
    gateStates: gate.states,
    settled: read.settled,
    refusal: null,
  };
}

/**
 * Runs the guard.
 *
 * `--remote` reads the ruleset live, so it does not need the cache to be
 * trustworthy — it is the thing that MAKES it trustworthy. Under `--remote` the
 * required-context rules therefore run regardless of the stamp, and any
 * disagreement surfaces as `ruleset_snapshot_drift` rather than as a verdict
 * about skips.
 *
 * @param {ReadonlyArray<string>} argv - CLI arguments
 * @param {object} [options] - Injection seams forwarded to {@link inspectVacuity}
 * @returns {{violations: object[], checked: number, tokens: string[], enforcement: string, trust: {trusted: boolean, reason: string}, recipe: string, pr: string|undefined, evidenceChecked: number, vacuity: object|undefined}} The result
 */
export function runGuard(argv, options = {}) {
  if (
    argv.includes("--require-review-evidence") &&
    !argv.includes("--vacuity") &&
    readFlagValue(argv, "--pr") === undefined
  ) {
    throw new Error(
      "check-skipped-required-checks: `--require-review-evidence` needs `--vacuity` or `--pr=<number>` so there is a pull request whose review evidence can be inspected."
    );
  }
  const positional = argv.filter(arg => !arg.startsWith("--"));
  const rootDir = positional[0] ?? process.cwd();
  const declaration = loadDeclaration(rootDir);
  const collected = collectSkipJobTokens(rootDir, declaration.workflows);
  const remote = argv.includes("--remote");
  const live = remote
    ? fetchLiveRequiredContexts(declaration.ruleset)
    : undefined;
  const trust = remote
    ? { trusted: true, reason: "" }
    : snapshotTrust(declaration);
  const result = evaluateSkippedRequiredChecks(
    live === undefined
      ? declaration
      : { ...declaration, required_contexts: live },
    collected.tokens,
    { trustRequiredContexts: trust.trusted }
  );
  const violations = [...collected.violations, ...result.violations];
  if (live !== undefined) {
    violations.push(
      ...compareRulesetBaseline(declaration.required_contexts, live)
    );
  }

  // The vacuity arm is layered ON TOP of the offline run rather than replacing
  // it: it is a third variant of one family, so it belongs in one report. Its
  // FINDINGS are `NEVER_BLOCKING`, so adding them cannot change the exit code
  // the offline arm would have produced on its own. Its REFUSAL is not a
  // finding and does change it — see `VACUITY_REFUSALS`.
  const vacuity = inspectVacuity(argv, declaration, {
    ...options,
    trustRequiredContexts: trust.trusted,
  });
  if (vacuity !== undefined) violations.push(...vacuity.violations);

  return {
    violations,
    checked: result.checked,
    tokens: collected.tokens,
    enforcement: declaration.enforcement ?? "error",
    trust,
    recipe: transcriptionRecipe(declaration),
    pr: vacuity?.pr,
    evidenceChecked: vacuity?.checked ?? 0,
    vacuity,
  };
}

/**
 * CLI entry point.
 *
 * @param {ReadonlyArray<string>} argv - Arguments
 * @returns {void}
 */
function main(argv) {
  /** @type {{violations: object[], checked: number, tokens: string[], enforcement: string, trust: {trusted: boolean, reason: string}, recipe: string}} */
  let result;
  try {
    result = runGuard(argv);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (argv.includes("--json")) {
      process.stdout.write(
        `${JSON.stringify({ ok: false, error: message }, null, 2)}\n`
      );
    } else {
      process.stderr.write(
        `::error title=Skipped-required-check guard::${message}\n`
      );
      process.stdout.write(`❌ ${message}\n`);
    }
    process.exitCode = 1;
    return;
  }

  const warnOnly = result.enforcement === "warn";
  // The supported alternative to a per-consumer `--json` wrapper. Opt-in, so
  // the shipped default is unchanged for everyone who does not pass it.
  const failOnVacuous = argv.includes("--fail-on-vacuous");
  // The review gate's own switch, deliberately NOT `--fail-on-vacuous`. That
  // flag means "fail on a check that did no work", which under the owner's
  // ruling (CodySwannGT/lisa#3221) is precisely the case that must NOT fail:
  // the two named entitlement descriptions are waived. Sharing one flag between
  // opposite policies is how a gate ends up doing the thing its name forbids.
  const requireReviewEvidence = argv.includes("--require-review-evidence");
  /**
   * True when a violation still fails the build under the active mode.
   *
   * @param {{kind: string}} violation - One violation
   * @returns {boolean} True when it blocks
   */
  const blocks = violation => {
    if (REVIEW_GATE_BLOCKING.includes(violation.kind)) {
      return requireReviewEvidence;
    }
    // A named waiver is report-only under every flag. `--fail-on-vacuous`
    // governs checks that claimed success without proving work; it must not
    // turn a vendor entitlement waiver into a failure through a shared array.
    if (violation.kind === VIOLATIONS.reviewWaived) return false;
    return NEVER_BLOCKING.includes(violation.kind)
      ? failOnVacuous
      : !warnOnly || ALWAYS_BLOCKING.includes(violation.kind);
  };
  const blocking = result.violations.filter(blocks);
  const refusal = result.vacuity?.refusal ?? null;
  const failed =
    blocking.length > 0 ||
    ((!result.trust.trusted || refusal !== null) && !warnOnly);

  if (argv.includes("--json")) {
    process.stdout.write(
      `${JSON.stringify(
        {
          ok: !failed,
          answered: result.trust.trusted,
          inspected:
            result.vacuity !== undefined && result.vacuity.refusal === null,
          ...result,
        },
        null,
        2
      )}\n`
    );
    if (failed) process.exitCode = 1;
    return;
  }

  const lines = ["## 🔒 Required checks that prove nothing", ""];

  // The refusal comes FIRST and replaces the verdict. Printing "✅ none
  // silences a required check" from a snapshot nobody transcribed is the one
  // outcome that is worse than never running: it is a confident wrong answer,
  // and it teaches people to trust it (#2476).
  if (!result.trust.trusted) {
    lines.push(
      `⛔ **NOT CHECKED** — this guard cannot say whether any skip silences a required status check, and will not pretend to.`,
      "",
      result.trust.reason,
      "",
      "```",
      result.recipe,
      "```",
      "",
      `Meanwhile \`--remote\` answers WITHOUT the cache, because it reads the ruleset live: \`npm run check:skipped-required-checks:remote\`.`,
      ""
    );
    process.stderr.write(
      `::${warnOnly ? "warning" : "error"} title=Skipped-required checks NOT CHECKED::${result.trust.reason.split("\n")[0]}\n`
    );
  }

  // Second refusal, same shape and the same reason as the first: an inspection
  // that never happened must not print the sentence a clean one prints.
  if (refusal !== null) {
    lines.push(
      `⛔ **NOT INSPECTED** (\`${refusal.kind}\`) — the vacuity arm did not examine a single check, and will not report that nothing was vacuous.`,
      "",
      refusal.reason,
      ""
    );
    process.stderr.write(
      `::${warnOnly ? "warning" : "error"} title=${refusal.kind}::${refusal.reason.split("\n")[0]}\n`
    );
  }

  if (result.violations.length === 0) {
    if (result.trust.trusted) {
      lines.push(
        `✅ ${result.checked} \`skip_jobs\` token(s) examined; none silences a ruleset-required status check.`,
        ...(result.pr === undefined || refusal !== null
          ? []
          : [
              `✅ ${result.evidenceChecked} evidence-bearing check(s) examined on PR #${result.pr}; each proved it did work.${
                result.vacuity?.settled === false
                  ? " (One or more had not settled when the wait expired, so this is what was true at that moment.)"
                  : ""
              }`,
            ])
      );
    } else {
      lines.push(
        `The rules that do NOT read \`required_contexts\` were still applied to ${result.checked} token(s) and found nothing.`
      );
    }
  } else {
    lines.push(
      `${blocking.length > 0 ? "❌" : "⚠️"} ${result.violations.length} violation(s) across ${result.checked} \`skip_jobs\` token(s):`,
      ""
    );
    for (const violation of result.violations) {
      lines.push(`- **${violation.kind}** — ${violation.message}`);
      process.stderr.write(
        `::${blocks(violation) ? "error" : "warning"} title=${violation.kind}::${violation.message.split("\n")[0]}\n`
      );
    }
    if (warnOnly) {
      lines.push(
        "",
        `This declaration sets \`"enforcement": "warn"\`, so ordinary findings are report-only. A proven false green (\`${VIOLATIONS.suppressesRequired}\`) still blocks.${requireReviewEvidence ? ` This run also passed \`--require-review-evidence\`, so \`${VIOLATIONS.reviewUnsatisfied}\` blocks.` : ""}${failOnVacuous ? ` This run also passed \`--fail-on-vacuous\`, so \`${VIOLATIONS.vacuous}\` and \`${VIOLATIONS.unproven}\` block.` : ""} Review each finding, fix or declare it, then delete the \`enforcement\` key when the adoption ramp is complete.`
      );
    }
    if (
      result.violations.some(violation =>
        [VIOLATIONS.vacuous, VIOLATIONS.unproven].includes(violation.kind)
      )
    ) {
      lines.push(
        "",
        failOnVacuous
          ? `\`${VIOLATIONS.vacuous}\` and \`${VIOLATIONS.unproven}\` are REPORT-ONLY by default; this run passed \`--fail-on-vacuous\`, which is the supported way to ask for an exit code once the governance call has been made. What they mean is unchanged: a PR carrying either finding has not been shown to be reviewed, so do not record it as reviewed.`
          : `\`${VIOLATIONS.vacuous}\` and \`${VIOLATIONS.unproven}\` are REPORT-ONLY in every enforcement mode — they never fail a build. A required check can go hollow because a vendor hit an org-wide spending cap, and reddening every PR on a billing state would be a worse gate than the one being criticised. What they change is what you may CLAIM: a PR carrying either finding has not been shown to be reviewed, so do not record it as reviewed. Pass \`--fail-on-vacuous\` to make them block.`
      );
    }
    if (
      result.violations.some(
        violation => violation.kind === VIOLATIONS.reviewWaived
      )
    ) {
      lines.push(
        "",
        `\`${VIOLATIONS.reviewWaived}\` is REPORT-ONLY under every enforcement mode and command-line flag. It records that the named review could not run; it is neither evidence that a review completed nor a failure the pull-request author can fix.`
      );
    }
  }
  const report = `${lines.join("\n")}\n`;
  process.stdout.write(report);
  if (process.env.GITHUB_STEP_SUMMARY) {
    // Synchronous, and failure-tolerant, because this is reporting rather than
    // verdict. The dynamic import returned a promise `main` did not await, so an
    // unwritable path, a removed directory or a full disk produced an unhandled
    // rejection — which Node exits non-zero on. A clean run then reported a CI
    // failure while the printed report said the guard passed, inverting the exit
    // code this file works hard to make meaningful. Losing a summary line is the
    // acceptable failure here; losing the verdict is not.
    try {
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, report);
    } catch (error) {
      console.error(
        `[skipped-required-checks] step summary not written: ${error.message}`
      );
    }
  }
  // Refusal is a failure, not a pass: an explicit run must never be mistaken
  // for a clean bill of health. `warn` — which only Lisa's untranscribed seeds
  // ship — downgrades it, because reddening a whole fleet the day a seed
  // arrives is how a gate gets deleted instead of transcribed.
  if (failed) process.exitCode = 1;
}

if (invokedAsScript(import.meta.url)) {
  main(process.argv.slice(2));
}
