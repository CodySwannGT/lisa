#!/usr/bin/env node
// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/**
 * check-nightly-e2e-health — the fail-closed nightly e2e merge gate.
 *
 * Shipped by Lisa (copy-overwrite). The reusable workflow that drives it is
 * `CodySwannGT/lisa/.github/workflows/nightly-e2e-health.yml`; the contract both
 * halves implement is `docs/nightly-e2e-gate.md` in Lisa, whose §2 truth table
 * is proven row-by-row by `tests/unit/scripts/nightly-e2e-health*.test.ts`
 * (rows 1-16, `-api` rows 17-20, `-bypass` rows 21-25, `-completeness` row 26,
 * `-issues` rows 27-31), with §10.9 proven by
 * `tests/unit/scripts/nightly-e2e-health-bypass-label.test.ts`.
 *
 * Usage:
 *   node scripts/check-nightly-e2e-health.mjs          # human report, exit 1 when blocked
 *   node scripts/check-nightly-e2e-health.mjs --json   # machine report, always exit 0
 *   node scripts/check-nightly-e2e-health.mjs --contract-version
 *   node scripts/check-nightly-e2e-health.mjs --report-issues  # the REPORTING half
 *
 * ## Two halves, and only one of them writes
 *
 * The default invocation is the merge GATE: a required status check that reads
 * run history and writes nothing. `--report-issues` is the REPORTING half (§10),
 * driven by `nightly-e2e-report.yml` on a schedule, which maintains exactly one
 * open tracking issue per suite — filed on the first red night, refreshed while
 * it stays red, closed when a complete green run lands.
 *
 * They are separate because filing is reporting, not verdict. Issue writes live
 * behind `apiWrite`, reachable only from `applyIssuePlan`, which only
 * `--report-issues` reaches; the gate path cannot reach them, and the gate's
 * reusable workflow requests no `issues:` scope. An Issues API that is down must
 * never be able to redden a required check.
 *
 * ## `--report-issues` publishes BEST EFFORT, and the summary is the report
 *
 * The tracking issue is a convenience; the verdict is the product. So the
 * reporting half resolves the verdict, writes it to `$GITHUB_STEP_SUMMARY`
 * FIRST, and only then attempts to publish — with the publish's outcome
 * absorbed into a `::warning::` that cannot change the job's result. A report
 * channel must not die because its optional publishing destination is
 * unavailable, which is precisely what a repository that switched GitHub Issues
 * off measured: three attempts at `POST /repos/{o}/{r}/issues`, HTTP 410, exit 1
 * — a dead publisher reported as a dead reporter (§10.4).
 *
 * Its exit code therefore answers "is the suite green", and nothing else. See
 * §10.4 for the full three-outcome contract.
 *
 * Zero dependencies and no install step, on purpose: a gate that sits on every
 * pull request has to be cheap enough to stay uncontroversial, and a gate that
 * needs a lockfile resolved is a gate that flakes.
 *
 * ## What it queries
 *
 * GitHub Actions RUN HISTORY. It runs no tests, dispatches nothing, and reads no
 * artifacts. A reusable workflow's `uses:` must be a static literal, so it
 * CANNOT dynamically call a list of workflow filenames supplied in an input —
 * any mental model of "the gate runs the suites in the table" is impossible on
 * this platform. Artifacts are excluded deliberately: they are zip archives
 * (Node ships no zip reader) and they expire, which would turn "the evidence
 * aged out" into an unreadable verdict.
 *
 * ## Fail-closed, in one paragraph
 *
 * Only a fresh `success` on the required branch passes. Failed, timed out and
 * action-required all block. So do `cancelled` and `skipped` — if cancelling a
 * run read as inconclusive-and-passing, cancelling the suite would be a
 * one-click way to clear the gate, the same false-green shape
 * `check-skipped-required-checks.mjs` exists to refuse. So does a run that is
 * missing, stale, on the wrong branch, or whose job the matcher no longer finds.
 * An unreachable or rate-limited API is a HARD failure after a bounded retry;
 * there is no configuration that renders "we could not check" as "it is fine".
 *
 * A `success` run is not automatically a fresh `success`, and since row 26 it is
 * not automatically a COMPLETE one either: GitHub concludes a run `success` when
 * jobs were skipped, so a suite narrowed to one platform — or one whose
 * prerequisites were absent — reports green having tested nothing it was asked
 * about. A run-scoped suite therefore reads the run's jobs as well.
 *
 * The one forgiving state is the TIME-BOXED bootstrap window (`bootstrap_until`),
 * during which MISSING evidence is reported but does not block, always with its
 * expiry timestamp on screen. Bootstrap forgives absence of evidence, never
 * evidence of failure — a red run is red inside the window too.
 *
 * ## The bypass reads the pull request LIVE (contract 1.6.0, row 40)
 *
 * `github.event.pull_request` is a SNAPSHOT taken when the run was triggered,
 * and a re-run replays it verbatim. Reading the bypass label and the
 * `Nightly-E2E-Bypass:` trailer out of it made the gate's own printed remedy
 * impossible to follow: applying the label fired no run, and re-running — the
 * obvious next move — replayed a payload from before the label existed. The
 * waiver was real, correctly recorded, and invisible to the gate that asked for
 * it. `fetchPullRequestState` reads both halves from the API at gate time
 * instead, which also means a label somebody REMOVED stops waiving. An
 * unreadable pull request is a REJECTED bypass, never a granted one.
 *
 * ## The escape hatch has to EXIST (contract 1.7.0, §10.9)
 *
 * Row 40's other half. There the label existed and the gate could not see it;
 * here there is no label to apply. Measured across four adopters on 2026-08-19,
 * two had the gate required by an active ruleset and no bypass label at all — so
 * §6's preferred path was unreachable and the unaudited admin merge was the only
 * exit, reached by following the printed instructions exactly.
 *
 * `fetchBypassLabelState` measures it on the REPORTING half, nightly, whether or
 * not anybody is blocked yet: discovering the escape hatch is absent while
 * trying to use it is the failure mode, so the gate half — which only speaks
 * once somebody is already blocked — is the wrong place to find out. An
 * unreadable labels API is `unknown`, never `present`; nothing here creates the
 * label, because manufacturing a bypass surface in a repository that never
 * adopted §6 is a new hole rather than a closed one.
 *
 * ## The newest run is not the newest CONCLUSIVE run (contract 1.8.0, rows 41-42)
 *
 * Measured on 2026-08-29 in a consuming repository: two runs of the same native
 * suite, seven seconds apart. The first concluded `success` with all eight jobs
 * green — the whole suite executed. The second concluded `cancelled` with one
 * cancelled preflight job and nothing else, because the suite's `concurrency`
 * group keeps only ONE pending run and displaces the rest. The second run tested
 * nothing, but it was the newest completed run, so the gate scored it and
 * reported `⚪ UNKNOWN [cancelled]` over a suite that had genuinely passed. The
 * gate is a required check, so that blocked every merge for three hours.
 *
 * Refusing to score a cancellation green stays exactly as it was (rows 6-8).
 * The defect is one layer upstream: SELECTION. `observe` now walks candidates
 * newest-first and stops at the first that produced evidence.
 *
 * "Produced evidence" is decided from the run's JOBS, not from a status
 * allowlist, because `cancelled` is overloaded across at least three causes —
 * a duplicate displaced by the concurrency group (tested nothing), a job killed
 * at its own `timeout-minutes` ceiling (tested most of the suite), and an
 * operator cancel (anywhere in between) — and only the first may ever be walked
 * past. See `runProducedEvidence`.
 *
 * Bounded twice over: the walk stops at the first run with evidence, and it
 * never leaves the arm's own freshness window. Without the second bound a stale
 * green could hold the gate open indefinitely, which is the opposite failure and
 * a worse one. When nothing conclusive is found inside the window it falls back
 * to the newest run, so `stale_run` / `indecisive_conclusion` / `no_run` still
 * fire and the gate still blocks. That fallback is what makes this change unable
 * to invent a pass: it may only ever promote an older FRESH, CONCLUSIVE run over
 * a run that tested nothing.
 *
 * And it SAYS SO. The original failure was silent — a real verdict was replaced
 * with no trace — so every finding carries a `selection` record naming the run
 * that was scored and every run walked past with the reason. A gate that quietly
 * changes which run it scores is the same class of defect one layer down.
 *
 * ## Inherited from three implementations, with one path closed
 *
 * `DECISIVE_CONCLUSIONS` comes from acmeorgb's `check-nightly-e2e.mjs` and is
 * kept because it is the right vocabulary. What is NOT kept is acmeorgb's
 * `unknown`-passes-with-a-warning: that is a fail-open path, and here `unknown`
 * fails once bootstrap closes. The bypass model and the context-pinning
 * discipline come from acmeorgd (TUN-525 / TUN-402). The job-name filter comes from
 * acmeorga's `nightly-e2e-lib.sh`, whose unbounded bootstrap is what §4 of the
 * contract time-boxes.
 *
 * @module scripts/check-nightly-e2e-health
 */

import { invokedAsScript } from "./lib/invoked-as-script.mjs";

/**
 * Contract version of the gate, asserted by the reusable workflow against its
 * own expectation. The workflow travels by git ref and this script travels by
 * `lisa apply`, so the two halves WILL drift; a MAJOR mismatch fails closed
 * rather than running a contract neither half agrees on. See §8 of
 * `docs/nightly-e2e-gate.md` for what counts as major / minor / patch.
 */
export const NIGHTLY_E2E_CONTRACT_VERSION = "1.9.0";

/**
 * The conclusions that constitute a verdict about the code.
 *
 * Closed on purpose. `cancelled` / `skipped` / `neutral` / `stale` / `null` are
 * operator or plumbing outcomes that say nothing about health, and a conclusion
 * GitHub introduces after this file was written is unknown to us — an unknown
 * conclusion is not evidence of health. Everything outside this set resolves to
 * state `unknown`, which blocks once bootstrap closes.
 */
export const DECISIVE_CONCLUSIONS = Object.freeze(
  new Set([
    "success",
    "failure",
    "timed_out",
    "action_required",
    "startup_failure",
  ])
);

/** The one conclusion that clears the gate. */
export const GREEN_CONCLUSION = "success";

/**
 * Run events that count as a nightly verdict.
 *
 * `workflow_dispatch` is the unblock path, not a convenience: it is what makes
 * the gate escapable by FIXING rather than by waiting for tomorrow's cron. It
 * stays branch-filtered — a dispatch from someone's feature branch must never
 * clear the gate for everybody.
 */
export const COUNTED_EVENTS = Object.freeze(["schedule", "workflow_dispatch"]);

/**
 * How many completed runs per event the selection walk (rows 41-42) may read.
 *
 * Bounded on purpose. The walk exists to step over runs that tested nothing, and
 * every candidate it examines costs a job read on the merge-gate path; an
 * unbounded walk would turn a long chain of displaced duplicates into an
 * unbounded number of requests. Ten is ample — the measured displacement chain
 * that motivated this was two runs, seven seconds apart — and in the ordinary
 * case where the newest run is conclusive the walk still reads exactly one run's
 * jobs, the same as before. The freshness window bounds it a second time.
 */
export const RUN_CANDIDATE_PAGE_SIZE = 10;

/** Suite states. `unknown` is "no readable verdict", which is not a pass. */
export const SUITE_STATES = Object.freeze({
  pass: "pass",
  fail: "fail",
  unknown: "unknown",
});

/**
 * The reason token row 26 stamps on a run that did not run everything.
 *
 * Named as a constant rather than repeated as a literal because the REPORTING
 * half (§10) asks the completeness question in its own right: closing a tracking
 * issue is the reporter declaring a suite healthy, and it must never do that on
 * evidence the suite never gathered.
 */
export const INCOMPLETE_EVIDENCE_REASON = "incomplete_run";

// ---------------------------------------------------------------------------
// SUITE SCOPE — "did this run test the WHOLE suite?" (rows 36-38)
// ---------------------------------------------------------------------------
//
// Row 26 asks whether every JOB ran. It cannot see inside a job, so it cannot
// see the other way a green run proves nothing: a job that ran, passed, and
// tested a hand-picked slice.
//
// Measured 2026-08-18. AcmeOrgB/frontend's only recent `success` ran 4 of ~80
// flows under `ios_include_tags: smoke`. AcmeOrgD/frontend's REQUIRED merge gate
// was, at the time of writing, satisfied by run 32120016803: `maestro-ios-report`
// green, Android skipped, and the run's own published count reading
// `maestro-ios-flowcount-7`. Seven flows cleared a merge gate for a suite of
// eighty. `gh run list` renders that identically to a full green, which is how a
// reader — and this gate — concludes a suite "has been green recently" when it
// never has.
//
// TWO independent signals, and BOTH are required rather than either:
//
//  1. SCOPE (the run's own recorded inputs). `maestro-native-e2e.yml` publishes
//     `maestro-<platform>-scope-full` or `maestro-<platform>-scope-filtered`
//     from the tag inputs it was actually given. This is the definitive signal
//     — it reads the filter itself rather than its consequences — but it only
//     exists on runs from a Lisa version that publishes it, so it is ABSENT on
//     every historical run and on any suite that is not maestro.
//  2. COUNT (executed flows). `maestro-<platform>-flowcount-<N>` has shipped for
//     longer and is the backstop: it catches a run narrowed by any mechanism at
//     all — a tag filter, a `flows_dir` override, a hand-edited flow list — and
//     it catches the runs signal 1 cannot see.
//
// Both travel as ARTIFACT NAMES, read from the artifacts LIST. That is one
// cheap API call with no download and no zip reader, and — the property that
// makes it usable at all — an artifact's NAME outlives its bytes, so an expired
// artifact still answers "how many flows did that night run?". The header of
// `nightly-e2e-health.yml` says this gate reads no artifacts; that meant no
// artifact CONTENT, and it now says so explicitly.

/** A run positively recorded as narrowed. Absence of evidence, not failure. */
export const FILTERED_RUN_REASON = "filtered_run";

/** A run that executed fewer flows than the suite declared it must. */
export const FLOW_SHORTFALL_REASON = "flow_shortfall";

/** `min_flows` was declared and the run published nothing to check it against. */
export const SCOPE_UNREADABLE_REASON = "scope_unreadable";

/**
 * An arm that ran and executed ZERO flows. Row 39 — unconditional.
 *
 * Split from `flow_shortfall` because it needs no `min_flows` and therefore no
 * denominator: "fewer than the suite declares" is a threshold judgement and
 * requires one, but "tested nothing" is not a judgement at all. Any floor a
 * repo could sensibly declare is >= 1, so rejecting zero cannot contradict a
 * declaration, and requiring one before disbelieving a zero-flow green would be
 * asking permission to notice that nothing ran.
 *
 * This row exists because AcmeOrgB/frontend hit it (TUN-572) and wrote a
 * 368-line local guard, `scripts/check-nightly-e2e-flow-coverage.mjs`, to catch
 * it — the same mechanism as rows 36-38, reached independently. That guard
 * blocks on `arms.some(arm => arm.executed === 0)` with NO configuration. Until
 * this row existed, adopting the reusable and retiring that fork would have
 * silently DROPPED zero-flow protection for any suite that had not declared
 * `min_flows` — the precise "convergence before the reusable is a superset"
 * hazard the fork-retirement work exists to avoid.
 */
export const ZERO_FLOWS_REASON = "zero_flows";

/**
 * `maestro-<platform>-flowcount-<N>`, as published by `maestro-native-e2e.yml`.
 *
 * Anchored at both ends for the reason `job_pattern` is: unanchored, this is a
 * substring test, and `maestro-ios-flowcount-7-retry` would be read as 7.
 */
export const FLOW_COUNT_ARTIFACT_PATTERN =
  /^maestro-(?<platform>[a-z0-9]+)-flowcount-(?<count>\d+)$/;

/** `maestro-<platform>-scope-<full|filtered>`, same publisher, same anchoring. */
export const SCOPE_ARTIFACT_PATTERN =
  /^maestro-(?<platform>[a-z0-9]+)-scope-(?<scope>full|filtered)$/;

/** Locale-independent code-point ordering required by Sonar's string-sort rule. */
function compareStrings(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

/** The label that identifies a tracking issue this reporter owns. */
export const TRACKING_ISSUE_LABEL = "nightly-e2e";

/** What the reporter may do about one suite (§10). */
export const ISSUE_ACTIONS = Object.freeze({
  create: "create",
  refresh: "refresh",
  close: "close",
  none: "none",
});

/**
 * Whether the gate actually blocks merges — MEASURED, never assumed (§10.7).
 *
 * The reporter used to state, in every issue it filed, that "pull requests into
 * `<branch>` are blocked". That sentence was a hardcoded claim about somebody
 * else's branch ruleset, and in one measured adopter it was measurably FALSE: not
 * one required context on `dev` matched this gate, so the suite blocked nothing
 * — while people burned audited bypass labels to clear a gate that was not
 * gating. An issue that misstates its own consequences is worse than one that
 * says nothing, because it is acted on.
 *
 * `unknown` is a first-class member of this set, not a tidy-up. If the branch
 * rules cannot be read, the honest answer is that we do not know — and this
 * file's whole doctrine is that "we could not check" must never render as an
 * answer in either direction. Claiming `not_required` on an unreadable API
 * would tell a reader to ignore a gate that may well be blocking every PR they
 * have open.
 */
export const REQUIREDNESS = Object.freeze({
  required: "required",
  notRequired: "not_required",
  unknown: "unknown",
});

/**
 * Whether the audited bypass label EXISTS — measured, never assumed (§10.9).
 *
 * §6 names the `nightly-e2e-bypass` label the preferred way past a red gate.
 * That path only exists if the label exists. Measured across four adopters on
 * 2026-08-19: two had the gate required by an active ruleset and **no bypass
 * label at all**, so the documented escape hatch was unreachable and the only
 * remaining exit was the unaudited admin merge — precisely the outcome §6
 * exists to prevent. A gate whose printed remedy cannot be followed is worse
 * than one with no remedy, because an operator follows the instructions and
 * they do not work.
 *
 * `unknown` is a first-class member for the same reason it is one in
 * `REQUIREDNESS`: an unreadable labels API must never render as either answer.
 * Rendering `present` on an unreadable read would reprint the instruction that
 * does not work; rendering `absent` would file a defect against a repository
 * that is fine. Note which way the asymmetry runs, though — the state this
 * guard must never invent is `present`, because that is the one that claims an
 * escape hatch exists. Nothing here CREATES the label: manufacturing a bypass
 * surface in a repository that never adopted the contract is a different
 * defect, not a fix for this one.
 */
export const BYPASS_LABEL_STATE = Object.freeze({
  present: "present",
  absent: "absent",
  unknown: "unknown",
  notMeasured: "not_measured",
});

/**
 * The status-check context the gate publishes, as Lisa's own caller names it.
 *
 * GitHub composes a reusable workflow's check name as
 * `<caller job name> / <called job name>`, and Lisa's shipped
 * `nightly-e2e-health.yml` template names those halves `🌙 Nightly E2E Health`
 * and `🌙 Gate`. Byte for byte, emoji included — §5 is the section about how
 * easily these two strings drift apart.
 *
 * Overridable via the `gate_context` input, because a repo that has not yet
 * converged onto the template publishes a different string — one adopter's fork
 * publishes the bare `🌙 Nightly E2E Health`, with no job suffix.
 */
export const DEFAULT_GATE_CONTEXT = "🌙 Nightly E2E Health / 🌙 Gate";

/**
 * The audited bypass label's default name, as §6 documents it.
 *
 * One constant rather than three literals: this string is the identity of the
 * escape hatch, and §10.9 now MEASURES whether a label by this name exists.
 * Three copies is three chances for the renderer, the settings resolver and the
 * measurement to disagree about which label they are talking about — and a
 * disagreement there reads to an operator as "the label is missing" when it is
 * merely spelled differently in one of them.
 */
export const DEFAULT_BYPASS_LABEL = "nightly-e2e-bypass";

// ---------------------------------------------------------------------------
// SECURITY LIMITS — source constants, never env-readable (portfolio doctrine)
// ---------------------------------------------------------------------------
//
// Every value in this block is a SOURCE CONSTANT and is deliberately not
// overridable from the environment. The doctrine comes from WS-0a: a security
// gate is an ALLOWLIST, never a denylist, and its limits live in code.
//
// The reason is that an env-readable limit fails OPEN on exactly the inputs
// nobody tests — an unset variable, a typo'd name, a new deployment that forgot
// to set it. `NIGHTLY_BOOTSTRAP_MAX_DAYS=100000` would have restored the
// forever-bootstrap this gate exists to delete, and a caller-supplied
// `bypass_reason_pattern` of `.*` would have satisfied the "reason required"
// rule with an empty PR body. Both were real holes in this file before the
// doctrine was applied to it.
//
// Callers may still TIGHTEN any of these through the workflow inputs. What they
// cannot do is loosen one, and `resolveSecurityLimits` below is the single
// place that is enforced — so fail-closed only has to be right once.

/** Hard ceiling on a bypass's lifetime, whatever the caller asks for. */
export const BYPASS_ABSOLUTE_MAX_HOURS = 72;

/**
 * Repository permissions that may grant a bypass — an ALLOWLIST.
 *
 * Never expressed as "anything except read/triage": a denylist of the roles we
 * happen to know about today silently admits any role GitHub adds tomorrow.
 */
export const BYPASS_PERMISSIONS = Object.freeze(new Set(["admin", "maintain"]));

/**
 * The reason line the PR body must carry. ALWAYS enforced.
 *
 * A reason AND a tracker reference, in the artefact reviewers already read.
 * Multiline so it can match one line of a body; not global, so `.exec` has no
 * sticky `lastIndex` to alternate on.
 *
 * A caller-supplied `bypass_reason_pattern` is an ADDITIONAL requirement that
 * must ALSO match — never a replacement for this one. That asymmetry is the
 * whole point: an override can only narrow what qualifies as a valid bypass.
 */
export const REQUIRED_BYPASS_REASON_PATTERN =
  "^Nightly-E2E-Bypass:\\s*(?<ticket>[A-Z][A-Z0-9]+-\\d+|#\\d+)\\s+(?<reason>\\S.*)$";

/**
 * Back-compatible alias.
 *
 * @deprecated Use `REQUIRED_BYPASS_REASON_PATTERN`. Kept so the name in the
 * published contract keeps resolving during the deprecation window (§8).
 */
export const DEFAULT_BYPASS_REASON_PATTERN = REQUIRED_BYPASS_REASON_PATTERN;

/** Hard ceiling on how far out a bootstrap window may sit. */
export const BOOTSTRAP_ABSOLUTE_MAX_DAYS = 30;

/**
 * How long a newly declared suite is forgiven for having no evidence yet.
 *
 * Bootstrap (§4) is one flag for the whole workflow, which made ADDING a suite
 * a repository-wide wedge: the moment a fourth suite lands in the table of an
 * armed repo its evidence is missing (row 9), and every pull request is blocked
 * until that suite's first green nightly. The escapes were re-opening the
 * GLOBAL window — un-arming the three suites that were working — or burning an
 * audited bypass. Neither is a proportionate answer to adding a suite.
 *
 * Two weeks is a fortnight of nightlies: long enough to wire a suite up and
 * burn its first failures down, short enough that forgetting the field is
 * self-correcting. It is a DEFAULT, and `grace_days` may only shorten it —
 * the ceiling it is checked against is `bootstrap_max_days`, the same
 * forgiveness budget the global window spends from (§4.1).
 */
export const DEFAULT_SUITE_GRACE_DAYS = 14;

/** Hard ceiling on how stale a run may be and still speak for the branch. */
export const ABSOLUTE_MAX_FRESHNESS_HOURS = 720;

/** Hard ceiling on retry attempts, so a "bounded retry" stays bounded. */
export const ABSOLUTE_MAX_API_ATTEMPTS = 5;

/**
 * Hard ceiling on job-list pages one run may consume.
 *
 * Unbounded, `NIGHTLY_API_MAX_PAGES` would remove the very bound that makes a
 * truncated job list detectable.
 */
export const ABSOLUTE_MAX_API_PAGES = 20;

/**
 * Hard ceiling on a single retry wait.
 *
 * Unbounded, `NIGHTLY_API_RETRY_MAX_SECONDS=86400` would park the gate until the
 * runner timeout — a check that never reports, which on a required context
 * blocks every PR just as effectively as a red one but with nothing to read.
 */
export const ABSOLUTE_MAX_RETRY_SECONDS = 120;

/**
 * Applies every source-constant ceiling, in one place.
 *
 * Numeric ceilings CLAMP DOWN rather than fail, because clamping toward
 * strictness cannot fail open and a caller who asked for a looser gate than
 * policy allows should still get the policy gate rather than a broken one. The
 * clamp is reported so it is never silent.
 *
 * `bootstrap_until` is the deliberate exception and FAILS instead of clamping
 * (see `resolveBootstrap`): it is a date somebody chose, and quietly pulling it
 * closer would make the gate arm on a day nobody expected.
 *
 * @param {{bypassMaxHours: number, bootstrapMaxDays: number, freshnessHours: number, apiMaxAttempts: number, apiMaxPages: number, apiRetryMaxSeconds: number}} requested - What the caller asked for
 * @returns {{limits: object, clamped: ReadonlyArray<string>}} The effective limits and what was reduced
 */
export function resolveSecurityLimits(requested) {
  const clamped = [];
  /**
   * Clamps one value to its source-constant ceiling, recording any reduction.
   *
   * @param {string} name - Caller-facing input name
   * @param {number} asked - Requested value
   * @param {number} ceiling - Source-constant ceiling
   * @returns {number} The effective value
   */
  const cap = (name, asked, ceiling) => {
    if (asked > ceiling) {
      clamped.push(
        `\`${name}\` was ${asked}, above the policy ceiling of ${ceiling}; using ${ceiling}. This limit is a source constant and cannot be raised from a workflow input or the environment.`
      );
      return ceiling;
    }
    return asked;
  };
  return {
    limits: Object.freeze({
      bypassMaxHours: cap(
        "bypass_max_hours",
        requested.bypassMaxHours,
        BYPASS_ABSOLUTE_MAX_HOURS
      ),
      bootstrapMaxDays: cap(
        "bootstrap_max_days",
        requested.bootstrapMaxDays,
        BOOTSTRAP_ABSOLUTE_MAX_DAYS
      ),
      freshnessHours: cap(
        "freshness_hours",
        requested.freshnessHours,
        ABSOLUTE_MAX_FRESHNESS_HOURS
      ),
      apiMaxAttempts: cap(
        "api_max_attempts",
        requested.apiMaxAttempts,
        ABSOLUTE_MAX_API_ATTEMPTS
      ),
      apiMaxPages: cap(
        "api_max_pages",
        requested.apiMaxPages,
        ABSOLUTE_MAX_API_PAGES
      ),
      apiRetryMaxSeconds: cap(
        "api_retry_max_seconds",
        requested.apiRetryMaxSeconds,
        ABSOLUTE_MAX_RETRY_SECONDS
      ),
    }),
    clamped: Object.freeze(clamped),
  };
}

/** Raised for anything that makes the gate's own configuration unreadable. */
export class GateConfigError extends Error {
  /**
   * @param {string} message - What is wrong and how to fix it
   */
  constructor(message) {
    super(message);
    this.name = "GateConfigError";
  }
}

/** Raised when the Actions API could not be read after bounded retries. */
export class GateApiError extends Error {
  /**
   * @param {string} message - What failed
   */
  constructor(message) {
    super(message);
    this.name = "GateApiError";
  }
}

// ---------------------------------------------------------------------------
// 1. Configuration — the `suites` table
// ---------------------------------------------------------------------------

/** Keys a suite entry may carry. Anything else is a typo, and typos fail. */
const SUITE_KEYS = Object.freeze(
  new Set([
    "label",
    "workflow",
    "match",
    "freshness_hours",
    "required_sha",
    "first_seen",
    "grace_days",
    "gated",
    "min_flows",
  ])
);

/** Keys each match mode may carry. */
const MATCH_KEYS = Object.freeze({
  run: new Set(["mode"]),
  job: new Set(["mode", "name"]),
  job_pattern: new Set(["mode", "pattern"]),
});

/**
 * Rejects a value that is not a plain object.
 *
 * @param {unknown} value - Candidate
 * @returns {boolean} True when the value is a non-array object
 */
function isPlainObject(value) {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray(value) === false
  );
}

