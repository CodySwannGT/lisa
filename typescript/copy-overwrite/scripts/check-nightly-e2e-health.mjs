#!/usr/bin/env node
/**
 * check-nightly-e2e-health — the fail-closed nightly e2e merge gate.
 *
 * Shipped by Lisa (copy-overwrite). The reusable workflow that drives it is
 * `CodySwannGT/lisa/.github/workflows/nightly-e2e-health.yml`; the contract both
 * halves implement is `docs/nightly-e2e-gate.md` in Lisa, whose §2 truth table
 * is proven row-by-row by `tests/unit/scripts/nightly-e2e-health*.test.ts`
 * (rows 1-16, `-api` rows 17-20, `-bypass` rows 21-25).
 *
 * Usage:
 *   node scripts/check-nightly-e2e-health.mjs          # human report, exit 1 when blocked
 *   node scripts/check-nightly-e2e-health.mjs --json   # machine report, always exit 0
 *   node scripts/check-nightly-e2e-health.mjs --contract-version
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
 * discipline come from tunnl (TUN-525 / TUN-402). The job-name filter comes from
 * propswap's `nightly-e2e-lib.sh`, whose unbounded bootstrap is what §4 of the
 * contract time-boxes.
 *
 * @module scripts/check-nightly-e2e-health
 */

import { pathToFileURL } from "node:url";

/**
 * Contract version of the gate, asserted by the reusable workflow against its
 * own expectation. The workflow travels by git ref and this script travels by
 * `lisa apply`, so the two halves WILL drift; a MAJOR mismatch fails closed
 * rather than running a contract neither half agrees on. See §8 of
 * `docs/nightly-e2e-gate.md` for what counts as major / minor / patch.
 */
export const NIGHTLY_E2E_CONTRACT_VERSION = "1.0.0";

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

/** Hard ceiling on a bypass's lifetime, whatever the caller asks for. */
export const BYPASS_ABSOLUTE_MAX_HOURS = 72;

/** Repository permissions that may grant a bypass. Maintainers only. */
export const BYPASS_PERMISSIONS = Object.freeze(new Set(["admin", "maintain"]));

/**
 * Default reason line the PR body must carry for a bypass to be valid.
 *
 * A reason AND a tracker reference, in the artefact reviewers already read.
 * Multiline so it can match one line of a body; not global, so `.exec` has no
 * sticky `lastIndex` to alternate on.
 */
