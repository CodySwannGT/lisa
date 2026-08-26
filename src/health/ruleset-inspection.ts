/** Structured, bounded GitHub ruleset collection and canonical comparison. */
/* eslint-disable jsdoc/require-param-description, jsdoc/require-returns, max-lines -- structured collection and normalization stay colocated */
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import type { ProjectType } from "../core/config.js";
import type { EnforcedContext } from "../core/gate-declaration-drift.js";
import { listFilesRecursive } from "../utils/file-operations.js";
import type { HealthFinding } from "./contract.js";
import { deterministicFinding, namedReason } from "./finding-utils.js";
import { projectPathKind } from "./read-only-fs.js";

const GH_TIMEOUT_MS = 15_000;
const MAX_GH_OUTPUT_BYTES = 256 * 1024;
const MAX_RULESETS = 32;
const ACTIONS_INTEGRATION_ID = 15_368;
const QUALITY_RULESET_NAME = "quality checks";
const QUALITY_WORKFLOW_NAME = "🔍 Quality Checks";
const REPOSITORY_PART = /^[A-Za-z0-9_.-]{1,100}$/u;
const RULESET_CHECK = "github.rulesets";
const WARN = "warn";
/** Where a per-repo required-check opt-in is declared. */
const CONFIGURED_CHECK_SOURCE =
  ".lisa.config.json \u2192 github.rulesets.requiredChecks";
/** Where a required run-gate context is declared. */
const DERIVED_RUN_GATE_SOURCE =
  ".lisa.config.json \u2192 gates (derived run-gate context)";
/** The declarative key, and the additive one it replaced. */
const CHECK_KEYS = ["requiredChecks", "addRequiredChecks"] as const;
/** Where a live requirement was read from. */
const LIVE_CHECK_SOURCE = "the repository's live rulesets";

/**
 * Return a sorted copy without mutating caller-owned input.
 * @param items - Caller-owned items
 * @param compare - Stable comparator
 */
function sortedCopy<T>(
  items: readonly T[],
  compare: (left: T, right: T) => number
): readonly T[] {
  const copy = [...items];
  // eslint-disable-next-line functional/immutable-data -- only the detached copy is sorted
  return copy.sort(compare);
}

/** Material ruleset fields health compares. */
export interface HealthRuleset {
  readonly name: string;
  readonly target: unknown;
  readonly enforcement: unknown;
  readonly conditions: unknown;
  readonly rules: unknown;
}

/**
 * Injectable structured ruleset reader. Implementations must honor `signal`
 * and release any owned handles before settling.
 */
export type RulesetReader = (
  owner: string,
  repo: string,
  projectRoot: string,
  timeoutMs: number,
  signal: AbortSignal
) => Promise<readonly HealthRuleset[]>;

/** Ruleset comparison result containing names only. */
export interface RulesetDrift {
  readonly missing: readonly string[];
  readonly drifted: readonly string[];
}

/** Required-check drift grouped by the ruleset that should enforce it. */
interface NamedRulesetContextDrift {
  readonly ruleset: string;
  readonly contexts: readonly string[];
}

/**
 * Run one fixed-argv bounded gh read, answering its stdout.
 *
 * Text rather than JSON, because not every bounded read this package makes is
 * one JSON document: `gh api --paginate` emits one array PER PAGE, so a
 * paginated read is a stream of values and its `--jq` output is lines. Shared
 * so there is one `gh` invocation site in this package rather than a second
 * one beside it.
 * @param argv
 * @param cwd
 * @param timeoutMs
 * @param signal
 */
export function readGhText(
  argv: readonly string[],
  cwd: string,
  timeoutMs: number,
  signal: AbortSignal
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      // eslint-disable-next-line sonarjs/no-os-command-from-path -- fixed user-installed gh executable
      "gh",
      [...argv],
      {
        cwd,
        encoding: "utf8",
        maxBuffer: MAX_GH_OUTPUT_BYTES,
        signal,
        killSignal: "SIGKILL",
        timeout: Math.max(1, Math.min(timeoutMs, GH_TIMEOUT_MS)),
      },
      (error, stdout) => {
        if (error !== null) {
          reject(error);
          return;
        }
        resolve(stdout);
      }
    );
  });
}

