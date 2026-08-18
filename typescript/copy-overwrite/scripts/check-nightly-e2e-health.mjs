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
 * `-issues` rows 27-31).
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
 * behind `apiWrite`, reachable only from `runReport`; the gate path cannot reach
 * them, and the gate's reusable workflow requests no `issues:` scope. An Issues
 * API that is down must never be able to redden a required check.
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
 * ## Inherited from three implementations, with one path closed
 *
 * `DECISIVE_CONCLUSIONS` comes from gemini's `check-nightly-e2e.mjs` and is kept
 * because it is the right vocabulary. What is NOT kept is gemini's
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
export const NIGHTLY_E2E_CONTRACT_VERSION = "1.4.0";

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

/** The label that identifies a tracking issue this reporter owns. */
export const TRACKING_ISSUE_LABEL = "nightly-e2e";

/** What the reporter may do about one suite (§10). */
export const ISSUE_ACTIONS = Object.freeze({
  create: "create",
  refresh: "refresh",
  close: "close",
  none: "none",
});

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
    const identity = `${entry.workflow} ${match.mode} ${match.name ?? match.pattern ?? ""}`;
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
      counts: Object.freeze({}),
      totalFlows: null,
    });
  }
  const filtered = [];
  const counts = {};
  for (const artifact of artifacts) {
    const name = typeof artifact?.name === "string" ? artifact.name : "";
    const scope = SCOPE_ARTIFACT_PATTERN.exec(name);
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
    filtered: Object.freeze(filtered.sort()),
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
  const base = { label: suite.label, workflow: suite.workflow };
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
      scopeUnverified:
        suite.min_flows === undefined &&
        (!scope.readable || scope.totalFlows === null),
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
// 4. Bypass — maintainers only, no self-bypass, reason required, auto-expiring
// ---------------------------------------------------------------------------

/**
 * Decides whether a bypass request is valid, as a pure function of the facts
 * the caller gathered.
 *
 * Every rejection carries a stable `reason` token so the audit says WHICH
 * condition failed. A bypass one person can both request and grant is not a
 * control, which is why `self_bypass` exists as its own rejection.
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
  if (prAuthor && labelEvent.actor.toLowerCase() === prAuthor.toLowerCase()) {
    return reject("self_bypass");
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
  self_bypass:
    "it was applied by the PR's own author. A bypass one person can both request and grant is not a control.",
  bypass_expired:
    "it was applied longer ago than `bypass_max_hours` allows. Bypasses auto-expire so a label nobody removes cannot become a permanent hole.",
  no_reason_or_ticket:
    "the PR body carries no `Nightly-E2E-Bypass: <TICKET> <reason>` line. A bypass without a reason and a ticket is not auditable.",
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
  wrong_branch: "the newest run is on a different branch.",
  stale_sha: "the newest run is for a different commit than the one required.",
  indecisive_conclusion:
    "the newest run reached no verdict about the code (cancelled / skipped / neutral). That is not a green — cancelling a run must never be a one-click way to clear a merge gate.",
  job_not_found:
    "the run completed without ever producing the job this gate reads. The job was renamed, which silently disarms the gate.",
  pattern_matched_nothing:
    "the job pattern matched zero jobs in the newest run. Zero matches is the signature of a renamed job.",
  [INCOMPLETE_EVIDENCE_REASON]:
    "the run reported `success`, but it did not run everything: at least one job was skipped, failed under `continue-on-error`, or could not be read. A run that skipped part of itself did not gather the evidence its green claims — a suite re-run for one platform only is not a verdict about the other one. Re-run the suite WITHOUT narrowing it.",
  [FILTERED_RUN_REASON]:
    'the run reported `success`, but it recorded itself as TAG-FILTERED — it ran a hand-picked slice of the suite, not the suite. A slice that passes says nothing about the flows it never started, so this is no result rather than a green. Re-run the suite with every tag / platform / shard picker left on its "all" default.',
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
      ? " — ⚠️ scope unverified: this run published no executed-flow count, so how much of the suite ran is unknown. If this suite publishes `maestro-<platform>-flowcount-<N>`, declare `min_flows` to make that a blocking question; if it does not (a browser suite, say), this line is the honest limit of what the gate can see"
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
 * Renders the full report.
 *
 * @param {object} verdict - Output of `decide`
 * @param {{branch: string, bypassLabel: string}} context - Report context
 * @returns {string} Markdown report
 */
export function formatReport(verdict, context) {
  const lines = ["## 🌙 Nightly E2E Health", ""];
  lines.push(...verdict.findings.map(finding => `- ${formatFinding(finding)}`));
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
      lines.push(
        `⛔ **A \`${context.bypassLabel}\` label is present but was REJECTED** — ${BYPASS_REJECTIONS[verdict.bypass.reason] ?? verdict.bypass.reason}`,
        ""
      );
    }
    lines.push(
      `Merges into \`${context.branch}\` are blocked until the nightly e2e suites are green again. To unblock:`,
      "  1. Fix the failure (open the run above — it names the failing spec or flow).",
      `  2. Re-run the suite from the Actions tab against \`${context.branch}\`, running the WHOLE suite. A \`workflow_dispatch\` run counts exactly like a scheduled one, so a green dispatch clears this gate immediately — no waiting for tomorrow. What does not count is a NARROWED re-run: leave any platform / tag / shard picker on its "all" default, because a run that skipped an arm says nothing about that arm.`,
      "  3. Re-run this check on your PR.",
      "",
      `If the failure is in the harness rather than the app — or this IS the PR that fixes the red nightly — a maintainer (not you) can apply the \`${context.bypassLabel}\` label after you add a \`Nightly-E2E-Bypass: <TICKET> <reason>\` line to the PR body. There is no admin-merge-past-red: the audited bypass is the only sanctioned path.`
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
    finding.reason !== SCOPE_UNREADABLE_REASON
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
 * The issue title for one suite.
 *
 * @param {object} finding - A finding
 * @returns {string} A title
 */
function issueTitle(finding) {
  return `🌙 Nightly e2e is not green: ${finding.label}`;
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
 * @param {{branch: string, now: Date}} context - Reporting context
 * @returns {string} Markdown
 */
function issueBody(finding, context) {
  const detail = REASON_TEXT[finding.reason] || "";
  const runLine = finding.url
    ? `[the run that reported it](${finding.url})`
    : "the Actions tab";
  return [
    suiteMarker(finding.label),
    evidenceMarker(finding),
    "",
    `## The \`${finding.label}\` end-to-end suite is not passing on \`${context.branch}\``,
    "",
    `**What this means.** Pull requests into \`${context.branch}\` are blocked until this suite is green again. That is deliberate: merging on top of a red suite is how a nightly ends up measuring days of accumulated damage instead of the change that broke it.`,
    "",
    "**What to do, in order.**",
    "",
    `1. Open ${runLine} and read what failed.`,
    "2. Fix it, or — if the failure is in the test harness rather than the product — say so in a comment here so the next person does not re-diagnose it.",
    `3. Re-run the **whole** suite against \`${context.branch}\`. Leave any platform / tag / shard picker on its \`all\` default: a run that skipped an arm says nothing about that arm, and will not clear the gate.`,
    "",
    "**You do not need to close this issue.** It closes itself the moment a full green run lands, and it is refreshed automatically every night it is still red. Closing it by hand while the suite is red just means tonight re-opens the question.",
    "",
    "<details><summary>Details</summary>",
    "",
    "| | |",
    "|---|---|",
    `| Suite | ${finding.label} |`,
    `| Workflow | \`${finding.workflow ?? "—"}\` |`,
    `| Branch | \`${context.branch}\` |`,
    `| Newest run | ${finding.conclusion ?? "—"}${finding.createdAt ? ` at ${finding.createdAt}` : ""}${finding.event ? ` via \`${finding.event}\`` : ""} |`,
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
 * @param {{branch: string, label: string, now: Date}} context - Reporting context
 * @returns {ReadonlyArray<object>} One plan entry per suite
 */
export function planIssueActions(findings, openIssues, context) {
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
      const base = {
        label: finding.label,
        state: finding.state,
        issues: numbers,
        title: null,
        body: null,
        comment: null,
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
            title: issueTitle(finding),
            body: issueBody(finding, context),
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
          action: ISSUE_ACTIONS.refresh,
          reason: "red_refreshed",
          title: issueTitle(finding),
          body: issueBody(finding, context),
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
        return {
          ...base,
          action: ISSUE_ACTIONS.close,
          reason: "green_complete",
          comment: `✅ Closing automatically: a complete green run landed for **${finding.label}** on \`${context.branch}\`.${finding.url ? `\n\n${finding.url}` : ""}`,
        };
      }

      return quiet("evidence_missing");
    })
  );
}