export const DEFAULT_BYPASS_REASON_PATTERN =
  "^Nightly-E2E-Bypass:\\s*(?<ticket>[A-Z][A-Z0-9]+-\\d+|#\\d+)\\s+(?<reason>\\S.*)$";

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
  new Set(["label", "workflow", "match", "freshness_hours", "required_sha"])
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
      void new RegExp(pattern);
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
        hours > 720
      ) {
        throw new GateConfigError(
          `${where}: \`freshness_hours\` must be a number in (0, 720].`
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

  if (suite.match.mode === "run") {
    const state = stateForConclusion(run.conclusion);
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

  const jobs = observation.jobs ?? [];
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
    return {
      ...base,
      ...seen,
      conclusion: GREEN_CONCLUSION,
      state: SUITE_STATES.pass,
      reason: "job_conclusion",
    };
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
      `\`bootstrap_until\` (${until}) is ${Math.ceil(days)} days out, beyond \`bootstrap_max_days\` (${maxDays}). A bootstrap window that can be extended by editing one string is propswap's forever-bootstrap: a suite that never runs passes forever. Raise the cap deliberately, in the same review, or bring the date in.`
    );
  }
  return Object.freeze({
    active: parsed > now.getTime(),
    until: new Date(parsed).toISOString(),
    expiresInDays: Math.max(0, Math.ceil(days)),
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
 * @param {object} request - `{ label, labelEvent, prAuthor, prBody, actorPermission, maxHours, reasonPattern, now }`
 * @returns {{valid: boolean, reason: string, actor: string|null, appliedAt: string|null, expiresAt: string|null, ticket: string|null, detail: string|null}} The decision
 */
export function evaluateBypass(request) {
  const {
    labelEvent,
    prAuthor,
    prBody,
    actorPermission,
    maxHours,
    reasonPattern,
    now,
  } = request;

  const reject = (reason, extra = {}) =>
    Object.freeze({
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

  let matcher;
  try {
    matcher = new RegExp(reasonPattern, "m");
  } catch (error) {
    throw new GateConfigError(
      `\`bypass_reason_pattern\` does not compile: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  const found = matcher.exec(prBody ?? "");
  if (!found) {
    return reject("no_reason_or_ticket", {
      expiresAt: new Date(expiresMs).toISOString(),
    });
  }

  return Object.freeze({
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
 * @param {ReadonlyArray<object>} findings - Per-suite findings
 * @param {{bootstrap: object, bypass: object|null}} options - Window and bypass decision
 * @returns {{verdict: string, blocked: boolean, findings: ReadonlyArray<object>, bootstrap: object, bypass: object|null}} The verdict
 */
export function decide(findings, { bootstrap, bypass = null }) {
  const rendered = findings.map(finding =>
    finding.state === SUITE_STATES.unknown && bootstrap.active
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
    return `${marker} ${finding.label} — green${when}${link}`;
  }
  const verdictWord =
    finding.state === "bootstrap"
      ? "not yet blocking"
      : finding.state.toUpperCase();
  const conclusion = finding.conclusion ? ` [${finding.conclusion}]` : "";
  return `${marker} ${finding.label} — ${verdictWord}${conclusion}${when} — ${detail}${link}`;
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

  if (verdict.bootstrap.active) {
    lines.push(
      `⏳ **Bootstrap window active — expires ${verdict.bootstrap.until} (${verdict.bootstrap.expiresInDays} day(s) from now).** Missing evidence is reported but not blocking until then. Evidence of FAILURE still blocks, inside the window as well as outside it. When the window lapses, every ⚠️ above becomes a ❌ with no further action.`,
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
      "The nightly is still red. This waives the gate for THIS pull request only; the tracking issue stays open until a green run lands."
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
      `  2. Re-run the suite from the Actions tab against \`${context.branch}\`. A \`workflow_dispatch\` run counts exactly like a scheduled one, so a green dispatch clears this gate immediately — no waiting for tomorrow.`,
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
  const remaining = response.headers?.get?.("x-ratelimit-remaining");
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
    const remaining = response.headers?.get?.("x-ratelimit-remaining");
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
    if (result === null) break;
    const batch = result.body.jobs ?? [];
    jobs.push(...batch);
    if (batch.length < 100) return Object.freeze(jobs);
  }
  throw new GateApiError(
    `Run ${runId} reports more jobs than \`api_max_pages\` (${api.maxPages}) allows this gate to read. A truncated job list can hide the failing shard, so this is RED rather than a partial read.`
  );
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
      if (!run || suite.match.mode === "run") {
        return { workflowMissing: false, run, jobs: [] };
      }
      return {
        workflowMissing: false,
        run,
        jobs: await fetchAllJobs(api, run.id, wait),
      };
    })
  );
}

/**
 * Reads who most recently applied the bypass label, from the PR timeline.
 *
 * @param {object} api - API coordinates
 * @param {number} prNumber - Pull request number
 * @param {string} label - The bypass label
 * @param {(ms: number) => Promise<void>} [wait] - Injectable sleep
 * @returns {Promise<{actor: string, createdAt: string}|null>} The labelling event
 */
export async function fetchLabelEvent(api, prNumber, label, wait) {
  const result = await apiGet(
    api,
    `/repos/${api.repo}/issues/${prNumber}/events?per_page=100`,
    wait
  ).catch(() => null);
  if (result === null) return null;
  const events = (result.body ?? []).filter(
    event => event.event === "labeled" && event.label?.name === label
  );
  const newest = events.reduce(
    (best, event) =>
      best === null || event.created_at > best.created_at ? event : best,
    null
  );
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

  return {
    api: {
      apiUrl: env.GITHUB_API_URL || "https://api.github.com",
      repo: env.GITHUB_REPOSITORY,
      token,
      maxAttempts: number("NIGHTLY_API_MAX_ATTEMPTS", 3),
      maxPages: number("NIGHTLY_API_MAX_PAGES", 5),
      retryMaxSeconds: number("NIGHTLY_API_RETRY_MAX_SECONDS", 60),
    },
    branch,
    suites: validateSuites(env.NIGHTLY_SUITES),
    freshnessHours: number("NIGHTLY_FRESHNESS_HOURS", 36),
    bootstrapUntil: env.NIGHTLY_BOOTSTRAP_UNTIL || "",
    bootstrapMaxDays: number("NIGHTLY_BOOTSTRAP_MAX_DAYS", 30),
    bypassLabel: env.NIGHTLY_BYPASS_LABEL || "nightly-e2e-bypass",
    bypassMaxHours: number("NIGHTLY_BYPASS_MAX_HOURS", 24),
    bypassReasonPattern:
      env.NIGHTLY_BYPASS_REASON_PATTERN || DEFAULT_BYPASS_REASON_PATTERN,
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
  const findings = settings.suites.map((suite, index) =>
    assessSuite(suite, observations[index], {
      branch: settings.branch,
      freshnessHours: settings.freshnessHours,
      now,
    })
  );

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
      maxHours: settings.bypassMaxHours,
      reasonPattern: settings.bypassReasonPattern,
      now,
    });
  }

  return { ...decide(findings, { bootstrap, bypass }), settings };
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

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main(process.argv.slice(2));
}
