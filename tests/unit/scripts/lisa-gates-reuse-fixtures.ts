/**
 * Fixtures for the release evidence-reuse verifier (CodySwannGT/lisa#3013).
 *
 * ONE golden envelope, and every test corrupts exactly ONE dimension of it. The
 * one-at-a-time discipline is the point: a verifier whose failures
 * cross-contaminate cannot be reasoned about a dimension at a time, so every
 * corruption test asserts both that the expected gate reruns AND that no other
 * gate's decision moved.
 *
 * The gate set is chosen to put one gate in each reuse class plus the awkward
 * cases: a plain deterministic gate, a deterministic gate that declares a work
 * count, a deterministic DIFF gate (bound to the commit as well as the tree), a
 * time-sensitive gate, and a never-reusable one.
 * @module tests/unit/scripts/lisa-gates-reuse-fixtures
 */

/** The moment every fixture is about. */
export const MOMENT = "pull-request";

/** The level every fixture declares. */
export const REQUIRED = "required";

/** Decisions, as constants so a duplicated literal cannot drift. */
export const RUN = "run";
/** @see RUN */
export const REUSE = "reuse";

/** Gate ids the fixtures name repeatedly. */
export const CODE_STYLE = "code-style";
/** @see CODE_STYLE */
export const DEP_VULN = "dependency-vulnerability";
/** @see CODE_STYLE */
export const STATIC_SECURITY = "static-security";
/** @see CODE_STYLE */
export const BEHAVIOR_CONTRACT = "behavior-contract";
/** @see CODE_STYLE */
export const TEST_CORRECTNESS = "test-correctness";

/** Refusal tokens, mirrored from `REUSE_REASON` so a test names the string. */
export const VERIFIED = "verified";
/** @see VERIFIED */
export const MALFORMED = "malformed";
/** @see VERIFIED */
export const UNAVAILABLE = "unavailable";
/** @see VERIFIED */
export const NOT_PROVED = "not-proved";
/** @see VERIFIED */
export const SUBJECT_MISMATCH = "subject-mismatch";
/** @see VERIFIED */
export const CONTRACT_MISMATCH = "contract-mismatch";
/** @see VERIFIED */
export const DERIVATIVE = "derivative";
/** @see VERIFIED */
export const UNATTRIBUTABLE = "unattributable";
/** @see VERIFIED */
export const UNCOVERED = "uncovered";
/** @see VERIFIED */
export const LEVEL_DOWNGRADE = "level-downgrade";
/** @see VERIFIED */
export const STALE = "stale";
/** @see VERIFIED */
export const NEVER_REUSABLE = "never-reusable";

/** The tree the release is about, and the tree the golden envelope proves. */
export const TREE = "a".repeat(40);

/** The commit that produced that tree. */
export const COMMIT = "b".repeat(40);

/** The repository both sides name. */
export const REPOSITORY = "acme/widget";

/** A stable clock, so freshness assertions never depend on wall time. */
export const NOW_MS = Date.parse("2026-08-25T12:00:00.000Z");

/** The gates block every fixture resolves against. */
export const GATES = Object.freeze({
  // deterministic, diff-bound, declares work
  [BEHAVIOR_CONTRACT]: { [MOMENT]: REQUIRED },
  // deterministic, no work count
  [CODE_STYLE]: { [MOMENT]: REQUIRED },
  // time-sensitive, declares work
  [DEP_VULN]: { [MOMENT]: REQUIRED },
  // never reusable, however perfect its row
  [STATIC_SECURITY]: { [MOMENT]: REQUIRED },
  // deterministic, declares work
  [TEST_CORRECTNESS]: { [MOMENT]: REQUIRED },
});

/** Every gate id the fixtures resolve, in the order `resolveMoment` returns. */
export const GATE_IDS = Object.freeze([
  CODE_STYLE,
  BEHAVIOR_CONTRACT,
  DEP_VULN,
  STATIC_SECURITY,
  TEST_CORRECTNESS,
]);

/** The gates that reuse in the golden run. */
export const REUSABLE_IDS = Object.freeze([
  CODE_STYLE,
  BEHAVIOR_CONTRACT,
  DEP_VULN,
  TEST_CORRECTNESS,
]);