/**
 * Run one fixed-argv bounded gh JSON read.
 * @param argv
 * @param cwd
 * @param timeoutMs
 * @param signal
 */
async function readGhJson(
  argv: readonly string[],
  cwd: string,
  timeoutMs: number,
  signal: AbortSignal
): Promise<unknown> {
  return JSON.parse(await readGhText(argv, cwd, timeoutMs, signal)) as unknown;
}

/**
 * Validate and project one detailed GitHub ruleset response.
 * @param candidate
 */
function projectRuleset(candidate: unknown): HealthRuleset {
  if (candidate === null || typeof candidate !== "object") {
    throw new Error("Ruleset detail was not an object");
  }
  const name = Reflect.get(candidate, "name");
  if (typeof name !== "string" || name.trim().length === 0) {
    throw new Error("Ruleset detail omitted its name");
  }
  return {
    name,
    target: Reflect.get(candidate, "target"),
    enforcement: Reflect.get(candidate, "enforcement"),
    conditions: Reflect.get(candidate, "conditions"),
    rules: Reflect.get(candidate, "rules"),
  };
}

/**
 * Default fixed-argv detailed GitHub ruleset reader.
 * @param owner
 * @param repo
 * @param projectRoot
 * @param timeoutMs
 * @param signal
 */
export const readGithubRulesets: RulesetReader = async (
  owner,
  repo,
  projectRoot,
  timeoutMs,
  signal
) => {
  const listed = await readGhJson(
    ["api", "-X", "GET", `repos/${owner}/${repo}/rulesets`],
    projectRoot,
    timeoutMs,
    signal
  );
  if (!Array.isArray(listed) || listed.length > MAX_RULESETS) {
    throw new Error("Ruleset list exceeded its bounded contract");
  }
  const details = await Promise.all(
    listed.map(async entry => {
      if (entry === null || typeof entry !== "object") {
        throw new Error("Ruleset list entry was not an object");
      }
      const id = Reflect.get(entry, "id");
      if (!Number.isSafeInteger(id)) {
        throw new Error("Ruleset list entry omitted its id");
      }
      return projectRuleset(
        await readGhJson(
          ["api", "-X", "GET", `repos/${owner}/${repo}/rulesets/${String(id)}`],
          projectRoot,
          timeoutMs,
          signal
        )
      );
    })
  );
  return sortedCopy(details, (left, right) =>
    left.name.localeCompare(right.name)
  );
};

/**
 * Read configured required-check opt-outs without exposing their values.
 * @param config
 */
function droppedChecks(
  config: Readonly<Record<string, unknown>>
): ReadonlySet<string> {
  const github = config.github;
  const rulesets =
    github !== null && typeof github === "object" && !Array.isArray(github)
      ? Reflect.get(github, "rulesets")
      : undefined;
  const dropped =
    rulesets !== null &&
    typeof rulesets === "object" &&
    !Array.isArray(rulesets)
      ? Reflect.get(rulesets, "dropRequiredChecks")
      : undefined;
  return new Set(
    Array.isArray(dropped)
      ? dropped.filter(item => typeof item === "string")
      : []
  );
}

/**
 * Read the per-repo required-check opt-INs for one ruleset.
 *
 * Mirrors `add_config_required_checks` in scripts/lisa-github-rulesets.sh. A
 * repository-specific high-signal check cannot live in a shared template — host
 * projects would inherit a context they never report, and a required check that
 * never reports blocks every pull request (#2476). It is declared per repo
 * instead, and this reader is what keeps `lisa health` from calling the
 * resulting live ruleset "drifted".
 *
 * Both keys are read. `requiredChecks` is the declarative one; `addRequiredChecks`
 * is the additive one it replaced, still honoured so an installed project keeps
 * reporting truthfully until it renames the key. Reading only the new name
 * would make every not-yet-migrated repository's live ruleset read as drifted,
 * which is a false alarm whose obvious fix is deleting a real requirement.
 * @param config
 * @param rulesetName
 */
