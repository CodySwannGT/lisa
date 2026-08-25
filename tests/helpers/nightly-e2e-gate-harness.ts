/**
 * Shared harness for the nightly e2e gate's truth-table suites.
 *
 * The gate is a `.mjs` guard shipped by copy-overwrite, so it has no type
 * declarations; the `GateModule` interface below is the typed view the suites
 * consume, and `loadGateModule` is the single place the dynamic import lives.
 * Keeping the run/job fixtures here as well means two suites cannot drift into
 * disagreeing about what "a fresh green run" looks like — which would make a
 * difference in outcome a difference in fixture rather than in behaviour.
 *
 * Specification: `docs/nightly-e2e-gate.md` §2.
 * @module tests/helpers/nightly-e2e-gate-harness
 */
import * as path from "node:path";
import { pathToFileURL } from "node:url";

import type {
  IssuePlanEntry,
  IssueResult,
  ReportingModule,
} from "./nightly-e2e-reporting-harness";

export {
  GATE_CONTEXT,
  ISSUE_ACTION,
  ISSUE_REASON,
  LABEL_STATE,
  REQUIRED_STATE,
  requiredChecksRule,
} from "./nightly-e2e-reporting-harness";
export type {
  BypassLabelState,
  IssuePlanEntry,
  IssueResult,
  Requiredness,
  RulesetSource,
  TrackedIssue,
} from "./nightly-e2e-reporting-harness";

/** Repository root, from this file's location. */
const REPO_ROOT = path.resolve(__dirname, "..", "..");

/** Repo-relative path of the guard under test. */
export const GUARD_REL =
  "typescript/copy-overwrite/scripts/check-nightly-e2e-health.mjs";

/** A minimal Actions run as the gate reads it. */
export interface Run {
  readonly id?: number;
  readonly conclusion?: string | null;
  readonly created_at?: string;
  readonly html_url?: string;
  readonly event?: string;
  readonly head_branch?: string;
  readonly head_sha?: string;
}

/** A minimal Actions job as the gate reads it. */
export interface Job {
  readonly name: string;
  readonly conclusion: string | null;
  readonly html_url?: string;
}

/** The resolved bootstrap window. */
export interface Bootstrap {
  readonly active: boolean;
  readonly until: string | null;
  readonly expiresInDays: number | null;
}

/**
 * One suite's resolved first-seen grace window (rows 32-35).
 *
 * Same shape as `Bootstrap` plus the anchor it was computed from, because the
 * anchor is what makes the window bounded and the audit has to show it.
 */
export interface SuiteGrace extends Bootstrap {
  readonly firstSeen: string | null;
}

/** One suite's finding. */
export interface Finding {
  readonly label: string;
  readonly state: string;
  readonly reason: string;
  readonly conclusion: string | null;
  readonly url: string | null;
  /** Present only for a suite that declared `first_seen`. */
  readonly grace?: SuiteGrace;
  /** Present only for a suite that declared `"gated": false` (§10.7). */
  readonly gated?: boolean;
  /** Rows 36-38: the measured numbers behind a scope disqualification. */
  readonly scopeDetail?: string;
  /** Rows 36-38: a green whose scope this gate could not check. */
  readonly scopeUnverified?: boolean;
  /** Rows 36-38: the executed-flow count read, when one was published. */
  readonly observedFlows?: number | null;
}

/** What a run recorded about its own scope, from its artifact names. */
export interface SuiteScope {
  readonly readable: boolean;
  readonly filtered: readonly string[];
  readonly full: readonly string[];
  readonly counts: Readonly<Record<string, number>>;
  readonly totalFlows: number | null;
}

/** The bypass decision. */
export interface BypassDecision {
  readonly valid: boolean;
  readonly reason: string;
  readonly actor: string | null;
  readonly ticket: string | null;
  readonly detail: string | null;
  readonly expiresAt: string | null;
  readonly waived?: readonly Finding[];
}

/** The whole verdict. */
export interface Verdict {
  readonly verdict: string;
  readonly blocked: boolean;
  readonly findings: readonly Finding[];
  readonly bootstrap: Bootstrap;
  readonly bypass: BypassDecision | null;
}