/**
 * Validates one suite's `match` block.
 *
 * @param {unknown} match - Candidate match block
 * @param {string} where - Human location for error messages
 * @returns {{mode: string, name?: string, pattern?: string}} The validated block
 * @throws {GateConfigError} When the block is unusable
 */
function validateMatch(match, where) {
  if (!isPlainObject(match)) {
    throw new GateConfigError(`${where}: \`match\` must be an object.`);
  }
  const mode = match.mode;
  if (typeof mode !== "string" || !(mode in MATCH_KEYS)) {
    throw new GateConfigError(
      `${where}: \`match.mode\` must be one of "run", "job", "job_pattern" (got ${JSON.stringify(mode)}).`
    );
  }
  for (const key of Object.keys(match)) {
    if (!MATCH_KEYS[mode].has(key)) {
      throw new GateConfigError(
        `${where}: \`match\` carries unknown key \`${key}\` for mode "${mode}". An ignored key is a gate configured differently than you believe.`
      );
    }
  }
  if (mode === "job") {
    if (typeof match.name !== "string" || match.name.length === 0) {
      throw new GateConfigError(
        `${where}: \`match.name\` is required and must be a non-empty string for mode "job".`
      );
    }
  }
  if (mode === "job_pattern") {
    const { pattern } = match;
    if (typeof pattern !== "string" || pattern.length === 0) {
      throw new GateConfigError(
        `${where}: \`match.pattern\` is required and must be a non-empty string for mode "job_pattern".`
      );
    }
    if (!pattern.startsWith("^") || !pattern.endsWith("$")) {
      throw new GateConfigError(
        `${where}: \`match.pattern\` must be anchored at both ends (^…$). An unanchored regex is a substring test wearing a regex's clothes — "Playwright" would match "Playwright (skipped placeholder)". Got ${JSON.stringify(pattern)}.`
      );
    }
    try {
      // No `g` flag, ever: a sticky lastIndex makes repeated .test() calls
      // return alternating answers, which reads as an intermittent gate.
      // Compiling IS the assertion — an invalid pattern throws right here — so
      // the result is deliberately unused.
      const _compiled = new RegExp(pattern);
    } catch (error) {
      throw new GateConfigError(
        `${where}: \`match.pattern\` does not compile: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
  return match;
}

/**
 * Parses and validates the `suites` table.
 *
 * Every failure here is a HARD failure of the gate, never a warning: a table the
 * gate cannot read is a gate that measures nothing, and a gate that measures
 * nothing must not report success.
 *
 * @param {string} raw - The raw JSON string from the workflow input
 * @returns {ReadonlyArray<object>} Validated, frozen suite entries
 * @throws {GateConfigError} When the table is absent, malformed or ambiguous
 */
export function validateSuites(raw) {
  if (typeof raw !== "string" || raw.trim().length === 0) {
    throw new GateConfigError(
      "The `suites` input is empty. The gate has nothing to check, and a gate with nothing to check must not report success."
    );
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new GateConfigError(
      `The \`suites\` input is not valid JSON: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new GateConfigError(
      "The `suites` input must be a JSON array with at least one entry."
    );
  }

  const labels = new Set();
  const identities = new Set();
  const suites = parsed.map((entry, index) => {
    const where = `suites[${index}]`;
    if (!isPlainObject(entry)) {
      throw new GateConfigError(`${where}: each suite must be an object.`);
    }
    for (const key of Object.keys(entry)) {
      if (!SUITE_KEYS.has(key)) {
        throw new GateConfigError(
          `${where}: unknown key \`${key}\`. Did you mean one of ${[...SUITE_KEYS].join(", ")}? A typo'd key silently takes the default, which is a looser gate than you wrote.`
        );
      }
    }
    if (typeof entry.label !== "string" || entry.label.length === 0) {
      throw new GateConfigError(
        `${where}: \`label\` is required and must be a non-empty string.`
      );
    }
    if (typeof entry.workflow !== "string" || entry.workflow.length === 0) {
      throw new GateConfigError(
        `${where}: \`workflow\` is required and must be a non-empty workflow FILE name (e.g. "maestro-e2e.yml").`
      );
    }
    if (labels.has(entry.label)) {
      throw new GateConfigError(
        `${where}: duplicate label ${JSON.stringify(entry.label)}. Two suites sharing a label produce one report line for two verdicts.`
      );
    }
    labels.add(entry.label);

    const match = validateMatch(entry.match, where);
    const identity = `${entry.workflow}\u0000${match.mode}\u0000${match.name ?? match.pattern ?? ""}`;
    if (identities.has(identity)) {
      throw new GateConfigError(
        `${where}: duplicate workflow+match (${entry.workflow}, ${match.mode}). The same suite declared twice is a copy-paste error, and the duplicate can mask a typo in the one you meant.`
      );
    }
    identities.add(identity);

    if (entry.freshness_hours !== undefined) {
      const hours = entry.freshness_hours;
      if (
        typeof hours !== "number" ||
        !Number.isFinite(hours) ||
        hours <= 0 ||
        hours > ABSOLUTE_MAX_FRESHNESS_HOURS
      ) {
        throw new GateConfigError(
          `${where}: \`freshness_hours\` must be a number in (0, ${ABSOLUTE_MAX_FRESHNESS_HOURS}].`
        );
      }
    }
    // Rows 32-35 — the per-suite grace anchor and its length. Shape only; the
    // WINDOW is resolved (and rejected) in `resolveSuiteGrace`, which is the
    // one place the `bootstrap_max_days` ceiling is applied to it.
    if (entry.first_seen !== undefined) {
      if (
        typeof entry.first_seen !== "string" ||
        entry.first_seen.trim().length === 0
      ) {
        throw new GateConfigError(
          `${where}: \`first_seen\` must be an ISO-8601 UTC timestamp naming when this suite entered the table (e.g. "2026-08-10T00:00:00Z").`
        );
      }
    }
    if (entry.grace_days !== undefined) {
      // A knob with no anchor is a gate configured differently than its author
      // believes — the same defect an ignored key is, so it fails the same way.
      if (entry.first_seen === undefined) {
        throw new GateConfigError(
          `${where}: \`grace_days\` requires \`first_seen\`. A grace length with no anchor forgives nothing and reads as though it forgives everything.`
        );
      }
      const days = entry.grace_days;
      if (
        typeof days !== "number" ||
        !Number.isFinite(days) ||
        days <= 0 ||
        days > BOOTSTRAP_ABSOLUTE_MAX_DAYS
      ) {
        throw new GateConfigError(
          `${where}: \`grace_days\` must be a number in (0, ${BOOTSTRAP_ABSOLUTE_MAX_DAYS}]. A grace that outlives the bootstrap ceiling IS acmeorga's forever-bootstrap, whatever it is called — rejected rather than clamped, so widening it is a reviewable act.`
        );
      }
    }
    // Row 37 — the executed-flow floor. A floor of 0 or a fractional one is
    // rejected rather than coerced: `min_flows: 0` reads as "a floor is
    // declared" and enforces nothing, which is the shape of every control that
    // reports success because it did nothing.
    if (entry.min_flows !== undefined) {
      const floor = entry.min_flows;
      if (!Number.isInteger(floor) || floor < 1) {
        throw new GateConfigError(
          `${where}: \`min_flows\` must be an integer >= 1 — the number of flows this suite must execute before its green counts as evidence. \`0\` would declare a floor and enforce nothing. Read from the \`maestro-<platform>-flowcount-<N>\` artifact the suite publishes; once declared, a run that publishes no count BLOCKS rather than passing unchecked.`
        );
      }
    }
    if (entry.required_sha !== undefined) {
      if (
        typeof entry.required_sha !== "string" ||
        !/^[0-9a-f]{40}$/.test(entry.required_sha)
      ) {
        throw new GateConfigError(
          `${where}: \`required_sha\` must be a full 40-character lowercase commit SHA.`
        );
      }
    }
    // §10.7 — a REPORTING-only declaration. The gate ignores it completely; it
    // exists so a suite that is tracked but not gating can say so in its issue
    // instead of crying wolf. Boolean and nothing else: a string "false" is
    // truthy, and a suite that believed it was ungated while claiming to block
    // merges is the exact confusion this field removes.
    if (entry.gated !== undefined && typeof entry.gated !== "boolean") {
      throw new GateConfigError(
        `${where}: \`gated\` must be a boolean (got ${JSON.stringify(entry.gated)}). It declares whether this suite's tracking issue may say that merges are blocked — it does not change the gate, which is decided by the branch ruleset.`
      );
    }
    return Object.freeze({ ...entry, match: Object.freeze({ ...match }) });
  });

  return Object.freeze(suites);
}

// ---------------------------------------------------------------------------
// 2. Classification — the truth table, as pure functions
// ---------------------------------------------------------------------------

/**
 * Whether a run is inside the freshness window.
 *
 * @param {object} run - An Actions run
 * @param {number} freshnessHours - Window size in hours
 * @param {Date} now - Evaluation instant
 * @returns {boolean} True when the run is fresh enough to speak for the branch
 */
export function isFresh(run, freshnessHours, now) {
  const created = Date.parse(run?.created_at ?? "");
  if (Number.isNaN(created)) return false;
  return now.getTime() - created <= freshnessHours * 3_600_000;
}

/**
 * Turns one conclusion into a suite state.
 *
 * @param {string|null|undefined} conclusion - The API's conclusion value
 * @returns {"pass"|"fail"|"unknown"} The state
 */
export function stateForConclusion(conclusion) {
  if (conclusion === GREEN_CONCLUSION) return SUITE_STATES.pass;
  if (DECISIVE_CONCLUSIONS.has(conclusion)) return SUITE_STATES.fail;
  return SUITE_STATES.unknown;
}

/**
 * Whether a run produced EVIDENCE about the code — rows 41-42's discriminator.
 *
 * This decides only whether a run is worth SCORING, never what its verdict is.
 * A run with evidence goes to `assessSuite` and is judged there exactly as
 * before; a run without evidence is stepped over so the next-older candidate can
 * be judged instead.
 *
 * Evidence is read from the run's JOBS rather than from a status allowlist,
 * because `cancelled` is overloaded across at least three distinct causes — a
 * duplicate displaced by the suite's `concurrency` group (tested nothing), a job
 * killed at its own `timeout-minutes` ceiling (tested most of the suite), and an
 * operator cancel (anywhere in between). A status-only rule cannot tell them
 * apart, and only the first may ever be walked past.
 *
 * Four cases, and three of them answer "scoreable":
 *
 * 1. A DECISIVE run conclusion is evidence whatever it says — including
 *    `failure`. Nothing here may skip over a red run to find an older green.
 * 2. An indecisive conclusion whose jobs contain at least one decisive outcome
 *    is PARTIAL evidence. Scoreable, and it will block, because a suite killed
 *    part-way through reached no verdict. Deliberately not skipped: walking past
 *    it to an older green would RELAX the gate, which is the failure mode a fix
 *    here must not introduce.
 * 3. An UNREAD job list — empty, or a list that would not load, whether it
 *    failed on the first page or part-way through — is scoreable. Fail-closed:
 *    a completed run always has at least one job, so an empty list is an unread
 *    one, and "we could not check" is never grounds to skip a run. A PARTIAL
 *    read belongs here rather than in case 4 for exactly the same reason: 100
 *    indecisive jobs and an unreadable page 2 do not show that the run tested
 *    nothing, and skipping it would hide a failure on the page that would not
 *    load behind an older green.
 * 4. An indecisive conclusion whose job list was read IN FULL and holds no
 *    decisive outcome tested nothing. This is the only case that is skipped.
 *
 * @param {object} run - An Actions run
 * @param {ReadonlyArray<object>|null|undefined} jobs - That run's jobs, as read
 * @param {boolean} [complete] - Whether that job list was read to its end; a partial read is never grounds to skip
 * @returns {boolean} True when the run is worth scoring
 */
export function runProducedEvidence(run, jobs, complete = true) {
  if (DECISIVE_CONCLUSIONS.has(run?.conclusion)) return true;
  if (!Array.isArray(jobs) || jobs.length === 0) return true;
  if (complete !== true) return true;
  return jobs.some(job => DECISIVE_CONCLUSIONS.has(job?.conclusion));
}

/**
 * Counts how many of a run's jobs reached a verdict.
 *
 * Carried onto the `selection` record so the report can say "0 of 1 job(s)
 * reached a verdict" rather than the unfalsifiable "it tested nothing".
 *
 * @param {ReadonlyArray<object>|null|undefined} jobs - A run's jobs
 * @returns {number} How many carry a decisive conclusion
 */
export function countDecisiveJobs(jobs) {
  if (!Array.isArray(jobs)) return 0;
  return jobs.filter(job => DECISIVE_CONCLUSIONS.has(job?.conclusion)).length;
}

/**
 * Reads the scope markers a run published, from its artifact NAMES.
 *
 * Pure, so the parsing is provable without a network. `readable: false` is the
 * "we could not ask" case and is deliberately distinct from an empty reading —
 * a run that published no markers and a run whose artifact list would not load
 * are different facts, and only one of them is the suite's fault.
 *
 * @param {ReadonlyArray<{name?: string}>|null} artifacts - The artifacts list, or null when unreadable
 * @returns {{readable: boolean, filtered: ReadonlyArray<string>, counts: Readonly<Record<string, number>>, totalFlows: number|null}} What the run recorded about its own scope
 */
export function readSuiteScope(artifacts) {
  if (!Array.isArray(artifacts)) {
    return Object.freeze({
      readable: false,
      filtered: Object.freeze([]),
      full: Object.freeze([]),
      counts: Object.freeze({}),
      totalFlows: null,
    });
  }
  const filtered = [];
  const full = [];
  const counts = {};
  for (const artifact of artifacts) {
    const name = typeof artifact?.name === "string" ? artifact.name : "";
    const scope = SCOPE_ARTIFACT_PATTERN.exec(name);
    if (scope && scope.groups.scope === "full") {
      full.push(scope.groups.platform);
      continue;
    }
    if (scope && scope.groups.scope === "filtered") {
      filtered.push(scope.groups.platform);
      continue;
    }
    const count = FLOW_COUNT_ARTIFACT_PATTERN.exec(name);
    if (count) {
      // MAX, never sum, when one platform somehow publishes twice: a re-uploaded
      // count is the same arm counted again, and summing it would inflate the
      // suite past its own floor. Taking the larger of two readings of one arm
      // is the reading that cannot invent flows.
      const value = Number(count.groups.count);
      const platform = count.groups.platform;
      counts[platform] = Math.max(counts[platform] ?? 0, value);
    }
  }
  const platforms = Object.keys(counts);
  return Object.freeze({
    readable: true,
    filtered: Object.freeze(filtered.sort(compareStrings)),
    // Tracked as well as `filtered`, because "the run asserted it was UNFILTERED"
    // and "the run said nothing" are different facts and only one of them is
    // grounds to stop asking. Every pre-adoption run is the second.
    full: Object.freeze(full.sort(compareStrings)),
    counts: Object.freeze({ ...counts }),
    // `null`, not 0, when nothing was published. Zero is a READING — the arm ran
    // and tested nothing — and rendering "no evidence" as that reading is the
    // exact substitution this whole section exists to refuse.
    totalFlows:
      platforms.length === 0
        ? null
        : platforms.reduce((sum, platform) => sum + counts[platform], 0),
  });
}

/**
 * Row 36-38 — was this run NARROWED?
 *
 * Returns `null` when the run is not disqualified, or the reason token that
 * disqualifies it. Every return here resolves to state `unknown`, never `fail`:
 * a narrowed run is ABSENCE of evidence about the flows it skipped, not evidence
 * that they are broken. That places it on the same side of the line as the
 * skipped-job half of row 26, which means bootstrap and per-suite grace forgive
 * it on the same terms — deliberate, so ARMING this row cannot wedge a repo that
 * is still standing its suites up.
 *
 * The asymmetry between the two signals is the whole design:
 *
 *  - A POSITIVELY OBSERVED filter (row 36) disqualifies unconditionally. No
 *    declaration is needed to disbelieve a run that reported its own narrowing.
 *  - A SHORTFALL against `min_flows` (row 37) and an UNREADABLE scope (row 38)
 *    require the suite to have declared `min_flows`. A floor cannot be inferred:
 *    this gate reads suites it did not write, including non-maestro ones that
 *    publish no counts at all, and a guessed denominator would either forgive
 *    everything or block every consumer on the day it shipped.
 *
 * That last point is where fail-closed actually lives. Declaring `min_flows` is
 * the act of saying "this suite publishes counts"; from that moment an
 * unreadable count is a BLOCK (row 38), never a shrug. Without the declaration
 * the gate cannot tell, and it says so on the report line rather than passing
 * silently — see `scopeUnverified` on the finding.
 *
 * @param {object} suite - A validated suite entry
 * @param {{readable: boolean, filtered: ReadonlyArray<string>, totalFlows: number|null}} scope - Output of `readSuiteScope`
 * @returns {{reason: string, detail: string}|null} The disqualification, or null
 */
