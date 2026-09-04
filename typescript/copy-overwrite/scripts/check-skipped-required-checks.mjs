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
 *   node scripts/check-skipped-required-checks.mjs [rootDir] [--json]
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
 *  - **Skipped** (the offline arm, below): GitHub counts a `skipped`
 *    required check as SATISFIED, so a `skip_jobs` token makes the gate
 *    decorative. Static, offline, BLOCKING.
 *  - **Vacuous** (`--pr` arm): the check really ran and really reported
 *    `success`, having done no work — measured on CodeRabbit posting
 *    `success — "Review rate limited"`. Live, per-PR, REPORTING ONLY.
 *
 * ## Where this runs
 *
 * Lisa's `quality.yml` runs this on every pull request. EVERY arm is offline:
 * nothing here reads a live ruleset, needs a token, or touches the network for
 * the required-context rules. That is a deliberate reduction (#3599) — the
 * scheduled arm that used to re-read the ruleset was removed along with the
 * `administration:read` credential it required, which sat as a standing repo
 * secret in every consumer to detect a rare event. If the committed snapshot
 * and the live ruleset drift apart, that is now discovered by consequence
 * rather than by check, and that is the accepted trade. Do not reintroduce a
 * cheaper detector for it.
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
 * list nobody ever compared against a real ruleset. Measured (#2476): in one
 * repository, the seed Lisa shipped named a context that repository's rulesets
 * did not require and OMITTED SIX contexts that they did. A guard reading that
 * would clear a genuinely-skipped required check and flag a non-required one.
 * That is worse than a guard nobody runs, because it teaches people to trust
 * it. The specific context is deliberately unnamed: what is required is a
 * per-repository fact, not something a generated fleet-wide explanation can
 * assert.
 *
 * So `required_contexts` is treated as a cache of a live fetch, not as
 * testimony. Trust is a function of PRESENCE: it is believed while
 * `ruleset.baseline_fetched_at` carries a parseable timestamp, and refused when
 * that stamp is empty or unreadable. Untranscribed, the guard REFUSES to
 * answer: every rule that depends on `required_contexts` is skipped, no ✅ is
 * printed, and the report says NOT CHECKED and why. The rules that do NOT read
 * `required_contexts` — an undeclared token, a token written with whitespace —
 * still run, because they are true regardless of what the ruleset requires.
 *
 * NOTHING EXPIRES, and that is a decided constraint (#3599), not an oversight.
 * A ninety-day ceiling used to sit here, and it was coherent only while a
 * scheduled arm existed that could re-read the ruleset and re-stamp the file.
 * With that arm removed, a deadline is an obligation with no way to discharge
 * it: somebody would have to re-transcribe every consumer's snapshot every
 * quarter forever, or the guard silently goes NOT CHECKED. A guard that
 * reliably expires into "not checked" is worse than one answering from a stamp
 * somebody wrote once, because the first looks healthy right up until it has
 * been quietly inert for a quarter. A softer form — believe it, but warn past N
 * days — is the same substitution and is refused for the same reason: it
 * recreates the recurring manual obligation and adds a signal nobody can act
 * on. Non-empty believed. Empty refused. Nothing expiring.
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
 * That mutual policing has one blind spot, and it is now UNCOVERED ON PURPOSE:
 * two snapshots in one repo can only catch each other drifting from the CODE.
 * Neither can see the ruleset itself change in the admin console — which is
 * exactly how one repository's list silently went from ten contexts to eleven,
 * with every test still green, because the "independent" transcription was made
 * from the same reading at the same moment.
 *
 * A scheduled arm used to close that gap by reading the live ruleset, and it
 * was removed (#3599) because closing it cost a permanent `administration:read`
 * token in every consumer. The blind spot is the price of not holding that
 * credential. It is stated here rather than hidden, and it is not an invitation
 * to build a lighter-weight version of the same thing.
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
 * INVOKED IT. `quality.yml` ran the offline arm with no `--pr`, the then-shipped
 * scheduled drift workflow ran its own arm, and the package script named
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
 * normally loud and exits 0. `--require-review-evidence` is the deliberate
 * exception: a refusal then blocks because the caller required proven evidence.
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
  whitespace: "whitespace_in_skip_token",
  vacuous: "vacuous_required_check",
  unproven: "unproven_required_check",
  absent: "absent_required_check",
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
 */
const ALWAYS_BLOCKING = Object.freeze([VIOLATIONS.suppressesRequired]);

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

/** Enables the blocking review-evidence policy. */
const REQUIRE_REVIEW_EVIDENCE_FLAG = "--require-review-evidence";

/**
 * Selects how many recently merged pull requests the waive-rate sample reads.
 *
 * Zero — the shipped default — disables the sample entirely, so no repository
 * acquires a network read it did not ask for. The workflow that ships with Lisa
 * passes a value, because the number is the point: `.github/workflows/
 * review-evidence.yml` recorded "of the last 40 merged pull requests, 39 waive"
 * in a COMMENT, where it changed nothing for eight months. A rate that an
 * operator reads at merge time is a different artefact from a rate somebody
 * once measured.
 */
const WAIVE_RATE_SAMPLE_FLAG = "--waive-rate-sample";

/**
 * The one call the waive-rate sample makes.
 *
 * Kept beside the flag rather than inline in the reader so the network shape is
 * visible without reading a function: merged pull requests, newest first, each
 * with its head commit's rollup contexts. `StatusContext` and `CheckRun` are
 * both selected because a review bot may report as either and the description —
 * `description` on one, `title` on the other — is the only field that separates
 * a review from a waiver.
 */
const RECENT_MERGED_CHECKS_QUERY = [
  "query($owner:String!,$name:String!,$limit:Int!){",
  "repository(owner:$owner,name:$name){",
  "pullRequests(states:MERGED,first:$limit,orderBy:{field:UPDATED_AT,direction:DESC}){",
  "nodes{number commits(last:1){nodes{commit{statusCheckRollup{contexts(last:100){",
  "nodes{__typename",
  " ... on StatusContext{context state description}",
  " ... on CheckRun{name conclusion title}",
  "}}}}}}}}}}",
].join("");

/**
 * The flag that used to select the live-ruleset drift mode, retired with it.
 *
 * Kept as an explicit rejection rather than left to the argument parser. Every
 * unrecognised `--*` argument is discarded before the positional read, so a
 * caller that still selects the retired mode would otherwise get the ordinary
 * offline run and an exit code of zero — a caller asking for a live comparison
 * and being told "pass" by something that never looked. Retiring a mode
 * silently is how a removed control keeps reporting success.
 */
const RETIRED_REMOTE_FLAG = "--remote";

/**
 * What a caller that still selects the retired mode is told.
 *
 * Names the flag only to say it is gone: the caller has to be able to find the
 * thing it must delete. It is deliberately not a suggestion to run anything —
 * there is no live-ruleset mode left to point at.
 */
const RETIRED_REMOTE_MESSAGE = `check-skipped-required-checks: \`${RETIRED_REMOTE_FLAG}\` was retired together with the live-ruleset drift arm and the standing \`administration:read\` token it required (CodySwannGT/lisa#3599). There is no live comparison left to run, so this invocation would otherwise have reported success without performing the check that was asked for. Drop the flag, and drop the \`check:skipped-required-checks:remote\` npm script that passes it.`;

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
  const valueAt = at + 1;
  if (valueAt >= argv.length) return undefined;
  const next = argv[valueAt];
  return next.startsWith("--") ? undefined : next;
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
  assertRequiredDeclarationKeys(declaration);
  assertDeclarationCollections(declaration);
  assertEnforcementMode(declaration);
  assertSkipJobDeclarations(declaration.skip_job_declarations);
  assertEvidenceBearingChecks(declaration.evidence_bearing_checks ?? {});
  return declaration;
}

/**
 * Refuses a declaration that omits one of the guard's load-bearing snapshots.
 *
 * @param {object} declaration - Parsed declaration
 * @returns {void}
 */
function assertRequiredDeclarationKeys(declaration) {
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
}

/**
 * Validates the two top-level collections the evaluator consumes.
 *
 * @param {object} declaration - Parsed declaration
 * @returns {void}
 */
function assertDeclarationCollections(declaration) {
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
}

/**
 * Validates the optional enforcement switch independently of declaration data.
 *
 * @param {object} declaration - Parsed declaration
 * @returns {void}
 */
function assertEnforcementMode(declaration) {
  if (
    declaration.enforcement !== undefined &&
    !ENFORCEMENT_MODES.includes(declaration.enforcement)
  ) {
    throw new Error(
      `check-skipped-required-checks: \`enforcement\` must be one of ${ENFORCEMENT_MODES.map(mode => `"${mode}"`).join(", ")}, not ${JSON.stringify(declaration.enforcement)}. Omit it to enforce — a typo silently downgrading this guard to advice is the fail-open shape it exists to refuse.`
    );
  }
}

/**
 * Validates one skip-token declaration.
 *
 * @param {string} token - Declared skip token
 * @param {unknown} entry - Declaration value
 * @returns {void}
 */
function assertSkipJobDeclaration(token, entry) {
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

/**
 * Validates every skip-token declaration.
 *
 * @param {Record<string, unknown>} declarations - Token declarations
 * @returns {void}
 */
function assertSkipJobDeclarations(declarations) {
  // Validate the SHAPE of every declaration, not just its presence. A truthy
  // non-object entry (`"test:e2e": true`, or a string) reads as "declared" at
  // the point of use, then yields `suppressed_contexts: undefined` — no hits,
  // no violation. The guard silently becomes a no-op for exactly the token
  // someone was trying to document, which is the fail-open class this file
  // exists to refuse. A bad snapshot fails loudly HERE instead, where it is
  // unambiguously a configuration error rather than a clean bill of health.
  for (const [token, entry] of Object.entries(declarations)) {
    assertSkipJobDeclaration(token, entry);
  }
}

/**
 * Validates one optional description-vocabulary list.
 *
 * @param {string} checkName - Evidence-bearing check name
 * @param {object} entry - Vocabulary declaration
 * @param {string} list - Vocabulary list name
 * @returns {void}
 */
function assertEvidenceVocabularyList(checkName, entry, list) {
  if (entry[list] === undefined) return;
  if (
    !Array.isArray(entry[list]) ||
    entry[list].some(phrase => typeof phrase !== "string")
  ) {
    throw new Error(
      `check-skipped-required-checks: \`evidence_bearing_checks.${checkName}.${list}\` must be an array of description strings.`
    );
  }
  if (entry[list].some(phrase => normalizeDescription(phrase) === "")) {
    throw new Error(
      `check-skipped-required-checks: \`evidence_bearing_checks.${checkName}.${list}\` must not contain an empty or whitespace-only description. An empty phrase can match missing evidence or every description, depending on how the vocabulary is consumed.`
    );
  }
}

/**
 * Refuses vocabulary that grants and denies credit for the same description.
 *
 * @param {string} checkName - Evidence-bearing check name
 * @param {object} entry - Vocabulary declaration
 * @returns {void}
 */
function assertEvidenceVocabularyDisjoint(checkName, entry) {
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
      `check-skipped-required-checks: \`evidence_bearing_checks.${checkName}.satisfy\` and \`.waive\` must be disjoint after shipped defaults are applied. These phrases appear in both: ${overlap.map(phrase => JSON.stringify(phrase)).join(", ")}. A phrase cannot mean both "review completed" and "review did not run".`
    );
  }
}

/**
 * Validates every evidence-bearing check declaration.
 *
 * @param {Record<string, unknown>} checks - Evidence-bearing check declarations
 * @returns {void}
 */
function assertEvidenceBearingChecks(checks) {
  // Same reasoning for the vacuity declarations: a non-object entry would read
  // as "declared" and then yield an empty vocabulary, quietly examining the
  // check against defaults the author thought they had overridden.
  for (const [name, entry] of Object.entries(checks)) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      throw new Error(
        `check-skipped-required-checks: the declaration for \`${name}\` in \`evidence_bearing_checks\` must be an object — use \`{}\` to accept the shipped description vocabulary.`
      );
    }
    for (const list of ["proof", "no_work", "satisfy", "waive"]) {
      assertEvidenceVocabularyList(name, entry, list);
    }

    // Resolve the shipped defaults before checking disjointness. A custom
    // satisfaction that names a shipped waiver (or the reverse) is just as
    // ambiguous as overlap between two custom lists. Satisfaction is checked
    // first at runtime, so accepting overlap would silently upgrade an explicit
    // waiver into evidence that a review completed.
    assertEvidenceVocabularyDisjoint(name, entry);
  }
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
 * Trust is PRESENCE, not freshness (#3599). There is no age ceiling here and
 * there must not be one: the scheduled arm that could re-read a live ruleset
 * and re-stamp this file is gone, so an expiry would be a deadline nobody can
 * meet, and the guard would go quietly inert rather than loudly wrong. A
 * warning past N days is the same mistake wearing a softer hat — it recreates
 * the obligation and emits a signal no operator can discharge. The protection
 * that matters is the REFUSAL on an untranscribed snapshot, and that is what
 * the two arms below preserve.
 *
 * @param {object} declaration - The per-repo declaration
 * @returns {{trusted: boolean, reason: string}} Whether to believe the snapshot, and why not
 */
export function snapshotTrust(declaration) {
  const stamp = declaration.ruleset?.baseline_fetched_at;
  if (typeof stamp !== "string" || stamp.trim() === "") {
    return {
      trusted: false,
      reason: `\`ruleset.baseline_fetched_at\` is empty, so \`required_contexts\` has never been transcribed from a live ruleset. Lisa's seed ships a GUESS, and the guess was measured WRONG once in this fleet (#2476): in that repository it named a context no ruleset required and omitted six that were. It names no context here on purpose — what is required is a per-repository fact. Transcribe the real list, stamp the date, and this guard starts answering.`,
    };
  }
  if (Number.isNaN(Date.parse(stamp))) {
    return {
      trusted: false,
      reason: `\`ruleset.baseline_fetched_at\` is ${JSON.stringify(stamp)}, which is not a date this can read. Use an ISO-8601 timestamp, e.g. "2026-08-13".`,
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
    violations.push(
      ...evaluateSkippedToken(
        token,
        declarations[token],
        required,
        ticketPattern,
        trustRequired
      )
    );
  }

  violations.push(...findOrphanedExemptions(declarations, skipped));

  return { violations, checked: skipped.length };
}

/**
 * Evaluates one token against its declaration and the trusted ruleset snapshot.
 *
 * @param {string} token - Skip token in a workflow
 * @param {object|undefined} entry - Its declaration
 * @param {ReadonlySet<string>} required - Required-context snapshot
 * @param {RegExp} ticketPattern - Accepted exemption ticket pattern
 * @param {boolean} trustRequired - Whether the snapshot is trusted
 * @returns {object[]} Violations for this token
 */
function evaluateSkippedToken(
  token,
  entry,
  required,
  ticketPattern,
  trustRequired
) {
  if (!entry) {
    return [
      {
        kind: VIOLATIONS.undeclared,
        token,
        message: `\`${token}\` is skipped but not declared in ${DECLARATION_PATH}. Declare what it silences and whether any of that is ruleset-required — an undeclared skip is a skip nobody reviewed.`,
      },
    ];
  }
  if (!trustRequired) return [];

  const suppressed = entry.suppressed_contexts ?? [];
  const hits = suppressed.filter(context => required.has(context));
  return [
    ...evaluateRequiredSnapshotCoherence(token, entry, suppressed, hits),
    ...evaluateRequiredSuppression(token, entry, hits, ticketPattern),
  ];
}

/**
 * Checks whether one token's declaration agrees with the required snapshot.
 *
 * @param {string} token - Skip token
 * @param {object} entry - Token declaration
 * @param {ReadonlyArray<string>} suppressed - Contexts the token suppresses
 * @param {ReadonlyArray<string>} hits - Suppressed contexts that are required
 * @returns {object[]} Snapshot-coherence violations
 */
function evaluateRequiredSnapshotCoherence(token, entry, suppressed, hits) {
  if (hits.length > 0 && entry.ruleset_required !== true) {
    return [
      {
        kind: VIOLATIONS.incoherent,
        token,
        message: `\`${token}\` declares \`ruleset_required: false\`, but it suppresses ${hits.map(hit => `"${hit}"`).join(", ")}, which \`required_contexts\` says IS required. One of the two snapshots is out of date — fix the one that is wrong, do not delete the check.`,
      },
    ];
  }
  if (hits.length === 0 && entry.ruleset_required === true) {
    return [
      {
        kind: VIOLATIONS.stale,
        token,
        message: `\`${token}\` declares \`ruleset_required: true\`, but none of ${suppressed.map(name => `"${name}"`).join(", ") || "(nothing)"} appears in \`required_contexts\`. The context was renamed or de-required and this declaration now describes a world that no longer exists.`,
      },
    ];
  }
  return [];
}

/**
 * Checks whether a real required-context suppression has an owned exemption.
 *
 * @param {string} token - Skip token
 * @param {object} entry - Token declaration
 * @param {ReadonlyArray<string>} hits - Required contexts suppressed
 * @param {RegExp} ticketPattern - Accepted exemption ticket pattern
 * @returns {object[]} Suppression or exemption violations
 */
function evaluateRequiredSuppression(token, entry, hits, ticketPattern) {
  if (hits.length === 0) return [];
  const exemption = entry.exemption;
  if (!exemption) {
    return [
      {
        kind: VIOLATIONS.suppressesRequired,
        token,
        contexts: hits,
        message: `\`${token}\` silences the ruleset-required context(s) ${hits.map(hit => `"${hit}"`).join(", ")}. GitHub counts a SKIPPED required check as SATISFIED, so that context reports green having run zero steps — the gate is decorative. Fix the suite, de-require the context, or record an exemption with a tracker ticket.`,
      },
    ];
  }
  if (
    typeof exemption.ticket !== "string" ||
    !ticketPattern.test(exemption.ticket)
  ) {
    return [
      {
        kind: VIOLATIONS.badExemption,
        token,
        message: `\`${token}\` carries an exemption whose ticket ${JSON.stringify(exemption.ticket)} does not match ${ticketPattern}. An exemption is a decision someone owns; without a ticket it is just a way to silence this guard.`,
      },
    ];
  }
  return [];
}

/**
 * Finds exemptions whose tokens are no longer skipped.
 *
 * @param {Record<string, object>} declarations - All token declarations
 * @param {ReadonlyArray<string>} skipped - Tokens currently skipped
 * @returns {object[]} Orphaned-exemption violations
 */
function findOrphanedExemptions(declarations, skipped) {
  const violations = [];
  for (const [token, entry] of Object.entries(declarations)) {
    if (!entry.exemption || skipped.includes(token)) continue;
    violations.push({
      kind: VIOLATIONS.orphaned,
      token,
      message: `\`${token}\` carries an exemption but is no longer skipped anywhere. Delete the exemption — leaving it teaches readers that the exemption list is fiction.`,
    });
  }
  return violations;
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
  const entries = Object.entries(declared);

  for (const [name, entry] of entries) {
    const violation = evaluateEvidenceBearingCheck(name, entry, checks, {
      at,
      required,
      trustRequired,
    });
    if (violation !== null) violations.push(violation);
  }

  return { violations, checked: entries.length };
}

/**
 * Explains whether the named evidence check is part of the trusted ruleset.
 *
 * @param {string} name - Check context name
 * @param {boolean} trustRequired - Whether the ruleset snapshot is trusted
 * @param {ReadonlySet<string>} required - Required-context snapshot
 * @returns {string} Sentence appended to a finding
 */
function evidenceRequiredNote(name, trustRequired, required) {
  if (!trustRequired) {
    return " Whether it is ruleset-required is NOT KNOWN here — `required_contexts` has not been transcribed, so this cannot say what the merge gate recorded.";
  }
  return required.has(name)
    ? " This context IS ruleset-required, so branch protection recorded a satisfied review gate for a review that did not happen."
    : " This context is not in `required_contexts`, so no merge gate was falsified — but nothing reviewed this either.";
}

/**
 * Evaluates one declared evidence-bearing check.
 *
 * @param {string} name - Declared check name
 * @param {object} entry - Per-check description vocabulary
 * @param {ReadonlyArray<object>} checks - Reported checks
 * @param {{at: string, required: ReadonlySet<string>, trustRequired: boolean}} context - Shared evaluation context
 * @returns {object|null} A finding, or null when this check proved work or is red
 */
function evaluateEvidenceBearingCheck(name, entry, checks, context) {
  const vocabulary = entry && typeof entry === "object" ? entry : {};
  const found = checks.find(check => check.name === name);
  if (found === undefined) {
    return {
      kind: VIOLATIONS.unproven,
      token: name,
      message: `\`${name}\` is declared evidence-bearing but did not report on this pull request at all.${context.at} A report of "no unresolved review threads" from this PR means NOBODY LOOKED, not that nothing was wrong — say which one you observed. (If the context was renamed, fix \`evidence_bearing_checks\`; names are compared byte for byte.)`,
    };
  }

  const state = String(found.state ?? "").toUpperCase();
  if (state === "FAILURE" || state === "ERROR") return null;

  const verdict = classifyCheckDescription(found.description, vocabulary);
  if (verdict === DESCRIPTION_VERDICTS.proved && state === "SUCCESS") {
    return null;
  }

  const requiredNote = evidenceRequiredNote(
    name,
    context.trustRequired,
    context.required
  );
  if (verdict === DESCRIPTION_VERDICTS.noWork && state === "SUCCESS") {
    return {
      kind: VIOLATIONS.vacuous,
      token: name,
      contexts: [name],
      message: `\`${name}\` reported ${state} with the description ${JSON.stringify(found.description ?? "")}, which says it DID NO WORK.${context.at}${requiredNote} \`gh pr checks\` prints \`pass\` for this exactly as it does for a real review — the description is the only thing that tells them apart. Treat this PR as UNREVIEWED.`,
    };
  }
  return {
    kind: VIOLATIONS.unproven,
    token: name,
    message: `\`${name}\` reported ${state} with the description ${JSON.stringify(found.description ?? "")}, which proves neither that it reviewed anything nor that it did not.${context.at}${requiredNote} Read the check itself before treating this PR as reviewed, or add the phrase to \`evidence_bearing_checks.${name}.proof\` once you have confirmed what it means.`,
  };
}

/**
 * Every required context that posted NO check-run at all.
 *
 * The third member of the family this file's header names, and the one that was
 * missing. **Skipped** is a check that ran and declined to prove anything;
 * **vacuous** is one that ran, reported success, and did no work; **absent** is
 * one that never reported. All three satisfy a merge gate without evidence, and
 * absence is the quietest because it produces no row for anyone to read.
 *
 * MEASURED (CodySwannGT/lisa#3580, on PR #3573): 15 required contexts, 2
 * reported, 13 absent. The three workflow runs that would have posted them sat
 * at `conclusion: action_required` with `created_at == updated_at` — parked,
 * never executed. The pull request rendered as "CI running" for 26 hours.
 *
 * **Why the vacuity arm could not see it.** {@link evaluateVacuousChecks}
 * iterates `evidence_bearing_checks`, which held ONE name on that repository.
 * `required_contexts` held fifteen. This file already knew the full required
 * set and spent it only on an annotation — "This context IS ruleset-required" —
 * attached to findings about the one. Nothing ever walked the fifteen to ask
 * which of them said nothing. The data was here; the question was not.
 *
 * Three properties, each load-bearing:
 *
 * - **Absent is not pending.** A check in flight has posted a row and will post
 *   a verdict; an absent one never will. Folding them together is the confusion
 *   that made the stall invisible, so this must not make it in reverse — only a
 *   context with no row at all counts, whatever state the rows carry.
 * - **No snapshot, no finding.** Without `required_contexts` this cannot know
 *   what was required, and a guard that invented the set would fire on every
 *   repository that has not transcribed one. Absence of knowledge is not
 *   knowledge of absence — the same distinction the arm exists to enforce,
 *   pointed at itself.
 * - **The parked-run lookup is an ENRICHMENT, never a precondition.** It names
 *   the approval gate when it can, because "absent" alone sends an operator
 *   hunting a broken workflow. But a finding that only reports when it can also
 *   explain would report nothing wherever the explanation is unavailable, which
 *   is the silent failure this was written to end.
 * @param {object} declaration - The per-repo declaration
 * @param {ReadonlyArray<{name: string}>} checks - Rows read for the head SHA
 * @param {object} [options] - `headSha` to cite, `parkedRuns` to explain with
 * @returns {{violations: object[], checked: number, absent: string[]}} Findings
 */
export function evaluateAbsentRequiredChecks(
  declaration,
  checks,
  options = {}
) {
  const required = declaration.required_contexts;
  if (!Array.isArray(required))
    return { violations: [], checked: 0, absent: [] };

  const at = citeHeadSha(options.headSha);
  const parked = (options.parkedRuns ?? []).filter(
    run => String(run?.conclusion ?? "") === "action_required"
  );
  // Named once for every finding rather than per context: a parked run posts no
  // check-run, so nothing ties one run to one absent context. Reporting the
  // whole parked set against each is honest about that; pretending to a mapping
  // this data cannot support would be a worse answer than an imprecise one.
  const approval =
    parked.length === 0
      ? ""
      : ` A workflow run for this head is parked at \`action_required\` and will never complete on its own: ${parked
          .map(
            run => `${JSON.stringify(String(run.name ?? ""))} (run ${run.id})`
          )
          .join(
            ", "
          )}. Approve it with \`gh api -X POST repos/<owner>/<repo>/actions/runs/<id>/approve\`, or the context stays absent indefinitely.`;

  const absent = required.filter(
    name => checks.find(check => check.name === name) === undefined
  );

  return {
    checked: required.length,
    absent,
    violations: absent.map(name => ({
      kind: VIOLATIONS.absent,
      token: name,
      contexts: [name],
      message: `\`${name}\` is ruleset-required but did not report on this pull request at all.${at} It posted NO check-run — not pending, not failing, ABSENT. \`gh pr checks\` prints no line for it and the pull request page renders it exactly as one still in flight, so every surface says "wait" and none says "broken".${approval} (If the context was renamed, fix \`required_contexts\`; names are compared byte for byte.)`,
    })),
  };
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
 * WHICH condition produced the state, as stable tokens.
 *
 * The state is the gate's SEVERITY and stays three-valued; this is what the
 * gate OBSERVED, and it is seven-valued because `unsatisfied` is reached from
 * five structurally different situations:
 *
 * | condition       | what actually happened           | operator's next move  |
 * |-----------------|----------------------------------|-----------------------|
 * | `absent`        | nobody reviewed                  | investigate the silence |
 * | `objected`      | a review ran and objected        | READ THE OBJECTION    |
 * | `pending`       | the reviewer is late             | wait, then re-run     |
 * | `unrecognised`  | the reviewer said something new  | classify the phrase   |
 * | `undetermined`  | THE GATE STOPPED WAITING         | re-run; read nothing into it |
 *
 * All of them published one word, so an operator handed `unsatisfied` had to
 * guess between situations whose correct responses have nothing in common. That
 * collapse is why CodySwannGT/lisa#3706, #3716 and #3600 each described a
 * different defect and each was partly right: they are faces of one
 * impoverished vocabulary.
 *
 * The second row is the sharpest. This file states that a review which
 * "RAN AND OBJECTED is the case this gate exists to let through to a human" —
 * and then reported it identically to nobody-reviewed. Blocking is correct
 * there, so no exit code was ever wrong; what was missing is any way to tell
 * the operator which of them they were looking at.
 *
 * THE LAST ROW IS NOT AN OBSERVATION AND MUST NEVER READ LIKE ONE (#3716).
 * `absent` and `pending` are things the gate SAW; `undetermined` is the gate
 * saying it ran out of time before it could see anything. Reported as `absent`
 * — "did not report on this pull request at all... investigate the silence" —
 * it sends an operator to audit the change instead of the wait, which is
 * exactly what a false red costs. MEASURED: a settle window expired NINE
 * SECONDS before the review it was waiting for arrived.
 *
 * And it is not a rare corner. {@link checksSettled} returns false whenever a
 * declared check is missing or still pending, so the wait CANNOT end early on
 * either shape: with one declared check, every `absent` and every `pending`
 * this gate can currently produce is a wait that expired. The two tokens are
 * kept because they are the honest labels for a settled reading, and a future
 * declaration with several checks can settle one while another is still in
 * flight — but today `undetermined` is what fires, and that is the point.
 *
 * SEVERITY IS DELIBERATELY UNCHANGED HERE. See `reviewGateState` for why
 * `pending` keeps blocking, and why `undetermined` blocks with it.
 */
export const REVIEW_GATE_CONDITIONS = Object.freeze({
  satisfied: "satisfied",
  waived: "waived",
  absent: "absent",
  objected: "objected",
  pending: "pending",
  unrecognised: "unrecognised",
  undetermined: "undetermined",
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
 * SEVERITY IS DELIBERATELY UNCHANGED. CodySwannGT/lisa#3600 reads the gate as
 * "backwards" — harsh on a late reviewer, lenient on a hollow one — and asks
 * for the two to be reconciled. Only half of that survives the invariant the
 * gate exists to enforce, which is THAT A REVIEW ACTUALLY HAPPENED:
 *
 * - `pending` means the review has not happened YET, so blocking is correct.
 *   Making it report-only would let a pull request merge unreviewed whenever a
 *   reviewer ran slow, which is the exact outcome this gate exists to prevent.
 * - The asymmetry #3600 names is real, but it points the other way: the lenient
 *   side is the hollow green, and that leniency is the owner's explicit ruling
 *   on #3221 (a vendor billing state nobody on the pull request can act on).
 *
 * So the response stays proportional by making the gate SAY which condition it
 * observed, not by lowering what it does about lateness. Reversing the severity
 * would trade a false red for a silent merge, and this file has a whole
 * vocabulary of evidence that the silent direction is the expensive one.
 *
 * WAITING IS NOT OBSERVING (#3716). `reading.waitExpired` is the settle loop
 * reporting that it hit its deadline rather than reaching a terminal read. When
 * it is set, the two shapes that mean "nothing conclusive yet" — no status at
 * all, and a status still in flight — are reported as `undetermined` instead of
 * as `absent` and `pending`. The distinction between those two shapes is
 * preserved inside the sentence, because "never started" and "started and ran
 * long" are different things to go and look at; what changes is that neither is
 * asserted as a fact about the reviewer when the gate simply stopped waiting.
 *
 * @param {{present: boolean, state?: string, description?: string, waitExpired?: boolean}} reading - One check, and whether the settle wait expired
 * @param {{waive?: readonly string[], satisfy?: readonly string[]}} [vocabulary] - Per-check extensions
 * @returns {{state: string, condition: string, why: string}} Severity, the condition observed, and a one-line reason
 */
export function reviewGateState(reading, vocabulary = {}) {
  if (!reading.present) return unreportedReviewGateState(reading.waitExpired);

  const state = String(reading.state ?? "").toUpperCase();
  const text = normalizeDescription(reading.description);
  if (state === "FAILURE" || state === "ERROR") {
    return objectedReviewGateState(state, text, reading.description);
  }
  if (state !== "SUCCESS") {
    return pendingReviewGateState(state, reading.waitExpired);
  }
  return successfulReviewGateState(text, reading.description, vocabulary);
}

/**
 * Builds the common verdict for a settle window that expired inconclusively.
 *
 * @param {string} seen - What the final poll observed
 * @returns {{state: string, condition: string, why: string}} Review gate verdict
 */
function undeterminedReviewGateState(seen) {
  return {
    state: REVIEW_GATE_STATES.unsatisfied,
    condition: REVIEW_GATE_CONDITIONS.undetermined,
    why: `was ${seen} when the settle window EXPIRED. The gate stopped waiting; it did not observe that nobody reviewed. This is NOT a finding about the code and nothing about the change should be investigated on the strength of it — RE-RUN THIS JOB once the reviewer has settled. Blocking is deliberate: an expired wait has not established that a review happened, and passing on it would let a pull request merge unreviewed whenever a reviewer ran slow. Do NOT re-request the review: a re-request OVERWRITES the existing commit status rather than adding to it, so under throttle it destroys a real review one-way and replaces a substantive objection with a rate-limit string.`,
  };
}

/**
 * Classifies a check that did not report at all.
 *
 * @param {boolean|undefined} waitExpired - Whether the settle window expired
 * @returns {{state: string, condition: string, why: string}} Review gate verdict
 */
function unreportedReviewGateState(waitExpired) {
  if (waitExpired === true) {
    return undeterminedReviewGateState("still unreported");
  }
  return {
    state: REVIEW_GATE_STATES.unsatisfied,
    condition: REVIEW_GATE_CONDITIONS.absent,
    why: "did not report on this pull request at all. ABSENT is not the same as waived: nothing said it could not review, so nothing accounts for the silence. A guard that read absence as permission would pass forever the first time it looked at the wrong commit.",
  };
}

/**
 * Classifies a review check that ran and objected.
 *
 * @param {string} state - Normalized failure state
 * @param {string} text - Normalized description
 * @param {string|undefined} description - Original description
 * @returns {{state: string, condition: string, why: string}} Review gate verdict
 */
function objectedReviewGateState(state, text, description) {
  return {
    state: REVIEW_GATE_STATES.unsatisfied,
    condition: REVIEW_GATE_CONDITIONS.objected,
    why: `reported ${state}${text === "" ? "" : ` — ${JSON.stringify(description ?? "")}`}. A review that RAN AND OBJECTED is the case this gate exists to let through to a human, and it is the one thing no waiver covers. READ THE OBJECTION: this is the one condition here where a review did happen.`,
  };
}

/**
 * Classifies a check that has not reached success or failure.
 *
 * @param {string} state - Normalized in-flight state
 * @param {boolean|undefined} waitExpired - Whether the settle window expired
 * @returns {{state: string, condition: string, why: string}} Review gate verdict
 */
function pendingReviewGateState(state, waitExpired) {
  const observed = state === "" ? "unreported" : state;
  if (waitExpired === true) {
    return undeterminedReviewGateState(`still ${observed}`);
  }
  return {
    state: REVIEW_GATE_STATES.unsatisfied,
    condition: REVIEW_GATE_CONDITIONS.pending,
    why: `is still ${observed} after the settle window. An unsettled check has not said anything yet, and the gate does not guess on its behalf. This is LATENESS, not a verdict about the code — wait for the reviewer to settle, then RE-RUN THIS JOB. Do NOT re-request the review: a re-request OVERWRITES the existing commit status rather than adding to it, so under throttle it destroys a real review one-way and replaces a substantive objection with a rate-limit string.`,
  };
}

/**
 * Classifies a successful check from its exact description vocabulary.
 *
 * @param {string} text - Normalized description
 * @param {string|undefined} description - Original description
 * @param {{waive?: readonly string[], satisfy?: readonly string[]}} vocabulary - Per-check extensions
 * @returns {{state: string, condition: string, why: string}} Review gate verdict
 */
function successfulReviewGateState(text, description, vocabulary) {
  const satisfies = [...REVIEW_SATISFACTIONS, ...(vocabulary.satisfy ?? [])];
  if (satisfies.some(phrase => text === normalizeDescription(phrase))) {
    return {
      state: REVIEW_GATE_STATES.satisfied,
      condition: REVIEW_GATE_CONDITIONS.satisfied,
      why: `reported ${JSON.stringify(description ?? "")}, which is a review that ran.`,
    };
  }
  const waivers = [...ENTITLEMENT_WAIVERS, ...(vocabulary.waive ?? [])];
  if (waivers.some(phrase => text === normalizeDescription(phrase))) {
    return {
      state: REVIEW_GATE_STATES.waived,
      condition: REVIEW_GATE_CONDITIONS.waived,
      why: `reported ${JSON.stringify(description ?? "")} — the check saying, in its own words, that it could not review. WAIVED, not satisfied: this pull request is UNREVIEWED and merging it is a decision taken on that basis. The waiver clears the moment the entitlement behind it is fixed, at which point this gate starts biting with no code change.`,
    };
  }
  return {
    state: REVIEW_GATE_STATES.unsatisfied,
    condition: REVIEW_GATE_CONDITIONS.unrecognised,
    why: `reported SUCCESS with the description ${JSON.stringify(description ?? "")}, which is neither a review that ran nor one of the named waivers. An UNRECOGNISED description is surfaced rather than waived — a gate that waived on "anything that is not a completed review" would waive a genuine failure and every phrase the vendor has not invented yet. If this string is legitimate, add it to \`evidence_bearing_checks\` under \`satisfy\` or \`waive\`, deliberately and by name.`,
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
 * @param {{headSha?: string, waitExpired?: boolean}} [options] - `headSha` is cited in every finding; `waitExpired` says the settle loop hit its deadline
 * @returns {{violations: object[], states: Record<string, string>, conditions: Record<string, string>, descriptions: Record<string, string>, checked: number}} Findings, per-check state and condition, the description each verdict was read from, and how many were examined
 */
export function evaluateReviewGate(declaration, checks, options = {}) {
  const declared = declaration.evidence_bearing_checks ?? {};
  const at = citeHeadSha(options.headSha);
  const violations = [];
  const states = {};
  // Carried alongside the states for the same reason the descriptions are: the
  // RENDERED verdict has to say WHICH condition it is publishing, and `states`
  // is three-valued severity that cannot tell an expired wait from a review
  // that ran and objected (#3716).
  const conditions = {};
  // Carried out with the states because the RENDERED verdict quotes it. A title
  // that said only "WAIVED" would tell an operator that something was waived
  // and not which vendor sentence did the waiving, which is the fact that says
  // whether to wait for the entitlement or merge on the waiver.
  const descriptions = {};
  let checked = 0;

  for (const [name, entry] of Object.entries(declared)) {
    checked += 1;
    const vocabulary = typeof entry === "object" && entry !== null ? entry : {};
    const found = checks.find(check => check.name === name);
    const verdict = reviewGateState(
      found === undefined
        ? { present: false, waitExpired: options.waitExpired === true }
        : {
            present: true,
            state: found.state,
            description: found.description,
            waitExpired: options.waitExpired === true,
          },
      vocabulary
    );
    states[name] = verdict.state;
    conditions[name] = verdict.condition;
    // Assigned ONLY when the check reported. An absent check with a `""`
    // description entry renders as `CodeRabbit reported ""` — a sentence that
    // says it reported. MEASURED on this fix's own first commit, where the
    // published verdict read exactly that. Absence is not a quiet report, and
    // the whole file turns on the two being different facts.
    if (found !== undefined)
      descriptions[name] = String(found.description ?? "");
    if (verdict.state === REVIEW_GATE_STATES.satisfied) continue;
    violations.push({
      kind:
        verdict.state === REVIEW_GATE_STATES.waived
          ? VIOLATIONS.reviewWaived
          : VIOLATIONS.reviewUnsatisfied,
      // WHICH of the four unsatisfying conditions this was. The `kind` carries
      // severity and cannot distinguish them — it is the same token for a
      // review that objected and for one that never ran. Anything rendering
      // this violation can now say which, without re-parsing the prose.
      condition: verdict.condition,
      token: name,
      contexts: [name],
      message: `\`${name}\` ${verdict.why}${at}`,
    });
  }

  return { violations, states, conditions, descriptions, checked };
}

/**
 * The check-run conclusion each review-gate verdict is published under.
 *
 * THIS IS THE WHOLE POINT OF #3639. Before this map existed the gate's three
 * verdicts all reached a merge decision through the same rendering: the job
 * exited 0 for `satisfied` AND for `waived`, so `gh pr checks` printed
 *
 *     🕵️ Did the required review checks do any work?   pass
 *
 * for a pull request nothing had read, character for character what it prints
 * for one a reviewer completed. The distinction lived in the run log, and the
 * file's own header had already measured how little that is worth: of the last
 * 40 merged pull requests, 39 waived. A waiver that applies to 39 of 40 merges
 * is the default path, and the default path rendering as the success path
 * reproduces — on the guard's own green — the exact indistinguishability the
 * guard exists to remove.
 *
 * `neutral` is the mechanism because it is the one conclusion that is NOT a
 * pass and NOT a failure. `gh pr checks` buckets NEUTRAL as `skipping`, so the
 * row reads differently at a glance, while contributing neither a failure to
 * gh's exit code nor a satisfied context to branch protection. The waiver keeps
 * its rationale — a pull request author cannot fix a vendor's billing state,
 * and reddening every PR on it would be a worse gate — and loses only its
 * disguise.
 */
export const REVIEW_VERDICT_CONCLUSIONS = Object.freeze({
  satisfied: "success",
  waived: "neutral",
  unsatisfied: "failure",
  uninspected: "failure",
});

/** GitHub truncates a check-run output title past this many characters. */
export const REVIEW_VERDICT_TITLE_LIMIT = 255;

/**
 * Flattens a title to one line and fits it in a check-run output title.
 *
 * Single-line is a correctness requirement, not tidiness: this string is
 * written to `$GITHUB_OUTPUT` as `key=value`, where a newline in the value ends
 * the assignment and the remainder is parsed as further output keys. A vendor
 * description is arbitrary text from outside this repository.
 *
 * @param {string} text - The composed title
 * @returns {string} One line, at most {@link REVIEW_VERDICT_TITLE_LIMIT} chars
 */
function fitTitle(text) {
  const flat = String(text).replace(/\s+/gu, " ").trim();
  return flat.length <= REVIEW_VERDICT_TITLE_LIMIT
    ? flat
    : `${flat.slice(0, REVIEW_VERDICT_TITLE_LIMIT - 1)}…`;
}

/**
 * The waive-rate sentence appended to a verdict title, or nothing.
 *
 * @param {{waived: number, sampled: number}|undefined} rate - A sampled tally
 * @returns {string} The sentence, or an empty string when nothing was sampled
 */
function waiveRateSuffix(rate) {
  return rate === undefined || rate.sampled === 0
    ? ""
    : ` · waived on ${rate.waived} of the last ${rate.sampled} merged pull requests`;
}

/**
 * Renders one merge-time verdict for every declared evidence-bearing check.
 *
 * Worst-wins across the declared checks, in the order `unsatisfied` > `waived`
 * > `satisfied`. One waived check among four satisfied ones still means this
 * pull request has an unreviewed arm, and a verdict that averaged them would be
 * the summary that hides the finding.
 *
 * Pure, and deliberately separate from the publishing step, so the property
 * that matters — a waiver and a satisfaction never render the same — is
 * testable without a GitHub API.
 *
 * THE TITLE IS THE ONLY LAYER A MERGE DECISION READS (#3716). Before this, an
 * expired settle wait published `UNREVIEWED — ... posted NO review status at
 * all`: a sentence asserting an observation the gate never made. The timeout
 * was known — the settle loop returned it — and it reached only a parenthetical
 * in the job summary, and only on the branch where there were NO violations. So
 * the one path where it mattered, a red check blocking a merge, was the one
 * path that never said it. The conditions are carried here for that reason.
 *
 * @param {{states?: Record<string, string>, conditions?: Record<string, string>, descriptions?: Record<string, string>, refusal?: {kind: string}|null, waiveRate?: {waived: number, sampled: number}}} reading -
 *   The gate's per-check states and conditions, the descriptions they were read
 *   from, any refusal, and an optional sampled waive rate
 * @returns {{verdict: string, conclusion: string, title: string}} What to publish
 */
export function reviewGateVerdict(reading = {}) {
  const states = reading.states ?? {};
  const conditions = reading.conditions ?? {};
  const descriptions = reading.descriptions ?? {};
  const names = Object.keys(states);
  const suffix = waiveRateSuffix(reading.waiveRate);

  if (reading.refusal || names.length === 0) {
    return {
      verdict: "uninspected",
      conclusion: REVIEW_VERDICT_CONCLUSIONS.uninspected,
      title: fitTitle(
        `NOT INSPECTED — no review evidence was read${reading.refusal ? ` (${reading.refusal.kind})` : ""}. NOBODY LOOKED is not the same fact as a clean review.`
      ),
    };
  }

  /**
   * Names one check alongside the exact description its verdict was read from.
   *
   * A check with no entry never REPORTED, and says so. `reported ""` for a
   * check that posted nothing is the one phrasing this whole file exists to
   * refuse: it makes absence look like a quiet answer.
   *
   * An `undetermined` check is quoted as a WAIT, never as a report. Saying it
   * "posted NO review status at all" is true of the bytes and false as an
   * account of what happened, and it is the sentence that sends an operator to
   * audit the change rather than re-run the job.
   *
   * @param {string} name - The declared check name
   * @returns {string} `<name> reported "<description>"`, or what the wait did
   */
  const quote = name => {
    if (conditions[name] === REVIEW_GATE_CONDITIONS.undetermined) {
      return `${name} had not settled when the gate's wait EXPIRED — not observed to be unreviewed`;
    }
    return Object.hasOwn(descriptions, name)
      ? `${name} reported ${JSON.stringify(descriptions[name])}`
      : `${name} posted NO review status at all`;
  };

  const unsatisfied = names.filter(
    name => states[name] === REVIEW_GATE_STATES.unsatisfied
  );
  if (unsatisfied.length > 0) {
    // FAIL-CLOSED, LABELLED. The conclusion is `failure` either way: an expired
    // wait has not established that a review happened, and the whole family of
    // defects this gate is made of is a control reporting a conclusion it did
    // not reach — so resolving a timeout to `success` would be a new instance
    // of exactly that. What changes is the WORD, because "we could not tell"
    // and "nobody reviewed" are different things to hand a human. Only when
    // EVERY unsatisfied check is undetermined, so a real objection alongside a
    // slow reviewer still leads with UNREVIEWED.
    const allUndetermined = unsatisfied.every(
      name => conditions[name] === REVIEW_GATE_CONDITIONS.undetermined
    );
    return {
      verdict: REVIEW_GATE_STATES.unsatisfied,
      conclusion: REVIEW_VERDICT_CONCLUSIONS.unsatisfied,
      title: fitTitle(
        allUndetermined
          ? `UNDETERMINED — the gate stopped waiting before review evidence settled, and is NOT reporting that nobody reviewed: ${unsatisfied.map(quote).join("; ")}. RE-RUN this job; do not investigate the change on the strength of this${suffix}`
          : `UNREVIEWED — review evidence unsatisfied: ${unsatisfied.map(quote).join("; ")}${suffix}`
      ),
    };
  }

  const waived = names.filter(
    name => states[name] === REVIEW_GATE_STATES.waived
  );
  if (waived.length > 0) {
    return {
      verdict: REVIEW_GATE_STATES.waived,
      conclusion: REVIEW_VERDICT_CONCLUSIONS.waived,
      title: fitTitle(
        `WAIVED — this pull request is UNREVIEWED and merging it is a decision taken on that basis: ${waived.map(quote).join("; ")}${suffix}`
      ),
    };
  }

  return {
    verdict: REVIEW_GATE_STATES.satisfied,
    conclusion: REVIEW_VERDICT_CONCLUSIONS.satisfied,
    title: fitTitle(`REVIEWED — ${names.map(quote).join("; ")}${suffix}`),
  };
}

/**
 * Counts how a sample of pull requests ended up, worst-wins per pull request.
 *
 * A pull request whose declared checks produced no state at all is not counted
 * as reviewed OR waived — it is not counted. A denominator that quietly absorbs
 * unreadable pull requests reports a lower waive rate than the truth, which is
 * the direction that makes the number reassuring rather than useful.
 *
 * @param {ReadonlyArray<Record<string, string>>} samples - One states map per pull request
 * @returns {{sampled: number, waived: number, satisfied: number, unsatisfied: number}} The tally
 */
export function summarizeWaiveRate(samples) {
  const tally = { sampled: 0, waived: 0, satisfied: 0, unsatisfied: 0 };
  for (const states of samples) {
    const values = Object.values(states ?? {});
    if (values.length === 0) continue;
    tally.sampled += 1;
    if (values.includes(REVIEW_GATE_STATES.unsatisfied)) tally.unsatisfied += 1;
    else if (values.includes(REVIEW_GATE_STATES.waived)) tally.waived += 1;
    else tally.satisfied += 1;
  }
  return tally;
}

/**
 * Reads the declared evidence-bearing rows for recently merged pull requests.
 *
 * ONE GraphQL call, not one REST call per pull request. A per-PR loop is ~2N
 * network reads inside a job that is already spending five minutes waiting for
 * a review bot to settle, and a sampler that can time the job out would be
 * deleted rather than read.
 *
 * `orderBy: UPDATED_AT` rather than a merge timestamp, and the difference is
 * worth naming: this is "recently touched merged pull requests", a proxy for
 * "recently merged" that the single-call shape buys. The number it produces is
 * an order-of-magnitude reading of how often the waiver is the path — which is
 * what an operator needs — not an audit figure.
 *
 * @param {number} limit - How many merged pull requests to read
 * @param {string} [repo] - `OWNER/NAME`; defaults to the current repository
 * @returns {Array<Array<{name: string, state: string, description: string}>>} Rows per pull request
 * @throws {Error} When the slug cannot be resolved or `gh` cannot answer
 */
export function fetchRecentMergedChecks(limit, repo) {
  const slug = resolveRepoSlug(repo);
  if (slug === undefined) {
    throw new Error(
      "check-skipped-required-checks: the waive-rate sample needs an OWNER/NAME. Pass `--repo=OWNER/NAME`, or set GITHUB_REPOSITORY."
    );
  }
  const [owner, name] = slug.split("/");
  const raw = boundedExecFileSync(
    "gh",
    [
      "api",
      "graphql",
      "-f",
      `query=${RECENT_MERGED_CHECKS_QUERY}`,
      "-F",
      `owner=${owner}`,
      "-F",
      `name=${name}`,
      "-F",
      `limit=${limit}`,
    ],
    { encoding: "utf8" }
  );
  const nodes = JSON.parse(raw)?.data?.repository?.pullRequests?.nodes ?? [];
  return nodes.map(node =>
    (
      node?.commits?.nodes?.[0]?.commit?.statusCheckRollup?.contexts?.nodes ??
      []
    ).map(context =>
      context?.__typename === "CheckRun"
        ? normalizeCheckRow(context.name, context.conclusion, context.title)
        : normalizeCheckRow(
            context?.context,
            context?.state,
            context?.description
          )
    )
  );
}

/**
 * Samples how often the review gate waives, best-effort and never fatal.
 *
 * A failed sample must never change the verdict. The rate is CONTEXT for a
 * decision the gate has already made from this pull request's own evidence, so
 * an unreachable API costs an operator one sentence rather than a red build —
 * and the absent sentence is the honest rendering of "not measured", which is
 * what the caller prints in its place.
 *
 * @param {object} declaration - The per-repo declaration
 * @param {number} limit - How many merged pull requests to read; 0 disables
 * @param {string} [repo] - `OWNER/NAME`; defaults to the current repository
 * @param {(limit: number, repo?: string) => Array<Array<object>>} [fetch] - Injection seam
 * @returns {{sampled: number, waived: number, satisfied: number, unsatisfied: number}|undefined} The tally, or undefined when it could not be taken
 */
export function sampleWaiveRate(declaration, limit, repo, fetch) {
  if (!Number.isInteger(limit) || limit <= 0) return undefined;
  try {
    const perPullRequest = (fetch ?? fetchRecentMergedChecks)(limit, repo);
    return summarizeWaiveRate(
      perPullRequest.map(
        checks => evaluateReviewGate(declaration, checks).states
      )
    );
  } catch {
    return undefined;
  }
}

/**
 * Publishes the verdict where a workflow step can read it.
 *
 * `$GITHUB_OUTPUT` rather than stdout because the consumer is the next step in
 * the job, which turns it into a check run — the surface a merge decision
 * actually consults. Best-effort for the same reason the step summary is:
 * losing the rendering must not invert the exit code the guard worked to earn.
 *
 * @param {{verdict: string, conclusion: string, title: string}} verdict - What to publish
 * @param {NodeJS.ProcessEnv} [env] - Environment, injectable for tests
 * @returns {boolean} True when the outputs were written
 */
export function writeVerdictOutputs(verdict, env = process.env) {
  const target = env.GITHUB_OUTPUT;
  if (target === undefined || target === "") return false;
  try {
    appendFileSync(
      target,
      `review_evidence_verdict=${verdict.verdict}\nreview_evidence_conclusion=${verdict.conclusion}\nreview_evidence_title=${verdict.title}\n`
    );
    return true;
  } catch (error) {
    console.error(
      `[skipped-required-checks] review verdict outputs not written: ${error.message}`
    );
    return false;
  }
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
    '[.check_runs[] | {id: .id, name: .name, conclusion: .conclusion, description: (.output.title // ""), completed_at: .completed_at, created_at: .created_at, started_at: .started_at}]'
  );
  return mergeCheckRows(
    statuses.map(row =>
      normalizeCheckRow(row.name, row.state, row.description)
    ),
    newestCheckRuns(runs).map(row =>
      normalizeCheckRow(row.name, row.conclusion, row.description)
    )
  );
}

/**
 * Keep the newest check run for each name across every check suite on a SHA.
 * @param {ReadonlyArray<object>} runs Raw check-run rows with timestamps and ids.
 * @returns {object[]} One newest row per name.
 */
export function newestCheckRuns(runs) {
  const newest = new Map();
  const rank = row => {
    const timestamp = Date.parse(row.created_at ?? "");
    return [Number.isFinite(timestamp) ? timestamp : 0, Number(row.id) || 0];
  };
  for (const row of runs) {
    const name = String(row?.name ?? "");
    const previous = newest.get(name);
    if (!previous) {
      newest.set(name, row);
      continue;
    }
    const [rowTime, rowId] = rank(row);
    const [previousTime, previousId] = rank(previous);
    if (
      rowTime > previousTime ||
      (rowTime === previousTime && rowId > previousId)
    ) {
      newest.set(name, row);
    }
  }
  return [...newest.values()];
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
 * Reads a `--name=<integer>` flag, falling back when absent or unreadable.
 *
 * Separate from the seconds reader because the fallback for an unreadable value
 * differs in kind: a bad timeout should still wait, while a bad sample size must
 * NOT silently become the shipped default and start making network calls a
 * caller did not ask for. Both clamp at zero.
 *
 * @param {ReadonlyArray<string>} argv - CLI arguments
 * @param {string} name - The flag, including its leading dashes
 * @param {number} fallback - Value to use when the flag is absent or unreadable
 * @returns {number} A non-negative integer
 */
function readIntegerFlag(argv, name, fallback) {
  const raw = readFlagValue(argv, name);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  return Number.isInteger(value) && value >= 0 ? value : fallback;
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
  const requireReviewEvidence = argv.includes(REQUIRE_REVIEW_EVIDENCE_FLAG);
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
  /**
   * Attaches the published verdict to a refusal, which must not render as green.
   *
   * @param {{kind: string, reason: string}|null} refusal - Why nothing was read
   * @returns {object} The refusal result, verdict included
   */
  const refused = refusal => ({
    ...empty,
    refusal,
    verdict: reviewGateVerdict({ refusal }),
  });
  if (pr === undefined) {
    return refused(vacuityRefusal({ declaration, pr }));
  }

  const repo = readFlagValue(argv, "--repo");
  let read;
  try {
    read = fetchSettledChecks(declaration, pr, repo, {
      timeoutSeconds: readSecondsFlag(
        argv,
        "--settle-timeout",
        wired || requireReviewEvidence ? SETTLE_TIMEOUT_SECONDS : 0
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
    return refused(vacuityRefusal({ declaration, pr, error }));
  }

  const refusal = vacuityRefusal({ declaration, pr, checks: read.checks });
  if (refusal !== null) {
    return {
      ...refused(refusal),
      headSha: read.headSha,
      settled: read.settled,
    };
  }
  const evaluated = evaluateVacuousChecks(declaration, read.checks, {
    trustRequiredContexts: options.trustRequiredContexts,
    headSha: read.headSha,
  });
  // Evaluated on the same rows the vacuity arm just read, so the absence arm
  // costs no extra fetch. It runs on EVERY invocation for the reason the review
  // gate does: a finding computed only when somebody opted in is invisible on
  // exactly the repositories that have not opted in yet.
  const absent = evaluateAbsentRequiredChecks(declaration, read.checks, {
    headSha: read.headSha,
    parkedRuns: options.parkedRuns,
  });
  // The gate is evaluated on EVERY run, not only when a caller asked it to
  // block. Its findings are what make a waiver visible, and a waiver that is
  // only computed when somebody opted in would be invisible on exactly the
  // repositories that have not opted in yet.
  const gate = evaluateReviewGate(declaration, read.checks, {
    headSha: read.headSha,
    // The settle loop exits on one of two things: everything declared reached a
    // terminal read, or the deadline passed. So `settled === false` IS "the
    // wait expired", and it is the only place that fact exists — every reader
    // downstream sees a check row that looks identical either way (#3716).
    waitExpired: read.settled === false,
  });
  // Sampled ONLY when this pull request is itself waived. The rate answers
  // "is this the exception or the rule?", a question that only arises once a
  // waiver is on the table, and every other run keeps the sampler's network
  // call — and its failure modes — out of the job entirely.
  const waiveRate = Object.values(gate.states).includes(
    REVIEW_GATE_STATES.waived
  )
    ? sampleWaiveRate(
        declaration,
        readIntegerFlag(argv, WAIVE_RATE_SAMPLE_FLAG, 0),
        repo,
        options.sampleChecks
      )
    : undefined;
  return {
    pr,
    prSource: source,
    headSha: read.headSha,
    checked: evaluated.checked,
    violations: [
      ...evaluated.violations,
      ...absent.violations,
      ...gate.violations,
    ],
    absent: absent.absent,
    gateStates: gate.states,
    gateConditions: gate.conditions,
    gateDescriptions: gate.descriptions,
    waiveRate,
    verdict: reviewGateVerdict({
      states: gate.states,
      conditions: gate.conditions,
      descriptions: gate.descriptions,
      waiveRate,
    }),
    settled: read.settled,
    refusal: null,
  };
}

/**
 * Runs the guard.
 *
 * Every arm is OFFLINE. There is no network read and no token anywhere in this
 * path: the required-context rules answer from the committed snapshot when
 * {@link snapshotTrust} believes it, and refuse when it does not.
 *
 * @param {ReadonlyArray<string>} argv - CLI arguments
 * @param {object} [options] - Injection seams forwarded to {@link inspectVacuity}
 * @returns {{violations: object[], checked: number, tokens: string[], enforcement: string, trust: {trusted: boolean, reason: string}, recipe: string, pr: string|undefined, evidenceChecked: number, vacuity: object|undefined}} The result
 */
export function runGuard(argv, options = {}) {
  if (argv.includes(RETIRED_REMOTE_FLAG)) {
    throw new Error(RETIRED_REMOTE_MESSAGE);
  }
  if (
    argv.includes(REQUIRE_REVIEW_EVIDENCE_FLAG) &&
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
  const trust = snapshotTrust(declaration);
  const result = evaluateSkippedRequiredChecks(declaration, collected.tokens, {
    trustRequiredContexts: trust.trusted,
  });
  const violations = [...collected.violations, ...result.violations];

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
    verdict: vacuity?.verdict,
    waiveRate: vacuity?.waiveRate,
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
  const attempt = attemptGuardRun(argv);
  if (attempt.error !== undefined) {
    writeGuardError(argv, attempt.error);
    return;
  }

  const result = attempt.result;
  const policy = cliPolicy(argv, result);
  const outcome = cliOutcome(result, policy);

  // Published BEFORE the report and before the exit code, because it is the only
  // artefact of this run that a merge decision reads.
  if (result.verdict !== undefined) writeVerdictOutputs(result.verdict);

  if (argv.includes("--json")) {
    writeJsonResult(result, outcome.failed);
    return;
  }
  writeTextResult(result, policy, outcome);
}

/**
 * Runs the guard without making error presentation part of the entry point.
 *
 * @param {ReadonlyArray<string>} argv - Arguments
 * @returns {{result?: object, error?: unknown}} One guard result or error
 */
function attemptGuardRun(argv) {
  try {
    return { result: runGuard(argv) };
  } catch (error) {
    return { error };
  }
}

/**
 * Prints an exception in the selected output format.
 *
 * @param {ReadonlyArray<string>} argv - Arguments
 * @param {unknown} error - Guard exception
 * @returns {void}
 */
function writeGuardError(argv, error) {
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
}

/**
 * Reads the CLI switches that change which findings block.
 *
 * @param {ReadonlyArray<string>} argv - Arguments
 * @param {object} result - Guard result
 * @returns {{warnOnly: boolean, failOnVacuous: boolean, requireReviewEvidence: boolean}} Active policy
 */
function cliPolicy(argv, result) {
  return {
    warnOnly: result.enforcement === "warn",
    // The supported alternative to a per-consumer `--json` wrapper.
    failOnVacuous: argv.includes("--fail-on-vacuous"),
    // Deliberately distinct from `--fail-on-vacuous`; entitlement waivers do
    // not become failures through a shared switch.
    requireReviewEvidence: argv.includes(REQUIRE_REVIEW_EVIDENCE_FLAG),
  };
}

/**
 * True when one violation blocks under the active CLI policy.
 *
 * @param {{kind: string}} violation - One violation
 * @param {{warnOnly: boolean, failOnVacuous: boolean, requireReviewEvidence: boolean}} policy - Active policy
 * @returns {boolean} True when the finding blocks
 */
function violationBlocks(violation, policy) {
  if (REVIEW_GATE_BLOCKING.includes(violation.kind)) {
    return policy.requireReviewEvidence;
  }
  if (violation.kind === VIOLATIONS.reviewWaived) return false;
  if (NEVER_BLOCKING.includes(violation.kind)) return policy.failOnVacuous;
  return !policy.warnOnly || ALWAYS_BLOCKING.includes(violation.kind);
}

/**
 * Computes the blocking set and refusal state once for both renderers.
 *
 * @param {object} result - Guard result
 * @param {object} policy - Active CLI policy
 * @returns {{blocking: object[], refusal: object|null, refusalBlocks: boolean, failed: boolean}} CLI outcome
 */
function cliOutcome(result, policy) {
  const blocking = result.violations.filter(violation =>
    violationBlocks(violation, policy)
  );
  const refusal = result.vacuity?.refusal ?? null;
  const refusalBlocks =
    refusal !== null && (!policy.warnOnly || policy.requireReviewEvidence);
  const failed =
    blocking.length > 0 ||
    (!result.trust.trusted && !policy.warnOnly) ||
    refusalBlocks;
  return { blocking, refusal, refusalBlocks, failed };
}

/**
 * Writes the machine-readable report.
 *
 * @param {object} result - Guard result
 * @param {boolean} failed - Whether the run blocks
 * @returns {void}
 */
function writeJsonResult(result, failed) {
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
}

/**
 * Appends the published review verdict to the human report.
 *
 * @param {string[]} lines - Report lines
 * @param {object} result - Guard result
 * @returns {void}
 */
function appendVerdictReport(lines, result) {
  if (result.verdict === undefined) return;
  lines.push(
    `**${result.verdict.title}**`,
    "",
    `Published as check-run conclusion \`${result.verdict.conclusion}\`. A \`neutral\` conclusion is how a WAIVED pull request is kept out of the shape a satisfied one prints — the waiver still blocks nothing, and it no longer looks like a review.`,
    "",
    result.waiveRate === undefined
      ? "The waive rate over recently merged pull requests was NOT sampled on this run, so no rate is claimed here."
      : `Recently merged pull requests sampled: ${result.waiveRate.sampled} — ${result.waiveRate.satisfied} reviewed, ${result.waiveRate.waived} waived, ${result.waiveRate.unsatisfied} unsatisfied.`,
    ""
  );
}

/**
 * Appends and annotates an untrusted ruleset snapshot.
 *
 * @param {string[]} lines - Report lines
 * @param {object} result - Guard result
 * @param {object} policy - Active CLI policy
 * @returns {void}
 */
function appendSnapshotRefusal(lines, result, policy) {
  if (result.trust.trusted) return;
  lines.push(
    "⛔ **NOT CHECKED** — this guard cannot say whether any skip silences a required status check, and will not pretend to.",
    "",
    result.trust.reason,
    "",
    "```",
    result.recipe,
    "```",
    ""
  );
  process.stderr.write(
    `::${policy.warnOnly ? "warning" : "error"} title=Skipped-required checks NOT CHECKED::${result.trust.reason.split("\n")[0]}\n`
  );
}

/**
 * Appends and annotates a vacuity inspection that could not run.
 *
 * @param {string[]} lines - Report lines
 * @param {{refusal: object|null, refusalBlocks: boolean}} outcome - CLI outcome
 * @returns {void}
 */
function appendInspectionRefusal(lines, outcome) {
  if (outcome.refusal === null) return;
  lines.push(
    `⛔ **NOT INSPECTED** (\`${outcome.refusal.kind}\`) — the vacuity arm did not examine a single check, and will not report that nothing was vacuous.`,
    "",
    outcome.refusal.reason,
    ""
  );
  process.stderr.write(
    `::${outcome.refusalBlocks ? "error" : "warning"} title=${outcome.refusal.kind}::${outcome.refusal.reason.split("\n")[0]}\n`
  );
}

/**
 * Appends the clean result, respecting a refused inspection.
 *
 * @param {string[]} lines - Report lines
 * @param {object} result - Guard result
 * @param {object|null} refusal - Vacuity refusal
 * @returns {void}
 */
function appendCleanResult(lines, result, refusal) {
  if (refusal !== null) return;
  if (!result.trust.trusted) {
    lines.push(
      `The rules that do NOT read \`required_contexts\` were still applied to ${result.checked} token(s) and found nothing.`
    );
    return;
  }

  lines.push(
    `✅ ${result.checked} \`skip_jobs\` token(s) examined; none silences a ruleset-required status check.`
  );
  if (result.pr === undefined) return;
  const settleNote =
    result.vacuity?.settled === false
      ? " (One or more had not settled when the wait expired, so this is what was true at that moment.)"
      : "";
  lines.push(
    `✅ ${result.evidenceChecked} evidence-bearing check(s) examined on PR #${result.pr}; each proved it did work.${settleNote}`
  );
}

/**
 * Appends annotations and prose for every finding.
 *
 * @param {string[]} lines - Report lines
 * @param {object} result - Guard result
 * @param {object} policy - Active CLI policy
 * @param {object[]} blocking - Blocking subset
 * @returns {void}
 */
function appendFindingReport(lines, result, policy, blocking) {
  lines.push(
    `${blocking.length > 0 ? "❌" : "⚠️"} ${result.violations.length} violation(s) across ${result.checked} \`skip_jobs\` token(s):`,
    ""
  );
  for (const violation of result.violations) {
    lines.push(`- **${violation.kind}** — ${violation.message}`);
    process.stderr.write(
      `::${violationBlocks(violation, policy) ? "error" : "warning"} title=${violation.kind}::${violation.message.split("\n")[0]}\n`
    );
  }
  appendFindingContext(lines, result, policy);
}

/**
 * Appends contextual guidance that applies to groups of findings.
 *
 * @param {string[]} lines - Report lines
 * @param {object} result - Guard result
 * @param {object} policy - Active CLI policy
 * @returns {void}
 */
function appendFindingContext(lines, result, policy) {
  if (result.vacuity?.settled === false) {
    lines.push(
      "",
      "⏳ The settle wait EXPIRED before every declared review check reached a terminal state, so the readings above are where the wait stopped rather than where the reviewer finished. RE-RUN this job before treating any of it as a finding about the change."
    );
  }
  if (policy.warnOnly) appendWarnModeGuidance(lines, policy);
  if (hasVacuityFinding(result.violations)) {
    appendVacuityGuidance(lines, policy.failOnVacuous);
  }
  if (hasReviewWaiver(result.violations)) appendReviewWaiverGuidance(lines);
}

/** @param {ReadonlyArray<object>} violations @returns {boolean} */
function hasVacuityFinding(violations) {
  return violations.some(violation =>
    [VIOLATIONS.vacuous, VIOLATIONS.unproven].includes(violation.kind)
  );
}

/** @param {ReadonlyArray<object>} violations @returns {boolean} */
function hasReviewWaiver(violations) {
  return violations.some(
    violation => violation.kind === VIOLATIONS.reviewWaived
  );
}

/** @param {string[]} lines @param {object} policy @returns {void} */
function appendWarnModeGuidance(lines, policy) {
  const reviewNote = policy.requireReviewEvidence
    ? ` This run also passed \`--require-review-evidence\`, so \`${VIOLATIONS.reviewUnsatisfied}\` blocks.`
    : "";
  const vacuityNote = policy.failOnVacuous
    ? ` This run also passed \`--fail-on-vacuous\`, so \`${VIOLATIONS.vacuous}\` and \`${VIOLATIONS.unproven}\` block.`
    : "";
  lines.push(
    "",
    `This declaration sets \`"enforcement": "warn"\`, so ordinary findings are report-only. A proven false green (\`${VIOLATIONS.suppressesRequired}\`) still blocks.${reviewNote}${vacuityNote} Review each finding, fix or declare it, then delete the \`enforcement\` key when the adoption ramp is complete.`
  );
}

/** @param {string[]} lines @param {boolean} failOnVacuous @returns {void} */
function appendVacuityGuidance(lines, failOnVacuous) {
  lines.push(
    "",
    failOnVacuous
      ? `\`${VIOLATIONS.vacuous}\` and \`${VIOLATIONS.unproven}\` are REPORT-ONLY by default; this run passed \`--fail-on-vacuous\`, which is the supported way to ask for an exit code once the governance call has been made. What they mean is unchanged: a PR carrying either finding has not been shown to be reviewed, so do not record it as reviewed.`
      : `\`${VIOLATIONS.vacuous}\` and \`${VIOLATIONS.unproven}\` are REPORT-ONLY in every enforcement mode — they never fail a build. A required check can go hollow because a vendor hit an org-wide spending cap, and reddening every PR on a billing state would be a worse gate than the one being criticised. What they change is what you may CLAIM: a PR carrying either finding has not been shown to be reviewed, so do not record it as reviewed. Pass \`--fail-on-vacuous\` to make them block.`
  );
}

/** @param {string[]} lines @returns {void} */
function appendReviewWaiverGuidance(lines) {
  lines.push(
    "",
    `\`${VIOLATIONS.reviewWaived}\` is REPORT-ONLY under every enforcement mode and command-line flag. It records that the named review could not run; it is neither evidence that a review completed nor a failure the pull-request author can fix.`
  );
}

/**
 * Builds the complete human-readable report.
 *
 * @param {object} result - Guard result
 * @param {object} policy - Active CLI policy
 * @param {object} outcome - CLI outcome
 * @returns {string} Markdown report
 */
function buildTextReport(result, policy, outcome) {
  const lines = ["## 🔒 Required checks that prove nothing", ""];
  appendVerdictReport(lines, result);
  appendSnapshotRefusal(lines, result, policy);
  appendInspectionRefusal(lines, outcome);
  if (result.violations.length === 0) {
    appendCleanResult(lines, result, outcome.refusal);
  } else {
    appendFindingReport(lines, result, policy, outcome.blocking);
  }
  return `${lines.join("\n")}\n`;
}

/**
 * Writes the human report, best-effort step summary, and exit status.
 *
 * @param {object} result - Guard result
 * @param {object} policy - Active CLI policy
 * @param {object} outcome - CLI outcome
 * @returns {void}
 */
function writeTextResult(result, policy, outcome) {
  const report = buildTextReport(result, policy, outcome);
  process.stdout.write(report);
  writeStepSummary(report);
  if (outcome.failed) process.exitCode = 1;
}

/**
 * Appends the report to the Actions summary without changing the verdict.
 *
 * @param {string} report - Rendered report
 * @returns {void}
 */
function writeStepSummary(report) {
  if (!process.env.GITHUB_STEP_SUMMARY) return;
  try {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, report);
  } catch (error) {
    console.error(
      `[skipped-required-checks] step summary not written: ${error.message}`
    );
  }
}

if (invokedAsScript(import.meta.url)) {
  main(process.argv.slice(2));
}