function addedChecks(
  config: Readonly<Record<string, unknown>>,
  rulesetName: string
): readonly Readonly<Record<string, unknown>>[] {
  const github = config.github;
  const rulesets =
    github !== null && typeof github === "object" && !Array.isArray(github)
      ? Reflect.get(github, "rulesets")
      : undefined;
  const declarations =
    rulesets !== null &&
    typeof rulesets === "object" &&
    !Array.isArray(rulesets)
      ? CHECK_KEYS.map(key => Reflect.get(rulesets, key))
      : [];
  const forRuleset = declarations
    .map(additions =>
      additions !== null &&
      typeof additions === "object" &&
      !Array.isArray(additions)
        ? Reflect.get(additions, rulesetName)
        : undefined
    )
    .find(entry => Array.isArray(entry));
  if (!Array.isArray(forRuleset)) return [];
  return forRuleset.flatMap(entry => {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      return [];
    }
    const context = Reflect.get(entry, "context");
    if (typeof context !== "string") return [];
    const integration = Reflect.get(entry, "integration_id");
    return [
      {
        context,
        integration_id:
          typeof integration === "number"
            ? integration
            : ACTIONS_INTEGRATION_ID,
      },
    ];
  });
}

/**
 * Merge per-repo additions into a template's rules, exactly as apply does.
 *
 * Runs BEFORE the no-workflows strip and before `dropRequiredChecks`, so both
 * of those still win over an addition — matching the shell applier's ordering.
 * @param rules
 * @param added
 */
function withAddedChecks(
  rules: unknown,
  added: readonly Readonly<Record<string, unknown>>[]
): unknown {
  if (added.length === 0) return rules;
  const existing = Array.isArray(rules) ? rules : [];
  const hasRequiredRule = existing.some(
    rule =>
      rule !== null &&
      typeof rule === "object" &&
      Reflect.get(rule, "type") === "required_status_checks"
  );
  if (!hasRequiredRule) {
    return [
      ...existing,
      {
        type: "required_status_checks",
        parameters: {
          strict_required_status_checks_policy: false,
          do_not_enforce_on_create: true,
          required_status_checks: added,
        },
      },
    ];
  }
  return existing.map(rule => {
    if (
      rule === null ||
      typeof rule !== "object" ||
      Reflect.get(rule, "type") !== "required_status_checks"
    ) {
      return rule;
    }
    const parameters = Reflect.get(rule, "parameters");
    if (parameters === null || typeof parameters !== "object") return rule;
    const checks = Reflect.get(parameters, "required_status_checks");
    if (!Array.isArray(checks)) return rule;
    const present = new Set(
      checks.flatMap(check => {
        const context =
          check !== null && typeof check === "object"
            ? Reflect.get(check, "context")
            : undefined;
        return typeof context === "string" ? [context] : [];
      })
    );
    return {
      ...rule,
      parameters: {
        ...parameters,
        required_status_checks: [
          ...checks,
          ...added.filter(check => !present.has(String(check.context))),
        ],
      },
    };
  });
}

/**
 * Derive the Actions contexts required run gates post through the quality
 * workflow. Awaited gates remain in the generated base ruleset so their
 * external integration pin is preserved rather than replaced with Actions.
 * @param lisaRoot
 * @param config
 */