export function assessSuiteScope(suite, scope) {
  if (scope.filtered.length > 0) {
    return {
      reason: FILTERED_RUN_REASON,
      detail: `the run recorded itself as tag-filtered on ${scope.filtered.map(platform => `\`${platform}\``).join(", ")}`,
    };
  }
  // Row 39 — ZERO, before the declaration gate. Deliberately PER-ARM rather
  // than on the total: a night that ran 40 Android flows and 0 iOS ones sums to
  // 40 and is still a run that proved nothing whatsoever about iOS. Summing
  // first would let a healthy arm launder a dead one, which is the same
  // arithmetic mistake as reading a suite's green off the platform that
  // happened to work.
  const dead = Object.keys(scope.counts)
    .filter(platform => scope.counts[platform] === 0)
    .sort(compareStrings);
  if (dead.length > 0) {
    return {
      reason: ZERO_FLOWS_REASON,
      detail: `${dead.map(platform => `\`${platform}\``).join(", ")} executed ZERO flows — that arm reached no assertion at all`,
    };
  }

  const floor = suite.min_flows;
  if (floor === undefined) return null;
  if (!scope.readable) {
    return {
      reason: SCOPE_UNREADABLE_REASON,
      detail: `\`min_flows\` is ${floor} but this run's artifact list could not be read, so the executed-flow count is unknown`,
    };
  }
  if (scope.totalFlows === null) {
    return {
      reason: SCOPE_UNREADABLE_REASON,
      detail: `\`min_flows\` is ${floor} but this run published no \`maestro-<platform>-flowcount-<N>\` marker, so how much of the suite ran is unknown`,
    };
  }
  if (scope.totalFlows < floor) {
    return {
      reason: FLOW_SHORTFALL_REASON,
      detail: `this run executed ${scope.totalFlows} flow(s) against a declared floor of ${floor}`,
    };
  }
  return null;
}

/**
 * Assesses one suite from what was observed for it.
 *
 * `reason` is a stable machine token (the truth-table row), so the tests can
 * assert the ROW rather than the prose, and the prose can be reworded without
 * anyone claiming the contract changed.
 *
 * @param {object} suite - A validated suite entry
 * @param {object} observation - `{ run, jobs, workflowMissing }`
 * @param {{branch: string, freshnessHours: number, now: Date}} context - Evaluation context
 * @returns {{label: string, state: string, reason: string, conclusion: string|null, url: string|null, createdAt: string|null, event: string|null}} The finding
 */
export function assessSuite(suite, observation, context) {
  // Rows 41-42. Attached to EVERY return path, because the defect being fixed
  // was a gate silently changing which run it scored — a selection nobody can
  // see is the same class of defect one layer down. Attached only when the
  // observation carried one, so a caller that never went through `observe`
  // produces byte-identical findings.
  const base = {
    label: suite.label,
    workflow: suite.workflow,
    ...(observation.selection ? { selection: observation.selection } : {}),
  };
  const blank = { conclusion: null, url: null, createdAt: null, event: null };
  // An observation with no `scope` at all is the same fact as an artifacts list
  // that would not load — "nobody asked" and "the answer did not come back" are
  // both absence of a reading — so it goes through the same constructor rather
  // than a hand-rolled stub. A stub missing a field would throw here and take
  // the whole gate red for a reason having nothing to do with any suite.
  const scope = observation.scope ?? readSuiteScope(null);

  /**
   * The ONE place a green may be returned, so row 36-38 cannot be bypassed by
   * a future third pass path.
   *
   * `scopeUnverified` rides on the PASSING finding rather than being swallowed:
   * a suite that declared no floor and published no counts really did pass every
   * check this gate can run, and the honest report of that is a green line that
   * says out loud which question went unasked. A silent green here would be the
   * same defect one layer up.
   *
   * @param {object} seen - The run fields already resolved for this finding
   * @param {string} reason - The truth-table reason token for the green
   * @returns {object} The finding
   */
  const green = (seen, reason) => {
    // Row 26's rule, applied to the half of it a job list cannot show you.
    // Every green below is argued from the jobs that were READ, so a list the
    // walk could not finish reading cannot support one: a `success` run whose
    // page 2 would not load looks, from page 1, exactly like a `success` run
    // with nothing behind it — and the failing shard hides on the page that
    // 404'd. The empty-list case already landed on `incomplete_run` for this
    // reason; a PARTIAL read is the same "we could not check", and it must not
    // render as "it is fine" either.
    //
    // Placed inside `green` on purpose, so it can only ever turn a PASS into
    // `unknown`. A decisive run or job conclusion returns before reaching here,
    // which keeps `failure` conclusive and unswallowable — an unreadable page
    // is never allowed to soften a red into an inconclusive.
    if (observation.jobsComplete === false) {
      return {
        ...base,
        ...seen,
        state: SUITE_STATES.unknown,
        reason: INCOMPLETE_EVIDENCE_REASON,
      };
    }
    const disqualifier = assessSuiteScope(suite, scope);
    if (disqualifier) {
      return {
        ...base,
        ...seen,
        state: SUITE_STATES.unknown,
        reason: disqualifier.reason,
        scopeDetail: disqualifier.detail,
      };
    }
    return {
      ...base,
      ...seen,
      state: SUITE_STATES.pass,
      reason,
      // Only ever true when no floor was declared — with one declared, the same
      // condition returns a disqualifier above instead.
      //
      // The condition is "no floor AND the run never asserted it was unfiltered",
      // NOT "no floor AND no count was published". Running this against the real
      // AcmeOrgB run 32023540492 is what corrected it: that run publishes
      // `flowcount-4` on both arms, so a count-based condition read it as
      // verified and printed a clean green — the exact 5%-of-the-suite false
      // green this file exists to catch, silently. Knowing the number is not the
      // same as being able to judge it; only a declared floor or the run's own
      // `scope-full` marker settles the question.
      scopeUnverified:
        suite.min_flows === undefined && (scope.full?.length ?? 0) === 0,
      // Carried so the notice can quote what WAS measured. "this run executed 8
      // flow(s)" is a number a reader can act on; "how much ran is unknown" when
      // the count was sitting right there is the gate withholding its evidence.
      observedFlows: scope.totalFlows,
    };
  };

  // Row 11 — the workflow file the table names no longer exists. That is not
  // missing evidence, it is a broken gate: someone renamed or deleted the suite
  // out from under it, and bootstrap must not forgive that.
  if (observation.workflowMissing) {
    return {
      ...base,
      ...blank,
      state: SUITE_STATES.fail,
      reason: "workflow_not_found",
    };
  }

  const run = observation.run ?? null;
  if (!run) {
    return { ...base, ...blank, state: SUITE_STATES.unknown, reason: "no_run" };
  }

  const seen = {
    conclusion: run.conclusion ?? null,
    url: run.html_url ?? null,
    createdAt: run.created_at ?? null,
    event: run.event ?? null,
  };

  // Row 15 — the API was asked for one branch; verifying head_branch anyway is
  // defence against a filter that silently stops filtering.
  if (run.head_branch && run.head_branch !== context.branch) {
    return {
      ...base,
      ...seen,
      state: SUITE_STATES.unknown,
      reason: "wrong_branch",
    };
  }
  // Row 16 — stale SHA.
  if (suite.required_sha && run.head_sha !== suite.required_sha) {
    return {
      ...base,
      ...seen,
      state: SUITE_STATES.unknown,
      reason: "stale_sha",
    };
  }
  // Row 10 — runs exist, but none recent enough to speak for the branch.
  const freshnessHours = suite.freshness_hours ?? context.freshnessHours;
  if (!isFresh(run, freshnessHours, context.now)) {
    return {
      ...base,
      ...seen,
      state: SUITE_STATES.unknown,
      reason: "stale_run",
    };
  }

  const jobs = observation.jobs ?? [];

  if (suite.match.mode === "run") {
    const state = stateForConclusion(run.conclusion);
    if (state !== SUITE_STATES.pass) {
      return {
        ...base,
        ...seen,
        state,
        reason:
          state === SUITE_STATES.unknown
            ? "indecisive_conclusion"
            : "run_conclusion",
      };
    }

    // Row 26 — COMPLETENESS. `mode: "run"` means the whole workflow IS the
    // suite, so the run's own `success` is evidence only when every job behind
    // it also succeeded.
    //
    // GitHub concludes a run `success` when jobs were SKIPPED. That is how a
    // suite reports green having tested half of itself: the shipped
    // `maestro-e2e.yml` caller exposes a `platform` dispatch picker, and
    // `platform: android` leaves the iOS job skipped while the run still
    // concludes `success`. Read as a run conclusion alone, that filtered
    // dispatch cleared a required merge gate for an arm that never executed —
    // acmeorga's trap, a suite declaring itself green on evidence it never
    // gathered. The same shape reaches the CRON path: with
    // `require_prerequisites: false` and no EXPO_TOKEN, every job skips and the
    // run is still `success`.
    //
    // The discriminator is "was this run PARTIAL?", never "was this a
    // dispatch?" — twice deliberately. The runs API exposes no `inputs` field,
    // so the filter itself is unreadable; and a full unfiltered dispatch is the
    // documented unblock path (§7), which must keep counting or the gate stops
    // being escapable by FIXING.
    //
    // An EMPTY job list lands here too: a completed run always has at least one
    // job, so an empty list is an unread job list, and "we could not check"
    // never renders as "it is fine".
    const shortfall = jobs.find(job => job.conclusion !== GREEN_CONCLUSION);
    if (jobs.length === 0 || shortfall) {
      const conclusion = shortfall?.conclusion ?? null;
      return {
        ...base,
        ...seen,
        // The RUN's `success` must not be printed beside a blocked state — the
        // same self-contradiction the job-scoped modes refuse below.
        conclusion,
        url: shortfall?.html_url ?? seen.url,
        // A skipped arm is ABSENCE of evidence, which bootstrap may forgive; a
        // job that failed under `continue-on-error` inside a green run is
        // EVIDENCE OF FAILURE, which it never may.
        state:
          stateForConclusion(conclusion) === SUITE_STATES.fail
            ? SUITE_STATES.fail
            : SUITE_STATES.unknown,
        reason: INCOMPLETE_EVIDENCE_REASON,
      };
    }

    return green(seen, "run_conclusion");
  }

  const matches =
    suite.match.mode === "job"
      ? jobs.filter(job => job.name === suite.match.name)
      : jobs.filter(job => new RegExp(suite.match.pattern).test(job.name));

  // Rows 12 and 13 — the matcher found nothing. A renamed job and a regex that
  // no longer matches are the same defect, and both are how a gate stops gating
  // with nothing to see. Never "nothing to report".
  //
  // `conclusion: null` is load-bearing here, not tidiness. `seen.conclusion` is
  // the RUN's conclusion, which for a job-scoped suite is a different question
  // from the one being answered — a workflow that also carries lint can conclude
  // `failure` while the watched job is green, and vice versa. Reporting the run's
  // value beside a job-derived state prints "❌ … [failure]" for a suite whose
  // job was never found, or worse "✅ … [failure]" for one that passed. Both read
  // as the gate contradicting itself, which is how a reader learns to stop
  // trusting it.
  if (matches.length === 0) {
    return {
      ...base,
      ...seen,
      conclusion: null,
      state: SUITE_STATES.unknown,
      reason:
        suite.match.mode === "job"
          ? "job_not_found"
          : "pattern_matched_nothing",
    };
  }

  // Row 14 — any non-success match decides, and we report THAT job's URL so the
  // message points at the thing that failed rather than at the run's summary.
  const offender = matches.find(job => job.conclusion !== GREEN_CONCLUSION);
  if (!offender) {
    return green({ ...seen, conclusion: GREEN_CONCLUSION }, "job_conclusion");
  }
  const state = stateForConclusion(offender.conclusion);
  return {
    ...base,
    ...seen,
    conclusion: offender.conclusion ?? null,
    url: offender.html_url ?? seen.url,
    state,
    reason:
      state === SUITE_STATES.unknown
        ? "indecisive_conclusion"
        : "job_conclusion",
  };
}

// ---------------------------------------------------------------------------
// 3. Bootstrap — time-boxed, with a visible expiry
// ---------------------------------------------------------------------------

/**
 * Resolves the bootstrap window.
 *
 * A window further out than `maxDays` is INVALID CONFIGURATION and fails the
 * gate (row 24), rather than being clamped. Clamping would let the window be
 * extended forever by editing one string; failing makes extension require
 * changing the cap too, which is a reviewable act.
 *
 * `maxDays` reaches here already clamped to `BOOTSTRAP_ABSOLUTE_MAX_DAYS` by
 * `resolveSecurityLimits`, so a caller cannot raise the ceiling it is checked
 * against — which is what stops this row from being defeated by one input.
 *
 * @param {string} until - ISO-8601 UTC timestamp, or "" for no window
 * @param {number} maxDays - Ceiling on how far out the window may sit
 * @param {Date} now - Evaluation instant
 * @returns {{active: boolean, until: string|null, expiresInDays: number|null}} The window
 * @throws {GateConfigError} When the timestamp is unparseable or beyond the cap
 */
export function resolveBootstrap(until, maxDays, now) {
  if (typeof until !== "string" || until.trim().length === 0) {
    return Object.freeze({ active: false, until: null, expiresInDays: null });
  }
  const parsed = Date.parse(until.trim());
  if (Number.isNaN(parsed)) {
    throw new GateConfigError(
      `\`bootstrap_until\` is not an ISO-8601 timestamp: ${JSON.stringify(until)}. Use e.g. "2026-09-15T00:00:00Z".`
    );
  }
  const days = (parsed - now.getTime()) / 86_400_000;
  if (days > maxDays) {
    throw new GateConfigError(
      `\`bootstrap_until\` (${until}) is ${Math.ceil(days)} days out, beyond \`bootstrap_max_days\` (${maxDays}). A bootstrap window that can be extended by editing one string is acmeorga's forever-bootstrap: a suite that never runs passes forever. Raise the cap deliberately, in the same review, or bring the date in.`
    );
  }
  return Object.freeze({
    active: parsed > now.getTime(),
    until: new Date(parsed).toISOString(),
    expiresInDays: Math.max(0, Math.ceil(days)),
  });
}

/**
 * Resolves ONE suite's first-seen grace window (rows 32-35).
 *
 * The problem this exists for: bootstrap is workflow-global, so adding a suite
 * to an armed repo blocks every pull request from the moment of the edit until
 * that suite's first green nightly — and the only outs were re-opening the
 * global window (which un-arms every suite that was already working) or an
 * audited bypass. Neither is proportionate to the routine act of adding a
 * suite, and both teach people that the gate is something to get around.
 *
 * What keeps this from becoming acmeorga's forever-bootstrap is the ANCHOR.
 * The window is not a date somebody picks; it is `first_seen + grace_days`,
 * and `first_seen` MAY NOT BE IN THE FUTURE. A future anchor would make this a
 * hand-typed expiry under another name, extendable by one string edit forever —
 * so it fails as misconfiguration, exactly as row 24 fails a bootstrap window
 * beyond its cap. Rolling the anchor forward is still possible, and it is
 * meant to be: it means writing "this suite is new" about a suite that is not,
 * in a diff a reviewer reads.
 *
 * The ceiling is `bootstrap_max_days` — the SAME forgiveness budget the global
 * window spends from, already clamped to `BOOTSTRAP_ABSOLUTE_MAX_DAYS` by
 * `resolveSecurityLimits`. A grace that could outlive it would be a second,
 * looser bootstrap wearing a per-suite hat.
 *
 * A window that lapsed long ago is INERT, never an error: cleaning the field
 * up must stay optional, or the design buys a churn commit per suite per month
 * and the first person to hit it deletes the anchor rather than the window.
 *
 * @param {object} suite - A validated suite entry
 * @param {number} maxDays - Ceiling on how far out any forgiveness window may sit
 * @param {Date} now - Evaluation instant
 * @returns {{active: boolean, until: string|null, expiresInDays: number|null, firstSeen: string|null}} The window
 * @throws {GateConfigError} When the anchor is unparseable, in the future, or the window exceeds the ceiling
 */
export function resolveSuiteGrace(suite, maxDays, now) {
  const raw = suite?.first_seen;
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return Object.freeze({
      active: false,
      until: null,
      expiresInDays: null,
      firstSeen: null,
    });
  }
  const anchor = Date.parse(raw.trim());
  if (Number.isNaN(anchor)) {
    throw new GateConfigError(
      `\`first_seen\` for suite ${JSON.stringify(suite.label)} is not an ISO-8601 timestamp: ${JSON.stringify(raw)}. Use e.g. "2026-08-10T00:00:00Z".`
    );
  }
  if (anchor > now.getTime()) {
    throw new GateConfigError(
      `\`first_seen\` for suite ${JSON.stringify(suite.label)} (${raw}) is in the future. A suite cannot have been first seen tomorrow, and an anchor that may sit in the future is a hand-typed expiry under another name — one string edit and the grace never ends.`
    );
  }
  const graceDays = suite.grace_days ?? DEFAULT_SUITE_GRACE_DAYS;
  const untilMs = anchor + graceDays * 86_400_000;
  const daysOut = (untilMs - now.getTime()) / 86_400_000;
  if (daysOut > maxDays) {
    throw new GateConfigError(
      `The first-seen grace for suite ${JSON.stringify(suite.label)} runs ${Math.ceil(daysOut)} days out, beyond \`bootstrap_max_days\` (${maxDays}). Per-suite grace spends from the same forgiveness budget as the bootstrap window, so it fails as misconfiguration rather than being clamped — shorten \`grace_days\`, or raise the cap deliberately in the same review.`
    );
  }
  return Object.freeze({
    active: untilMs > now.getTime(),
    until: new Date(untilMs).toISOString(),
    expiresInDays: Math.max(0, Math.ceil(daysOut)),
    firstSeen: new Date(anchor).toISOString(),
  });
}

// ---------------------------------------------------------------------------
// 4. Bypass — maintainers only, reason required, auto-expiring, self-service
// ---------------------------------------------------------------------------

/**
 * Decides whether a bypass request is valid, as a pure function of the facts
 * the caller gathered.
 *
 * Every rejection carries a stable `reason` token so the audit says WHICH
 * condition failed.
 *
 * The bypass is deliberately SELF-SERVICE: the PR's own author may apply the
 * label and have it honoured. It did not start that way — a `self_bypass`
 * rejection used to require a second person — and the measurement that removed
 * it is worth keeping next to the code. Across one portfolio repository, 93
 * pull requests carried the label and exactly ONE waiver was ever honoured,
 * because on a small team (and on any repo where an agent opens the PR) the
 * author and the only available labeller are the same party. A control that
 * fires on 1% of attempts is not protecting anything; it is routing the other
 * 99% onto the unaudited admin merge, which records nothing at all. The value
 * of this mechanism is the AUDIT RECORD, not the second pair of eyes, so every
 * arm that produces the record is kept and only the second-party requirement
 * is gone. `prAuthor` is therefore still carried onto the audit — recorded,
 * never used to reject. (Owner ruling, 2026-08-19.)
 *
 * `extraReasonPattern` is an ADDITIONAL requirement, never a replacement for
 * `REQUIRED_BYPASS_REASON_PATTERN`. An override that could replace the built-in
 * rule would let `.*` satisfy "a reason and a ticket are required" with an empty
 * PR body — a security limit a caller can relax is not a limit.
 *
 * @param {object} request - `{ labelEvent, prAuthor, prNumber, label, prBody, actorPermission, maxHours, extraReasonPattern, now }`
 * @returns {{valid: boolean, reason: string, actor: string|null, appliedAt: string|null, expiresAt: string|null, ticket: string|null, detail: string|null}} The decision
 */
export function evaluateBypass(request) {
  const {
    labelEvent,
    prAuthor,
    prNumber = null,
    label = null,
    prBody,
    actorPermission,
    maxHours,
    extraReasonPattern,
    now,
  } = request;

  /** Identity of the request, carried onto every outcome for the audit. */
  const subject = {
    label,
    prAuthor: prAuthor ?? null,
    prNumber,
    actorPermission: actorPermission ?? null,
  };

  const reject = (reason, extra = {}) =>
    Object.freeze({
      ...subject,
      valid: false,
      reason,
      actor: labelEvent?.actor ?? null,
      appliedAt: labelEvent?.createdAt ?? null,
      expiresAt: null,
      ticket: null,
      detail: null,
      ...extra,
    });

  if (!labelEvent || !labelEvent.actor || !labelEvent.createdAt) {
    // The label is present but nobody can be shown to have applied it — on a
    // fork PR the timeline is unreadable. An unattributable bypass is not an
    // audited bypass.
    return reject("no_attributable_actor");
  }
  if (!BYPASS_PERMISSIONS.has(actorPermission)) {
    return reject("actor_not_maintainer", {
      detail: actorPermission ?? "unknown",
    });
  }
  const cappedHours = Math.min(maxHours, BYPASS_ABSOLUTE_MAX_HOURS);
  const appliedMs = Date.parse(labelEvent.createdAt);
  if (Number.isNaN(appliedMs)) return reject("no_attributable_actor");
  const expiresMs = appliedMs + cappedHours * 3_600_000;
  if (now.getTime() > expiresMs) {
    return reject("bypass_expired", {
      expiresAt: new Date(expiresMs).toISOString(),
    });
  }

  // The built-in rule ALWAYS applies. It is checked first and on its own, so no
  // caller-supplied pattern can stand in for it.
  const found = new RegExp(REQUIRED_BYPASS_REASON_PATTERN, "m").exec(
    prBody ?? ""
  );
  if (!found) {
    return reject("no_reason_or_ticket", {
      expiresAt: new Date(expiresMs).toISOString(),
    });
  }

  // An optional project rule can only NARROW what qualifies — e.g. a repo that
  // wants its own ticket prefix, or a second required line. It is an AND.
  if (typeof extraReasonPattern === "string" && extraReasonPattern.length > 0) {
    let extra;
    try {
      extra = new RegExp(extraReasonPattern, "m");
    } catch (error) {
      throw new GateConfigError(
        `\`bypass_reason_pattern\` does not compile: ${error instanceof Error ? error.message : String(error)}`
      );
    }
    if (!extra.test(prBody ?? "")) {
      return reject("no_reason_or_ticket", {
        expiresAt: new Date(expiresMs).toISOString(),
      });
    }
  }

  return Object.freeze({
    ...subject,
    valid: true,
    reason: "valid",
    actor: labelEvent.actor,
    appliedAt: new Date(appliedMs).toISOString(),
    expiresAt: new Date(expiresMs).toISOString(),
    ticket: found.groups?.ticket ?? null,
    detail: (found.groups?.reason ?? "").trim() || null,
  });
}

