/**
 * Registry of synced settings: the single map between `.lisa.config.json`
 * keys, their built-in defaults, and the project artifact files that mirror
 * them (test thresholds, lint budgets, mutation gates).
 *
 * The registry drives `lisa sync`: every entry is populated into the config
 * when missing (absorbing an existing artifact value first, falling back to
 * the built-in default), and afterwards the config value is written back into
 * each artifact file — config is the source of truth unless a value is
 * completely missing.
 * @module sync/registry
 */
import { DEFAULT_PROJECT_RULES_FILE } from "../core/project-config.js";
import { validateHealthSchedule } from "../health/contract.js";
import type { JsonValue } from "./json-path.js";
import type { LegacyAliasMapping } from "./legacy-aliases.js";

/**
 * A project file that mirrors a synced setting. Artifact files are only ever
 * written when they already exist on disk — sync never scaffolds an artifact
 * into a project whose stack does not use it.
 */
export interface ArtifactBinding {
  /** Repo-relative path of the mirrored file */
  readonly file: string;
  /** Dot path of the mirrored value inside the file ("" = whole document) */
  readonly pointer: string;
}

/** One synced setting: a config key, its default, and optional mirrors. */
export interface SyncedSetting {
  /** Dot path of the setting inside `.lisa.config.json` */
  readonly key: string;
  /** Built-in default used when neither config nor artifact has a value */
  readonly defaultValue: JsonValue;
  /** Optional executable validator for human/config supplied values. */
  readonly validate?: (value: unknown) => JsonValue;
  /**
   * Internal relative-path mappings for deprecated keys that remain readable.
   * Sync uses these to avoid filling a new default beside a human-owned alias.
   */
  readonly legacyAliases?: readonly LegacyAliasMapping[];
  /** Files that mirror this value (written from config on every sync) */
  readonly artifacts?: readonly ArtifactBinding[];
  /**
   * Entry applies when ANY condition matches (absent = always applies).
   * `"github"` means the `github` section exists; `"tracker=jira"` means the
   * `tracker` key equals `"jira"`.
   */
  readonly relevantWhen?: readonly string[];
  /** One-line human description used in sync reports */
  readonly description: string;
}

/** A key sync cannot default and must report when missing. */
export interface RequiredKey {
  /** Dot path of the required setting */
  readonly key: string;
  /** Applies when ANY condition matches (absent = always required) */
  readonly relevantWhen?: readonly string[];
  /** Setup command that provisions the key */
  readonly setupHint: string;
}

const WHEN_TRACKER_JIRA = "tracker=jira";
const WHEN_TRACKER_GITHUB = "tracker=github";
const WHEN_SOURCE_GITHUB = "source=github";
const WHEN_TRACKER_LINEAR = "tracker=linear";
const WHEN_SOURCE_LINEAR = "source=linear";
const WHEN_SOURCE_NOTION = "source=notion";

const COVERAGE_DEFAULTS: JsonValue = {
  global: { statements: 70, branches: 70, functions: 70, lines: 70 },
};

const BUILD_LABEL_DEFAULTS = {
  ready: "status:ready",
  claimed: "status:in-progress",
  blocked: "status:blocked",
  human_needed: "human-needed",
  done: {
    dev: "status:on-dev",
    staging: "status:on-stg",
    production: "status:done",
  },
} as const;

const PRD_LABEL_DEFAULTS: JsonValue = {
  draft: "prd-draft",
  ready: "prd-ready",
  in_review: "prd-in-review",
  blocked: "prd-blocked",
  ticketed: "prd-ticketed",
  shipped: "prd-shipped",
  verified: "prd-verified",
  sentinel: "prd-intake-feedback",
};

/**
 * All settings `lisa sync` manages. Local-only keys (`atlassian.email`,
 * `intake.assignee`, `jira.verified_workflow_hash`, secret paths) are
 * deliberately absent — sync never populates the committed file with values
 * that belong in `.lisa.config.local.json`.
 */