async function derivedRunGateChecks(
  lisaRoot: string,
  config: Readonly<Record<string, unknown>>
): Promise<readonly Readonly<Record<string, unknown>>[]> {
  const entry = pathToFileURL(
    path.join(lisaRoot, "all", "copy-overwrite", "scripts", "lisa-gates.mjs")
  ).href;
  const loaded = await (
    import(entry) as Promise<{
      contextsFor?: (
        gates: Record<string, unknown>,
        options: Record<string, unknown>
      ) => unknown;
    }>
  ).catch(() => null);
  if (typeof loaded?.contextsFor !== "function") return [];
  const { runner: _runner, ...gates } = (config.gates ?? {}) as Record<
    string,
    unknown
  >;
  try {
    const contexts = loaded.contextsFor(gates, {
      moment: "pull-request",
      workflowName: QUALITY_WORKFLOW_NAME,
      mode: "run",
    });
    if (!Array.isArray(contexts)) return [];
    return contexts.flatMap(context =>
      typeof context === "string"
        ? [{ context, integration_id: ACTIONS_INTEGRATION_ID }]
        : []
    );
  } catch {
    return [];
  }
}

/**
 * Add derived checks only to the ruleset that owns the quality workflow.
 * @param rules - Candidate ruleset rules
 * @param rulesetName - Ruleset receiving the candidate rules
 * @param checks - Derived workflow-posted checks
 */
function withDerivedRunGateChecks(
  rules: unknown,
  rulesetName: string,
  checks: readonly Readonly<Record<string, unknown>>[]
): unknown {
  return rulesetName === QUALITY_RULESET_NAME
    ? withAddedChecks(rules, checks)
    : rules;
}

/**
 * Normalize one ruleset exactly as the applier does.
 * @param projected - Projected ruleset document
 * @param configured - Per-repository configured additions
 * @param derived - Required contexts derived from run gates
 * @param hasWorkflows - Whether Actions contexts can report
 * @param dropped - Contexts the repository explicitly drops
 */
function normalizedProjectRules(
  projected: HealthRuleset,
  configured: readonly Readonly<Record<string, unknown>>[],
  derived: readonly Readonly<Record<string, unknown>>[],
  hasWorkflows: boolean,
  dropped: ReadonlySet<string>
): unknown {
  return normalizeExpectedRules(
    withAddedChecks(
      withDerivedRunGateChecks(projected.rules, projected.name, derived),
      configured
    ),
    hasWorkflows,
    dropped
  );
}

/**
 * Attribute one normalized context to the declaration that supplied it.
 * @param context - Required status context
 * @param configured - Per-repository configured checks
 * @param derived - Checks derived from run-gate declarations
 * @param template - Shipped template source path
 */
function enforcementSource(
  context: string,
  configured: readonly Readonly<Record<string, unknown>>[],
  derived: readonly Readonly<Record<string, unknown>>[],
  template: string
): string {
  if (configured.some(check => check.context === context)) {
    return CONFIGURED_CHECK_SOURCE;
  }
  return derived.some(check => check.context === context)
    ? DERIVED_RUN_GATE_SOURCE
    : template;
}

/**
 * Apply workflow and configured required-check normalization used by apply.
 * @param rules
 * @param hasWorkflows
 * @param dropped
 */
function normalizeExpectedRules(
  rules: unknown,
  hasWorkflows: boolean,
  dropped: ReadonlySet<string>
): unknown {
  if (!Array.isArray(rules)) return rules;
  return rules.flatMap(rule => {
    if (
      rule === null ||
      typeof rule !== "object" ||
      Reflect.get(rule, "type") !== "required_status_checks"
    ) {
      return [rule];
    }
    const parameters = Reflect.get(rule, "parameters");
    if (parameters === null || typeof parameters !== "object") return [rule];
    const checks = Reflect.get(parameters, "required_status_checks");
    if (!Array.isArray(checks)) return [rule];
    const retained = checks.filter(check => {
      if (check === null || typeof check !== "object") return true;
      const integration = Reflect.get(check, "integration_id");
      const context = Reflect.get(check, "context");
      return (
        (hasWorkflows || integration !== ACTIONS_INTEGRATION_ID) &&
        (typeof context !== "string" || !dropped.has(context))
      );
    });
    if (retained.length === 0) return [];
    return [
      {
        ...rule,
        parameters: { ...parameters, required_status_checks: retained },
      },
    ];
  });
}

/** Where the `base` ruleset comes from now that no template ships it. */
const GENERATED_BASE_SOURCE = ".lisa.config.json (generated base ruleset)";

