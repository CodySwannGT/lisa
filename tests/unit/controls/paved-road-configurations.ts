/**
 * The `gates` configurations whose resolution is pinned.
 * @remarks
 * Each one restates a configuration an existing gate suite already resolves,
 * named for the suite it came from. They are restated rather than imported
 * because those suites keep theirs private, and the requirement this serves
 * is that they keep passing unmodified.
 *
 * Together they cover every shape a declaration takes today: a bare level, a
 * project's own `run`, an awaited signal, a caller chain, a declared failure
 * shape, an `off`, an interceptor, and a manifest that does or does not carry
 * the default task.
 * @module tests/unit/controls/paved-road-configurations
 */
/** One pinned configuration, and the inputs it is resolved with. */
export interface PavedRoadConfiguration {
  /** The key its snapshots are stored under. */
  readonly name: string;
  /** The existing suite the configuration was taken from. */
  readonly origin: string;
  /** The `gates` block. */
  readonly gates: Readonly<Record<string, unknown>>;
  /** Task-runner prefix. Omitted means the registry's default runner. */
  readonly runner?: string;
  /** The project's manifest scripts. Omitted means unknown. */
  readonly scripts?: Readonly<Record<string, string>>;
  /** Whether gates declared `off` are reported, as the CI facade asks. */
  readonly includeOff?: boolean;
}

const REQUIRED = "required";
const OPTIONAL = "optional";
const OFF = "off";
const COMMIT = "commit";
const PUSH = "push";
const PULL_REQUEST = "pull-request";
const PRE_DEPLOY_PROD = "pre-deploy:production";
const BUN_RUN = "bun run";
const LINT_TASK = "lint";
const REVIEW_BOT = "CodeRabbit";
const CODE_STYLE = "code-style";
const CODE_REVIEW = "code-review";
const AUDIT_GATE = "dependency-vulnerability";
const RESOLUTION_SUITE = "lisa-gates-resolution: resolveMoment";

/** The block the resolution suite resolves at every one of its moments. */
const RESOLUTION_GATES = {
  [CODE_STYLE]: {
    run: LINT_TASK,
    [COMMIT]: REQUIRED,
    [PULL_REQUEST]: REQUIRED,
  },
  "test-meaningfulness": { [PULL_REQUEST]: OPTIONAL },
  "dead-code": { [PUSH]: OFF },
  "verification-bypass": { "pre-tool": REQUIRED },
  [CODE_REVIEW]: {
    [PUSH]: { level: OPTIONAL, run: "review:local" },
    [PULL_REQUEST]: { level: REQUIRED, await: REVIEW_BOT },
  },
};

/** The three gates that fall back to a built-in the facade owns. */
const OWNED_FALLBACK_GATES = {
  [AUDIT_GATE]: { [COMMIT]: REQUIRED, [PULL_REQUEST]: REQUIRED },
  "learnings-budget": { [PULL_REQUEST]: REQUIRED },
  "security-floor-integrity": { [PULL_REQUEST]: REQUIRED },
};