/** Human wording for each bypass rejection token. */
const BYPASS_REJECTIONS = Object.freeze({
  no_attributable_actor:
    "nobody can be shown to have applied it (the PR timeline was unreadable — this is normal on a fork PR). An unattributable bypass is not an audited bypass.",
  actor_not_maintainer:
    "the person who applied it does not have `admin` or `maintain` on this repository. Bypasses are maintainers only.",
  bypass_expired:
    "it was applied longer ago than `bypass_max_hours` allows. Bypasses auto-expire so a label nobody removes cannot become a permanent hole.",
  no_reason_or_ticket:
    "the PR body carries no `Nightly-E2E-Bypass: <TICKET> <reason>` line. A bypass without a reason and a ticket is not auditable.",
  pr_state_unreadable:
    "this pull request's live labels and body could not be read, so whether a waiver was requested is UNKNOWN. The gate stays closed: a bypass that fires when it could not read the request is worse than no bypass. On a private repository the caller job needs `pull-requests: read`; otherwise this is a transient API failure and a re-run resolves it.",
});

// ---------------------------------------------------------------------------
// 5. Verdict
// ---------------------------------------------------------------------------

/**
 * Combines suite findings, the bootstrap window and the bypass decision into
 * the one verdict the check reports.
 *
 * Order matters and is the contract: bootstrap softens only `unknown`, and the
 * bypass is applied LAST — so a bypass waives a genuine red, and a green PR
 * carrying a stale label still reports `pass` rather than pretending the label
 * did something.
 *
 * A finding may carry its OWN window in `finding.grace` (rows 32-35), resolved
 * per suite from `first_seen`. It softens the same states the global window
 * softens and nothing more — `unknown` only, never `fail` — so grace forgives
 * absence of evidence and never evidence of failure, exactly as bootstrap does.
 * Two windows, one rule; a suite is forgiven when EITHER is open, which is what
 * lets a repo arm three suites and still add a fourth.
 *
 * @param {ReadonlyArray<object>} findings - Per-suite findings
 * @param {{bootstrap: object, bypass: object|null}} options - Window and bypass decision
 * @returns {{verdict: string, blocked: boolean, findings: ReadonlyArray<object>, bootstrap: object, bypass: object|null}} The verdict
 */
export function decide(findings, { bootstrap, bypass = null }) {
  const rendered = findings.map(finding =>
    finding.state === SUITE_STATES.unknown &&
    (bootstrap.active || finding.grace?.active === true)
      ? { ...finding, state: "bootstrap" }
      : finding
  );
  const blocking = rendered.filter(
    finding =>
      finding.state === SUITE_STATES.fail ||
      finding.state === SUITE_STATES.unknown
  );

  if (blocking.length === 0) {
    const anyBootstrap = rendered.some(
      finding => finding.state === "bootstrap"
    );
    return Object.freeze({
      verdict: anyBootstrap ? "bootstrap" : "pass",
      blocked: false,
      findings: Object.freeze(rendered),
      bootstrap,
      // A stale label on a non-red PR waived nothing; say so by reporting no
      // bypass at all rather than an inert one.
      bypass: null,
    });
  }

  if (bypass?.valid) {
    return Object.freeze({
      verdict: "bypassed",
      blocked: false,
      findings: Object.freeze(rendered),
      bootstrap,
      bypass: Object.freeze({ ...bypass, waived: Object.freeze(blocking) }),
    });
  }

  return Object.freeze({
    verdict: "fail",
    blocked: true,
    findings: Object.freeze(rendered),
    bootstrap,
    bypass: bypass ?? null,
  });
}

// ---------------------------------------------------------------------------
// 6. Reporting
// ---------------------------------------------------------------------------

/** Marker per rendered state. */
const STATE_MARKERS = Object.freeze({
  pass: "✅",
  fail: "❌",
  unknown: "⚪",
  bootstrap: "⚠️",
});

/** One human sentence per truth-table reason. */
const REASON_TEXT = Object.freeze({
  workflow_not_found:
    "the workflow file this gate watches does not exist any more. Someone renamed or deleted the suite out from under the gate — fix the `suites` table or restore the workflow.",
  no_run: "no completed run on this branch at all.",
  stale_run: "no completed run inside the freshness window.",
  wrong_branch: "the run this gate scored is on a different branch.",
  stale_sha:
    "the run this gate scored is for a different commit than the one required.",
  indecisive_conclusion:
    "the run this gate scored reached no verdict about the code (cancelled / skipped / neutral). That is not a green — cancelling a run must never be a one-click way to clear a merge gate. The `↳` line beneath names the run that was scored and every run walked past for having tested nothing, so a displaced duplicate is no longer mistaken for last night's verdict.",
  job_not_found:
    "the run completed without ever producing the job this gate reads. The job was renamed, which silently disarms the gate.",
  pattern_matched_nothing:
    "the job pattern matched zero jobs in the run this gate scored. Zero matches is the signature of a renamed job.",
  [INCOMPLETE_EVIDENCE_REASON]:
    "the run reported `success`, but it did not run everything: at least one job was skipped, failed under `continue-on-error`, or could not be read. A run that skipped part of itself did not gather the evidence its green claims — a suite re-run for one platform only is not a verdict about the other one. Re-run the suite WITHOUT narrowing it.",
  [FILTERED_RUN_REASON]:
    'the run reported `success`, but it recorded itself as TAG-FILTERED — it ran a hand-picked slice of the suite, not the suite. A slice that passes says nothing about the flows it never started, so this is no result rather than a green. Re-run the suite with every tag / platform / shard picker left on its "all" default.',
  [ZERO_FLOWS_REASON]:
    "the run reported `success`, but an arm of it executed ZERO flows — it TESTED NOTHING. No flow reached its first assertion, so this run proved nothing about the app on that platform, whatever the run's conclusion says. This is not an ordinary flow failure and it needs no `min_flows` to be disbelieved. Open that arm's `maestro-<platform>-results` artifact for why the runner never started a flow.",
  [FLOW_SHORTFALL_REASON]:
    "the run reported `success`, but it executed FEWER FLOWS than this suite declares it must (`min_flows`). A narrowed run reaching green is how a four-flow dispatch clears a merge gate for an eighty-flow suite. Re-run the whole suite, or lower `min_flows` deliberately if the suite really did shrink.",
  [SCOPE_UNREADABLE_REASON]:
    'this suite declares `min_flows`, so its runs must publish an executed-flow count — and this one\'s could not be read. That is NOT a pass: an unreadable count is exactly what a narrowed run looks like from here, and rendering "we could not check" as "it is fine" is the defect this row exists to close. Check the suite still publishes `maestro-<platform>-flowcount-<N>` and that the caller grants `actions: read`.',
  run_conclusion: "",
  job_conclusion: "",
});

/**
 * Renders one finding as a single line.
 *
 * @param {object} finding - A rendered finding
 * @returns {string} One report line
 */
export function formatFinding(finding) {
  const marker = STATE_MARKERS[finding.state] ?? "•";
  const when = finding.createdAt
    ? ` (${finding.createdAt} via \`${finding.event ?? "?"}\`)`
    : "";
  const link = finding.url ? `: ${finding.url}` : "";
  const detail = REASON_TEXT[finding.reason] || "";
  if (finding.state === "pass") {
    // A green whose SCOPE went unchecked says so on its own line. The
    // alternative — printing it identically to a fully verified green — is the
    // precise reading error this gate was measured making: a filtered run and a
    // full one rendered the same, so the history read as "green recently".
    const unverified = finding.scopeUnverified
      ? typeof finding.observedFlows === "number"
        ? ` — ⚠️ scope unverified: this run executed ${finding.observedFlows} flow(s), and no \`min_flows\` is declared for this suite, so the gate cannot tell whether that is the whole suite or a slice of it. Compare it against a known-full night and declare \`min_flows\` to make this a blocking question`
        : " — ⚠️ scope unverified: this run published no executed-flow count, so how much of the suite ran is unknown. If this suite publishes `maestro-<platform>-flowcount-<N>`, declare `min_flows` to make that a blocking question; if it does not (a browser suite, say), this line is the honest limit of what the gate can see"
      : "";
    return `${marker} ${finding.label} — green${when}${link}${unverified}`;
  }
  // The measured numbers ride on the line, not just in the prose: "executed 7
  // flow(s) against a declared floor of 60" is actionable where "the run was
  // narrowed" sends the reader back to the run page to find out how much.
  const scopeDetail = finding.scopeDetail ? ` (${finding.scopeDetail})` : "";
  const verdictWord =
    finding.state === "bootstrap"
      ? "not yet blocking"
      : finding.state.toUpperCase();
  const conclusion = finding.conclusion ? ` [${finding.conclusion}]` : "";
  // The per-suite expiry rides on the LINE, not just in the trailing
  // paragraph: with one suite in grace and three armed, a reader has to be able
  // to tell which line is forgiven and until when. There is no quiet grace.
  const grace =
    finding.state === "bootstrap" && finding.grace?.active
      ? ` — new suite (first seen ${finding.grace.firstSeen}); its grace expires ${finding.grace.until} (in ${finding.grace.expiresInDays} day(s)), after which this line blocks`
      : "";
  return `${marker} ${finding.label} — ${verdictWord}${conclusion}${when} — ${detail}${scopeDetail}${link}${grace}`;
}

/**
 * Renders which run a finding was scored on, and every run walked past.
 *
 * Rows 41-42, and it prints on EVERY finding that has a selection — greens
 * included. The defect this closes was silent: a run that tested nothing
 * replaced the verdict of a run that tested everything, with no trace, and three
 * hours went into debugging a suite that was fine. A gate that quietly changes
 * which run it scores is the same defect one layer down, so the selection is not
 * conditional on anything having gone wrong.
 *
 * A scored run that reached NO verdict also names its cause, from the job
 * counts the walk already read. `cancelled` is overloaded across a displaced
 * duplicate, a job killed at its own `timeout-minutes` ceiling, and an operator
 * cancel; "0 of 1 job(s) reached a verdict" and "7 of 8" are different enough
 * that a reader can tell "it never started" from "it ran out of time" without
 * opening the run. That costs nothing — the counts come from jobs already
 * fetched, and no workflow job configuration is read to produce them.
 *
 * A DECISIVE conclusion gets no such suffix. `success` and `failure` already say
 * what happened, and appending job arithmetic to every green is noise.
 *
 * @param {object|null|undefined} selection - The finding's selection record
 * @returns {string|null} One trailing line, or null when there is nothing to say
 */
export function formatSelection(selection) {
  if (!selection) return null;
  const conclusion = selection.conclusion ?? null;
  const counted =
    !DECISIVE_CONCLUSIONS.has(conclusion) &&
    typeof selection.decisiveJobs === "number" &&
    typeof selection.totalJobs === "number";
  const cause = counted
    ? ` — ${selection.decisiveJobs} of ${selection.totalJobs} job(s) reached a verdict, so it ${selection.decisiveJobs === 0 ? "tested nothing" : "ran but did not finish"}`
    : "";
  const scored = `↳ scored run ${selection.runId ?? "?"} (${conclusion ?? "no conclusion"}${cause}, ${selection.createdAt ?? "unknown time"})`;
  const fallback = selection.fellBack
    ? " (no conclusive run in the freshness window — fell back to the newest)"
    : "";
  const skipped = (selection.skipped ?? [])
    .map(
      entry =>
        `${entry.runId ?? "?"} [${entry.conclusion ?? "no conclusion"} — ${entry.decisiveJobs} of ${entry.totalJobs} job(s) reached a verdict, so it tested nothing]`
    )
    .join(", ");
  return `${scored}${fallback}${skipped ? `; skipped ${skipped}` : ""}`;
}

/**
 * Renders the full report.
 *
 * @param {object} verdict - Output of `decide`
 * @param {{branch: string, bypassLabel: string}} context - Report context
 * @returns {string} Markdown report
 */
export function formatReport(verdict, context) {
  const lines = ["## 🌙 Nightly E2E Health", ""];
  lines.push(
    ...verdict.findings.flatMap(finding => {
      const line = `- ${formatFinding(finding)}`;
      const selection = formatSelection(finding.selection);
      return selection === null ? [line] : [line, `  - ${selection}`];
    })
  );
  lines.push("");

  // A limit the caller asked for and did not get must be visible, or the gate
  // is quietly stricter than its configuration says and the next person debugs
  // the wrong thing.
  for (const note of verdict.clamped ?? []) {
    lines.push(`🔒 **Policy ceiling applied** — ${note}`, "");
  }

  if (verdict.bootstrap.active) {
    lines.push(
      `⏳ **Bootstrap window active — expires ${verdict.bootstrap.until} (${verdict.bootstrap.expiresInDays} day(s) from now).** Missing evidence is reported but not blocking until then. Evidence of FAILURE still blocks, inside the window as well as outside it. When the window lapses, every ⚠️ above becomes a ❌ with no further action.`,
      ""
    );
  }

  // Per-suite grace gets its own paragraph for the same reason bootstrap does:
  // a forgiveness nobody can see is a gate quietly measuring less than it reads
  // as measuring. Naming the suites keeps "which one is new?" off the reader.
  const inGrace = verdict.findings.filter(
    finding => finding.state === "bootstrap" && finding.grace?.active
  );
  if (inGrace.length > 0) {
    lines.push(
      `🌱 **New-suite grace active for ${inGrace.map(finding => `\`${finding.label}\``).join(", ")}.** A suite gets a bounded window from its \`first_seen\` anchor to produce its first verdict, so adding a suite cannot block every pull request until tomorrow's nightly. Every OTHER suite stays armed, evidence of FAILURE still blocks inside the window, and when the window lapses the line above blocks with no further action.`,
      ""
    );
  }

  if (verdict.verdict === "bypassed") {
    lines.push(
      `⚠️ **Gate bypassed — audited.** Applied by \`${verdict.bypass.actor}\` at ${verdict.bypass.appliedAt}, expires ${verdict.bypass.expiresAt}. Ticket: \`${verdict.bypass.ticket}\`. Reason: ${verdict.bypass.detail}`,
      "",
      "Waived:",
      ...verdict.bypass.waived.map(
        finding =>
          `  - ${finding.label} — ${finding.conclusion ?? finding.reason}${finding.url ? `: ${finding.url}` : ""}`
      ),
      "",
      `The nightly is still red. This waives the gate for THIS pull request only; the tracking issue — filed and maintained by the \`nightly-e2e-report\` workflow, one per suite — stays open until a green run lands.`
    );
  } else if (verdict.blocked) {
    if (verdict.bypass && !verdict.bypass.valid) {
      // `pr_state_unreadable` gets its own lead because the usual one asserts
      // something this branch cannot know. When the live read failed, whether a
      // label is present is precisely the unanswered question — saying "a label
      // is present but was REJECTED" would send the reader to remove a label
      // that may not exist.
      const lead =
        verdict.bypass.reason === "pr_state_unreadable"
          ? "⛔ **The bypass could not be evaluated**"
          : `⛔ **A \`${context.bypassLabel}\` label is present but was REJECTED**`;
      lines.push(
        `${lead} — ${BYPASS_REJECTIONS[verdict.bypass.reason] ?? verdict.bypass.reason}`,
        ""
      );
    }
    lines.push(
      `Merges into \`${context.branch}\` are blocked until the nightly e2e suites are green again. To unblock:`,
      "  1. Fix the failure (open the run above — it names the failing spec or flow).",
      `  2. Re-run the suite from the Actions tab against \`${context.branch}\`, running the WHOLE suite. A \`workflow_dispatch\` run counts exactly like a scheduled one, so a green dispatch clears this gate immediately — no waiting for tomorrow. What does not count is a NARROWED re-run: leave any platform / tag / shard picker on its "all" default, because a run that skipped an arm says nothing about that arm.`,
      "  3. Re-run this check on your PR.",
      "",
      `If the failure is in the harness rather than the app — or this IS the PR that fixes the red nightly — waive the gate yourself: add a \`Nightly-E2E-Bypass: <TICKET> <reason>\` line to the PR body, then apply the \`${context.bypassLabel}\` label. You may apply it to your own PR; anyone with \`admin\` or \`maintain\` here can. The waiver auto-expires a bounded number of hours after the label goes on (\`bypass_max_hours\`, 24 by default, hard-capped at 72), so it cannot become a permanent hole. Prefer this route: it is the only way past this gate that records who waived it, under which ticket, and when the waiver expires. An admin merge may also be available — that is a property of this repository's own ruleset rather than of this gate, so read its bypass actors rather than assuming either way — but it leaves no such record.`
    );
  } else {
    lines.push(
      "Last night's e2e verdict is not red. Nothing here blocks this pull request."
    );
  }
  return `${lines.join("\n")}\n`;
}

// ---------------------------------------------------------------------------
// 6.1 The tracking issue — §10 of the contract
// ---------------------------------------------------------------------------
//
// The gate blocks merges, which tells whoever opened a pull request. It tells
// NOBODY ELSE. A red nightly with no open pull requests is invisible, there is
// nothing to assign, and there is no record that the suite came back. This half
// closes that: exactly ONE open tracking issue per suite, refreshed on each red
// night and closed when a full green run lands.
//
// One per SUITE, never one per red night. A reporter that files every morning
// produces a backlog nobody triages and makes the suite's actual state illegible
// from the issue list. The issue is a STATE MIRROR of one suite.
//
// Filing is REPORTING, not verdict, and the two are kept apart structurally:
// this code runs only from `runReport` (the scheduled reporting workflow), never
// from `runGate` (the required status check). The gate's reusable workflow does
// not even request `issues:` scope, so an issues API that is down, throttled or
// forbidden cannot turn a green nightly into a red pull request.

/**
 * Whether a finding rests on evidence the suite actually gathered.
 *
 * Row 26 already refuses to call a partial run a pass, so for the GATE this is
 * implied. The reporter asks it separately and on purpose: closing a tracking
 * issue is a stronger claim than letting a pull request through — it announces
 * that a suite is healthy — and it is the one action that must never fire on a
 * run that skipped part of itself. acmeorga's trap, in their words: *one spec
 * reporting success would close the tracking issue while the failures that
 * opened it went unrun.* Asking the question here means a future loosening of
 * row 26 cannot silently re-open that hole.
 *
 * ## `gated: false` does NOT relax any of this (§10.7, owner ruling)
 *
 * Every exclusion below applies in full to a suite declared `"gated": false`.
 * The two ideas are orthogonal: **evidence quality** is what we know about a
 * suite's state; **blocking authority** is what follows from knowing it.
 * `gated: false` changes only the second — what the issue SAYS about merges —
 * and nothing about what counts as knowing.
 *
 * Stated explicitly because the next reader will assume the opposite: "not a
 * gate" reads as "lower stakes", so relaxing the bar here looks harmless. It is
 * backwards. A gating suite that closes on evidence it never gathered gets
 * caught the next morning, when somebody's pull request sails through on a
 * green that was not earned. **An ungated suite's wrong verdict is the one
 * nobody is watching** — there is no merge queue downstream to trip over it, so
 * a false all-clear there can stand indefinitely.
 *
 * @param {{reason: string}} finding - A finding from `assessSuite`
 * @returns {boolean} True when the run was complete
 */
export function isCompleteEvidence(finding) {
  // Rows 36-38 join row 26 here for the reason the doc comment gives: with the
  // gate as written none of them can produce a `pass`, so asking again looks
  // redundant — and that is exactly why it is asked. The reporter's close action
  // must not depend on the gate staying strict.
  //
  // `scopeUnverified` is deliberately NOT here. It is true of every suite that
  // has not adopted `min_flows` yet, which is all of them on the day this ships;
  // refusing to close on it would make the tracking issues immortal across four
  // repositories to express a doubt the gate itself does not act on. The two
  // halves tighten together instead: declare `min_flows` and an unreadable count
  // becomes `scope_unreadable`, which IS in this list.
  return (
    finding.reason !== INCOMPLETE_EVIDENCE_REASON &&
    finding.reason !== FILTERED_RUN_REASON &&
    finding.reason !== FLOW_SHORTFALL_REASON &&
    finding.reason !== SCOPE_UNREADABLE_REASON &&
    finding.reason !== ZERO_FLOWS_REASON
  );
}

/**
 * Percent-encodes a string down to `[A-Za-z0-9_.~%]`, comment-safe.
 *
 * `encodeURIComponent` alone leaves `-`, `!`, `'`, `(`, `)` and `*` untouched.
 * Only `>` can actually terminate an HTML comment and that one it does escape,
 * so this is belt and braces — but a marker is an identity, and an identity that
 * needs a paragraph explaining why it *happens* to be safe is one refactor away
 * from not being.
 *
 * @param {string} value - Arbitrary text
 * @returns {string} An inert encoding of it
 */