/**
 * The `base` ruleset the applier will generate for this project.
 *
 * `all/github-rulesets/base.json` was deleted: seven of its fields duplicated
 * the `policy` block, four more could not be declared at all, and it pinned two
 * vendor status checks every repository inherited. The applier builds the
 * payload from config now, so a health reader that only walked
 * `<type>/github-rulesets/` would go blind to the one ruleset that carries a
 * repository's branch protection — and report its live contexts as owned by
 * nobody.
 *
 * Loaded from the installed Lisa package at runtime rather than reimplemented
 * here. A second implementation of the payload is the exact defect this
 * replaced: two writers for one setting, with nothing comparing them.
 * @param lisaRoot - Lisa package root
 * @param config - Safe project config
 * @returns The generated ruleset, or nothing when the generator is unavailable
 */
async function generatedBaseRuleset(
  lisaRoot: string,
  config: Readonly<Record<string, unknown>>
): Promise<readonly HealthRuleset[]> {
  const entry = pathToFileURL(
    path.join(lisaRoot, "scripts", "lisa-ruleset-payload.mjs")
  ).href;
  const loaded = await (
    import(entry) as Promise<{
      buildRulesetPayload?: (input: object) => unknown;
    }>
  ).catch(() => null);
  const build = loaded?.buildRulesetPayload;
  if (typeof build !== "function") return [];
  const { runner: _runner, ...gates } = (config.gates ?? {}) as Record<
    string,
    unknown
  >;
  try {
    return [projectRuleset(build({ gates, policy: config.policy ?? {} }))];
  } catch {
    return [];
  }
}

/**
 * Read expected material rulesets after the same per-project normalization as apply.
 * @param lisaRoot - Lisa package root
 * @param projectRoot - Canonical host root
 * @param types - Canonically ordered project types
 * @param config - Safe project config
 * @returns Expected rulesets sorted by name
 */