/** What the guard exports, as these suites consume it. */
export interface GateModule extends ReportingModule {
  readonly DECISIVE_CONCLUSIONS: ReadonlySet<string>;
  readonly BYPASS_ABSOLUTE_MAX_HOURS: number;
  readonly REQUIRED_BYPASS_REASON_PATTERN: string;
  readonly BOOTSTRAP_ABSOLUTE_MAX_DAYS: number;
  readonly DEFAULT_SUITE_GRACE_DAYS: number;
  readonly ABSOLUTE_MAX_FRESHNESS_HOURS: number;
  readonly ABSOLUTE_MAX_API_ATTEMPTS: number;
  readonly ABSOLUTE_MAX_API_PAGES: number;
  readonly ABSOLUTE_MAX_RETRY_SECONDS: number;
  readonly BYPASS_PERMISSIONS: ReadonlySet<string>;
  resolveSecurityLimits(requested: Record<string, number>): {
    limits: Record<string, number>;
    clamped: readonly string[];
  };
  readonly NIGHTLY_E2E_CONTRACT_VERSION: string;
  assessSuite(
    suite: Record<string, unknown>,
    observation: Record<string, unknown>,
    context: { branch: string; freshnessHours: number; now: Date }
  ): Finding;
  validateSuites(raw: string | undefined): readonly unknown[];
  resolveBootstrap(until: string, maxDays: number, now: Date): Bootstrap;
  resolveSuiteGrace(
    suite: Record<string, unknown>,
    maxDays: number,
    now: Date
  ): SuiteGrace;
  evaluateBypass(request: Record<string, unknown>): BypassDecision;
  decide(
    findings: readonly Finding[],
    options: { bootstrap: Bootstrap; bypass?: BypassDecision | null }
  ): Verdict;
  formatReport(
    verdict: Verdict,
    context: { branch: string; bypassLabel: string }
  ): string;
  apiGet(
    api: Record<string, unknown>,
    apiPath: string,
    wait?: () => Promise<void>
  ): Promise<{ body: Record<string, unknown> } | null>;
  fetchAllJobs(
    api: Record<string, unknown>,
    runId: number,
    wait?: () => Promise<void>
  ): Promise<readonly Job[]>;
  observe(
    api: Record<string, unknown>,
    suites: readonly Record<string, unknown>[],
    branch: string,
    wait?: () => Promise<void>
  ): Promise<
    readonly {
      workflowMissing: boolean;
      run: Run | null;
      jobs: readonly Job[];
    }[]
  >;
  retryDelayMs(
    response: { headers: { get(name: string): string | null } | null },
    attempt: number,
    maxSeconds: number
  ): number;
  resolveSettings(env: Record<string, string | undefined>): unknown;
  readonly TRACKING_ISSUE_LABEL: string;
  readonly INCOMPLETE_EVIDENCE_REASON: string;
  readonly FILTERED_RUN_REASON: string;
  readonly FLOW_SHORTFALL_REASON: string;
  readonly SCOPE_UNREADABLE_REASON: string;
  readonly ZERO_FLOWS_REASON: string;
  readSuiteScope(artifacts: readonly { name?: string }[] | null): SuiteScope;
  assessSuiteScope(
    suite: Record<string, unknown>,
    scope: SuiteScope
  ): { reason: string; detail: string } | null;
  fetchRunArtifacts(
    api: Record<string, unknown>,
    runId: number,
    wait?: () => Promise<void>
  ): Promise<readonly { name?: string }[] | null>;
  formatFinding(finding: Finding): string;
  suiteMarker(label: string): string;
  isCompleteEvidence(finding: { readonly reason: string }): boolean;
  planIssueActions(
    findings: readonly Finding[],
    openIssues: readonly TrackedIssue[],
    context: { branch: string; label: string; now: Date }
  ): readonly IssuePlanEntry[];
  applyIssuePlan(
    api: Record<string, unknown>,
    plan: readonly IssuePlanEntry[],
    wait?: () => Promise<void>
  ): Promise<readonly IssueResult[]>;
  fetchTrackingIssues(
    api: Record<string, unknown>,
    label: string,
    wait?: () => Promise<void>
  ): Promise<readonly TrackedIssue[]>;
  runGate(
    env: Record<string, string | undefined>,
    wait?: () => Promise<void>
  ): Promise<Verdict>;
  fetchLabelEvent(
    api: Record<string, unknown>,
    prNumber: number,
    label: string,
    wait?: () => Promise<void>
  ): Promise<{ actor: string; createdAt: string } | null>;
  /** Row 40: the LIVE pull-request read the bypass decides on. */
  fetchPullRequestState(
    api: Record<string, unknown>,
    prNumber: number,
    wait?: () => Promise<void>
  ): Promise<{
    labels: readonly string[];
    body: string;
    author: string | null;
  } | null>;
  /** Row 40: the emitted decision when that read fails. */
  unreadablePullRequestBypass(subject: {
    prNumber?: number | null;
    label?: string | null;
    prAuthor?: string | null;
  }): BypassDecision;
}

