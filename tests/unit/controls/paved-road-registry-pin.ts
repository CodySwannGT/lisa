/**
 * The gate registry's defaults, written down as they stood before the control
 * audit work began.
 * @remarks
 * Every row is a literal, and none of it is read off the live registry. A
 * table derived from the registry would follow the registry when it changed,
 * and the pin would then agree with whatever it was meant to catch.
 *
 * The list is closed on purpose. A gate added to the registry later cannot
 * change what an existing declaration resolves to, so it does not have to
 * join; a gate on this list whose default moves is exactly the change an
 * existing Lisa user would feel.
 * @module tests/unit/controls/paved-road-registry-pin
 */
import type { PavedRoadConfiguration } from "./paved-road-configurations.js";

const POST_TOOL = "post-tool";
const PRE_TOOL = "pre-tool";
const SESSION_START = "session-start";
const COMMIT = "commit";
const PUSH = "push";
const PULL_REQUEST = "pull-request";
/** One environment per suffixed family is enough to reach its defaults. */
const PRE_DEPLOY = "pre-deploy:production";
const POST_DEPLOY = "post-deploy:production";
const CONTINUOUS = "continuous:production";

const PR_ONWARD = [PULL_REQUEST, PRE_DEPLOY, POST_DEPLOY];
const PUSH_ONWARD = [PUSH, ...PR_ONWARD];
const COMMIT_ONWARD = [COMMIT, ...PUSH_ONWARD];
const EDIT_ONWARD = [POST_TOOL, ...COMMIT_ONWARD];
const PRE_TOOL_ONWARD = [PRE_TOOL, ...COMMIT_ONWARD];
const SESSION_ONWARD = [SESSION_START, ...COMMIT_ONWARD];
const PR_AND_CONTINUOUS = [...PR_ONWARD, CONTINUOUS];
const PUSH_AND_CONTINUOUS = [...PUSH_ONWARD, CONTINUOUS];
const PUSH_AND_PR = [PUSH, PULL_REQUEST];
const DEPLOY_ONLY = [PRE_DEPLOY, POST_DEPLOY, CONTINUOUS];

/** One pinned gate: its default task, and every moment it is declared at. */
export interface PinnedGate {
  /** The task the registry resolves a bare declaration to. */
  readonly task: string;
  /** The moments the pin declares the gate at. */
  readonly moments: readonly string[];
  /** The script a stack template ships for the same concern, if any. */
  readonly shippedAs?: string;
  /** A default that replaces `task` at one moment, keyed by that moment. */
  readonly taskAt?: Readonly<Record<string, string>>;
}

/** Every gate the registry held at the pin, with its defaults. */
export const PINNED_GATES: Readonly<Record<string, PinnedGate>> = {
  "code-style": { task: "lint", moments: EDIT_ONWARD },
  "code-style-slow": { task: "lint:slow", moments: PUSH_ONWARD },
  "format-conformance": { task: "format:check", moments: EDIT_ONWARD },
  "type-correctness": { task: "typecheck", moments: PUSH_ONWARD },
  "build-integrity": { task: "build", moments: PUSH_ONWARD },
  "test-correctness": { task: "test:unit", moments: PUSH_ONWARD },
  "test-node-suites": { task: "test:node", moments: PUSH_ONWARD },
  "test-integration": { task: "test:integration", moments: PUSH_ONWARD },
  "test-meaningfulness": { task: "test:mutation", moments: PR_ONWARD },
  "coverage-adequacy": {
    task: "test:coverage",
    shippedAs: "test:cov",
    moments: PUSH_ONWARD,
  },
  "e2e-browser": { task: "test:e2e", moments: PR_AND_CONTINUOUS },
  "e2e-native": {
    task: "test:e2e:native",
    shippedAs: "maestro:test",
    moments: PR_AND_CONTINUOUS,
  },
  "environment-reset": {
    task: "environment:reset:verify",
    moments: PR_AND_CONTINUOUS,
  },
  "environment-reseed": {
    task: "environment:reseed:verify",
    moments: PR_AND_CONTINUOUS,
  },
  "journey-coverage": { task: "test:e2e:coverage", moments: PR_ONWARD },
  "behavior-contract": {
    task: "check:behavior-contract",
    shippedAs: "bdd:coverage",
    moments: PR_ONWARD,
  },
  "state-classification": {
    task: "check:state-classification",
    moments: COMMIT_ONWARD,
  },
  "security-floor-integrity": {
    task: "check:security-floors",
    moments: COMMIT_ONWARD,
  },
  "generative-testing": { task: "test:property", moments: PR_AND_CONTINUOUS },
  "structural-rules": {
    task: "lint:structural",
    shippedAs: "sg:scan",
    moments: EDIT_ONWARD,
  },
  "suppression-residue": {
    task: "check:suppressions",
    moments: PRE_TOOL_ONWARD,
  },
  "migration-provenance": {
    task: "check:migrations",
    moments: PRE_TOOL_ONWARD,
  },
  "dead-code": {
    task: "check:dead-code",
    shippedAs: "knip:check",
    moments: PUSH_ONWARD,
  },
  "credential-leakage": {
    task: "security:check-for-leaks",
    moments: COMMIT_ONWARD,
  },
  "introduced-history-credential-leakage": {
    task: "security:check-introduced-history",
    moments: PUSH_AND_PR,
  },
  "dependency-vulnerability": {
    task: "security:audit",
    moments: PUSH_AND_CONTINUOUS,
  },
  "static-security": { task: "security:sast", moments: PR_AND_CONTINUOUS },
  "runtime-web-vulnerability": {
    task: "security:dast",
    shippedAs: "security:zap",
    moments: DEPLOY_ONLY,
  },
  "license-compliance": { task: "security:licenses", moments: PR_ONWARD },
  "code-review": { task: "review:local", moments: PUSH_AND_PR },
  "performance-budget": {
    task: "perf:check",
    shippedAs: "lighthouse:check",
    moments: PUSH_AND_CONTINUOUS,
  },
  "load-capacity": {
    task: "perf:load",
    shippedAs: "k6:load",
    moments: DEPLOY_ONLY,
  },
  accessibility: { task: "a11y:check", moments: DEPLOY_ONLY },
  traceability: {
    task: "check:work-item",
    taskAt: { [PUSH]: "check:work-item:push" },
    moments: PUSH_AND_PR,
  },
  "commit-conformance": { task: "check:commit-msg", moments: COMMIT_ONWARD },
  "threshold-monotonicity": { task: "check:thresholds", moments: PUSH_ONWARD },
  "artifact-freshness": { task: "check:artifacts", moments: COMMIT_ONWARD },
  "learnings-budget": {
    task: "check:learnings-budget",
    moments: COMMIT_ONWARD,
  },
  "conflict-residue": {
    task: "check:conflict-markers",
    moments: COMMIT_ONWARD,
  },
  "version-duplication": {
    task: "check:duplicate-versions",
    moments: COMMIT_ONWARD,
  },
  "credential-availability": {
    task: "readiness:secrets",
    moments: SESSION_ONWARD,
  },
  "tool-availability": { task: "readiness:tools", moments: SESSION_ONWARD },
};