// eslint-disable-next-line sonarjs/cognitive-complexity -- normalization mirrors the apply contract explicitly
export async function expectedRulesets(
  lisaRoot: string,
  projectRoot: string,
  types: readonly ProjectType[],
  config: Readonly<Record<string, unknown>>
): Promise<readonly HealthRuleset[]> {
  const hasWorkflows =
    (await projectPathKind(projectRoot, path.join(".github", "workflows"))) ===
    "directory";
  const dropped = droppedChecks(config);
  const derivedRunChecks = await derivedRunGateChecks(lisaRoot, config);
  const byName = new Map<string, HealthRuleset>();
  for (const parsed of await generatedBaseRuleset(lisaRoot, config)) {
    const projected = projectRuleset(parsed);
    const normalized = {
      ...projected,
      rules: normalizedProjectRules(
        projected,
        addedChecks(config, projected.name),
        derivedRunChecks,
        hasWorkflows,
        dropped
      ),
    };
    if (!Array.isArray(normalized.rules) || normalized.rules.length > 0) {
      // eslint-disable-next-line functional/immutable-data -- most-specific stack wins in the bounded plan
      byName.set(normalized.name, normalized);
    }
  }
  for (const type of ["all", ...types]) {
    const directory = path.join(lisaRoot, type, "github-rulesets");
    try {
      for (const file of await listFilesRecursive(directory)) {
        const parsed = JSON.parse(await readFile(file, "utf8")) as unknown;
        const projected = projectRuleset(parsed);
        const normalized = {
          ...projected,
          rules: normalizedProjectRules(
            projected,
            addedChecks(config, projected.name),
            derivedRunChecks,
            hasWorkflows,
            dropped
          ),
        };
        if (!Array.isArray(normalized.rules) || normalized.rules.length > 0) {
          // eslint-disable-next-line functional/immutable-data -- most-specific stack wins in the bounded plan
          byName.set(normalized.name, normalized);
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return [...byName.values()].sort((left, right) =>
    left.name.localeCompare(right.name)
  );
}

/**
 * The required status contexts one project's ruleset templates name, with the
 * file each requirement was read from.
 *
 * `expectedRulesets` already normalizes templates the way apply does, but it
 * answers with whole ruleset documents and loses which file said what. The
 * declaration comparison has to name the template file — "this context is
 * required and no declaration asks for it" is not actionable without it — so
 * this walk keeps the attribution instead.
 *
 * Returning an empty list is meaningful and must not be read as "nothing is
 * enforced": callers treat an empty result as a source they could not reach,
 * because a comparison against nothing reports every declaration as unenforced.
 * @param lisaRoot - Lisa package root
 * @param projectRoot - Canonical host root
 * @param types - Canonically ordered project types
 * @param config - Safe project config
 * @returns Required contexts with their ruleset and source file
 */
export async function expectedRequiredContexts(
  lisaRoot: string,
  projectRoot: string,
  types: readonly ProjectType[],
  config: Readonly<Record<string, unknown>>
): Promise<readonly EnforcedContext[]> {
  const hasWorkflows =
    (await projectPathKind(projectRoot, path.join(".github", "workflows"))) ===
    "directory";
  const dropped = droppedChecks(config);
  const derivedRunChecks = await derivedRunGateChecks(lisaRoot, config);
  const byName = new Map<string, readonly EnforcedContext[]>();
  for (const parsed of await generatedBaseRuleset(lisaRoot, config)) {
    const projected = projectRuleset(parsed);
    const added = addedChecks(config, projected.name);
    const rules = normalizedProjectRules(
      projected,
      added,
      derivedRunChecks,
      hasWorkflows,
      dropped
    );
    // eslint-disable-next-line functional/immutable-data -- most-specific stack wins, matching expectedRulesets
    byName.set(
      projected.name,
      [...requiredStatusChecksByContext(rules).keys()].map(context => ({
        context,
        ruleset: projected.name,
        source: GENERATED_BASE_SOURCE,
      }))
    );
  }
  for (const type of ["all", ...types]) {
    const directory = path.join(lisaRoot, type, "github-rulesets");
    try {
      for (const file of await listFilesRecursive(directory)) {
        const parsed = JSON.parse(await readFile(file, "utf8")) as unknown;
        const projected = projectRuleset(parsed);
        const added = addedChecks(config, projected.name);
        const rules = normalizedProjectRules(
          projected,
          added,
          derivedRunChecks,
          hasWorkflows,
          dropped
        );
        const template = path
          .relative(lisaRoot, file)
          .split(path.sep)
          .join(path.posix.sep);
        // eslint-disable-next-line functional/immutable-data -- most-specific stack wins, matching expectedRulesets
        byName.set(
          projected.name,
          [...requiredStatusChecksByContext(rules).keys()].map(context => ({
            context,
            ruleset: projected.name,
            source: enforcementSource(
              context,
              added,
              derivedRunChecks,
              template
            ),
          }))
        );
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return sortedCopy([...byName.values()].flat(), (left, right) =>
    left.context.localeCompare(right.context)
  );
}

/**
 * The required status contexts a live ruleset payload names.
 * @param actual - Rulesets as the repository actually holds them
 * @returns Required contexts with their ruleset, sorted
 */
export function liveRequiredContexts(
  actual: readonly HealthRuleset[]
): readonly EnforcedContext[] {
  return sortedCopy(
    actual.flatMap(ruleset =>
      [...requiredStatusChecksByContext(ruleset.rules).keys()].map(context => ({
        context,
        ruleset: ruleset.name,
        source: LIVE_CHECK_SOURCE,
      }))
    ),
    (left, right) => left.context.localeCompare(right.context)
  );
}

/**
 * Canonicalize semantically unordered JSON objects and arrays.
 * @param value
 */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value
      .map(canonical)
      .sort((left, right) =>
        JSON.stringify(left).localeCompare(JSON.stringify(right))
      );
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonical(item)])
    );
  }
  return value;
}

/**
 * Remove read-only defaults GitHub may add to otherwise equivalent rules.
 * This projection is applied symmetrically so authored non-default values
 * remain material.
 * @param value
 */
function withoutGithubDefaults(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutGithubDefaults);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).flatMap(([key, item]) =>
        key === "required_reviewers" && Array.isArray(item) && item.length === 0
          ? []
          : [[key, withoutGithubDefaults(item)]]
      )
    );
  }
  return value;
}

