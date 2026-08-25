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
 * - "agy":     emit Antigravity artifacts (~/.gemini/config/mcp_config.json + AGENTS.md learnings bridge)
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
 * Retired harness values that Lisa no longer accepts verbatim but silently
 * migrates to a canonical {@link Harness} rather than hard-failing the apply.
 *
 * `both` predates the multi-agent fleet: it was the "Claude + Codex" value
 * removed in c0978c9f. Projects that still carry it in `.lisa.config.json`
 * (e.g. from a pre-fleet install) would otherwise fail every `lisa apply` with
 * an "Invalid harness" error. It is intentionally NOT advertised in
 * {@link ACCEPTED_HARNESS_INPUTS} — it is a migration target, not a valid input.
 */
export const LEGACY_HARNESS_ALIASES: Readonly<Record<string, Harness>> = {
  both: "fleet",
};

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

  /**
   * If true, run the FULL apply even when `skipGitCheck` is set.
   *
   * `--skip-git-check` otherwise selects the reduced `postinstall-safe`
   * subset as a side effect, which is the conflation CodySwannGT/lisa#3066
   * reports: an automated caller needs the clean-tree waiver for an honest
   * reason — it has just run an install, so the tree is dirty by construction
   * — and gets the reduced apply with no way to decline. Every agent emit and
   * the Sonar integration are then skipped, which is why no package install at
   * any version can migrate `.codex/config.toml`.
   *
   * Undefined or false preserves today's behaviour exactly, so no existing
   * caller changes. See `core/apply-mode` for why the default could not simply
   * be inverted.
   */
  readonly fullApply?: boolean;

  /**
   * Opt-in permission for a non-interactive apply to replace managed files it
   * would otherwise only report as `stale`.
   *
   * Undefined — the default — keeps the conservative behaviour: a
   * non-interactive apply never replaces a file the project may have
   * customised. Set only when the operator has decided to take upstream's
   * version, which is the supported way to deliver a changed enforcement guard
   * without hand-deleting it first.
   */
  readonly refreshTemplates?: RefreshTemplates;

  /** Target harness(es) for emitted artifacts (e.g. claude | codex | fleet) */
  readonly harness: Harness;
}

/**
 * Which managed files a non-interactive apply may refresh.
 *
 * Scoping exists because the blunt form is genuinely dangerous: the managed set
 * includes files projects legitimately customise (`tsconfig.json`, `knip.json`,
 * `eslint.config.ts`). Refreshing only `scripts/lisa-hooks` to take a security
 * fix should not cost a project its build config.
 */
export type RefreshTemplates =
  /** Every stale managed file. */
  | { readonly mode: "all" }
  /** Only files at, or beneath, these repo-relative paths. */
  | { readonly mode: "paths"; readonly paths: readonly string[] };

/**
 * Whether a non-interactive apply may replace this managed file.
 * @param relativePath - Repo-relative path of the managed file
 * @param refresh - The resolved --refresh-templates selection, if any
 * @returns True when the operator opted this path in
 */
export function mayRefreshTemplate(
  relativePath: string,
  refresh: RefreshTemplates | undefined
): boolean {
  if (refresh === undefined) return false;
  if (refresh.mode === "all") return true;
  // Normalise so `scripts/lisa-hooks`, `scripts/lisa-hooks/`, and an exact file
  // path all behave the way the flag reads.
  const target = relativePath.replaceAll("\\", "/");
  return refresh.paths.some(raw => {
    const scope = stripTrailingSlashes(raw.replaceAll("\\", "/"));
    return scope === target || target.startsWith(`${scope}/`);
  });
}

/**
 * Drop trailing slashes so `scripts/lisa-hooks/` and `scripts/lisa-hooks` are
 * one scope.
 *
 * Written as a loop rather than a `/\/+$/` replace: that pattern is
 * super-linear on a pathological input, and a scope string comes straight from
 * the command line.
 * @param value - Normalised, forward-slashed path
 * @returns The path without any trailing slashes
 */
function stripTrailingSlashes(value: string): string {
  return value.endsWith("/") ? stripTrailingSlashes(value.slice(0, -1)) : value;
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
    /**
     * The managed template differs from the installed file and this apply
     * could not update it, because a non-interactive apply cannot prompt
     * before replacing a file a project may have customised.
     *
     * Distinct from "skipped" on purpose. Folding the two together is what
     * let template changes — including fixes to the enforcement guards —
     * go undelivered while the summary read exactly like a clean no-op.
     */
    | "stale"
    /**
     * A Lisa-owned artifact whose installed copy could not be proved to be
     * behind Lisa's, so it was preserved rather than overwritten.
     *
     * Emphatically not "stale" — that word says the file is out of date, and
     * here the likeliest reason it differs is that it is *ahead*. Filing the two
     * under one label would reproduce the original defect in the reporting: an
     * operator reading "out of date" about a guard they deliberately hardened
     * would fix the wrong thing.
     */
    | "host-ahead"
    | "overwritten"
    | "appended"
    | "merged"
    | "created";
  readonly linesAdded?: number;
  /**
   * Operator-readable explanation of a non-obvious outcome, shown verbatim.
   *
   * Carries the "why" for `host-ahead`, where the path alone tells an operator
   * nothing actionable and the whole point is to say what would have been lost.
   */
  readonly note?: string;
}

/**
 * Counters for operation summary
 */
export interface OperationCounters {
  copied: number;
  skipped: number;
  /** Managed files left out of date because this apply could not overwrite them. */
  stale: number;
  /** Lisa-owned artifacts preserved because the installed copy may be ahead. */
  hostAhead: number;
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
  /**
   * Managed files this run found changed upstream and left alone.
   *
   * `counters.stale` already carries how many there were, and a count is not
   * something a caller can act on or record. The apply prints the names and
   * then the install output scrolls away; the caller needs them to write into
   * the receipt so the finding outlives the terminal
   * (CodySwannGT/lisa#3033).
   */
  readonly stalePaths: readonly string[];
}

/**
 * Create initial operation counters with all values at zero
 * @returns Operation counters initialized to zero
 */
export function createInitialCounters(): OperationCounters {
  return {
    copied: 0,
    skipped: 0,
    stale: 0,
    hostAhead: 0,
    overwritten: 0,
    appended: 0,
    merged: 0,
    deleted: 0,
    ignored: 0,
    migrationsApplied: 0,
    migrationsSkipped: 0,
  };
}