export const SYNC_REGISTRY: readonly SyncedSetting[] = [
  {
    key: "harness",
    defaultValue: "claude",
    description: "Target coding-agent harness(es)",
  },
  {
    key: "projectRulesFile",
    defaultValue: DEFAULT_PROJECT_RULES_FILE,
    description: "Hand-authored project rules file (independent of the ledger)",
  },
  {
    key: "health.schedule",
    defaultValue: "off",
    validate: validateHealthSchedule,
    description: "Health-check schedule (off, daily, or weekly)",
  },
  {
    key: "quality.testCoverage",
    defaultValue: COVERAGE_DEFAULTS,
    artifacts: [
      { file: "vitest.thresholds.json", pointer: "" },
      { file: "jest.thresholds.json", pointer: "" },
    ],
    description: "Test coverage floors (statements/branches/functions/lines)",
  },
  {
    key: "quality.e2eCoverage",
    defaultValue: { playwright: { routes: 80 }, maestro: { routes: 80 } },
    artifacts: [{ file: "e2e.thresholds.json", pointer: "" }],
    description:
      "E2E route/screen coverage floors (Playwright web routes, Maestro screens)",
  },
  {
    key: "quality.lintBudgets",
    defaultValue: {
      cognitiveComplexity: 10,
      maxLines: 300,
      maxLinesPerFunction: 75,
    },
    artifacts: [{ file: "eslint.thresholds.json", pointer: "" }],
    description: "Lint complexity and size budgets",
  },
  {
    key: "quality.mutation.gate",
    defaultValue: { enabled: false, since: "main" },
    artifacts: [{ file: "mutation.gate.json", pointer: "" }],
    description: "Diff-only mutation testing gate",
  },
  {
    key: "quality.mutation.strykerThresholds",
    defaultValue: { high: 80, low: 60, break: 60 },
    artifacts: [{ file: "stryker.conf.json", pointer: "thresholds" }],
    description: "Stryker mutation-score thresholds",
  },
  {
    key: "intake.repair",
    defaultValue: { staleAfterHours: 2, maxCandidates: 100 },
    description: "Repair-intake stall window and candidate cap",
  },
  {
    // Semantics documented in one place: the claim-archaeology rule pair
    // (plugins/src/base/rules/{eager,reference}/claim-archaeology.md).
    key: "archaeology",
    defaultValue: { maxSteps: 8 },
    description:
      "Claim-time archaeology cost budget (max tracker/git queries per claim)",
  },
  {
    key: "monitor",
    defaultValue: {
      maxCandidates: 20,
      gapTiers: "core",
      backoffHours: 24,
      // Provider-neutral threshold names: the audit spans Sentry, CloudWatch,
      // X-Ray, and future providers, so no key is prefixed with a vendor.
      thresholds: {
        minEvents24h: 1,
        errorRateSpikeMultiplier: 2,
        p95LatencyMs: 1000,
        faultRatePct: 5,
      },
    },
    legacyAliases: [
      {
        currentPath: "thresholds.minEvents24h",
        legacyPath: "thresholds.sentryMinEvents24h",
      },
      {
        currentPath: "thresholds.faultRatePct",
        legacyPath: "thresholds.xrayFaultRatePct",
      },
    ],
    description: "Observability audit caps and alert thresholds",
  },
  {
    key: "jira.workflow",
    defaultValue: {
      ready: "Ready",
      claimed: "In Progress",
      review: "Code Review",
      blocked: "Blocked",
      done: { dev: "On Dev", staging: "On Stg", production: "Done" },
    },
    relevantWhen: ["jira", WHEN_TRACKER_JIRA],
    description: "JIRA workflow status names per lifecycle role",
  },
  {
    key: "jira.labels",
    defaultValue: { human_needed: "Human Needed" },
    relevantWhen: ["jira", WHEN_TRACKER_JIRA],
    description: "JIRA marker labels",
  },
  {
    key: "github.labels",
    defaultValue: { build: BUILD_LABEL_DEFAULTS, prd: PRD_LABEL_DEFAULTS },
    relevantWhen: ["github", WHEN_TRACKER_GITHUB, WHEN_SOURCE_GITHUB],
    description: "GitHub build and PRD lifecycle labels",
  },
  {
    key: "linear.labels",
    defaultValue: {
      build: { ...BUILD_LABEL_DEFAULTS, review: "status:code-review" },
      prd: PRD_LABEL_DEFAULTS,
    },
    relevantWhen: ["linear", WHEN_TRACKER_LINEAR, WHEN_SOURCE_LINEAR],
    description: "Linear build and PRD lifecycle labels",
  },
  {
    key: "notion.statusProperty",
    defaultValue: "Status",
    relevantWhen: ["notion", WHEN_SOURCE_NOTION],
    description: "Notion database property that drives the PRD lifecycle",
  },
  {
    key: "notion.values",
    defaultValue: {
      draft: "Draft",
      ready: "Ready",
      in_review: "In Review",
      blocked: "Blocked",
      ticketed: "Ticketed",
      shipped: "Shipped",
      verified: "Verified",
    },
    relevantWhen: ["notion", WHEN_SOURCE_NOTION],
    description: "Notion status option names per lifecycle role",
  },
  {
    key: "wiki.ttlSeconds",
    defaultValue: 300,
    relevantWhen: ["wiki"],
    description: "Remote wiki mirror refresh TTL",
  },
];

/**
 * Keys sync can never default: they identify external systems and must come
 * from a human (via the matching `/lisa:setup:*` skill). Sync reports them
 * when missing instead of inventing values.
 */
export const REQUIRED_KEYS: readonly RequiredKey[] = [
  { key: "tracker", setupHint: "/lisa:setup:jira | github | linear" },
  {
    key: "jira.project",
    relevantWhen: [WHEN_TRACKER_JIRA],
    setupHint: "/lisa:setup:jira",
  },
  {
    key: "atlassian.cloudId",
    relevantWhen: [WHEN_TRACKER_JIRA, "source=confluence"],
    setupHint: "/lisa:setup:atlassian",
  },
  {
    key: "github.org",
    relevantWhen: [WHEN_TRACKER_GITHUB, WHEN_SOURCE_GITHUB],
    setupHint: "/lisa:setup:github",
  },
  {
    key: "github.repo",
    relevantWhen: [WHEN_TRACKER_GITHUB, WHEN_SOURCE_GITHUB],
    setupHint: "/lisa:setup:github",
  },
  {
    key: "linear.workspace",
    relevantWhen: [WHEN_TRACKER_LINEAR, WHEN_SOURCE_LINEAR],
    setupHint: "/lisa:setup:linear",
  },
  {
    key: "linear.teamKey",
    relevantWhen: [WHEN_TRACKER_LINEAR],
    setupHint: "/lisa:setup:linear",
  },
  {
    key: "notion.workspaceId",
    relevantWhen: [WHEN_SOURCE_NOTION],
    setupHint: "/lisa:setup:notion",
  },
  {
    key: "notion.prdDatabaseId",
    relevantWhen: [WHEN_SOURCE_NOTION],
    setupHint: "/lisa:setup:notion",
  },
];