/**
 * Extract required status checks by context from a material ruleset.
 * @param rules
 */
function requiredStatusChecksByContext(
  rules: unknown
): ReadonlyMap<string, unknown> {
  if (!Array.isArray(rules)) return new Map();
  const entries = rules.flatMap(rule => {
    if (
      rule === null ||
      typeof rule !== "object" ||
      Reflect.get(rule, "type") !== "required_status_checks"
    ) {
      return [];
    }
    const parameters = Reflect.get(rule, "parameters");
    if (parameters === null || typeof parameters !== "object") return [];
    const checks = Reflect.get(parameters, "required_status_checks");
    if (!Array.isArray(checks)) return [];
    return checks.flatMap(check => {
      if (check === null || typeof check !== "object") return [];
      const context = Reflect.get(check, "context");
      return typeof context === "string" ? [[context, check] as const] : [];
    });
  });
  return new Map(entries);
}

/**
 * Project actual rules onto expected required-check contexts.
 *
 * Host-added required contexts are enforcement, not drift. Comparing the whole
 * live list would make doctor pressure operators to remove checks Lisa cannot
 * preserve safely.
 * @param actualRules
 * @param expectedRules
 */
function comparableActualRules(
  actualRules: unknown,
  expectedRules: unknown
): unknown {
  const expectedContexts = new Set(
    requiredStatusChecksByContext(expectedRules).keys()
  );
  if (!Array.isArray(actualRules) || expectedContexts.size === 0) {
    return actualRules;
  }
  return actualRules.map(rule => {
    if (
      rule === null ||
      typeof rule !== "object" ||
      Reflect.get(rule, "type") !== "required_status_checks"
    ) {
      return rule;
    }
    const parameters = Reflect.get(rule, "parameters");
    if (parameters === null || typeof parameters !== "object") return rule;
    const checks = Reflect.get(parameters, "required_status_checks");
    if (!Array.isArray(checks)) return rule;
    return {
      ...rule,
      parameters: {
        ...parameters,
        required_status_checks: checks.filter(check => {
          if (check === null || typeof check !== "object") return true;
          const context = Reflect.get(check, "context");
          return typeof context !== "string" || expectedContexts.has(context);
        }),
      },
    };
  });
}

/**
 * List Lisa-required checks absent from a live ruleset.
 * @param expected
 * @param actual
 */
function missingRequiredContexts(
  expected: HealthRuleset,
  actual: HealthRuleset | undefined
): readonly string[] {
  const actualContexts = requiredStatusChecksByContext(actual?.rules);
  return sortedCopy(
    [...requiredStatusChecksByContext(expected.rules).keys()].filter(
      context => !actualContexts.has(context)
    ),
    (left, right) => left.localeCompare(right)
  );
}

/**
 * Name missing required-check enforcement by ruleset.
 * @param expected
 * @param actual
 */
function requiredContextDrift(
  expected: readonly HealthRuleset[],
  actual: readonly HealthRuleset[]
): readonly NamedRulesetContextDrift[] {
  const observed = new Map(actual.map(item => [item.name, item]));
  return expected.flatMap(item => {
    const contexts = missingRequiredContexts(item, observed.get(item.name));
    return contexts.length === 0 ? [] : [{ ruleset: item.name, contexts }];
  });
}

/**
 * Compare expected and observed material ruleset documents.
 * @param expected
 * @param actual
 */