/** What the release run observes about itself. */
export const OBSERVED = Object.freeze({
  commit: COMMIT,
  gatesDigest: "sha256:deadbeef",
  inputsDigest: "sha256:cafebabe",
  registryVersion: "4.9.0",
  repository: REPOSITORY,
  tree: TREE,
  workflowRef: "acme/widget/.github/workflows/quality.yml@refs/heads/main",
  workflowSha: "c".repeat(40),
});

/**
 * One evidence row.
 * @param {string} gate Gate id.
 * @param {object} [overrides] Field overrides.
 * @returns {object} The row.
 */
function row(
  gate: string,
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    gate,
    label: gate,
    level: REQUIRED,
    max_age_minutes: null,
    measures: { exit_code: 0, state: "passed" },
    observed_at: new Date(NOW_MS - 5 * 60_000).toISOString(),
    prover: { tool: `npm run ${gate}`, version: "1.2.3" },
    status: "pass",
    work: 12,
    ...overrides,
  };
}

/**
 * A known-good envelope that reuses everything reusable.
 *
 * Deep-cloned on every call so a test that mutates one cannot reach another —
 * shared mutable fixtures are how a one-at-a-time suite silently stops being
 * one.
 * @returns {object} The golden envelope.
 */
export function goldenEnvelope(): Record<string, unknown> {
  return {
    contract: {
      gates_digest: OBSERVED.gatesDigest,
      inputs_digest: OBSERVED.inputsDigest,
      moment: MOMENT,
      registry_version: OBSERVED.registryVersion,
      runner: "npm run",
      workflow_ref: OBSERVED.workflowRef,
      workflow_sha: OBSERVED.workflowSha,
    },
    gates: GATE_IDS.map(gate => row(gate)),
    observed_at: new Date(NOW_MS - 5 * 60_000).toISOString(),
    producer: {
      actor: "someone",
      caller_chain: ["🔍 Quality Checks"],
      event: "pull_request",
      reused_gates: [],
      run_attempt: "1",
      run_id: "999",
      run_url: "https://github.com/acme/widget/actions/runs/999",
      workflow: "CI",
    },
    schema: "lisa.gate-evidence/v1",
    subject: {
      commit: COMMIT,
      ref: "refs/pull/1/merge",
      repository: REPOSITORY,
      tree: TREE,
    },
    verdict: "proved",
  };
}

/**
 * The golden envelope with one path replaced.
 * @param {string} path Dotted path, e.g. `subject.tree`.
 * @param {unknown} value The replacement.
 * @returns {object} The corrupted envelope.
 */
export function corrupt(path: string, value: unknown): Record<string, unknown> {
  const envelope = goldenEnvelope();
  const segments = path.split(".");
  const last = segments.pop() as string;
  const parent = segments.reduce<Record<string, unknown>>(
    (node, segment) => node[segment] as Record<string, unknown>,
    envelope
  );
  if (value === undefined) delete parent[last];
  else parent[last] = value;
  return envelope;
}

/**
 * The golden envelope with one gate's row replaced.
 * @param {string} gate Gate id.
 * @param {object|null} overrides Field overrides, or null to delete the row.
 * @returns {object} The corrupted envelope.
 */
export function corruptRow(
  gate: string,
  overrides: Record<string, unknown> | null
): Record<string, unknown> {
  const envelope = goldenEnvelope();
  const rows = envelope.gates as Record<string, unknown>[];
  envelope.gates =
    overrides === null
      ? rows.filter(entry => entry.gate !== gate)
      : rows.map(entry =>
          entry.gate === gate ? { ...entry, ...overrides } : entry
        );
  return envelope;
}

/**
 * The decision map a plan produced, keyed by gate id.
 * @param {object} plan A `reusePlan` result.
 * @returns {Record<string, string>} gate → decision.
 */
export function decisionsByGate(plan: {
  decisions: { decision: string; gate: string }[];
}): Record<string, string> {
  return Object.fromEntries(
    plan.decisions.map(entry => [entry.gate, entry.decision])
  );
}

/**
 * The reason map a plan produced, keyed by gate id.
 * @param {object} plan A `reusePlan` result.
 * @returns {Record<string, string>} gate → reason token.
 */
export function reasonsByGate(plan: {
  decisions: { gate: string; reason: string }[];
}): Record<string, string> {
  return Object.fromEntries(
    plan.decisions.map(entry => [entry.gate, entry.reason])
  );
}
