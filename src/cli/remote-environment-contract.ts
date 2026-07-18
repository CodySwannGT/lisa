import type { Harness, ProjectType } from "../core/config.js";
import { HARNESS_VALUES } from "../core/config.js";

/** Project-owned extension point for remote-environment requirements. */
export const REMOTE_ENVIRONMENT_MANIFEST =
  ".lisa/remote-environment.json" as const;

/** One concrete coding agent, excluding the fleet aggregate. */
export type RemoteAgent = Exclude<Harness, "fleet">;

/** A variable the current project requires in a remote coding environment. */
export interface RemoteEnvironmentVariableStatus {
  /** Environment-variable name. Values are never exposed. */
  readonly name: string;
  /** Why this project requires the variable. */
  readonly reason: string;
  /** Project signal that activated the requirement. */
  readonly source: string;
  /** Whether the variable contains a credential. */
  readonly secret: boolean;
  /** Whether the variable is visible to the `lisa ui` process. */
  readonly set: boolean;
}

/** Startup artifact expected by one supported remote coding agent. */
export interface RemoteEnvironmentStartupStatus {
  /** Agent whose remote environment consumes the artifact. */
  readonly agent: RemoteAgent;
  /** Project-relative setup artifact, when one is configured. */
  readonly artifact?: string;
  /** Whether the configured artifact exists. */
  readonly installed: boolean;
}

/** Project-aware remote-environment readiness exposed to the console. */
export interface RemoteEnvironmentStatus {
  /** Lisa project types detected for the current project. */
  readonly projectTypes: readonly ProjectType[];
  /** Required variables only; optional/dormant integrations are omitted. */
  readonly variables: readonly RemoteEnvironmentVariableStatus[];
  /** Startup artifact status for every supported agent. */
  readonly startupScripts: readonly RemoteEnvironmentStartupStatus[];
}

/** Internal names-only variable requirement. */
export interface VariableRequirement {
  /** Environment-variable name. */
  readonly name: string;
  /** Human-readable reason the project requires it. */
  readonly reason: string;
  /** Project signal that activated it. */
  readonly source: string;
  /** Whether it contains a credential. */
  readonly secret: boolean;
}

/** Active remote-tool integrations detected from the host project. */
export interface IntegrationFlags {
  /** AWS SDK/infrastructure/operational integration. */
  readonly aws: boolean;
  /** Expo Application Services integration. */
  readonly eas: boolean;
  /** Figma tooling integration. */
  readonly figma: boolean;
  /** Jam debugging integration. */
  readonly jam: boolean;
  /** Maestro Cloud integration. */
  readonly maestro: boolean;
  /** Sentry tooling integration. */
  readonly sentry: boolean;
  /** SonarCloud integration. */
  readonly sonar: boolean;
}

/** Raw project-owned manifest shape; every field is validated before use. */
export interface RemoteEnvironmentManifest {
  /** Names-only variable declarations. */
  readonly variables?: readonly {
    readonly name?: unknown;
    readonly reason?: unknown;
    readonly source?: unknown;
    readonly secret?: unknown;
    readonly required?: unknown;
  }[];
  /** Per-agent project-relative startup artifacts. */
  readonly startupScripts?: Readonly<Record<string, unknown>>;
}

/** Supported concrete agents in canonical order. */
export const REMOTE_AGENTS: readonly RemoteAgent[] = HARNESS_VALUES.filter(
  (harness): harness is RemoteAgent => harness !== "fleet"
);

const GENERIC_STARTUP_ARTIFACT = "scripts/remote-agent-setup.sh";

/** Default project artifacts recognized for each remote agent. */
export const DEFAULT_STARTUP_ARTIFACTS: Readonly<
  Record<RemoteAgent, readonly string[]>
> = {
  claude: ["scripts/claude-remote-setup.sh", GENERIC_STARTUP_ARTIFACT],
  codex: ["scripts/codex-remote-setup.sh", GENERIC_STARTUP_ARTIFACT],
  cursor: [
    ".cursor/environment.json",
    "scripts/cursor-remote-setup.sh",
    GENERIC_STARTUP_ARTIFACT,
  ],
  agy: ["scripts/agy-remote-setup.sh", GENERIC_STARTUP_ARTIFACT],
  copilot: [
    ".github/workflows/copilot-setup-steps.yml",
    "scripts/copilot-remote-setup.sh",
    GENERIC_STARTUP_ARTIFACT,
  ],
  opencode: ["scripts/opencode-remote-setup.sh", GENERIC_STARTUP_ARTIFACT],
};

/**
 * Validate project-owned manifest variable declarations.
 * @param manifest - Parsed manifest
 * @returns Required variable declarations only
 */
export function manifestRequirements(
  manifest: RemoteEnvironmentManifest | null
): readonly VariableRequirement[] {
  return (manifest?.variables ?? []).flatMap(entry => {
    if (
      entry.required === false ||
      typeof entry.name !== "string" ||
      !/^[A-Z][A-Z0-9_]*$/u.test(entry.name)
    ) {
      return [];
    }
    return [
      {
        name: entry.name,
        reason:
          typeof entry.reason === "string"
            ? entry.reason
            : "Required by the project remote-environment manifest",
        source:
          typeof entry.source === "string"
            ? entry.source
            : REMOTE_ENVIRONMENT_MANIFEST,
        secret: entry.secret !== false,
      },
    ];
  });
}

/**
 * Deduplicate requirements by variable name while preserving first-source order.
 * @param requirements - Requirements from config, detection, and manifest
 * @returns Deduplicated requirements
 */
export function uniqueRequirements(
  requirements: readonly VariableRequirement[]
): readonly VariableRequirement[] {
  return requirements.filter(
    (requirement, index) =>
      requirements.findIndex(
        candidate => candidate.name === requirement.name
      ) === index
  );
}
