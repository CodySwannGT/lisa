/**
 * Fixtures for the mocked `runDeterministicHealth` suite
 * (`deterministic.test.ts`). The suite owns its `vi.hoisted` mock state and
 * every `vi.mock`; this module supplies the default state, the expected check
 * order, and the fake ruleset finding the mocks delegate to.
 * @module tests/unit/health/deterministic-fixtures
 */
import path from "node:path";

/** Plugin-sync marker path, relative to the project root. */
export const PLUGIN_MARKER_PATH = path.join(".claude", ".lisa-plugins-synced");
/** The package version the mocked CLI reports. */
export const PACKAGE_VERSION = "2.999.0";
/** The GitHub rulesets check identifier. */
const GITHUB_RULESETS = "github.rulesets";

/** Every deterministic check, in the order the runner must report them. */
export const CHECK_ORDER = [
  "project.state",
  "project.wiki",
  "starters.remote",
  "config.required",
  "config.sync",
  "templates.managed",
  "package.conformance",
  "instructions.canonical",
  "hooks.managed",
  "plugins.current",
  "ci.workflows",
  "github.rulesets",
  "github.declared-checks",
  "github.ruleset-reach",
  "expo.splash-exit",
] as const;

/** Mutable state the suite's mocked inspectors read. */
export interface DeterministicMockState {
  /** Parsed `.lisa.config.json`. */
  config: Record<string, unknown>;
  /** Whether `.lisa.config.json` exists. */
  configPresent: boolean;
  /** Parsed Claude settings, or undefined for an unsupported harness. */
  settings: Record<string, unknown> | undefined;
  /** Project text files keyed by relative path. */
  texts: Map<string, string | undefined>;
  /** Dry-run config-sync outcome. */
  sync: {
    actions: { key: string; kind: string; detail: string }[];
    missingRequired: { key: string; setupHint: string }[];
    dryRun: boolean;
  };
  /** Managed-template drift by category. */
  drift: { managed: string[]; hooks: string[]; workflows: string[] };
  /** Create-only workflows missing from the host. */
  missingWorkflows: string[];
  /** Stale reusable-workflow inputs. */
  staleWorkflowInputs: string[];
  /** Whether package.json conforms. */
  packageConforms: boolean;
  /** Whether the required GitHub rulesets are present. */
  rulesetsPresent: boolean;
}

/**
 * Build the in-band default mock state: every check passes except the two
 * that warn without remote access.
 * @returns Fresh mutable mock state
 */
export function defaultMockState(): DeterministicMockState {
  return {
    config: {
      tracker: "github",
      github: { org: "example", repo: "project" },
    },
    configPresent: true,
    settings: { enabledPlugins: { "lisa@lisa": true } },
    texts: new Map([
      ["AGENTS.md", "Canonical project instructions."],
      ["CLAUDE.md", "@AGENTS.md"],
      [PLUGIN_MARKER_PATH, `${PACKAGE_VERSION}\n`],
    ]),
    sync: { actions: [], missingRequired: [], dryRun: true },
    drift: { managed: [], hooks: [], workflows: [] },
    missingWorkflows: [],
    staleWorkflowInputs: [],
    packageConforms: true,
    rulesetsPresent: true,
  };
}

/**
 * Fake `rulesetFinding`: warn when the ruleset reader fails, otherwise pass or
 * fail on whether the required rulesets are present.
 * @param reader - The injected ruleset reader
 * @param present - Whether the required rulesets are present
 * @returns The deterministic GitHub rulesets finding
 */
export async function fakeRulesetFinding(
  reader: () => Promise<unknown>,
  present: boolean
) {
  try {
    await reader();
  } catch {
    return {
      check: GITHUB_RULESETS,
      layer: "deterministic",
      status: "warn",
      reason:
        "GitHub rulesets could not be observed within the deterministic deadline.",
    };
  }
  return present
    ? {
        check: GITHUB_RULESETS,
        layer: "deterministic",
        status: "pass",
        reason: "Required GitHub rulesets are active and materially current.",
      }
    : {
        check: GITHUB_RULESETS,
        layer: "deterministic",
        status: "fail",
        reason: "GitHub ruleset drift: Base missing",
      };
}