function inertEncode(value) {
  return encodeURIComponent(value).replace(
    /[-!'()*]/g,
    character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

/**
 * The HTML-comment marker that ties one issue to one suite.
 *
 * Identity has to survive an edited title, a renamed label and a human's
 * rewording, so it lives in the body as a comment rather than in anything a
 * person is likely to touch. The suite label is encoded, which is not
 * decoration: a suite called `evil --> <!--` would otherwise terminate the
 * comment early and make its marker match every other suite's issue — which on
 * a green night would close them all.
 *
 * @param {string} label - The suite label
 * @returns {string} A marker unique to that suite
 */
export function suiteMarker(label) {
  return `<!-- lisa_nightly_e2e_suite:${inertEncode(label)} -->`;
}

/**
 * A compact fingerprint of *why* a suite is red, embedded in the issue body.
 *
 * It is what lets a refresh tell "still the same failure" from "a different
 * failure now", so the reporter can rewrite the body every night (free) while
 * commenting (a notification) only when something actually changed.
 *
 * @param {object} finding - A finding
 * @returns {string} An opaque, comment-safe stamp
 */
function evidenceMarker(finding) {
  return `<!-- lisa_nightly_e2e_evidence:${inertEncode(
    [finding.reason, finding.conclusion ?? "", finding.url ?? ""].join("|")
  )} -->`;
}

/**
 * Whether one required-status-check context names THIS gate.
 *
 * Matching is a small family rather than string equality, because the same gate
 * publishes two different context strings depending on how it is wired. GitHub
 * composes a reusable workflow's check as `<caller job> / <called job>`, so a
 * repo calling Lisa's reusable is required under
 * `🌙 Nightly E2E Health / 🌙 Gate` while a repo still running a local
 * single-job reimplementation is required under the bare
 * `🌙 Nightly E2E Health`. Both ARE the gate. Demanding equality would report
 * `not_required` for the second — a false all-clear about a branch that really
 * is blocked, which is the same defect as the false "blocked" this whole
 * section exists to delete, pointed the other way.
 *
 * So a context matches when it is the configured one, or when one is the other
 * plus a ` / `-separated job suffix. Nothing looser: a bare substring test would
 * match `🌙 Nightly E2E Health (advisory)` and any other check somebody names
 * nearby.
 *
 * @param {string} context - A required status-check context
 * @param {string} gateContext - The configured gate context
 * @returns {boolean} True when the context denotes this gate
 */
export function contextMatchesGate(context, gateContext) {
  if (typeof context !== "string" || typeof gateContext !== "string")
    return false;
  if (context === gateContext) return true;
  return (
    context.startsWith(`${gateContext} / `) ||
    gateContext.startsWith(`${context} / `)
  );
}

/**
 * Resolves what THIS suite's issue may claim about blocking merges.
 *
 * Two independent facts combine, and the combination can only ever be WEAKER
 * than the branch-level measurement:
 *
 *   1. `requiredness` — measured from the branch ruleset, for the gate as a
 *      whole. It is per-BRANCH: one context guards every suite in the table.
 *   2. `gated: false` — declared per-SUITE by the caller, for a suite that is
 *      deliberately tracked without gating.
 *
 * A caller may therefore silence a blocking claim for one suite, and may never
 * manufacture one: `gated: true` on a branch where the gate is not required
 * still renders `not_required`. That asymmetry is the same one §6.2 applies to
 * the bypass pattern — an override narrows, it never loosens — and here it is
 * what stops a suite table from asserting a merge consequence that the branch's
 * rules do not actually impose.
 *
 * @param {object} finding - A finding, possibly carrying `gated`
 * @param {{state: string, detail?: string|null}} requiredness - Branch measurement
 * @returns {{state: string, detail: string|null, source: string}} The effective claim
 */
export function suiteRequiredness(finding, requiredness) {
  if (finding?.gated === false) {
    return Object.freeze({
      state: REQUIREDNESS.notRequired,
      detail:
        'this suite is declared `"gated": false` in the gate\'s suite table — it is tracked, not enforced',
      source: "suite_opt_out",
    });
  }
  return Object.freeze({
    state: requiredness?.state ?? REQUIREDNESS.unknown,
    detail: requiredness?.detail ?? null,
    source: "branch_rules",
  });
}

/** The title suffix each requiredness state earns. */
const REQUIREDNESS_TITLE = Object.freeze({
  [REQUIREDNESS.required]: " (blocking merges)",
  [REQUIREDNESS.notRequired]: " (not blocking merges)",
  [REQUIREDNESS.unknown]: " (merge impact unknown)",
});

/**
 * The issue title for one suite.
 *
 * The requiredness state rides in the TITLE, not only in the body, because the
 * issue list is the surface an operator triages from and "is anything waiting on
 * this?" is the question they are triaging by. Retitling an existing issue is
 * safe: identity is the body marker (§10.1), never the title.
 *
 * @param {object} finding - A finding
 * @param {{requiredness: {state: string}}} context - Reporting context
 * @returns {string} A title
 */
function issueTitle(finding, context) {
  const claim = suiteRequiredness(finding, context.requiredness);
  return `🌙 Nightly e2e is not green${REQUIREDNESS_TITLE[claim.state] ?? ""}: ${finding.label}`;
}

/**
 * The "what this means" paragraph, which used to be a hardcoded falsehood.
 *
 * @param {{state: string, detail: string|null, source: string}} claim - Effective claim
 * @param {string} branch - The branch under gate
 * @returns {string} One markdown paragraph
 */
function meaningParagraph(claim, branch) {
  if (claim.state === REQUIREDNESS.required) {
    return `**What this means.** Pull requests into \`${branch}\` are blocked until this suite is green again — measured just now from \`${branch}\`'s branch rules, not assumed. That is deliberate: merging on top of a red suite is how a nightly ends up measuring days of accumulated damage instead of the change that broke it.`;
  }
  if (claim.state === REQUIREDNESS.notRequired) {
    const why =
      claim.source === "suite_opt_out"
        ? claim.detail
        : `no required status check on \`${branch}\` matches this gate`;
    return `**What this means.** This suite does **not** gate merges — ${why}. Pull requests into \`${branch}\` are going in on top of it. Fixing it is still the point: a nightly nobody fixes stops being evidence of anything, and it is the only signal you have that \`${branch}\` still works end to end. But nothing is waiting on you to merge, so do not treat this as an outage.`;
  }
  return `**What this means.** ⚠️ **Not known.** \`${branch}\`'s branch rules could not be read${claim.detail ? ` (${claim.detail})` : ""}, so this issue makes no claim either way about whether pull requests are blocked. Check the branch's ruleset before acting on either assumption — "we could not check" is not the same as "nothing is blocked".`;
}

/**
 * The bypass paragraph, which is conditional on the paragraph above it.
 *
 * A bypass recipe printed unconditionally is how people end up applying an
 * audited waiver label to a check that was never required — burning the audit
 * trail the label exists to create, to buy a merge that was never blocked. That
 * happened in a measured adopter repository.
 *
 * @param {{state: string}} claim - Effective claim
 * @param {{branch: string, bypassLabel: string}} context - Reporting context
 * @returns {ReadonlyArray<string>} Markdown lines
 */
function bypassParagraph(claim, context) {
  const label = context.bypassLabel;
  if (claim.state === REQUIREDNESS.notRequired) {
    return [
      `**Do you need a waiver? No.** This check is not required on \`${context.branch}\`, so applying the \`${label}\` label would waive nothing — it is an audited escape hatch for a gate that is actually holding a merge, and there is no merge being held. Do not spend one here.`,
      "",
    ];
  }
  const defect = bypassLabelLines(context);
  const recipe = [
    `1. Apply the \`${label}\` label to the pull request.`,
    "2. Put a line in the **pull request body** naming a ticket and a reason:",
    "",
    "   ```",
    "   Nightly-E2E-Bypass: ABC-123 hotfix for the outage; this suite is red for an unrelated harness bug",
    "   ```",
    "",
    `3. The waiver is time-boxed and only an \`admin\` or \`maintain\` collaborator can grant one. It is recorded on the run, and the label is removed when the PR closes. This tracking issue stays open either way — a bypass waives ONE pull request, it does not make the nightly green.`,
  ];
  if (claim.state === REQUIREDNESS.required) {
    return [
      "**If you must merge before this is fixed.**",
      "",
      ...defect,
      ...recipe,
      "",
    ];
  }
  return [
    `**If you must merge before this is fixed.** ⚠️ Confirm first whether the gate is actually required on \`${context.branch}\` — that could not be read tonight. If it is not, the \`${label}\` label waives nothing and should not be applied. If it is:`,
    "",
    ...defect,
    ...recipe,
    "",
  ];
}

/**
 * The §10.9 defect block: the escape hatch this gate documents does not exist.
 *
 * Rendered ABOVE the waiver recipe rather than instead of it, deliberately. The
 * recipe is not wrong, it is unreachable — and it becomes reachable the moment
 * somebody runs the one command printed here. Deleting it would leave a reader
 * who fixed the label with no instructions for the thing they just enabled.
 *
 * Empty when the label is `present`, so a repository that installed the whole
 * contract reads EXACTLY what it read before this shipped — byte for byte.
 * That is the control: a defect renderer that also perturbs the healthy case
 * cannot be told apart from a renderer that fires indiscriminately.
 *
 * @param {{bypassLabel: string, bypassLabelState?: {state: string, detail: string|null},
 *   requiredness?: {rulesets?: ReadonlyArray<object>}}} context - Reporting context
 * @returns {ReadonlyArray<string>} Markdown lines, possibly none
 */
function bypassLabelLines(context) {
  const label = context.bypassLabel;
  const measured = context.bypassLabelState;
  const state = measured?.state ?? BYPASS_LABEL_STATE.notMeasured;
  if (state === BYPASS_LABEL_STATE.absent) {
    return [
      "> [!CAUTION]",
      `> **This gate is armed with no escape hatch.** The \`${label}\` label does not exist in this repository, so the audited waiver below **cannot be applied**. The gate is required by ${describeRulesets(context.requiredness?.rulesets)}, which means a red suite holds every pull request into \`${context.branch}\` and the only remaining route past it is an unaudited admin merge — the one route that records nothing about who waived what. Anyone with \`admin\` or \`maintain\` can fix it with one command:`,
      ">",
      "> ```",
      `> gh label create ${label} --description "Audited waiver for the nightly e2e merge gate — docs/nightly-e2e-gate.md section 6" --color B60205`,
      "> ```",
      ">",
      "> This report does not create the label itself. Conjuring a bypass surface into a repository whose owners never chose to have one is a different defect, not a fix for this one — so the mismatch is named and the decision is left where it belongs.",
      "",
    ];
  }
  // `not_measured` and `present` both render NOTHING, and they are kept apart
  // anyway: `not_measured` is "nobody asked", `unknown` is "we asked and the
  // API would not say". Collapsing the first into the second would print a
  // hedge in every issue filed by a caller that predates this measurement, and
  // collapsing the second into the first would silently swallow the case the
  // hedge exists for.
  if (state === BYPASS_LABEL_STATE.unknown) {
    return [
      "> [!WARNING]",
      `> Whether the \`${label}\` label exists in this repository could not be read${measured?.detail ? ` (${measured.detail})` : ""}. Confirm it exists before relying on the route below — "we could not check" is not "it is there", and following a recipe for a label that is not there ends at the unaudited admin merge.`,
      "",
    ];
  }
  return [];
}

/**
 * The issue body — written for whoever is standing at the gate.
 *
 * Lisa's factories are meant to be operable by people who do not read code
 * (AGENTS.md), and a tracking issue is one of the artefacts that crosses the
 * gate outward. So it opens with what broke and what to do, and keeps the
 * machine detail below a fold.
 *
 * @param {object} finding - A finding
 * @param {{branch: string, now: Date, requiredness: object, bypassLabel: string,
 *   gateContext: string}} context - Reporting context
 * @returns {string} Markdown
 */
function issueBody(finding, context) {
  const detail = REASON_TEXT[finding.reason] || "";
  const runLine = finding.url
    ? `[the run that reported it](${finding.url})`
    : "the Actions tab";
  const claim = suiteRequiredness(finding, context.requiredness);
  const blockingCell = {
    [REQUIREDNESS.required]: `yes — \`${context.gateContext}\` is a required status check on \`${context.branch}\``,
    [REQUIREDNESS.notRequired]:
      claim.source === "suite_opt_out"
        ? 'no — declared `"gated": false` for this suite'
        : `no — no required status check on \`${context.branch}\` matches \`${context.gateContext}\``,
    [REQUIREDNESS.unknown]: `unknown — the branch rules could not be read${claim.detail ? ` (${claim.detail})` : ""}`,
  }[claim.state];
  return [
    suiteMarker(finding.label),
    evidenceMarker(finding),
    "",
    `## The \`${finding.label}\` end-to-end suite is not passing on \`${context.branch}\``,
    "",
    meaningParagraph(claim, context.branch),
    "",
    "**What to do, in order.**",
    "",
    `1. Open ${runLine} and read what failed.`,
    "2. Fix it, or — if the failure is in the test harness rather than the product — say so in a comment here so the next person does not re-diagnose it.",
    `3. Re-run the **whole** suite against \`${context.branch}\`. Leave any platform / tag / shard picker on its \`all\` default: a run that skipped an arm says nothing about that arm, and will not clear the gate.`,
    "",
    ...bypassParagraph(claim, context),
    "**You do not need to close this issue.** It closes itself the moment a full green run lands, and it is refreshed automatically every night it is still red. Closing it by hand while the suite is red just means tonight re-opens the question.",
    "",
    "<details><summary>Details</summary>",
    "",
    "| | |",
    "|---|---|",
    `| Suite | ${finding.label} |`,
    `| Workflow | \`${finding.workflow ?? "—"}\` |`,
    `| Branch | \`${context.branch}\` |`,
    `| Blocks merges | ${blockingCell} |`,
    // "Scored", not "Newest": since the selection walk landed, the run this
    // row describes is the newest CONCLUSIVE one, which may be older than the
    // newest candidate. Labelling it "Newest" would reintroduce the exact
    // confusion the walk exists to remove.
    `| Scored run | ${finding.conclusion ?? "—"}${finding.createdAt ? ` at ${finding.createdAt}` : ""}${finding.event ? ` via \`${finding.event}\`` : ""} |`,
    `| Why it is not green | ${detail || finding.reason} |`,
    `| Last checked | ${context.now.toISOString()} |`,
    "",
    "</details>",
    "",
    "<sub>Filed and maintained by Lisa's nightly e2e reporter. The contract is `docs/nightly-e2e-gate.md` §10.</sub>",
  ].join("\n");
}

/**
 * Decides what to do about every suite's tracking issue. PURE.
 *
 * Every HTTP call lives in `applyIssuePlan`, so the whole decision — including
 * the one that must never misfire, closing — is testable without a network.
 *
 * @param {ReadonlyArray<object>} findings - Findings from `assessSuite`, RAW
 *   (never run through `decide`, whose bootstrap rendering would hide a suite's
 *   real state from the reporter)
 * @param {ReadonlyArray<object>} openIssues - Open issues carrying the label
 * @param {{branch: string, label: string, now: Date, requiredness?: object,
 *   bypassLabel?: string, gateContext?: string, pinIssues?: boolean}} context -
 *   Reporting context
 * @returns {ReadonlyArray<object>} One plan entry per suite
 */
export function planIssueActions(findings, openIssues, context) {
  // Every renderer below reads these, and a caller that predates them must not
  // crash the reporter — the reporting half is the half that must never take
  // the gate down with it. An absent measurement is `unknown`, which is the
  // same answer a failed one gets: honest, and never a claim in either
  // direction.
  const resolved = {
    ...context,
    requiredness: context.requiredness ?? { state: REQUIREDNESS.unknown },
    bypassLabel: context.bypassLabel ?? DEFAULT_BYPASS_LABEL,
    gateContext: context.gateContext ?? DEFAULT_GATE_CONTEXT,
    // `not_measured`, never `unknown`: a caller that predates §10.9 did not ask
    // about the label, and printing "we could not read it" for a question
    // nobody put is a false report about this repository.
    bypassLabelState: context.bypassLabelState ?? {
      state: BYPASS_LABEL_STATE.notMeasured,
      detail: null,
    },
  };
  return Object.freeze(
    findings.map(finding => {
      const marker = suiteMarker(finding.label);
      const matches = openIssues
        // `GET /repos/{owner}/{repo}/issues` returns PULL REQUESTS as well as
        // issues. Mistaking one for the tracking issue would comment on
        // somebody's pull request and then CLOSE it the night the suite went
        // green.
        .filter(issue => !issue.pull_request)
        .filter(issue => (issue.body ?? "").includes(marker))
        .slice()
        .sort((left, right) => left.number - right.number);
      const numbers = Object.freeze(matches.map(issue => issue.number));
      const nodeIds = Object.freeze(
        matches.map(issue => issue.node_id ?? null).filter(Boolean)
      );
      const claim = suiteRequiredness(finding, resolved.requiredness);
      const base = {
        label: finding.label,
        state: finding.state,
        issues: numbers,
        // Carried alongside the numbers because pinning is a GraphQL mutation
        // and GraphQL addresses an issue by node id, never by number.
        nodeIds,
        requiredness: claim.state,
        title: null,
        body: null,
        comment: null,
        // `null` is "do not touch the pin", which is what every entry gets when
        // pinning is off. Distinct from `false`, which actively UNPINS.
        pin: null,
      };
      const quiet = reason => ({
        ...base,
        action: ISSUE_ACTIONS.none,
        reason,
      });

      // Evidence the suite never gathered decides NOTHING. It does not close an
      // issue (that would be an all-clear the run cannot support) and it does
      // not open one (absence of evidence is not evidence of failure). The
      // existing issue simply stays as it was.
      if (!isCompleteEvidence(finding)) return quiet("evidence_incomplete");

      if (finding.state === SUITE_STATES.fail) {
        if (matches.length === 0) {
          return {
            ...base,
            action: ISSUE_ACTIONS.create,
            reason: "red_filed",
            title: issueTitle(finding, resolved),
            body: issueBody(finding, resolved),
            pin: resolved.pinIssues === true ? true : null,
          };
        }
        // The oldest open match is the canonical one. A second match means a
        // duplicate got filed anyway (a hand-filed issue, or a race that beat
        // the concurrency group); refreshing the oldest keeps the history in one
        // place, and the green night closes every duplicate at once.
        const unchanged = (matches[0].body ?? "").includes(
          evidenceMarker(finding)
        );
        return {
          ...base,
          issues: Object.freeze([matches[0].number]),
          nodeIds: Object.freeze(
            matches[0].node_id ? [matches[0].node_id] : []
          ),
          action: ISSUE_ACTIONS.refresh,
          reason: "red_refreshed",
          pin: resolved.pinIssues === true ? true : null,
          title: issueTitle(finding, resolved),
          body: issueBody(finding, resolved),
          // A comment is a notification. One every night for the same failure
          // trains people to mute the issue that is supposed to be alerting
          // them, so only a CHANGE in the evidence earns one.
          comment: unchanged
            ? null
            : `🔴 Still not green, and the evidence changed.\n\n${formatFinding(finding)}`,
        };
      }

      if (finding.state === SUITE_STATES.pass) {
        if (matches.length === 0) return quiet("green_untracked");
        // The close comment carries the requiredness claim too. It is the LAST
        // thing anyone reads on this issue and it is what gets quoted in a
        // standup — an all-clear that says "merges are unblocked" about a gate
        // that never blocked anything is the same falsehood as the one at the
        // top of the body, just harder to catch because everyone is relieved.
        const relief = {
          [REQUIREDNESS.required]: ` Merges into \`${resolved.branch}\` are no longer held by this suite.`,
          [REQUIREDNESS.notRequired]:
            claim.source === "suite_opt_out"
              ? " (This suite is tracked but does not gate merges, so nothing was blocked.)"
              : ` (This suite is not a required check on \`${resolved.branch}\`, so nothing was blocked while it was red.)`,
          [REQUIREDNESS.unknown]: ` (Whether this suite gates merges on \`${resolved.branch}\` could not be read, so this all-clear says nothing about merges.)`,
        }[claim.state];
        return {
          ...base,
          action: ISSUE_ACTIONS.close,
          reason: "green_complete",
          // Unpinning on green is not cosmetic. A pinned issue is the repo's
          // "look at this" slot, and one that stays pinned after the suite
          // recovers is how a pin board stops meaning anything.
          pin: resolved.pinIssues === true ? false : null,
          comment: `✅ Closing automatically: a complete green run landed for **${finding.label}** on \`${resolved.branch}\`.${relief ?? ""}${finding.url ? `\n\n${finding.url}` : ""}`,
        };
      }

      return quiet("evidence_missing");
    })
  );
}

/**
 * The §10.9 line in the nightly job summary — the surface that runs whether or
 * not anybody needs the escape hatch yet.
 *
 * This is the whole point of putting the measurement on the REPORTING half. The
 * gate half only speaks when somebody is already blocked, which is the moment
 * it is too late to discover that the documented way out was never installed.
 * This job runs every night, green or red, and writes here every time.
 *
 * Silent on `present` and on `not_measured`, so a healthy repository's summary
 * is byte-identical to the one it produced before this shipped.
 *
 * @param {{branch: string, bypassLabel?: string, requiredness?: object,
 *   bypassLabelState?: {state: string, detail: string|null}}} context - Reporting context
 * @returns {ReadonlyArray<string>} Markdown lines, possibly none
 */
function bypassLabelSummary(context) {
  const label = context.bypassLabel ?? DEFAULT_BYPASS_LABEL;
  const measured = context.bypassLabelState;
  const state = measured?.state ?? BYPASS_LABEL_STATE.notMeasured;
  if (state === BYPASS_LABEL_STATE.absent) {
    return [
      `⛔ **Defect — this gate is armed with no escape hatch.** \`${label}\` does not exist in this repository, while the gate is required by ${describeRulesets(context.requiredness?.rulesets)}. The audited waiver §6 documents cannot be applied, so the only route past a red suite is an unaudited admin merge. Create the label once: \`gh label create ${label}\`.`,
      "",
    ];
  }
  if (state === BYPASS_LABEL_STATE.unknown) {
    return [
      `⚠️ Whether the \`${label}\` waiver label exists could not be read${measured?.detail ? ` (${measured.detail})` : ""}. Unreadable is not confirmation that it is there.`,
      "",
    ];
  }
  return [];
}

/**
 * Renders the VERDICT — which suites are green and which are not.
 *
 * Written to the job summary before any publishing is attempted (§10.4), which
 * is the whole reason it is a separate renderer from `formatIssueReport`: this
 * one describes the suites and needs nothing from the Issues API, so it survives
 * an Issues API that is switched off, throttled or forbidden.
 *
 * @param {ReadonlyArray<object>} findings - Output of `assessSuite`, per suite
 * @param {{branch: string}} context - Reporting context
 * @returns {string} Markdown
 */
export function formatVerdictReport(findings, context) {
  const red = findings.filter(finding => finding.state === SUITE_STATES.fail);
  const lines = [
    red.length > 0
      ? `## 🔴 Nightly E2E verdict — ${red.length} suite(s) not green`
      : "## 🌙 Nightly E2E verdict",
    "",
    `Branch: \`${context.branch}\``,
    "",
    ...findings.map(finding => `- ${formatFinding(finding)}`),
    "",
    // Said here, on the surface the verdict lands on, rather than only in the
    // contract: the next reader of a run whose publish warned needs to know
    // that they are already looking at the report.
    "**This section is the report.** Publishing it to a GitHub tracking issue is a best-effort side-effect recorded below; a publish that fails leaves this verdict untouched and does not change this job's result.",
    "",
  ];
  return `${lines.join("\n")}\n`;
}

/**
 * The publishing half of the job summary — what happened to the issues.
 *
 * @param {ReadonlyArray<object>} results - Output of `applyIssuePlan`
 * @param {object} context - `{branch, requiredness, gateContext, bypassLabel, bypassLabelState, publishFailure}`
 * @returns {string} Markdown
 */
