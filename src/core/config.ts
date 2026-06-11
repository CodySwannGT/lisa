/**
 * Copy strategy types for handling file operations
 */
export type CopyStrategy =
  | "copy-overwrite"
  | "copy-contents"
  | "create-only"
  | "merge"
  | "tagged-merge"
  | "package-lisa";

/**
 * Available project types that Lisa can detect and configure
 */
export type ProjectType =
  | "typescript"
  | "expo"
  | "nestjs"
  | "cdk"
  | "harper-fabric"
  | "phaser"
  | "npm-package"
  | "rails";

/**
 * Project type hierarchy - child types include their parent types
 */
export const PROJECT_TYPE_HIERARCHY: Readonly<
  Record<string, ProjectType | undefined>
> = {
  expo: "typescript",
  nestjs: "typescript",
  cdk: "typescript",
  "harper-fabric": "typescript",
  phaser: "typescript",
  "npm-package": "typescript",
  typescript: undefined,
  rails: undefined,
} as const;

/**
 * Canonical order for processing project types (parents before children)
 */
export const PROJECT_TYPE_ORDER: readonly ProjectType[] = [
  "typescript",
  "npm-package",
  "harper-fabric",
  "phaser",
  "expo",
  "nestjs",
  "cdk",
  "rails",
] as const;

/**
 * All available copy strategies in processing order
 */
export const COPY_STRATEGIES: readonly CopyStrategy[] = [
  "copy-overwrite",
  "copy-contents",
  "create-only",
  "merge",
  "tagged-merge",
  "package-lisa",
] as const;

/**
 * Target harness(es) for emitted artifacts.
 *
 * - "claude":  emit Claude Code artifacts (.claude/, .claude-plugin/, CLAUDE.md)
 * - "codex":   emit OpenAI Codex CLI artifacts (.codex/, .codex-plugin/, .agents/, AGENTS.md)
 * - "cursor":  emit Cursor artifacts (Cursor reads .claude-plugin/ natively; no per-project files)
 * - "agy":     emit Antigravity artifacts (~/.gemini/config/mcp_config.json + AGENTS.md with baked rules)
 * - "copilot": emit GitHub Copilot artifacts (.github/copilot-instructions.md + plugin install)
 * - "opencode": emit OpenCode artifacts (.opencode/skills/lisa/ + AGENTS.md, read natively)
 * - "fleet":   emit for every supported agent (Claude + Codex + Cursor + agy + Copilot + OpenCode)
 *
 * The input alias `all` is accepted on the CLI and in `.lisa.config.json` and
 * normalized to `fleet` (see {@link HARNESS_ALIASES} / `normalizeHarness`).
 */
export type Harness =
  | "claude"
  | "codex"
  | "cursor"
  | "agy"
  | "copilot"
  | "opencode"
  | "fleet";

/**
 * All valid harness values, in canonical order
 */
export const HARNESS_VALUES: readonly Harness[] = [
  "claude",
  "codex",
  "cursor",
  "agy",
  "copilot",
  "opencode",
  "fleet",
] as const;

/**
 * Input aliases accepted on the CLI and in `.lisa.config.json`, each mapping to
 * a canonical {@link Harness}. `all` is a friendly synonym for `fleet`.
 */
export const HARNESS_ALIASES: Readonly<Record<string, Harness>> = {
  all: "fleet",
};

/**
 * Every string a user may supply for a harness: the canonical values plus the
 * accepted aliases. Used to build help text and validation error messages so
 * `all` is advertised alongside `fleet`.
 */
export const ACCEPTED_HARNESS_INPUTS: readonly string[] = [
  ...HARNESS_VALUES,
  ...Object.keys(HARNESS_ALIASES),
];

/**
 * Per-project emit agents that have a dispatch path in `lisa apply`.
 * (Cursor is intentionally absent — it needs no per-project writes; it consumes
 * the `lisa-cursor` plugin variant directly via its marketplace/loader.)
 */
export type EmitAgent = "claude" | "codex" | "agy" | "copilot" | "opencode";

/**
 * Whether a configured harness should emit artifacts for a given agent.
 *
 * Centralizes the dispatch-inclusion rule so the four `process<Agent>Emit`
 * guards stay consistent: a `"fleet"` harness includes every agent, and any
 * single-agent harness matches only itself. (A prior copy-paste left `"fleet"`
 * out of the Codex guard, so fleet installs silently skipped Codex — this
 * predicate prevents that class of bug.)
 * @param harness - The configured/CLI-resolved harness value.
 * @param agent - The emit agent whose dispatch is being gated.
 * @returns True when the harness should run that agent's emit path.
 */
export function harnessIncludesAgent(
  harness: Harness,
  agent: EmitAgent
): boolean {
  if (harness === "fleet") return true;
  return harness === agent;
}

/**
 * Default harness when none is configured (backward compatibility — existing
 * host projects predate Codex support and have always emitted .claude/ artifacts)
 */
export const DEFAULT_HARNESS: Harness = "claude";

/**
 * Runtime configuration for Lisa operations
 */
export interface LisaConfig {
  /** Path to Lisa installation directory (containing configs) */
  readonly lisaDir: string;

  /** Path to destination project directory */
  readonly destDir: string;

  /** If true, show what would be done without making changes */
  readonly dryRun: boolean;

  /** If true, auto-accept all prompts (non-interactive mode) */
  readonly yesMode: boolean;

  /** If true, only validate compatibility without applying */
  readonly validateOnly: boolean;

  /** If true, skip the dirty git working directory check (for postinstall use) */
  readonly skipGitCheck: boolean;

  /** Target harness(es) for emitted artifacts (e.g. claude | codex | fleet) */
  readonly harness: Harness;
}

/**
 * Operation mode for Lisa execution
 */
export type OperationMode = "apply" | "validate";

/**
 * Result of a single file operation
 */
export interface FileOperationResult {
  readonly relativePath: string;
  readonly strategy: CopyStrategy;
  readonly action:
    | "copied"
    | "skipped"
    | "overwritten"
    | "appended"
    | "merged"
    | "created";
  readonly linesAdded?: number;
}

/**
 * Counters for operation summary
 */
export interface OperationCounters {
  copied: number;
  skipped: number;
  overwritten: number;
  appended: number;
  merged: number;
  deleted: number;
  ignored: number;
  migrationsApplied: number;
  migrationsSkipped: number;
}

/**
 * Structure of deletions.json file
 */
export interface DeletionsConfig {
  /** Paths to delete (files or directories) */
  readonly paths: readonly string[];
  /** Paths to keep (exempt from deletion even if present in paths) */
  readonly keep?: readonly string[];
}

/**
 * Result of a Lisa operation
 */
export interface LisaResult {
  readonly success: boolean;
  readonly counters: OperationCounters;
  readonly detectedTypes: readonly ProjectType[];
  readonly mode: OperationMode;
  readonly errors: readonly string[];
}

/**
 * Create initial operation counters with all values at zero
 * @returns Operation counters initialized to zero
 */
export function createInitialCounters(): OperationCounters {
  return {
    copied: 0,
    skipped: 0,
    overwritten: 0,
    appended: 0,
    merged: 0,
    deleted: 0,
    ignored: 0,
    migrationsApplied: 0,
    migrationsSkipped: 0,
  };
}
