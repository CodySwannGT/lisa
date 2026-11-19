/**
 * The required checks a project's own configuration contributes to its
 * expected rulesets: per-repository opt-ins and opt-outs, run-gate contexts,
 * and the generated `base` ruleset.
 * @module health/ruleset-config-checks
 */
import path from "node:path";
import { pathToFileURL } from "node:url";

import { projectRuleset, type HealthRuleset } from "./ruleset-gh.js";
import {
  ACTIONS_INTEGRATION_ID,
  type RequiredCheck,
} from "./ruleset-normalize.js";

const QUALITY_WORKFLOW_NAME = "🔍 Quality Checks";
/** The declarative key, and the additive one it replaced. */
const CHECK_KEYS = ["requiredChecks", "addRequiredChecks"] as const;
/** Where a per-repo required-check opt-in is declared. */
const CONFIGURED_CHECK_SOURCE =
  ".lisa.config.json → github.rulesets.requiredChecks";
/** Where a required run-gate context is declared. */
const DERIVED_RUN_GATE_SOURCE =
  ".lisa.config.json → gates (derived run-gate context)";

/**
 * Read `github.rulesets` from a project config.
 * @param config - Safe project config
 * @returns The rulesets object, or undefined when absent or malformed
 */
function rulesetsConfig(
  config: Readonly<Record<string, unknown>>
): object | undefined {
  const github = config.github;
  const rulesets =
    github !== null && typeof github === "object" && !Array.isArray(github)
      ? Reflect.get(github, "rulesets")
      : undefined;
  return rulesets !== null &&
    typeof rulesets === "object" &&
    !Array.isArray(rulesets)
    ? rulesets
    : undefined;
}

/**
 * Read the run-gate declarations without the runner block.
 * @param config - Safe project config
 * @returns The declared gates
 */
function declaredGates(
  config: Readonly<Record<string, unknown>>
): Record<string, unknown> {
  const { runner: _runner, ...gates } = (config.gates ?? {}) as Record<
    string,
    unknown
  >;
  return gates;
}

/**
 * Read configured required-check opt-outs without exposing their values.
 * @param config - Safe project config
 * @returns The contexts the repository drops
 */
export function droppedChecks(
  config: Readonly<Record<string, unknown>>
): ReadonlySet<string> {
  const rulesets = rulesetsConfig(config);
  const dropped =
    rulesets === undefined
      ? undefined
      : Reflect.get(rulesets, "dropRequiredChecks");
  return new Set(
    Array.isArray(dropped)
      ? dropped.filter(item => typeof item === "string")
      : []
  );
}

/**
 * Project one declared opt-in into a required check.
 * @param entry - Untrusted declaration entry
 * @returns The check, or nothing when the entry names no context
 */
function declaredCheck(entry: unknown): readonly RequiredCheck[] {
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
        typeof integration === "number" ? integration : ACTIONS_INTEGRATION_ID,
    },
  ];
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
 * @param config - Safe project config
 * @param rulesetName - Ruleset whose opt-ins to read
 * @returns The checks the repository adds to that ruleset
 */
export function addedChecks(
  config: Readonly<Record<string, unknown>>,
  rulesetName: string
): readonly RequiredCheck[] {
  const rulesets = rulesetsConfig(config);
  const declarations =
    rulesets === undefined
      ? []
      : CHECK_KEYS.map(key => Reflect.get(rulesets, key));
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
  return forRuleset.flatMap(declaredCheck);
}

/**
 * Derive the Actions contexts required run gates post through the quality
 * workflow. Awaited gates remain in the generated base ruleset so their
 * external integration pin is preserved rather than replaced with Actions.
 * @param lisaRoot - Lisa package root holding the shipped templates
 * @param config - Safe project config
 * @returns Required checks the run gates post
 */
export async function derivedRunGateChecks(
  lisaRoot: string,
  config: Readonly<Record<string, unknown>>
): Promise<readonly RequiredCheck[]> {
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
  const gates = declaredGates(config);
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
 * Attribute one normalized context to the declaration that supplied it.
 * @param context - Required status context
 * @param configured - Per-repository configured checks
 * @param derived - Checks derived from run-gate declarations
 * @param template - Shipped template source path
 * @returns The declaration that requires the context
 */
export function enforcementSource(
  context: string,
  configured: readonly RequiredCheck[],
  derived: readonly RequiredCheck[],
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
export async function generatedBaseRuleset(
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
  const gates = declaredGates(config);
  try {
    return [projectRuleset(build({ gates, policy: config.policy ?? {} }))];
  } catch {
    return [];
  }
}