export function formatIssueReport(results, context) {
  const say = {
    create: "filed a tracking issue",
    refresh: "refreshed the open tracking issue",
    close: "closed the tracking issue — the suite is green again",
    none: "left the tracking state alone",
  };
  const state = context.requiredness?.state ?? REQUIREDNESS.unknown;
  const gateContext = context.gateContext ?? DEFAULT_GATE_CONTEXT;
  // Printed in the job log as well as the issues, so the measurement is
  // auditable from the run that made it rather than only from its output.
  const requirednessLine = {
    [REQUIREDNESS.required]: `🔒 The gate **is required** on \`${context.branch}\` (\`${gateContext}\`) — a red suite blocks merges.`,
    [REQUIREDNESS.notRequired]: `🔓 The gate is **not required** on \`${context.branch}\` — no required status check matches \`${gateContext}\`, so a red suite blocks nothing. The issues say so rather than claiming otherwise.`,
    [REQUIREDNESS.unknown]: `⚪ Whether the gate is required on \`${context.branch}\` could not be read${context.requiredness?.detail ? ` (${context.requiredness.detail})` : ""}. The issues claim neither.`,
  }[state];
  const lines = [
    "## 🌙 Nightly E2E tracking issues",
    "",
    `Branch: \`${context.branch}\``,
    "",
    requirednessLine,
    "",
    ...bypassLabelSummary(context),
  ];
  // The publish died outright rather than per-suite. Said on the summary as
  // well as in the annotation, because the annotation scrolls off a busy run
  // page and this section is where a reader goes looking for it.
  if (context.publishFailure) {
    lines.push(
      `- ⚠️ **Nothing was published** — ${context.publishFailure}`,
      "",
      "The verdict above is unaffected: it was written before publishing was attempted, and this job's result reflects the SUITE, not the publish.",
      ""
    );
  }
  for (const result of results) {
    const where = result.issues.length
      ? ` (#${result.issues.join(", #")})`
      : "";
    lines.push(
      result.ok
        ? `- ✅ **${result.label}** — ${say[result.action] ?? result.action}${where} [${result.reason}]`
        : `- ⚠️ **${result.label}** — could not ${result.action} its tracking issue${where}: ${result.error}`
    );
    // Visible, but never folded into the line's ✅/⚠️ marker: a pin that did
    // not land is not a tracking issue that did not land, and the report must
    // not teach a reader to treat them as the same thing.
    for (const warning of result.warnings ?? []) {
      lines.push(`  - 📌 ${warning}`);
    }
  }
  lines.push(
    "",
    "This job REPORTS; it does not gate. Nothing here can block a pull request — the merge gate is a separate workflow that never writes. This job's own result answers whether the SUITE is green, never whether publishing worked: a tracking issue that could not be written is a ⚠️ above, not a failure.",
    ""
  );
  return `${lines.join("\n")}\n`;
}

// ---------------------------------------------------------------------------
// 7. The Actions API
// ---------------------------------------------------------------------------

/**
 * Sleeps.
 *
 * @param {number} ms - Milliseconds
 * @returns {Promise<void>} Resolves after the delay
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** GitHub's remaining-quota response header, read from three call sites. */
const RATELIMIT_REMAINING_HEADER = "x-ratelimit-remaining";

/**
 * The `accept` value that selects GitHub's versioned REST media type.
 *
 * Named because it is a wire contract shared by every request this file makes:
 * send a different one and the API answers with a different response shape,
 * which every parser below would then misread rather than reject.
 */
const GITHUB_ACCEPT = "application/vnd.github+json";

/**
 * The `user-agent` GitHub sees. GitHub requires one, and this value is how a
 * request from this check is told apart from any other Lisa traffic in an
 * audit log — so it is one string, not three that can drift apart.
 */
const HEALTH_USER_AGENT = "lisa-nightly-e2e-health";

/**
 * How long to wait before retrying a throttled response, bounded.
 *
 * @param {Response} response - The throttled response
 * @param {number} attempt - 1-based attempt number
 * @param {number} maxSeconds - Ceiling on the wait
 * @returns {number} Milliseconds to wait
 */
export function retryDelayMs(response, attempt, maxSeconds) {
  const retryAfter = Number(response.headers?.get?.("retry-after"));
  if (Number.isFinite(retryAfter) && retryAfter > 0) {
    return Math.min(retryAfter, maxSeconds) * 1000;
  }
  const remaining = response.headers?.get?.(RATELIMIT_REMAINING_HEADER);
  const reset = Number(response.headers?.get?.("x-ratelimit-reset"));
  if (remaining === "0" && Number.isFinite(reset)) {
    const seconds = Math.max(0, reset - Math.floor(Date.now() / 1000));
    return Math.min(seconds, maxSeconds) * 1000;
  }
  return Math.min(2 ** attempt, maxSeconds) * 1000;
}

/**
 * One GET against the Actions API, with bounded retry.
 *
 * 404 is returned to the caller as `null` because it is meaningful (a workflow
 * file that no longer exists). Everything else that is not OK is retried and
 * then RAISED — "we could not check" must never render as "it is fine".
 *
 * @param {object} api - `{ apiUrl, repo, token, maxAttempts, retryMaxSeconds }`
 * @param {string} path - API path beginning with `/`
 * @param {(ms: number) => Promise<void>} [wait] - Injectable sleep, for tests
 * @returns {Promise<{body: object, headers: Headers}|null>} Response, or null on 404
 * @throws {GateApiError} When the API stayed unreadable
 */
export async function apiGet(api, path, wait = sleep) {
  let lastProblem = "unknown";
  for (let attempt = 1; attempt <= api.maxAttempts; attempt += 1) {
    let response;
    try {
      response = await fetch(`${api.apiUrl}${path}`, {
        headers: {
          accept: GITHUB_ACCEPT,
          authorization: `Bearer ${api.token}`,
          "x-github-api-version": "2022-11-28",
          "user-agent": HEALTH_USER_AGENT,
        },
      });
    } catch (error) {
      lastProblem = `network error: ${error instanceof Error ? error.message : String(error)}`;
      if (attempt < api.maxAttempts)
        await wait(
          retryDelayMs({ headers: null }, attempt, api.retryMaxSeconds)
        );
      continue;
    }
    if (response.status === 404) return null;
    if (response.ok) {
      return { body: await response.json(), headers: response.headers };
    }
    // 401/403 without rate-limit headers is an auth problem: retrying cannot
    // fix a token that is not allowed to read run history, so fail immediately
    // with a message that names the fix.
    const remaining = response.headers?.get?.(RATELIMIT_REMAINING_HEADER);
    const throttled =
      response.status === 429 || (response.status === 403 && remaining === "0");
    if ((response.status === 401 || response.status === 403) && !throttled) {
      throw new GateApiError(
        `The Actions API returned ${response.status} for ${path}. The token cannot read run history — the caller job needs \`permissions: actions: read\`. Refusing to read an unreadable API as a green nightly.`
      );
    }
    lastProblem = `HTTP ${response.status}`;
    if (attempt < api.maxAttempts) {
      await wait(retryDelayMs(response, attempt, api.retryMaxSeconds));
    }
  }
  throw new GateApiError(
    `The Actions API stayed unreadable for ${path} after ${api.maxAttempts} attempts (${lastProblem}). Refusing to read an unreachable API as a green nightly — this check is RED, not inconclusive.`
  );
}

/**
 * The newest completed runs of one workflow on one branch for one event.
 *
 * Reads a bounded PAGE rather than a single run, which is rows 41-42's whole
 * mechanism. `per_page: "1"` made "the newest run" and "the newest run that
 * tested anything" the same query; they are not, and a displaced duplicate that
 * executed nothing is routinely the newer of the two.
 *
 * @param {object} api - API coordinates
 * @param {string} file - Workflow file name
 * @param {string} branch - Branch to read
 * @param {string} event - Run event
 * @param {(ms: number) => Promise<void>} [wait] - Injectable sleep
 * @returns {Promise<{runs: ReadonlyArray<object>, missing: boolean}>} The candidates, or a 404 marker
 */
export async function fetchRunCandidates(api, file, branch, event, wait) {
  const query = new URLSearchParams({
    branch,
    status: "completed",
    event,
    per_page: String(RUN_CANDIDATE_PAGE_SIZE),
  });
  const result = await apiGet(
    api,
    `/repos/${api.repo}/actions/workflows/${encodeURIComponent(file)}/runs?${query}`,
    wait
  );
  if (result === null) return { runs: Object.freeze([]), missing: true };
  return {
    runs: Object.freeze(result.body.workflow_runs ?? []),
    missing: false,
  };
}

/**
 * Every job of a run, paginated to exhaustion.
 *
 * Exhaustive on purpose: a matrix suite routinely exceeds one page, and a
 * truncated job list turns "the failing shard is on page 2" into a false green.
 * Hitting the page cap while still unread is raised rather than silently
 * truncated.
 *
 * `complete` says whether the walk reached the end of the list, and it is the
 * half a caller cannot reconstruct from the jobs alone. A list cut short by a
 * mid-walk 404 is indistinguishable, by inspection, from a short list that was
 * read in full — and the two must not be treated alike: 100 indecisive jobs
 * followed by an unreadable page 2 is *not* proof that the run tested nothing,
 * because the failing shard may be on the page that would not load. Callers
 * that decide anything from the ABSENCE of a job outcome must consult it.
 *
 * @param {object} api - API coordinates
 * @param {number|string} runId - The run
 * @param {(ms: number) => Promise<void>} [wait] - Injectable sleep
 * @returns {Promise<{jobs: ReadonlyArray<object>, complete: boolean}>} All jobs read, and whether the list was read to its end
 */
export async function fetchAllJobs(api, runId, wait) {
  const jobs = [];
  for (let page = 1; page <= api.maxPages; page += 1) {
    const result = await apiGet(
      api,
      `/repos/${api.repo}/actions/runs/${runId}/jobs?per_page=100&page=${page}&filter=latest`,
      wait
    );
    // A 404 means the run's job list stopped being readable mid-walk. Return
    // what was read, flagged INCOMPLETE; falling through to the page-cap throw
    // below would blame a pagination limit that had nothing to do with it AND
    // discard every job already collected.
    if (result === null)
      return Object.freeze({ jobs: Object.freeze(jobs), complete: false });
    const batch = result.body.jobs ?? [];
    jobs.push(...batch);
    if (batch.length < 100)
      return Object.freeze({ jobs: Object.freeze(jobs), complete: true });
  }
  throw new GateApiError(
    `Run ${runId} reports more jobs than \`api_max_pages\` (${api.maxPages}) allows this gate to read. A truncated job list can hide the failing shard, so this is RED rather than a partial read.`
  );
}

/**
 * Measures whether this gate actually blocks merges into one branch.
 *
 * REPORTING ONLY. Nothing on the gate path calls this, and it deliberately
 * cannot fail the caller: it catches everything and answers `unknown`.
 *
 * That is not defensive padding, it is the contract. This measurement decorates
 * an issue; the issue is the notification channel; §10.4 says an outage in the
 * notification channel must never become an outage anywhere else. A reporter
 * that aborted because it could not read a ruleset would stop filing the issues
 * that tell people the suite is down — trading a missing sentence for a missing
 * alert.
 *
 * `GET /repos/{owner}/{repo}/rules/branches/{branch}` is the right endpoint
 * rather than `/branches/{branch}/protection`: it returns the EFFECTIVE rules
 * for a branch from every source (repository rulesets, organization rulesets,
 * and classic branch protection projected into the same shape), which is the
 * question being asked. Reading a single ruleset by id would answer "is it in
 * THIS ruleset", and a context required by an org-level ruleset would render as
 * `not_required`.
 *
 * Note what a 404 means here and why it is `unknown` rather than
 * `not_required`: `apiGet` maps 404 to `null`, and this endpoint 404s for a
 * repository or branch it cannot see — including a token with too little scope.
 * A branch that genuinely has no rules answers `200 []`, which IS
 * `not_required`. Collapsing the two would report "nothing is blocking you"
 * because we were not allowed to look.
 *
 * @param {object} api - API coordinates
 * @param {string} branch - The branch whose rules are being read
 * @param {string} gateContext - The status-check context this gate publishes
 * @param {(ms: number) => Promise<void>} [wait] - Injectable sleep
 * @returns {Promise<{state: string, detail: string|null, contexts: ReadonlyArray<string>}>}
 *   The measurement, never a throw
 */
export async function fetchRequiredness(api, branch, gateContext, wait) {
  const unknown = detail =>
    Object.freeze({
      state: REQUIREDNESS.unknown,
      detail,
      contexts: [],
      rulesets: [],
    });
  // No context, no measurement. `resolveSettings` can no longer produce an
  // empty one, but this is the place where an empty one does its damage, and a
  // guard belongs where the harm lands as well as where it originates: matching
  // every required check against `""` yields zero matches, which is
  // indistinguishable from a branch that genuinely does not require this gate.
  // It is not a throw — §10.4 forbids the reporter becoming an outage — and it
  // is not `not_required`, because "nobody told me which check to look for" is
  // the third state this function already has.
  if (typeof gateContext !== "string" || gateContext.trim().length === 0) {
    return unknown(
      "no gate context was configured, so there is nothing to match required checks against — an unmatched empty context is not evidence that this gate is unrequired"
    );
  }
  let result;
  try {
    result = await apiGet(
      api,
      `/repos/${api.repo}/rules/branches/${encodeURIComponent(branch)}`,
      wait
    );
  } catch (error) {
    return unknown(
      `the branch-rules API was unreadable: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`
    );
  }
  if (result === null) {
    return unknown(
      `\`GET /repos/${api.repo}/rules/branches/${branch}\` returned 404 — the branch or the repository is not visible to this token`
    );
  }
  if (!Array.isArray(result.body)) {
    return unknown(
      "the branch-rules API returned something that is not a list of rules"
    );
  }
  const rules = result.body.filter(
    rule => rule?.type === "required_status_checks"
  );
  const contexts = Object.freeze(
    rules
      .flatMap(rule => rule?.parameters?.required_status_checks ?? [])
      .map(check => check?.context)
      .filter(context => typeof context === "string")
  );
  const matched = contexts.filter(context =>
    contextMatchesGate(context, gateContext)
  );
  // WHICH ruleset requires it, not merely that something does. A defect report
  // that names only the label leaves the reader hunting for the rule to read;
  // §10.9 has to name both halves of the mismatch, and this endpoint already
  // carries the source on every rule it returns. An org-level ruleset renders
  // as `Organization` here, which is the case where "check your repository
  // settings" would send someone to the wrong page entirely.
  const rulesets = Object.freeze(
    rules
      .filter(rule =>
        (rule?.parameters?.required_status_checks ?? []).some(check =>
          contextMatchesGate(check?.context, gateContext)
        )
      )
      .map(rule =>
        Object.freeze({
          sourceType:
            typeof rule?.ruleset_source_type === "string"
              ? rule.ruleset_source_type
              : null,
          source:
            typeof rule?.ruleset_source === "string"
              ? rule.ruleset_source
              : null,
          id: typeof rule?.ruleset_id === "number" ? rule.ruleset_id : null,
        })
      )
  );
  return Object.freeze({
    state:
      matched.length > 0 ? REQUIREDNESS.required : REQUIREDNESS.notRequired,
    detail:
      matched.length > 0
        ? `required as ${matched.map(context => `\`${context}\``).join(", ")}`
        : null,
    contexts,
    rulesets,
  });
}

/**
 * Renders the ruleset(s) that require this gate, for a defect report.
 *
 * @param {ReadonlyArray<{sourceType: string|null, source: string|null, id: number|null}>} rulesets -
 *   Matching rule sources from `fetchRequiredness`
 * @returns {string} A prose fragment, never empty
 */
export function describeRulesets(rulesets) {
  const named = (rulesets ?? [])
    .map(entry => {
      const scope = entry?.sourceType
        ? `${entry.sourceType} ruleset`
        : "ruleset";
      const name = entry?.source ? ` \`${entry.source}\`` : "";
      const id = typeof entry?.id === "number" ? ` (id ${entry.id})` : "";
      return `${scope}${name}${id}`;
    })
    .filter(Boolean);
  // Not "unknown ruleset": the requiredness measurement already proved a rule
  // is in effect, and the caller only reaches this on `required`. What is
  // missing is the rule's SOURCE, which older API responses omit.
  if (named.length === 0) return "an active ruleset on this branch";
  return named.join(" and ");
}

/**
 * Measures whether the audited bypass label EXISTS in this repository (§10.9).
 *
 * REPORTING ONLY, and it cannot fail its caller — same contract as
 * `fetchRequiredness`, for the same §10.4 reason: a reporter that aborted on an
 * unreadable labels API would stop filing the issues that tell people the suite
 * is down.
 *
 * ## Why a 404 is `absent` here, when a 404 is `unknown` for the branch rules
 *
 * It looks like the same ambiguity and it is not. `apiGet` maps 404 to `null`,
 * and `/repos/{o}/{r}/rules/branches/{b}` 404s for a repository the token
 * cannot see — so there, 404 conflates "no rules" with "not allowed to look".
 * `/repos/{o}/{r}/labels/{name}` 404s for a label that does not exist in a
 * repository that IS readable, and the only caller acts on this measurement
 * after `fetchRequiredness` returned `required`, which required a successful
 * `200` from the same repository. Repository visibility is therefore already
 * PROVEN by the time `absent` can be rendered; the remaining meaning of a 404
 * is the label.
 *
 * Everything else — a throw out of `apiGet`, a non-2xx that outlived its
 * retries, a network failure — is `unknown`. Never `present`: the state this
 * function must not invent is the one that claims an escape hatch exists. It
 * never returns `not_measured` either — that token belongs to callers who did
 * not ask, and this function is the asking.
 *
 * @param {object} api - API coordinates
 * @param {string} label - The configured bypass label
 * @param {(ms: number) => Promise<void>} [wait] - Injectable sleep
 * @returns {Promise<{state: string, detail: string|null}>} The measurement, never a throw
 */
export async function fetchBypassLabelState(api, label, wait) {
  const unknown = detail =>
    Object.freeze({ state: BYPASS_LABEL_STATE.unknown, detail });
  if (typeof label !== "string" || label.trim().length === 0) {
    return unknown(
      "no bypass label is configured, so there is nothing to look for — an unnamed label is not evidence that a waiver route exists"
    );
  }
  let result;
  try {
    result = await apiGet(
      api,
      `/repos/${api.repo}/labels/${encodeURIComponent(label)}`,
      wait
    );
  } catch (error) {
    return unknown(
      `the labels API was unreadable: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`
    );
  }
  if (result === null) {
    return Object.freeze({
      state: BYPASS_LABEL_STATE.absent,
      detail: `\`GET /repos/${api.repo}/labels/${label}\` returned 404 — no label by that name exists in this repository`,
    });
  }
  return Object.freeze({ state: BYPASS_LABEL_STATE.present, detail: null });
}

/**
 * The artifact NAMES a run published, paginated to exhaustion.
 *
 * Names only — nothing here downloads an artifact, and the gate still has no zip
 * reader. The names carry the scope markers (rows 36-38) and, unlike the bytes,
 * they survive the retention window, so a three-month-old run can still answer
 * "how many flows did you run?".
 *
 * Returns `null` on 404 and on a truncated read, which is the "we could not ask"
 * signal `assessSuiteScope` turns into a BLOCK for any suite that declared a
 * floor. A partial page walk is deliberately reported as unreadable rather than
 * as what was read: a flow-count marker sitting on the page this walk never
 * reached is indistinguishable from one that was never published, and the second
 * of those readings is the one that passes.
 *
 * @param {object} api - API coordinates
 * @param {number|string} runId - The run
 * @param {(ms: number) => Promise<void>} [wait] - Injectable sleep
 * @returns {Promise<ReadonlyArray<object>|null>} All artifacts, or null when unreadable
 */
export async function fetchRunArtifacts(api, runId, wait) {
  const artifacts = [];
  for (let page = 1; page <= api.maxPages; page += 1) {
    const result = await apiGet(
      api,
      `/repos/${api.repo}/actions/runs/${runId}/artifacts?per_page=100&page=${page}`,
      wait
    );
    if (result === null) return null;
    const batch = result.body.artifacts ?? [];
    artifacts.push(...batch);
    if (batch.length < 100) return Object.freeze(artifacts);
  }
  return null;
}

/**
 * Selects the run one suite will be scored on, and records what it walked past.
 *
 * Rows 41-42. Candidates arrive newest-first; the walk stops at the first that
 * produced evidence (`runProducedEvidence`) and never leaves the arm's own
 * freshness window. Both bounds are load-bearing. Without the first the gate
 * would keep reading runs it has no reason to; without the second a stale green
 * could hold the gate open indefinitely, which is the opposite failure and a
 * worse one.
 *
 * When nothing conclusive is found inside the window it falls back to the NEWEST
 * candidate — the run the gate scored before this walk existed — so `stale_run`,
 * `indecisive_conclusion` and the rest still fire and the gate still blocks.
 * That fallback is what makes selection unable to invent a pass: it may only
 * ever promote an older fresh, conclusive run over a run that tested nothing.
 *
 * @param {object} api - API coordinates
 * @param {ReadonlyArray<object>} candidates - Completed runs, newest first
 * @param {number} freshnessHours - This arm's freshness window
 * @param {Date} now - Evaluation instant
 * @param {(ms: number) => Promise<void>} [wait] - Injectable sleep
 * @returns {Promise<{run: object, jobs: ReadonlyArray<object>, jobsComplete: boolean, selection: object}>} The scored run, its jobs, whether that job list was read to its end, and the audit
 */
async function selectScoredRun(api, candidates, freshnessHours, now, wait) {
  const jobsById = new Map();
  const walkedPast = [];
  let chosen = null;
  for (const candidate of candidates) {
    if (!isFresh(candidate, freshnessHours, now)) break;
    const read = await fetchAllJobs(api, candidate.id, wait);
    const { jobs, complete } = read;
    jobsById.set(candidate.id, read);
    if (runProducedEvidence(candidate, jobs, complete)) {
      chosen = candidate;
      break;
    }
    walkedPast.push({
      runId: candidate.id ?? null,
      conclusion: candidate.conclusion ?? null,
      createdAt: candidate.created_at ?? null,
      decisiveJobs: countDecisiveJobs(jobs),
      totalJobs: jobs.length,
    });
  }
  const run = chosen ?? candidates[0];
  const read = jobsById.get(run.id) ?? (await fetchAllJobs(api, run.id, wait));
  const { jobs, complete: jobsComplete } = read;
  // A run cannot be both scored and skipped. When the walk falls back onto a
  // candidate it had already stepped over — the single-candidate case — the
  // honest report is "this was scored because nothing better existed", not a
  // line contradicting itself.
  const skipped = walkedPast.filter(entry => entry.runId !== run.id);
  return {
    run,
    jobs,
    jobsComplete,
    selection: Object.freeze({
      runId: run.id ?? null,
      conclusion: run.conclusion ?? null,
      createdAt: run.created_at ?? null,
      // Carried for the SCORED run too, not only the skipped ones, so an
      // inconclusive verdict can name its cause. See `formatSelection`.
      decisiveJobs: countDecisiveJobs(jobs),
      totalJobs: jobs.length,
      fellBack: chosen === null && walkedPast.length > 0,
      skipped: Object.freeze(skipped.map(entry => Object.freeze(entry))),
    }),
  };
}

/**
 * Observes every suite.
 *
 * @param {object} api - API coordinates
 * @param {ReadonlyArray<object>} suites - Validated suites
 * @param {string} branch - Branch to read
 * @param {{freshnessHours: number, now: Date}} context - Evaluation context, bounding the selection walk
 * @param {(ms: number) => Promise<void>} [wait] - Injectable sleep
 * @returns {Promise<ReadonlyArray<object>>} One observation per suite
 */
