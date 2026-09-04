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

  /**
   * If true, skip the dirty git working directory check.
   *
   * Means ONLY that. Selecting the reduced apply is `postinstall`'s job
   * (CodySwannGT/lisa#3066).
   */
  readonly skipGitCheck: boolean;

  /**
   * If true, this apply declared itself a package-manager install lifecycle.
   *
   * Set by `--postinstall-safe` or `LISA_POSTINSTALL=1`, both of which every
   * Lisa-written postinstall invocation carries. This — and nothing else —
   * selects the reduced `postinstall-safe` subset, which skips every agent
   * emit (Codex, Claude, agy, Copilot, OpenCode) and the Sonar integration so
   * that `bun install` never regenerates large committed agent trees.
   *
   * It used to be inferred from `skipGitCheck`, which is the conflation
   * CodySwannGT/lisa#3066 reports: an automated caller needs the clean-tree
   * waiver for an honest reason — it has just run an install, so the tree is
   * dirty by construction — and silently got the reduced apply with no way to
   * decline. See `core/apply-mode`.
   */
  readonly postinstall?: boolean;

  /**
   * If true, run the FULL apply even inside a declared postinstall.
   *
   * The override of last resort, for an operator who means to force the
   * complete apply from inside a lifecycle script.
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
    /**
     * A template Lisa did not write because the project already configures
     * that tool under a filename Lisa's would OUTRANK.
     *
     * Distinct from "skipped" for the same reason "stale" is: `skipped` says
     * nothing changed and nothing needed to, and folding a finding into it is
     * exactly what let the previous defect stay invisible. Here something was
     * deliberately not written, and the operator needs to know both that the
     * template is absent and why — a `knip.json` written beside a repository's
     * own `knip.ts` silently replaces its settings with stack defaults
     * (CodySwannGT/lisa#3501).
     */
    | "shadowed"
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
  /** Templates not written because they would outrank the project's own config. */
  shadowed: number;
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
  /**
   * Paths whose removal is mandatory, each mapped to the reason it is.
   *
   * Since CodySwannGT/lisa#3656 a `.github/workflows/` entry only deletes a
   * file whose own ownership header says Lisa manages it, because a manifest
   * names paths and a consumer can have authored something unrelated at the
   * same one. That default is right for retiring a workflow nobody needs any
   * more, and wrong for retiring one that is actively harmful: two removals
   * already shipped on owner rulings — a caller that jammed pull requests
   * fleet-wide by pushing with `github.token` (#3590), and a drift arm whose
   * `administration:read` requirement forced a personal access token into a
   * permanent repository secret (#3599) — and both must reach an edited copy
   * too, because an edited copy does the same damage.
   *
   * So the override is per path and carries prose. The reason is not a comment:
   * it is printed next to the deletion in the install output, which is the only
   * thing standing between a consumer and a file disappearing with no
   * explanation. An entry with no honest reason to write is an entry that
   * belongs in `paths` alone.
   *
   * Only `.github/workflows/` deletions are gated today, so a reason attached
   * to any other path is recorded and unused.
   */
  readonly force?: Readonly<Record<string, string>>;
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
  /**
   * `.github/workflows/` files this run deleted.
   *
   * Carried out of the apply for the same reason as `stalePaths`, and with more
   * urgency: a deleted workflow removes its own checks, so nothing downstream
   * ever goes red to mark the loss (CodySwannGT/lisa#3656). The caller writes
   * these into the receipt so the removal is answerable after the install
   * output is gone.
   */
  readonly deletedWorkflowPaths: readonly string[];
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
    shadowed: 0,
    overwritten: 0,
    appended: 0,
    merged: 0,
    deleted: 0,
    ignored: 0,
    migrationsApplied: 0,
    migrationsSkipped: 0,
  };
}