/** The instant every suite evaluates at, so freshness maths is deterministic. */
export const NOW = new Date("2026-08-12T12:00:00Z");

/** Inside the default 36h freshness window. */
export const FRESH = "2026-08-12T06:00:00Z";

/** Outside it. */
export const STALE = "2026-08-09T06:00:00Z";

/** The branch under gate. */
export const BRANCH = "dev";

/** Stable reason tokens, named so the suites assert the truth-table ROW. */
export const REASON = Object.freeze({
  runConclusion: "run_conclusion",
  jobConclusion: "job_conclusion",
  indecisive: "indecisive_conclusion",
  noRun: "no_run",
  staleRun: "stale_run",
  incompleteRun: "incomplete_run",
  filteredRun: "filtered_run",
  flowShortfall: "flow_shortfall",
  scopeUnreadable: "scope_unreadable",
  zeroFlows: "zero_flows",
});

/**
 * A job every `mode: "run"` fixture carries unless it is testing completeness.
 *
 * A completed run always has at least one job, and since row 26 a run-scoped
 * suite reads them: the run's own `success` is only evidence when every job
 * behind it succeeded. A fixture with no jobs is therefore not "a green run
 * with the job list omitted for brevity" — it is row 26's unreadable-job-list
 * case, which is exactly why it lives here rather than being defaulted away
 * inside each suite.
 */
export const GREEN_JOB: Job = Object.freeze({
  name: "🧪 e2e",
  conclusion: "success",
});

/** Suite states. */
export const STATE = Object.freeze({
  pass: "pass",
  fail: "fail",
  unknown: "unknown",
});

/**
 * Loads the guard.
 *
 * @returns The guard's exports, typed
 */
export async function loadGateModule(): Promise<GateModule> {
  return (await import(
    pathToFileURL(path.join(REPO_ROOT, GUARD_REL)).href
  )) as unknown as GateModule;
}

/**
 * A run that would pass every check except what the caller overrides.
 *
 * @param conclusion - The run's conclusion
 * @param extra - Field overrides
 * @returns A run
 */
export function runWith(
  conclusion: string | null,
  extra: Partial<Run> = {}
): Run {
  return {
    id: 1,
    conclusion,
    created_at: FRESH,
    html_url: "https://example.test/run/1",
    event: "schedule",
    head_branch: BRANCH,
    head_sha: "a".repeat(40),
    ...extra,
  };
}

/** A finding shaped like a red suite, for verdict-assembly cases. */
export const RED_FINDING: Finding = Object.freeze({
  label: "s",
  state: STATE.fail,
  reason: REASON.runConclusion,
  conclusion: "failure",
  url: "u",
});

/** A finding shaped like a suite with no readable evidence. */
export const MISSING_FINDING: Finding = Object.freeze({
  label: "s",
  state: STATE.unknown,
  reason: REASON.noRun,
  conclusion: null,
  url: null,
});

/** A finding shaped like a green suite. */
export const GREEN_FINDING: Finding = Object.freeze({
  label: "s",
  state: STATE.pass,
  reason: REASON.runConclusion,
  conclusion: "success",
  url: "u",
});

/** API coordinates with a tiny retry budget, so suites stay instant. */
export const TEST_API = Object.freeze({
  apiUrl: "https://api.test",
  repo: "o/r",
  token: "t",
  maxAttempts: 3,
  maxPages: 5,
  retryMaxSeconds: 1,
});

/**
 * A no-op sleeper, so a retry path costs no wall-clock time.
 *
 * @returns A promise that resolves immediately
 */
export const noWait = async (): Promise<void> => undefined;

/**
 * A fake `Response`.
 *
 * @param status - HTTP status
 * @param headers - Response headers, lowercase keys
 * @param body - JSON body
 * @returns A minimal Response-shaped object
 */
export function fakeResponse(
  status: number,
  headers: Record<string, string> = {},
  body: unknown = {}
): unknown {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    json: async () => body,
  };
}