export async function observe(api, suites, branch, context, wait) {
  return await Promise.all(
    suites.map(async suite => {
      const perEvent = await Promise.all(
        COUNTED_EVENTS.map(event =>
          fetchRunCandidates(api, suite.workflow, branch, event, wait)
        )
      );
      if (perEvent.every(result => result.missing)) {
        return { workflowMissing: true, run: null, jobs: [] };
      }
      // Newest FIRST by created_at, so a fresh dispatch supersedes an older
      // failed schedule. ISO-8601 UTC compares correctly as strings.
      const candidates = perEvent
        .flatMap(result => result.runs)
        .filter(
          candidate => candidate && typeof candidate.created_at === "string"
        )
        // Equal timestamps compare 0 rather than falling through to -1, which
        // would make the sort unstable and let two runs created in the same
        // second swap places between reads of the same history.
        .sort((left, right) =>
          left.created_at === right.created_at
            ? 0
            : left.created_at < right.created_at
              ? 1
              : -1
        );
      // Jobs are read for EVERY match mode, `run` included. A run-scoped suite
      // needs them to prove the run was complete (row 26) — a `success` run
      // that skipped half its jobs is not evidence about the half it skipped.
      if (candidates.length === 0) {
        return { workflowMissing: false, run: null, jobs: [] };
      }
      const { run, jobs, jobsComplete, selection } = await selectScoredRun(
        api,
        candidates,
        suite.freshness_hours ?? context.freshnessHours,
        context.now,
        wait
      );
      // Artifacts are read for every suite, not only the ones declaring
      // `min_flows`: a run that recorded ITSELF as filtered disqualifies with no
      // declaration at all (row 36), and a gate that only looked when asked to
      // would miss exactly the repos that have not adopted the field yet. Read
      // for the SCORED run, which is the run every other row also judges.
      const artifacts = await fetchRunArtifacts(api, run.id, wait);
      return {
        workflowMissing: false,
        run,
        jobs,
        jobsComplete,
        selection,
        scope: readSuiteScope(artifacts),
      };
    })
  );
}

/**
 * One write against the Issues API, with the same bounded retry as `apiGet`.
 *
 * Deliberately a SEPARATE function rather than a `method` parameter on
 * `apiGet`: everything the merge gate calls must be provably read-only, and a
 * shared function with a write mode makes that a matter of reading argument
 * lists. Nothing on the gate path can reach this.
 *
 * @param {object} api - `{ apiUrl, repo, token, maxAttempts, retryMaxSeconds }`
 * @param {string} method - `POST` or `PATCH`
 * @param {string} path - API path beginning with `/`
 * @param {object} payload - JSON body
 * @param {(ms: number) => Promise<void>} [wait] - Injectable sleep, for tests
 * @returns {Promise<object>} The created or updated resource
 * @throws {GateApiError} When the write did not land
 */
export async function apiWrite(api, method, path, payload, wait = sleep) {
  let lastProblem = "unknown";
  for (let attempt = 1; attempt <= api.maxAttempts; attempt += 1) {
    let response;
    try {
      response = await fetch(`${api.apiUrl}${path}`, {
        method,
        headers: {
          accept: GITHUB_ACCEPT,
          authorization: `Bearer ${api.token}`,
          "content-type": "application/json",
          "x-github-api-version": "2022-11-28",
          "user-agent": HEALTH_USER_AGENT,
        },
        body: JSON.stringify(payload),
      });
    } catch (error) {
      lastProblem = `network error: ${error instanceof Error ? error.message : String(error)}`;
      if (attempt < api.maxAttempts)
        await wait(
          retryDelayMs({ headers: null }, attempt, api.retryMaxSeconds)
        );
      continue;
    }
    if (response.ok) return await response.json();
    const remaining = response.headers?.get?.(RATELIMIT_REMAINING_HEADER);
    const throttled =
      response.status === 429 || (response.status === 403 && remaining === "0");
    if ((response.status === 401 || response.status === 403) && !throttled) {
      throw new GateApiError(
        `The Issues API returned ${response.status} for ${method} ${path}. The reporting job needs \`permissions: issues: write\`. (The merge gate does NOT — it is a separate workflow that never writes, so this cannot block anyone's pull request.)`
      );
    }
    if (response.status === 404) {
      throw new GateApiError(
        `The Issues API returned 404 for ${method} ${path}. Either Issues are disabled on this repository or the target issue no longer exists.`
      );
    }
    lastProblem = `HTTP ${response.status}`;
    if (attempt < api.maxAttempts) {
      await wait(retryDelayMs(response, attempt, api.retryMaxSeconds));
    }
  }
  throw new GateApiError(
    `The Issues API stayed unwritable for ${method} ${path} after ${api.maxAttempts} attempts (${lastProblem}).`
  );
}

/**
 * Pins or unpins one tracking issue. BEST EFFORT — never throws.
 *
 * Pinning is GraphQL-only; REST has no equivalent, which is why this is the one
 * place in the file that speaks a second protocol. GraphQL addresses an issue by
 * NODE ID, not by number, so the plan carries `nodeIds` beside `issues`.
 *
 * It returns a warning instead of throwing for one specific reason: **GitHub
 * allows at most three pinned issues per repository**, and the fourth
 * `pinIssue` fails. That failure is entirely ordinary — a repo with three
 * pinned issues and a fourth red suite is a Tuesday — and it says nothing about
 * whether the tracking issue itself was written correctly. Letting it fail the
 * reporting job would turn a decoration into a red check, and an operator who
 * sees the report job go red every night for a full pin board learns to ignore
 * the report job.
 *
 * Note also that a GraphQL error arrives as **HTTP 200 with an `errors` array**,
 * not as a failing status. Checking `response.ok` alone would read the pin limit
 * as a success and report a pin that never happened.
 *
 * @param {object} api - API coordinates, including `graphqlUrl`
 * @param {string} nodeId - The issue's GraphQL node id
 * @param {boolean} pinned - True to pin, false to unpin
 * @returns {Promise<{ok: boolean, warning: string|null}>} Outcome, never a throw
 */