/** The configurations drawn from the existing gate suites. */
export const SUITE_CONFIGURATIONS: readonly PavedRoadConfiguration[] = [
  {
    name: "resolution suite",
    origin: RESOLUTION_SUITE,
    gates: RESOLUTION_GATES,
    runner: BUN_RUN,
  },
  {
    name: "resolution suite, off gates reported",
    origin: "quality-gate-off-state: declared-off against never-declared",
    gates: {
      ...RESOLUTION_GATES,
      "test-node-suites": { [PULL_REQUEST]: OFF },
    },
    runner: BUN_RUN,
    includeOff: true,
  },
  {
    name: "owned fallbacks, empty manifest",
    origin: RESOLUTION_SUITE,
    gates: OWNED_FALLBACK_GATES,
    runner: BUN_RUN,
    scripts: {},
  },
  {
    name: "owned fallbacks, audit task supplied",
    origin: RESOLUTION_SUITE,
    gates: OWNED_FALLBACK_GATES,
    runner: BUN_RUN,
    scripts: { "security:audit": "custom-audit" },
  },
  {
    name: "explicit run over an owned fallback",
    origin: RESOLUTION_SUITE,
    gates: {
      [AUDIT_GATE]: {
        [PULL_REQUEST]: { level: REQUIRED, run: "audit:project" },
      },
    },
    runner: BUN_RUN,
    scripts: {},
  },
  {
    name: "needs suite",
    origin: "lisa-gates-resolution: needsAt",
    gates: {
      "e2e-native": {
        run: "test:e2e:native",
        needs: { tools: ["maestro"], secrets: ["MAESTRO_API_KEY"] },
        [PULL_REQUEST]: OPTIONAL,
        [PRE_DEPLOY_PROD]: REQUIRED,
      },
      [CODE_STYLE]: { run: LINT_TASK, [COMMIT]: REQUIRED },
    },
  },
  {
    name: "contexts suite",
    origin: "lisa-gates-resolution: contextsFor",
    gates: {
      [CODE_STYLE]: { run: LINT_TASK, [PULL_REQUEST]: REQUIRED },
      "test-meaningfulness": { [PULL_REQUEST]: OPTIONAL },
      "load-capacity": { [PRE_DEPLOY_PROD]: REQUIRED },
      [CODE_REVIEW]: { [PULL_REQUEST]: { level: REQUIRED, await: REVIEW_BOT } },
    },
  },
  {
    name: "awaited signal with evidence and a pinned poster",
    origin: "lisa-gates: evidence and posted_by",
    gates: {
      [CODE_REVIEW]: {
        [PULL_REQUEST]: {
          level: REQUIRED,
          await: "Greptile",
          posted_by: 347_564,
          evidence: { no_work: ["seat limit exceeded"] },
        },
      },
    },
  },
  {
    name: "caller chain override",
    origin: "lisa-gates-caller-chain-override",
    gates: {
      [CODE_STYLE]: { run: LINT_TASK, [PULL_REQUEST]: REQUIRED },
      "e2e-browser": {
        run: "test:e2e:pr",
        [PULL_REQUEST]: {
          level: REQUIRED,
          caller_chain: ["🎭 PR Browser Coverage"],
        },
      },
    },
  },
  {
    name: "declared failure shape",
    origin: "gate-declared-failure-shapes",
    gates: {
      "artifact-freshness": {
        [COMMIT]: {
          level: REQUIRED,
          run: "check:artifacts",
          failure_shape: [
            "check:artifacts FAILED, and these are the checks that failed:",
          ],
        },
      },
      "x-plugin-artifact-sync": {
        [PUSH]: { level: REQUIRED, run: "check:plugins" },
      },
    },
  },
  {
    name: "execution order",
    origin: "lisa-gates-order",
    gates: {
      "artifact-freshness": { [COMMIT]: REQUIRED },
      [CODE_STYLE]: { [COMMIT]: { level: REQUIRED, run: "lint:staged" } },
      "structural-rules": { [COMMIT]: REQUIRED },
      traceability: { [PUSH]: REQUIRED },
      "test-correctness": { [PUSH]: REQUIRED },
      "test-integration": { [PUSH]: REQUIRED },
      "type-correctness": { [PUSH]: REQUIRED },
      "dead-code": { [PUSH]: REQUIRED },
    },
  },
  {
    name: "shipped aliases on a project manifest",
    origin: "lisa-gates-shipped-as",
    gates: {
      "runtime-web-vulnerability": { [PRE_DEPLOY_PROD]: REQUIRED },
      "load-capacity": { [PRE_DEPLOY_PROD]: REQUIRED },
      "e2e-native": { [PULL_REQUEST]: REQUIRED, [PRE_DEPLOY_PROD]: REQUIRED },
    },
    scripts: {
      "security:zap": "zap-baseline.py -t http://localhost:8081",
      "maestro:test": "maestro test .maestro",
      lint: "oxlint",
    },
  },
  {
    name: "manifest-free history scan",
    origin: "history-secret-contract",
    gates: {
      "introduced-history-credential-leakage": {
        [PUSH]: REQUIRED,
        [PULL_REQUEST]: REQUIRED,
      },
      "credential-leakage": { [PULL_REQUEST]: OFF },
    },
    includeOff: true,
  },
  {
    name: "interceptors",
    origin: "lisa-gates-resolution: contextsFor, one per interceptor",
    gates: Object.fromEntries(
      [
        "verification-bypass",
        "destructive-safety",
        "instruction-integrity",
        "orchestration-conformance",
        "structured-data-handling",
      ].map(id => [id, { "pre-tool": REQUIRED, [PULL_REQUEST]: REQUIRED }])
    ),
  },
];