/**
 * The default task the pin expects for one gate at one moment.
 * @param gate - A pinned gate
 * @param moment - The moment it is resolved at
 * @returns The moment's own default where the gate has one, else its task
 */
export const pinnedTaskAt = (gate: PinnedGate, moment: string): string =>
  gate.taskAt?.[moment] ?? gate.task;

/** Every pinned gate, declared with a bare level wherever it is pinned. */
const BARE_DECLARATIONS = Object.fromEntries(
  Object.entries(PINNED_GATES).map(([id, gate]) => [
    id,
    Object.fromEntries(gate.moments.map(moment => [moment, "required"])),
  ])
);

/**
 * A manifest carrying a script for each of the given task names.
 * @param tasks - The script names to supply
 * @returns A `scripts` block with one entry per name
 */
const manifestOf = (tasks: readonly string[]): Record<string, string> =>
  Object.fromEntries(tasks.map(task => [task, `run ${task}`]));

/** A manifest that supplies the task every pinned default names. */
const EVERY_DEFAULT_TASK = manifestOf(
  Object.values(PINNED_GATES).flatMap(gate => [
    gate.task,
    ...Object.values(gate.taskAt ?? {}),
  ])
);

/** A manifest that supplies only the scripts the stack templates ship. */
const ONLY_SHIPPED_ALIASES = manifestOf(
  Object.values(PINNED_GATES).flatMap(gate =>
    gate.shippedAs === undefined ? [] : [gate.shippedAs]
  )
);

/** The name of the configuration whose manifest supplies every default. */
export const EVERY_DEFAULT_SUPPLIED = "registry defaults, every task supplied";

/** The name of the configuration whose manifest supplies only aliases. */
export const ONLY_ALIASES_SUPPLIED =
  "registry defaults, only shipped aliases supplied";

/**
 * The same bare declarations under the three things a caller can know about
 * the project's manifest. Which one applies decides whether a default task
 * runs, a shipped alias stands in for it, or a built-in takes over.
 */
export const REGISTRY_PIN_CONFIGURATIONS: readonly PavedRoadConfiguration[] = [
  {
    name: "registry defaults, manifest unknown",
    origin: "lisa-gates-order: every moment of every gate the registry holds",
    gates: BARE_DECLARATIONS,
  },
  {
    name: EVERY_DEFAULT_SUPPLIED,
    origin: "lisa-gates-resolution: the registry task the project supplies",
    gates: BARE_DECLARATIONS,
    scripts: EVERY_DEFAULT_TASK,
  },
  {
    name: ONLY_ALIASES_SUPPLIED,
    origin: "lisa-gates-shipped-as: the prover the project actually ships",
    gates: BARE_DECLARATIONS,
    scripts: ONLY_SHIPPED_ALIASES,
  },
];