/**
 * Renders the reporting outcome for the job log and summary.
 *
 * @param {ReadonlyArray<object>} results - Output of `applyIssuePlan`
 * @param {{branch: string}} context - Reporting context
 * @returns {string} Markdown
 */
export function formatIssueReport(results, context) {
  const say = {
    create: "filed a tracking issue",
    refresh: "refreshed the open tracking issue",
    close: "closed the tracking issue — the suite is green again",
    none: "left the tracking state alone",
  };
  const lines = [
    "## 🌙 Nightly E2E tracking issues",
    "",
    `Branch: \`${context.branch}\``,
    "",
  ];
  for (const result of results) {
    const where = result.issues.length
      ? ` (#${result.issues.join(", #")})`
      : "";
    lines.push(
      result.ok
        ? `- ✅ **${result.label}** — ${say[result.action] ?? result.action}${where} [${result.reason}]`
        : `- ⚠️ **${result.label}** — could not ${result.action} its tracking issue${where}: ${result.error}`
    );
  }
  lines.push(
    "",
    "This job REPORTS; it does not gate. Nothing here can block a pull request — the merge gate is a separate workflow that never writes.",
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
          accept: "application/vnd.github+json",
          authorization: `Bearer ${api.token}`,
          "x-github-api-version": "2022-11-28",
          "user-agent": "lisa-nightly-e2e-health",
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
 * Newest completed run of one workflow on one branch for one event.
 *
 * @param {object} api - API coordinates
 * @param {string} file - Workflow file name
 * @param {string} branch - Branch to read
 * @param {string} event - Run event
 * @param {(ms: number) => Promise<void>} [wait] - Injectable sleep
 * @returns {Promise<{run: object|null, missing: boolean}>} The newest run, or a 404 marker
 */
export async function fetchNewestRun(api, file, branch, event, wait) {
  const query = new URLSearchParams({
    branch,
    status: "completed",
    event,
    per_page: "1",
  });
  const result = await apiGet(
    api,
    `/repos/${api.repo}/actions/workflows/${encodeURIComponent(file)}/runs?${query}`,
    wait
  );
  if (result === null) return { run: null, missing: true };
  return { run: result.body.workflow_runs?.[0] ?? null, missing: false };
}

/**
 * Every job of a run, paginated to exhaustion.
 *
 * Exhaustive on purpose: a matrix suite routinely exceeds one page, and a
 * truncated job list turns "the failing shard is on page 2" into a false green.
 * Hitting the page cap while still unread is raised rather than silently
 * truncated.
 *
 * @param {object} api - API coordinates
 * @param {number|string} runId - The run
 * @param {(ms: number) => Promise<void>} [wait] - Injectable sleep
 * @returns {Promise<ReadonlyArray<object>>} All jobs
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
    // what was read; falling through to the page-cap throw below would blame a
    // pagination limit that had nothing to do with it AND discard every job
    // already collected.
    if (result === null) return Object.freeze(jobs);
    const batch = result.body.jobs ?? [];
    jobs.push(...batch);
    if (batch.length < 100) return Object.freeze(jobs);
  }
  throw new GateApiError(
    `Run ${runId} reports more jobs than \`api_max_pages\` (${api.maxPages}) allows this gate to read. A truncated job list can hide the failing shard, so this is RED rather than a partial read.`
  );
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
 * Observes every suite.
 *
 * @param {object} api - API coordinates
 * @param {ReadonlyArray<object>} suites - Validated suites
 * @param {string} branch - Branch to read
 * @param {(ms: number) => Promise<void>} [wait] - Injectable sleep
 * @returns {Promise<ReadonlyArray<object>>} One observation per suite
 */
export async function observe(api, suites, branch, wait) {
  return await Promise.all(
    suites.map(async suite => {
      const perEvent = await Promise.all(
        COUNTED_EVENTS.map(event =>
          fetchNewestRun(api, suite.workflow, branch, event, wait)
        )
      );
      if (perEvent.every(result => result.missing)) {
        return { workflowMissing: true, run: null, jobs: [] };
      }
      // Newest by created_at, so a fresh dispatch supersedes an older failed
      // schedule. ISO-8601 UTC compares correctly as strings.
      const run = perEvent
        .map(result => result.run)
        .filter(
          candidate => candidate && typeof candidate.created_at === "string"
        )
        .reduce(
          (newest, candidate) =>
            newest === null || candidate.created_at > newest.created_at
              ? candidate
              : newest,
          null
        );
      // Jobs are read for EVERY match mode, `run` included. A run-scoped suite
      // needs them to prove the run was complete (row 26) — a `success` run
      // that skipped half its jobs is not evidence about the half it skipped.
      if (!run) {
        return { workflowMissing: false, run, jobs: [] };
      }
      // Artifacts are read for every suite, not only the ones declaring
      // `min_flows`: a run that recorded ITSELF as filtered disqualifies with no
      // declaration at all (row 36), and a gate that only looked when asked to
      // would miss exactly the repos that have not adopted the field yet.
      const [jobs, artifacts] = await Promise.all([
        fetchAllJobs(api, run.id, wait),
        fetchRunArtifacts(api, run.id, wait),
      ]);
      return {
        workflowMissing: false,
        run,
        jobs,
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
          accept: "application/vnd.github+json",
          authorization: `Bearer ${api.token}`,
          "content-type": "application/json",
          "x-github-api-version": "2022-11-28",
          "user-agent": "lisa-nightly-e2e-health",
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
        results.push({ ...base, ok: true, error: null });
        continue;
      }
      if (entry.action === ISSUE_ACTIONS.close) {
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
        results.push({ ...base, ok: true, error: null });
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
    },
    issueLabel: env.NIGHTLY_ISSUE_LABEL || TRACKING_ISSUE_LABEL,
    branch,
    suites: validateSuites(env.NIGHTLY_SUITES),
    freshnessHours: limits.freshnessHours,
    bootstrapUntil: env.NIGHTLY_BOOTSTRAP_UNTIL || "",
    bootstrapMaxDays: limits.bootstrapMaxDays,
    bypassLabel: env.NIGHTLY_BYPASS_LABEL || "nightly-e2e-bypass",
    bypassMaxHours: limits.bypassMaxHours,
    // An ADDITIONAL project rule, never a replacement — see `evaluateBypass`.
    extraBypassReasonPattern: env.NIGHTLY_BYPASS_REASON_PATTERN || "",
    clamped,
    pr: {
      number: Number(env.NIGHTLY_PR_NUMBER) || null,
      author: env.NIGHTLY_PR_AUTHOR || null,
      body: env.NIGHTLY_PR_BODY || "",
      labels: (() => {
        try {
          const parsed = JSON.parse(env.NIGHTLY_PR_LABELS || "[]");
          return Array.isArray(parsed) ? parsed.map(String) : [];
        } catch {
          return [];
        }
      })(),
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

  let bypass = null;
  if (settings.pr.number && settings.pr.labels.includes(settings.bypassLabel)) {
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
      prAuthor: settings.pr.author,
      prBody: settings.pr.body,
      actorPermission,
      prNumber: settings.pr.number,
      label: settings.bypassLabel,
      maxHours: settings.bypassMaxHours,
      extraReasonPattern: settings.extraBypassReasonPattern,
      now,
    });
  }

  return {
    ...decide(findings, { bootstrap, bypass }),
    clamped: settings.clamped,
    settings,
  };
}

/**
 * Runs the REPORTING half: files, refreshes and closes the tracking issues.
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
 * @param {NodeJS.ProcessEnv} env - The environment
 * @param {(ms: number) => Promise<void>} [wait] - Injectable sleep
 * @returns {Promise<object>} Findings, plan and per-suite results
 */
export async function runReport(env, wait) {
  const settings = resolveSettings(env);
  const now = new Date();
  const observations = await observe(
    settings.api,
    settings.suites,
    settings.branch,
    wait
  );
  const findings = settings.suites.map((suite, index) =>
    assessSuite(suite, observations[index], {
      branch: settings.branch,
      freshnessHours: settings.freshnessHours,
      now,
    })
  );
  const plan = planIssueActions(
    findings,
    await fetchTrackingIssues(settings.api, settings.issueLabel, wait),
    { branch: settings.branch, label: settings.issueLabel, now }
  );
  return {
    findings,
    plan,
    results: await applyIssuePlan(settings.api, plan, wait),
    settings,
  };
}

/**
 * The reporting entry point, as the scheduled workflow invokes it.
 *
 * Its exit code answers "did REPORTING work", never "is the suite green". A red
 * nightly reported correctly is a SUCCESSFUL report — conflating the two would
 * hand operators a second red check that means something different from the
 * first one.
 *
 * @param {boolean} asJson - Emit the machine record instead of prose
 * @returns {Promise<void>} Resolves once the report is written
 */
async function reportIssues(asJson) {
  let outcome;
  try {
    outcome = await runReport(process.env);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(
      `::error title=Nightly E2E reporting failed::${message.split("\n")[0]}\n`
    );
    process.stdout.write(`${message}\n`);
    process.exitCode = 1;
    return;
  }
  const { settings, ...machine } = outcome;
  if (asJson) {
    process.stdout.write(`${JSON.stringify(machine, null, 2)}\n`);
  } else {
    const report = formatIssueReport(machine.results, {
      branch: settings.branch,
    });
    process.stdout.write(report);
    await appendSummary(report);
  }
  const failed = machine.results.filter(result => !result.ok);
  for (const result of failed) {
    process.stderr.write(
      `::error title=Nightly E2E tracking issue not updated::${result.label} — ${result.error}\n`
    );
  }
  if (failed.length > 0) process.exitCode = 1;
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
 * @param {string} report - Markdown
 * @returns {Promise<void>} Resolves when written
 */
async function appendSummary(report) {
  if (!process.env.GITHUB_STEP_SUMMARY) return;
  const { appendFileSync } = await import("node:fs");
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, report);
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