export async function setIssuePin(api, nodeId, pinned) {
  const mutation = pinned ? "pinIssue" : "unpinIssue";
  if (typeof nodeId !== "string" || nodeId.length === 0) {
    return Object.freeze({
      ok: false,
      warning: `could not ${mutation}: the issue has no GraphQL node id`,
    });
  }
  try {
    const response = await fetch(api.graphqlUrl ?? `${api.apiUrl}/graphql`, {
      method: "POST",
      headers: {
        accept: GITHUB_ACCEPT,
        authorization: `Bearer ${api.token}`,
        "content-type": "application/json",
        "user-agent": HEALTH_USER_AGENT,
      },
      body: JSON.stringify({
        query: `mutation($id: ID!) { ${mutation}(input: {issueId: $id}) { issue { number } } }`,
        variables: { id: nodeId },
      }),
    });
    if (!response.ok) {
      return Object.freeze({
        ok: false,
        warning: `${mutation} returned HTTP ${response.status}`,
      });
    }
    const body = await response.json();
    if (Array.isArray(body?.errors) && body.errors.length > 0) {
      const first = body.errors[0]?.message ?? "unknown GraphQL error";
      return Object.freeze({
        ok: false,
        warning: `${mutation} was refused: ${first}${
          /pinned|limit/i.test(String(first))
            ? " (GitHub allows at most 3 pinned issues per repository — the tracking issue was still filed and refreshed correctly)"
            : ""
        }`,
      });
    }
    return Object.freeze({ ok: true, warning: null });
  } catch (error) {
    return Object.freeze({
      ok: false,
      warning: `${mutation} could not be sent: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
}

/**
 * Every OPEN issue carrying the tracking label, paginated to exhaustion.
 *
 * Read through the issues LIST rather than the search API on purpose. Search is
 * an index with its own latency, and an index that has not caught up yet reports
 * "no issue for this suite" — which is exactly how a reporter files a duplicate
 * every night. The list endpoint is immediately consistent.
 *
 * An unknown label simply matches nothing (an empty list, not an error), which
 * is what makes the very first run — before the label exists — file rather than
 * fail.
 *
 * @param {object} api - API coordinates
 * @param {string} label - The tracking label
 * @param {(ms: number) => Promise<void>} [wait] - Injectable sleep
 * @returns {Promise<ReadonlyArray<object>>} Open issues
 */
export async function fetchTrackingIssues(api, label, wait) {
  const issues = [];
  for (let page = 1; page <= api.maxPages; page += 1) {
    const query = new URLSearchParams({
      state: "open",
      labels: label,
      per_page: "100",
      page: String(page),
    });
    const result = await apiGet(
      api,
      `/repos/${api.repo}/issues?${query}`,
      wait
    );
    if (result === null) {
      throw new GateApiError(
        `Could not list issues for ${api.repo} (404). Issues are probably disabled on this repository, so the nightly reporter has nowhere to file. Enable Issues or stop scheduling the reporting workflow.`
      );
    }
    const batch = Array.isArray(result.body) ? result.body : [];
    issues.push(...batch);
    if (batch.length < 100) return Object.freeze(issues);
  }
  throw new GateApiError(
    `More than \`api_max_pages\` (${api.maxPages}) pages of open \`${label}\` issues. Refusing to file against a truncated list, which would duplicate an issue this reporter already owns.`
  );
}

/**
 * Executes a plan. One suite's failure never abandons the others.
 *
 * Sequential rather than parallel: these are writes to one issue set, and a
 * burst of them is exactly what GitHub's secondary rate limits exist to slow
 * down. Ordered execution also makes the job log readable top to bottom.
 *
 * @param {object} api - API coordinates
 * @param {ReadonlyArray<object>} plan - Output of `planIssueActions`
 * @param {(ms: number) => Promise<void>} [wait] - Injectable sleep
 * @returns {Promise<ReadonlyArray<object>>} One result per plan entry
 */
export async function applyIssuePlan(api, plan, wait) {
  const results = [];
  for (const entry of plan) {
    const base = {
      label: entry.label,
      action: entry.action,
      reason: entry.reason,
      issues: entry.issues,
      requiredness: entry.requiredness ?? null,
      warnings: Object.freeze([]),
    };
    // Pins are applied AFTER the write that matters has landed, and their
    // outcome is collected as warnings rather than folded into `ok`. `ok`
    // answers "was the tracking issue written", which is what the job's exit
    // code is derived from; a full pin board must not redden the report.
    const pin = async nodeIds => {
      if (entry.pin === null || entry.pin === undefined) return [];
      const outcomes = await Promise.all(
        nodeIds.map(nodeId => setIssuePin(api, nodeId, entry.pin))
      );
      return outcomes
        .filter(outcome => !outcome.ok)
        .map(outcome => outcome.warning);
    };
    try {
      if (entry.action === ISSUE_ACTIONS.create) {
        const created = await apiWrite(
          api,
          "POST",
          `/repos/${api.repo}/issues`,
          {
            title: entry.title,
            body: entry.body,
            labels: [api.issueLabel ?? TRACKING_ISSUE_LABEL],
          },
          wait
        );
        results.push({
          ...base,
          issues: Object.freeze([created.number]),
          warnings: Object.freeze(await pin([created.node_id])),
          ok: true,
          error: null,
        });
        continue;
      }
      if (entry.action === ISSUE_ACTIONS.refresh) {
        const [number] = entry.issues;
        await apiWrite(
          api,
          "PATCH",
          `/repos/${api.repo}/issues/${number}`,
          { title: entry.title, body: entry.body },
          wait
        );
        if (entry.comment) {
          await apiWrite(
            api,
            "POST",
            `/repos/${api.repo}/issues/${number}/comments`,
            { body: entry.comment },
            wait
          );
        }
        results.push({
          ...base,
          warnings: Object.freeze(await pin(entry.nodeIds ?? [])),
          ok: true,
          error: null,
        });
        continue;
      }
      if (entry.action === ISSUE_ACTIONS.close) {
        // Unpin BEFORE closing. A closed issue can still be unpinned, but
        // ordering it this way means the pin board is already correct at the
        // instant the issue disappears from the open list — there is no window
        // where the repo advertises a pinned issue that is closed.
        const warnings = await pin(entry.nodeIds ?? []);
        for (const number of entry.issues) {
          if (entry.comment) {
            await apiWrite(
              api,
              "POST",
              `/repos/${api.repo}/issues/${number}/comments`,
              { body: entry.comment },
              wait
            );
          }
          await apiWrite(
            api,
            "PATCH",
            `/repos/${api.repo}/issues/${number}`,
            { state: "closed", state_reason: "completed" },
            wait
          );
        }
        results.push({
          ...base,
          warnings: Object.freeze(warnings),
          ok: true,
          error: null,
        });
        continue;
      }
      results.push({ ...base, ok: true, error: null });
    } catch (error) {
      // One suite's reporting failure must not silence the rest. Recorded, not
      // thrown: the caller decides the job's exit code once, having seen every
      // suite.
      results.push({
        ...base,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return Object.freeze(results);
}

/**
 * Reads the pull request's CURRENT labels, body and author, LIVE from the API.
 *
 * THIS IS THE BYPASS'S ONLY SOURCE OF TRUTH, and the reason it exists is a
 * measured defect. The gate used to read both halves of the bypass request from
 * `github.event.pull_request` — `toJSON(...labels.*.name)` and `...body`. That
 * object is the event payload CAPTURED WHEN THE RUN WAS TRIGGERED. It is a
 * snapshot, not a live read, and a re-run REPLAYS the original payload. So the
 * gate's own printed remedy — "add the trailer, then apply the label" — could
 * not work: applying a label fires no run under the default activity types, and
 * re-running (the obvious next move, and the one the failure message invites)
 * replays a payload from before the label existed. Measured on two consumer
 * repositories: the label sat on the pull request the whole time while the job
 * logged `NIGHTLY_PR_LABELS: []`. The only thing that worked was an empty
 * commit, to manufacture a `synchronize` whose payload happened to carry the
 * label — a workaround nobody should have to discover.
 *
 * A live read is immune to both halves of that: it is correct on a re-run, and
 * correct whether or not the caller subscribed to the `labeled` activity type.
 *
 * It also fixes the mirror-image hole, which matters more: a payload that still
 * carries a label somebody has since REMOVED would waive a gate whose waiver was
 * withdrawn. Reading live is the only way "the label is gone" can reach the
 * gate at all.
 *
 * FAILS CLOSED, and never falls back to the payload. `null` means the pull
 * request could not be read — 404, an unreadable API, a body with no `labels`
 * array — and the caller turns that into a REJECTED bypass, never into a
 * bypass. Falling back to the payload here would reintroduce exactly the
 * stale-label waiver above, on the one path where nobody is watching. Note the
 * distinction the caller depends on: `null` is "unreadable", while a readable
 * pull request carrying no labels is `labels: []` — both stay gated, for
 * reasons the report states differently.
 *
 * @param {object} api - API coordinates
 * @param {number} prNumber - Pull request number
 * @param {(ms: number) => Promise<void>} [wait] - Injectable sleep
 * @returns {Promise<{labels: ReadonlyArray<string>, body: string, author: string|null}|null>} Live PR state, or `null` when unreadable
 */
export async function fetchPullRequestState(api, prNumber, wait) {
  const result = await apiGet(
    api,
    `/repos/${api.repo}/pulls/${prNumber}`,
    wait
  ).catch(() => null);
  const pr = result?.body;
  // A missing `labels` array is UNREADABLE, not "no labels". The two must not
  // collapse: one is a broken read and the other is a fact about the PR.
  if (!pr || !Array.isArray(pr.labels)) return null;
  const labels = pr.labels
    .map(entry => (typeof entry === "string" ? entry : entry?.name))
    .filter(name => typeof name === "string" && name.length > 0);
  return Object.freeze({
    labels: Object.freeze(labels),
    body: typeof pr.body === "string" ? pr.body : "",
    author: typeof pr.user?.login === "string" ? pr.user.login : null,
  });
}

/**
 * The emitted decision for "the pull request could not be read".
 *
 * Same keys as every `evaluateBypass` outcome, so `audit_json` has one shape
 * whatever happened — §6's emitted record is asserted key for key.
 *
 * @param {{prNumber: number|null, label: string|null, prAuthor: string|null}} subject - What was being evaluated
 * @returns {{valid: boolean, reason: string}} A rejected bypass
 */
export function unreadablePullRequestBypass({
  prNumber = null,
  label = null,
  prAuthor = null,
}) {
  return Object.freeze({
    label,
    prAuthor,
    prNumber,
    actorPermission: null,
    valid: false,
    reason: "pr_state_unreadable",
    actor: null,
    appliedAt: null,
    expiresAt: null,
    ticket: null,
    detail: null,
  });
}

/**
 * Reads who most recently applied the bypass label, from the PR's issue events.
 *
 * PAGINATED, and that is not defensive padding. The issue-events API returns
 * events OLDEST-FIRST, so on a long-lived pull request — a big feature branch,
 * or exactly the sort of PR that ends up needing a bypass — page 1 holds the
 * oldest hundred events and the label application is on a later page. Reading
 * only page 1 would report `no_attributable_actor` for a perfectly valid
 * maintainer bypass. That fails closed, so it is not a security hole, but it
 * rejects the legitimate case for the wrong stated reason, which is its own kind
 * of untrustworthy gate.
 *
 * Every page is scanned and the newest match across all of them wins, so a label
 * removed and re-applied is attributed to the person who applied it LAST.
 *
 * @param {object} api - API coordinates
 * @param {number} prNumber - Pull request number
 * @param {string} label - The bypass label
 * @param {(ms: number) => Promise<void>} [wait] - Injectable sleep
 * @returns {Promise<{actor: string, createdAt: string}|null>} The labelling event
 */
export async function fetchLabelEvent(api, prNumber, label, wait) {
  let newest = null;
  for (let page = 1; page <= api.maxPages; page += 1) {
    const result = await apiGet(
      api,
      `/repos/${api.repo}/issues/${prNumber}/events?per_page=100&page=${page}`,
      wait
    ).catch(() => null);
    if (result === null) break;
    const batch = result.body ?? [];
    for (const event of batch) {
      if (event.event !== "labeled" || event.label?.name !== label) continue;
      if (newest === null || event.created_at > newest.created_at) {
        newest = event;
      }
    }
    if (batch.length < 100) break;
  }
  if (!newest?.actor?.login) return null;
  return { actor: newest.actor.login, createdAt: newest.created_at };
}

/**
 * Reads an actor's permission on the repository.
 *
 * @param {object} api - API coordinates
 * @param {string} login - The actor
 * @param {(ms: number) => Promise<void>} [wait] - Injectable sleep
 * @returns {Promise<string|null>} `admin` | `maintain` | `write` | `read` | null
 */
export async function fetchActorPermission(api, login, wait) {
  const result = await apiGet(
    api,
    `/repos/${api.repo}/collaborators/${encodeURIComponent(login)}/permission`,
    wait
  ).catch(() => null);
  return result?.body?.role_name ?? result?.body?.permission ?? null;
}

// ---------------------------------------------------------------------------
// 8. Entry point
// ---------------------------------------------------------------------------

/**
 * Resolves everything the gate needs from the environment, failing loudly
 * rather than degrading into a check that silently measures nothing.
 *
 * @param {NodeJS.ProcessEnv} env - The environment
 * @returns {object} Resolved settings
 * @throws {GateConfigError} When required settings are absent or unusable
 */
export function resolveSettings(env) {
  const token = env.GITHUB_TOKEN || env.GH_TOKEN;
  if (!token) {
    throw new GateConfigError(
      "No GITHUB_TOKEN / GH_TOKEN in the environment. This gate reads the Actions API and cannot report a verdict without one."
    );
  }
  if (!env.GITHUB_REPOSITORY) {
    throw new GateConfigError(
      "No GITHUB_REPOSITORY in the environment, so there is no repository to read nightly runs from."
    );
  }
  const branch = (env.NIGHTLY_BRANCH || "").trim();
  if (!branch) {
    throw new GateConfigError(
      "No `branch` input. The gate must know which branch's nightly verdict it speaks for — an unfiltered read would let a dispatch from any feature branch clear the gate for everybody."
    );
  }
  const number = (name, fallback) => {
    const raw = env[name];
    if (raw === undefined || String(raw).trim() === "") return fallback;
    const value = Number(raw);
    if (!Number.isFinite(value) || value <= 0) {
      throw new GateConfigError(
        `\`${name}\` must be a positive number (got ${raw}).`
      );
    }
    return value;
  };

  // Every security ceiling is applied HERE, through the one shared resolver, so
  // fail-closed only has to be right once. Resolved at call time from the env
  // passed in — never captured at module load, so a test or a re-entrant caller
  // cannot be reading limits some earlier import froze.
  const { limits, clamped } = resolveSecurityLimits({
    bypassMaxHours: number("NIGHTLY_BYPASS_MAX_HOURS", 24),
    bootstrapMaxDays: number("NIGHTLY_BOOTSTRAP_MAX_DAYS", 30),
    freshnessHours: number("NIGHTLY_FRESHNESS_HOURS", 36),
    apiMaxAttempts: number("NIGHTLY_API_MAX_ATTEMPTS", 3),
    apiMaxPages: number("NIGHTLY_API_MAX_PAGES", 5),
    apiRetryMaxSeconds: number("NIGHTLY_API_RETRY_MAX_SECONDS", 60),
  });

  return {
    api: {
      apiUrl: env.GITHUB_API_URL || "https://api.github.com",
      repo: env.GITHUB_REPOSITORY,
      token,
      maxAttempts: limits.apiMaxAttempts,
      maxPages: limits.apiMaxPages,
      retryMaxSeconds: limits.apiRetryMaxSeconds,
      // Carried on the API coordinates so the reporting writes cannot be
      // labelled differently from the reads that look for them.
      issueLabel: env.NIGHTLY_ISSUE_LABEL || TRACKING_ISSUE_LABEL,
      // GHES publishes GraphQL somewhere other than `${apiUrl}/graphql`, and
      // the runner already exports the right value.
      graphqlUrl:
        env.GITHUB_GRAPHQL_URL ||
        `${env.GITHUB_API_URL || "https://api.github.com"}/graphql`,
    },
    issueLabel: env.NIGHTLY_ISSUE_LABEL || TRACKING_ISSUE_LABEL,
    // Reporting-only settings. The gate reads none of them, which is why they
    // carry defaults rather than failing when absent — a gate that could be
    // configured into silence by omitting a variable is the shape this file
    // refuses, but the REPORTER's equivalent risk is the opposite one: a
    // missing decoration must not stop the notification going out.
    // TRIMMED BEFORE THE FALLBACK, never after. `(env.X || DEFAULT).trim()`
    // read `NIGHTLY_GATE_CONTEXT="   "` as a configured value — whitespace is
    // truthy — so the fallback never fired and the context resolved to `""`.
    // An empty context matches no required check (`contextMatchesGate` can
    // satisfy neither half of its ` / ` test against it), so `fetchRequiredness`
    // answered `not_required` for a branch the gate really does guard, and the
    // run still exited successfully: a gate switching itself off and printing
    // green. Unset and whitespace-only come from the same place — an unfilled
    // workflow input — and now resolve the same way, which is what `branch` and
    // `suites` above already do.
    gateContext:
      (env.NIGHTLY_GATE_CONTEXT ?? "").trim() || DEFAULT_GATE_CONTEXT,
    // Opt-in. Pinning writes to a repository-wide, three-slot surface that
    // nothing else in this file touches, so it stays off until a caller asks.
    pinIssues: /^(1|true|yes)$/i.test(String(env.NIGHTLY_PIN_ISSUES ?? "")),
    branch,
    suites: validateSuites(env.NIGHTLY_SUITES),
    freshnessHours: limits.freshnessHours,
    bootstrapUntil: env.NIGHTLY_BOOTSTRAP_UNTIL || "",
    bootstrapMaxDays: limits.bootstrapMaxDays,
    bypassLabel:
      String(env.NIGHTLY_BYPASS_LABEL ?? "").trim() || DEFAULT_BYPASS_LABEL,
    bypassMaxHours: limits.bypassMaxHours,
    // An ADDITIONAL project rule, never a replacement — see `evaluateBypass`.
    extraBypassReasonPattern: env.NIGHTLY_BYPASS_REASON_PATTERN || "",
    clamped,
    // The ONLY thing taken from the event payload is the pull request NUMBER,
    // and only because a PR's number is immutable — it is an address, not a
    // fact about the PR. Everything the bypass decides on (labels, body, and
    // the author carried onto the audit) is read LIVE by
    // `fetchPullRequestState`, because `github.event` is a snapshot from
    // trigger time that a re-run replays verbatim.
    //
    // `NIGHTLY_PR_LABELS` and `NIGHTLY_PR_BODY` are DELIBERATELY NOT READ from
    // here as of contract 1.6.0. The reusable workflow still sets them, on
    // purpose: a consumer that has taken the newer workflow ref but not yet run
    // `lisa apply` is still running a pre-1.6.0 guard, and that guard needs
    // them. Reading them here would defeat the fix — the payload is exactly
    // what was wrong.
    //
    // `payloadAuthor` is a fallback for the audit record only. It never gates
    // anything (see `evaluateBypass`: `prAuthor` is recorded, never used to
    // reject), so a stale value cannot change a verdict.
    pr: {
      number: Number(env.NIGHTLY_PR_NUMBER) || null,
      payloadAuthor: env.NIGHTLY_PR_AUTHOR || null,
    },
  };
}

/**
 * Runs the gate.
 *
 * @param {NodeJS.ProcessEnv} env - The environment
 * @param {(ms: number) => Promise<void>} [wait] - Injectable sleep
 * @returns {Promise<object>} The verdict
 */
export async function runGate(env, wait) {
  const settings = resolveSettings(env);
  const now = new Date();
  const bootstrap = resolveBootstrap(
    settings.bootstrapUntil,
    settings.bootstrapMaxDays,
    now
  );
  const observations = await observe(
    settings.api,
    settings.suites,
    settings.branch,
    { freshnessHours: settings.freshnessHours, now },
    wait
  );
  const findings = settings.suites.map((suite, index) => {
    const finding = assessSuite(suite, observations[index], {
      branch: settings.branch,
      freshnessHours: settings.freshnessHours,
      now,
    });
    // Resolved for EVERY suite, so a misconfigured anchor fails the gate
    // whether or not its window is still open — a rule that only runs while it
    // would forgive something is a rule nobody notices breaking. The window is
    // attached only when the suite actually declared one, so an untouched
    // table produces byte-identical findings.
    const grace = resolveSuiteGrace(suite, settings.bootstrapMaxDays, now);
    return grace.firstSeen === null ? finding : { ...finding, grace };
  });

  // The bypass reads the pull request LIVE and never consults `github.event`.
  // Three outcomes, and the middle one is the vacuity guard: unreadable is a
  // REJECTED bypass, never an absent one and never a granted one.
  let bypass = null;
  if (settings.pr.number) {
    const live = await fetchPullRequestState(
      settings.api,
      settings.pr.number,
      wait
    );
    const subject = {
      prNumber: settings.pr.number,
      label: settings.bypassLabel,
      prAuthor: settings.pr.payloadAuthor,
    };
    if (live === null) {
      bypass = unreadablePullRequestBypass(subject);
    } else if (live.labels.includes(settings.bypassLabel)) {
      const labelEvent = await fetchLabelEvent(
        settings.api,
        settings.pr.number,
        settings.bypassLabel,
        wait
      );
      const actorPermission = labelEvent
        ? await fetchActorPermission(settings.api, labelEvent.actor, wait)
        : null;
      bypass = evaluateBypass({
        labelEvent,
        prAuthor: live.author ?? settings.pr.payloadAuthor,
        prBody: live.body,
        actorPermission,
        prNumber: settings.pr.number,
        label: settings.bypassLabel,
        maxHours: settings.bypassMaxHours,
        extraReasonPattern: settings.extraBypassReasonPattern,
        now,
      });
    }
    // The remaining case — read successfully, label not present — leaves
    // `bypass` null. Nobody asked for a waiver, so there is nothing to report,
    // and a label REMOVED since the run was triggered lands here rather than
    // waiving anything.
  }

  return {
    ...decide(findings, { bootstrap, bypass }),
    clamped: settings.clamped,
    settings,
  };
}

/**
 * The READ half of reporting: everything up to, and not including, the writes.
 *
 * Reads exactly what the gate reads and assesses it with exactly the same
 * classifier, so the issue and the merge gate can never disagree about whether a
 * suite is red. What it does NOT do is call `decide`: that renders `unknown` as
 * `bootstrap` while a window is open, and the reporter needs each suite's real
 * state. (Bootstrap changes nothing here anyway — an `unknown` suite is left
 * alone either way, and a genuinely red one is red inside the window too.)
 *
 * The bypass is likewise absent by construction: a bypass waives the gate for
 * ONE pull request, it does not make the nightly green, and the tracking issue
 * stays open until a green run lands.
 *
 * Split from the writes so the CLI can surface the verdict BEFORE publishing it
 * (§10.4). Everything here is a `GET`; the first write in the reporting path is
 * `applyIssuePlan`.
 *
 * @param {NodeJS.ProcessEnv} env - The environment
 * @param {(ms: number) => Promise<void>} [wait] - Injectable sleep
 * @returns {Promise<object>} Findings, requiredness, label state, plan, settings
 */
export async function planReport(env, wait) {
  const settings = resolveSettings(env);
  const now = new Date();
  const observations = await observe(
    settings.api,
    settings.suites,
    settings.branch,
    { freshnessHours: settings.freshnessHours, now },
    wait
  );
  const findings = settings.suites.map((suite, index) => {
    const finding = assessSuite(suite, observations[index], {
      branch: settings.branch,
      freshnessHours: settings.freshnessHours,
      now,
    });
    // Attached only when the caller actually declared the suite ungated, so an
    // untouched suite table produces byte-identical findings — the same shape
    // `runGate` uses for `grace`.
    return suite.gated === false ? { ...finding, gated: false } : finding;
  });
  // Measured, not assumed, and measured ONCE per report rather than per suite:
  // requiredness is a property of the branch, and asking N times would be N
  // chances to get N different answers into one report.
  const requiredness = await fetchRequiredness(
    settings.api,
    settings.branch,
    settings.gateContext,
    wait
  );
  // Measured only after branch rules prove this gate is required. On a branch
  // this gate does not guard, the issue already says "you do not need a waiver".
  // When requiredness itself is unknown, querying the label would turn a label
  // 404 into a confident defect even though the rules API never proved the
  // waiver recipe applies. Skipping the CALL rather than suppressing the RENDER
  // keeps both cases fail-closed at the wire boundary.
  const bypassLabelState =
    requiredness.state === REQUIREDNESS.required
      ? await fetchBypassLabelState(settings.api, settings.bypassLabel, wait)
      : Object.freeze({
          state: BYPASS_LABEL_STATE.notMeasured,
          detail:
            requiredness.state === REQUIREDNESS.notRequired
              ? "not measured — this gate is not required on this branch, so no waiver recipe is printed and a missing label waives nothing"
              : "not measured — whether this gate is required could not be read, so the labels API was not queried",
        });
  const context = {
    branch: settings.branch,
    label: settings.issueLabel,
    now,
    requiredness,
    gateContext: settings.gateContext,
    bypassLabel: settings.bypassLabel,
    bypassLabelState,
    pinIssues: settings.pinIssues,
  };
  return { findings, requiredness, bypassLabelState, context, settings };
}

/**
 * The PUBLISH half: read the open tracking issues, plan, and write.
 *
 * The read of the existing issues lives on THIS side of the split, not with the
 * verdict, and that placement is the point. Listing open issues is the Issues
 * API — the same API that can be switched off, throttled or forbidden — so a
 * verdict that depended on it would still die with its publisher, which is the
 * whole defect (§10.4). Everything the verdict needs comes from Actions run
 * history instead.
 *
 * @param {object} planned - Output of `planReport`
 * @param {(ms: number) => Promise<void>} [wait] - Injectable sleep
 * @returns {Promise<{plan: ReadonlyArray<object>, results: ReadonlyArray<object>}>} Plan and outcomes
 */
export async function publishReport(planned, wait) {
  const { settings, findings, context } = planned;
  const plan = planIssueActions(
    findings,
    await fetchTrackingIssues(settings.api, settings.issueLabel, wait),
    context
  );
  return { plan, results: await applyIssuePlan(settings.api, plan, wait) };
}

/**
 * Plan, then publish. The whole report in one call.
 *
 * Kept as the single-call entry point it has always been — every existing
 * caller and every §10 test reads the same five fields back. `reportIssues`
 * deliberately does NOT use it: the CLI has to get the verdict onto the job
 * summary between the two halves, and has to survive the second half failing,
 * neither of which a combined call can express (§10.4).
 *
 * @param {Record<string, string|undefined>} env - Process environment
 * @param {(ms: number) => Promise<void>} [wait] - Injectable sleep
 * @returns {Promise<object>} `{findings, requiredness, bypassLabelState, plan, results, settings}`
 */
export async function runReport(env, wait) {
  const planned = await planReport(env, wait);
  const { context: _context, ...verdict } = planned;
  return { ...verdict, ...(await publishReport(planned, wait)) };
}

/**
 * Whether a suite is red in the sense §10.4's exit code needs.
 *
 * `fail` AND complete evidence — the same pair `planIssueActions` requires
 * before it will file anything, asked here of the FINDING so the exit code needs
 * nothing from the Issues API. A `fail` that row 30 routed to
 * `evidence_incomplete` decided nothing there and decides nothing here either,
 * or the job would go red about a run whose own report says it proved nothing.
 *
 * @param {object} finding - A finding
 * @returns {boolean} True when the suite genuinely failed
 */
function isGenuinelyRed(finding) {
  return finding.state === SUITE_STATES.fail && isCompleteEvidence(finding);
}

/**
 * The reporting entry point, as the scheduled workflow invokes it.
 *
 * Three outcomes, three deliberately different exit codes (§10.4):
 *
 *   1. **No verdict could be resolved** — configuration, a schema refusal, an
 *      unreadable run history → EXIT 1. Nothing was reported, and "we could not
 *      check" must never render as "it is fine".
 *   2. **Verdict resolved, publishing failed** → EXIT 0 + `::warning::`. The
 *      tracking issue is a convenience; the verdict is the product, and it is
 *      already on the job summary by the time publishing is attempted. A report
 *      channel must not die because its optional publishing destination is
 *      unavailable — measured as HTTP 410 on `POST /repos/{o}/{r}/issues` for a
 *      repository that switched Issues off.
 *   3. **The SUITE itself is red** → EXIT 1 + `::error::` per red suite.
 *
 * Case 3 is why case 2 is safe to absorb. Without it this entry point would have
 * no failing path left at all once publishing stopped reddening it, and a job
 * that cannot go red is a job whose green means nothing.
 *
 * @param {boolean} asJson - Emit the machine record instead of prose
 * @returns {Promise<void>} Resolves once the report is written
 */
export async function reportIssues(asJson) {
  // ---------------------------------------------------------------------
  // 1. Resolve the verdict. Read-only, and the one path that still exits 1
  //    for a reporting failure — because it produced no report at all.
  // ---------------------------------------------------------------------
  let planned;
  try {
    planned = await planReport(process.env);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(
      `::error title=Nightly E2E reporting failed::${message.split("\n")[0]}\n`
    );
    process.stdout.write(`${message}\n`);
    process.exitCode = 1;
    return;
  }
  const { settings, context: _context, ...verdict } = planned;

  // ---------------------------------------------------------------------
  // 2. Surface the verdict, BEFORE anything can go wrong publishing it.
  //    Making publishing non-fatal on its own would trade a false red for a
  //    silent gap — the same defect pointing the other way. The step summary
  //    is a channel that exists whether or not GitHub Issues do.
  // ---------------------------------------------------------------------
  if (!asJson) {
    const verdictReport = formatVerdictReport(verdict.findings, {
      branch: settings.branch,
    });
    process.stdout.write(verdictReport);
    await appendSummary(verdictReport);
  }

  // ---------------------------------------------------------------------
  // 3. Publish — best effort, and nothing it does reaches the exit code.
  // ---------------------------------------------------------------------
  // `applyIssuePlan` already records a per-suite write failure rather than
  // throwing (row 31). This catch is for everything around it — most concretely
  // the LIST of open issues, which is the same Issues API the writes use and can
  // therefore be off, throttled or forbidden in exactly the same way.
  let plan = [];
  let results = [];
  let publishFailure = null;
  try {
    ({ plan, results } = await publishReport(planned));
  } catch (error) {
    publishFailure = error instanceof Error ? error.message : String(error);
    process.stderr.write(
      `::warning title=Nightly E2E tracking issues not published::${publishFailure.split("\n")[0]} — the verdict for this run is in the job summary, and this job's result reflects the SUITE, not the publish.\n`
    );
  }
  const machine = { ...verdict, plan, results, publishFailure };
  if (asJson) {
    process.stdout.write(`${JSON.stringify(machine, null, 2)}\n`);
  } else {
    const report = formatIssueReport(results, {
      branch: settings.branch,
      requiredness: verdict.requiredness,
      gateContext: settings.gateContext,
      bypassLabel: settings.bypassLabel,
      bypassLabelState: verdict.bypassLabelState,
      publishFailure,
    });
    process.stdout.write(report);
    await appendSummary(report);
  }
  // An `unknown` requiredness is annotated on the run, because it means every
  // issue this report touched is deliberately silent about merge consequences —
  // and the reason (a scope, a rename, an outage) is fixable.
  if (verdict.requiredness?.state === REQUIREDNESS.unknown) {
    process.stderr.write(
      `::warning title=Nightly E2E requiredness unknown::Could not read \`${settings.branch}\`'s branch rules, so the tracking issues claim neither that merges are blocked nor that they are not. ${verdict.requiredness.detail ?? ""}\n`
    );
  }
  // §10.9. An annotation rather than a failure, and that is not timidity: this
  // job's exit code answers "is the suite green" (§10.4), and reddening it for a
  // repository-configuration defect would teach operators to ignore the one job
  // that tells them a suite is down. It is loud where loudness is free.
  if (verdict.bypassLabelState?.state === BYPASS_LABEL_STATE.absent) {
    process.stderr.write(
      `::error title=Nightly E2E bypass label missing::The gate is required on \`${settings.branch}\` but the \`${settings.bypassLabel}\` label does not exist in this repository, so the audited waiver cannot be applied and an unaudited admin merge is the only exit. Create it once: gh label create ${settings.bypassLabel}\n`
    );
  } else if (verdict.bypassLabelState?.state === BYPASS_LABEL_STATE.unknown) {
    process.stderr.write(
      `::warning title=Nightly E2E bypass label unreadable::Could not read whether \`${settings.bypassLabel}\` exists in this repository. ${verdict.bypassLabelState.detail ?? ""}\n`
    );
  }
  for (const result of results) {
    for (const warning of result.warnings ?? []) {
      process.stderr.write(
        `::warning title=Nightly E2E tracking issue not pinned::${result.label} — ${warning}\n`
      );
    }
  }
  // A tracking issue that did not land is a `::warning::`, NOT an `::error::`
  // and not a failure. It names the suite and the cause, which is what an
  // operator needs to fix the publisher; the verdict it could not publish is
  // three paragraphs up the same summary.
  for (const result of results.filter(entry => !entry.ok)) {
    process.stderr.write(
      `::warning title=Nightly E2E tracking issue not updated::${result.label} — ${result.error} (the verdict for this run is in the job summary; this job's result reflects the SUITE, not the publish)\n`
    );
  }

  // ---------------------------------------------------------------------
  // 4. Exit on the SUITE, never on the publish.
  // ---------------------------------------------------------------------
  // Read off the FINDINGS, never off the plan or the results: the plan needs the
  // Issues API to build, and a verdict that could not be reached because the
  // publisher was unreachable is the defect this whole section deletes.
  // `::error::` annotates but does not fail a step, so the explicit non-zero
  // exit code is what actually carries the red.
  const red = verdict.findings.filter(isGenuinelyRed);
  for (const finding of red) {
    process.stderr.write(
      `::error title=Nightly E2E is not green::${finding.label} — ${finding.state.toUpperCase()}${finding.conclusion ? ` (${finding.conclusion})` : ""} [${finding.reason}]${finding.url ? ` — ${finding.url}` : ""}\n`
    );
  }
  if (red.length > 0) process.exitCode = 1;
}

/**
 * CLI.
 *
 * @param {ReadonlyArray<string>} argv - Arguments
 * @returns {Promise<void>} Resolves once the report is written
 */
async function main(argv) {
  if (argv.includes("--contract-version")) {
    process.stdout.write(`${NIGHTLY_E2E_CONTRACT_VERSION}\n`);
    return;
  }
  const asJson = argv.includes("--json");
  // The reporting half is opt-in at the call site, which is what keeps the
  // default invocation — the required status check — provably read-only.
  if (argv.includes("--report-issues")) return await reportIssues(asJson);

  /** @type {object} */
  let verdict;
  try {
    verdict = await runGate(process.env);
  } catch (error) {
    // Configuration and API failures are the gate's own failure modes, and both
    // are RED. Never a pass, never a warning.
    const message = error instanceof Error ? error.message : String(error);
    const kind = error instanceof GateConfigError ? "configuration" : "api";
    const failure = {
      verdict: "fail",
      blocked: true,
      error: { kind, message },
      findings: [],
    };
    // A downstream job reading `verdict`/`blocked` must see the gate's OWN
    // failures too. Leaving them unset makes a configuration or API failure
    // indistinguishable from a job that never ran — the same "absence reads as
    // fine" shape the whole gate refuses.
    await writeOutputs(failure);
    if (asJson) {
      process.stdout.write(`${JSON.stringify(failure, null, 2)}\n`);
      return;
    }
    const report = `## 🌙 Nightly E2E Health\n\n❌ **The gate could not produce a verdict (${kind}).**\n\n${message}\n\nThis check is RED, not inconclusive: "we could not check" must never render as "it is fine".\n`;
    process.stdout.write(report);
    await appendSummary(report);
    process.stderr.write(
      `::error title=Nightly E2E gate ${kind} failure::${message.split("\n")[0]}\n`
    );
    process.exitCode = 1;
    return;
  }

  const { settings, ...machine } = verdict;
  if (asJson) {
    process.stdout.write(`${JSON.stringify(machine, null, 2)}\n`);
    return;
  }

  const report = formatReport(machine, {
    branch: settings.branch,
    bypassLabel: settings.bypassLabel,
  });
  process.stdout.write(report);
  await appendSummary(report);
  await writeOutputs(machine);

  if (machine.verdict === "bypassed") {
    process.stderr.write(
      `::notice title=Nightly E2E gate BYPASSED (audited)::${machine.bypass.actor} waived ${machine.bypass.waived.length} red suite(s) under ticket ${machine.bypass.ticket}; the bypass expires ${machine.bypass.expiresAt}\n`
    );
  }
  if (machine.blocked) {
    for (const finding of machine.findings.filter(f => f.state !== "pass")) {
      process.stderr.write(
        `::error title=Nightly E2E is not green::${finding.label} — ${finding.state}${finding.conclusion ? ` (${finding.conclusion})` : ""} [${finding.reason}]${finding.url ? ` — ${finding.url}` : ""}\n`
      );
    }
    process.exitCode = 1;
  }
}

/**
 * Appends a report to the job summary when one exists.
 *
 * NEVER throws. The same report has already gone to stdout, and on the gate path
 * the verdict is additionally in the step outputs and the exit code, so an
 * unwritable `$GITHUB_STEP_SUMMARY` is a failure of one RENDERING SURFACE and
 * nothing more. Left to propagate it would reach top-level `main`, where on the
 * reporting path it would fail the job AND skip publishing — a summary file the
 * runner could not open taking down both channels at once, which is §10.4's
 * defect wearing different clothes. It is absorbed into a `::warning::` rather
 * than swallowed, because a summary that silently never appears is how an
 * operator learns to stop looking at it.
 *
 * @param {string} report - Markdown
 * @returns {Promise<void>} Resolves when written, or when it could not be
 */
async function appendSummary(report) {
  if (!process.env.GITHUB_STEP_SUMMARY) return;
  try {
    const { appendFileSync } = await import("node:fs");
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, report);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(
      `::warning title=Nightly E2E job summary unwritable::Could not append to \`$GITHUB_STEP_SUMMARY\` (${message.split("\n")[0]}). The same report is in this job's log.\n`
    );
  }
}

/**
 * Publishes the machine verdict as step outputs.
 *
 * @param {object} machine - The verdict
 * @returns {Promise<void>} Resolves when written
 */
async function writeOutputs(machine) {
  if (!process.env.GITHUB_OUTPUT) return;
  const { appendFileSync } = await import("node:fs");
  const audit = JSON.stringify(machine);
  appendFileSync(
    process.env.GITHUB_OUTPUT,
    `verdict=${machine.verdict}\nblocked=${machine.blocked}\naudit_json<<LISA_AUDIT_EOF\n${audit}\nLISA_AUDIT_EOF\n`
  );
}

if (invokedAsScript(import.meta.url)) {
  await main(process.argv.slice(2));
}