export function compareRulesets(
  expected: readonly HealthRuleset[],
  actual: readonly HealthRuleset[]
): RulesetDrift {
  const observed = new Map(actual.map(item => [item.name, item]));
  const missing = expected
    .filter(item => !observed.has(item.name))
    .map(item => item.name);
  const drifted = expected.flatMap(item => {
    const present = observed.get(item.name);
    if (present === undefined) return [];
    const expectedMaterial = canonical(
      withoutGithubDefaults({
        target: item.target,
        enforcement: item.enforcement,
        conditions: item.conditions,
        rules: item.rules,
      })
    );
    const actualMaterial = canonical(
      withoutGithubDefaults({
        target: present.target,
        enforcement: present.enforcement,
        conditions: present.conditions,
        rules: comparableActualRules(present.rules, item.rules),
      })
    );
    if (JSON.stringify(expectedMaterial) !== JSON.stringify(actualMaterial)) {
      return [item.name];
    }
    return [];
  });
  return {
    missing: sortedCopy(missing, (left, right) => left.localeCompare(right)),
    drifted: sortedCopy(drifted, (left, right) => left.localeCompare(right)),
  };
}

/**
 * Extract a safe GitHub target without reporting configured values.
 * @param config
 */
function githubTarget(
  config: Readonly<Record<string, unknown>>
): { readonly owner: string; readonly repo: string } | undefined {
  const github = config.github;
  if (github === null || typeof github !== "object" || Array.isArray(github)) {
    return undefined;
  }
  const owner = Reflect.get(github, "org");
  const repo = Reflect.get(github, "repo");
  return typeof owner === "string" &&
    typeof repo === "string" &&
    REPOSITORY_PART.test(owner) &&
    REPOSITORY_PART.test(repo)
    ? { owner, repo }
    : undefined;
}

/**
 * Collect and compare detailed material GitHub ruleset state.
 * @param lisaRoot - Lisa package root
 * @param projectRoot - Canonical host root
 * @param types - Safely detected project types
 * @param config - Safe project config
 * @param reader - Structured remote ruleset reader
 * @param timeoutMs - Remaining shared deadline
 * @param signal - Shared cancellation signal
 * @returns GitHub ruleset finding
 */
export async function rulesetFinding(
  lisaRoot: string,
  projectRoot: string,
  types: readonly ProjectType[],
  config: Readonly<Record<string, unknown>>,
  reader: RulesetReader,
  timeoutMs: number,
  signal: AbortSignal
): Promise<HealthFinding> {
  const target = githubTarget(config);
  if (target === undefined) {
    return deterministicFinding(
      "github.rulesets",
      "warn",
      "GitHub rulesets are unavailable without a configured repository."
    );
  }
  const actual = await reader(
    target.owner,
    target.repo,
    projectRoot,
    timeoutMs,
    signal
  ).catch(() => undefined);
  if (actual === undefined) {
    return deterministicFinding(
      RULESET_CHECK,
      WARN,
      "GitHub rulesets could not be observed within the deterministic deadline."
    );
  }
  const expected = await expectedRulesets(lisaRoot, projectRoot, types, config);
  const drift = compareRulesets(expected, actual);
  const contextDrift = requiredContextDrift(expected, actual);
  const missingContextsByRuleset = new Map(
    contextDrift.map(item => [item.ruleset, item.contexts])
  );
  const names = [
    ...drift.missing.map(name => {
      const contexts = missingContextsByRuleset.get(name) ?? [];
      return contexts.length === 0
        ? `${name} missing`
        : `${name} missing; runs without blocking: ${contexts.join(", ")}`;
    }),
    ...drift.drifted.map(name => {
      const contexts = missingContextsByRuleset.get(name) ?? [];
      return contexts.length === 0
        ? `${name} drifted`
        : `${name} drifted; runs without blocking: ${contexts.join(", ")}`;
    }),
  ];
  return names.length === 0
    ? deterministicFinding(
        RULESET_CHECK,
        "pass",
        "Required GitHub rulesets are active and materially current."
      )
    : deterministicFinding(
        RULESET_CHECK,
        "fail",
        namedReason("GitHub ruleset drift", names)
      );
}
/* eslint-enable jsdoc/require-param-description, jsdoc/require-returns, max-lines -- restore repository defaults */
