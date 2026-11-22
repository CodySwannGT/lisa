/**
 * The rulesets — and the required contexts they enforce — a project should
 * hold, read from Lisa's generated base ruleset and shipped templates after
 * the same per-project normalization the applier performs.
 *
 * Templates are walked most-general first (`all`, then each detected type);
 * a later ruleset of the same name replaces an earlier one, so the most
 * specific stack wins.
 * @module health/ruleset-expected
 */
import { readFile } from "node:fs/promises";
import path from "node:path";

import type { ProjectType } from "../core/config.js";
import type { EnforcedContext } from "../core/gate-declaration-drift.js";
import { listFilesRecursive } from "../utils/file-operations.js";
import { projectPathKind } from "./read-only-fs.js";
import {
  addedChecks,
  derivedRunGateChecks,
  droppedChecks,
  enforcementSource,
  generatedBaseRuleset,
} from "./ruleset-config-checks.js";
import {
  projectRuleset,
  sortedCopy,
  type HealthRuleset,
} from "./ruleset-gh.js";
import {
  normalizedProjectRules,
  requiredStatusChecksByContext,
  type RequiredCheck,
  type RulesetNormalization,
} from "./ruleset-normalize.js";

/** Where the `base` ruleset comes from now that no template ships it. */
const GENERATED_BASE_SOURCE = ".lisa.config.json (generated base ruleset)";
/** Where a live requirement was read from. */
const LIVE_CHECK_SOURCE = "the repository's live rulesets";

/** One expected ruleset, normalized, with the file that declared it. */
interface NormalizedSource {
  readonly projected: HealthRuleset;
  readonly added: readonly RequiredCheck[];
  readonly rules: unknown;
  /** Lisa-relative template path, or undefined for the generated base. */
  readonly template: string | undefined;
}

/**
 * Report whether an error is a missing-path error.
 * @param error - Caught error
 * @returns True for ENOENT
 */
function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === "ENOENT";
}

/**
 * Parse template files in order, stopping at the first one that vanished —
 * the original walk caught that inside the per-type loop and kept what it had.
 * @param files - Template files in listing order
 * @returns Each file with its parsed document
 */
async function readUntilMissing(
  files: readonly string[]
): Promise<readonly { file: string; parsed: unknown }[]> {
  const [file, ...rest] = files;
  if (file === undefined) return [];
  const text = await readFile(file, "utf8").catch((error: unknown) => {
    if (isMissing(error)) return undefined;
    throw error;
  });
  if (text === undefined) return [];
  const parsed = JSON.parse(text) as unknown;
  return [{ file, parsed }, ...(await readUntilMissing(rest))];
}

/**
 * Read the ruleset templates one project type ships, absent directories empty.
 * @param lisaRoot - Lisa package root
 * @param type - `all` or a project type
 * @returns Parsed templates in listing order
 */
async function readTypeTemplates(
  lisaRoot: string,
  type: string
): Promise<readonly { file: string; parsed: unknown }[]> {
  const directory = path.join(lisaRoot, type, "github-rulesets");
  const files = await listFilesRecursive(directory).catch((error: unknown) => {
    if (isMissing(error)) return [];
    throw error;
  });
  return readUntilMissing(files);
}

/**
 * Read the templates for every type, sequentially and most-general first.
 * @param lisaRoot - Lisa package root
 * @param types - Remaining types to read, in order
 * @returns Parsed templates in walk order
 */
async function readAllTemplates(
  lisaRoot: string,
  types: readonly string[]
): Promise<readonly { file: string; parsed: unknown }[]> {
  const [type, ...rest] = types;
  if (type === undefined) return [];
  const templates = await readTypeTemplates(lisaRoot, type);
  return [...templates, ...(await readAllTemplates(lisaRoot, rest))];
}

/**
 * Normalize one parsed ruleset document against the repository's facts.
 * @param parsed - Parsed ruleset document
 * @param config - Safe project config
 * @param normalization - Derived checks, workflow presence and dropped contexts
 * @param template - Lisa-relative template path, or undefined for the base
 * @returns The normalized source
 */
function normalizeSource(
  parsed: unknown,
  config: Readonly<Record<string, unknown>>,
  normalization: RulesetNormalization,
  template: string | undefined
): NormalizedSource {
  const projected = projectRuleset(parsed);
  const added = addedChecks(config, projected.name);
  return {
    projected,
    added,
    rules: normalizedProjectRules(projected, added, normalization),
    template,
  };
}

/**
 * Collect every expected ruleset in walk order, normalized as apply does.
 * @param lisaRoot - Lisa package root
 * @param projectRoot - Canonical host root
 * @param types - Canonically ordered project types
 * @param config - Safe project config
 * @returns The normalization facts and every normalized source
 */
async function normalizedSources(
  lisaRoot: string,
  projectRoot: string,
  types: readonly ProjectType[],
  config: Readonly<Record<string, unknown>>
): Promise<{
  readonly normalization: RulesetNormalization;
  readonly sources: readonly NormalizedSource[];
}> {
  const hasWorkflows =
    (await projectPathKind(projectRoot, path.join(".github", "workflows"))) ===
    "directory";
  const dropped = droppedChecks(config);
  const derived = await derivedRunGateChecks(lisaRoot, config);
  const normalization = { derived, hasWorkflows, dropped };
  const base = await generatedBaseRuleset(lisaRoot, config);
  const templates = await readAllTemplates(lisaRoot, ["all", ...types]);
  const sources = [
    ...base.map(parsed =>
      normalizeSource(parsed, config, normalization, undefined)
    ),
    ...templates.map(({ file, parsed }) =>
      normalizeSource(
        parsed,
        config,
        normalization,
        path.relative(lisaRoot, file).split(path.sep).join(path.posix.sep)
      )
    ),
  ];
  return { normalization, sources };
}

/**
 * Read expected material rulesets after the same per-project normalization as apply.
 * @param lisaRoot - Lisa package root
 * @param projectRoot - Canonical host root
 * @param types - Canonically ordered project types
 * @param config - Safe project config
 * @returns Expected rulesets sorted by name
 */
export async function expectedRulesets(
  lisaRoot: string,
  projectRoot: string,
  types: readonly ProjectType[],
  config: Readonly<Record<string, unknown>>
): Promise<readonly HealthRuleset[]> {
  const { sources } = await normalizedSources(
    lisaRoot,
    projectRoot,
    types,
    config
  );
  const byName = new Map(
    sources
      .filter(source => !Array.isArray(source.rules) || source.rules.length > 0)
      .map(source => [
        source.projected.name,
        { ...source.projected, rules: source.rules },
      ])
  );
  return sortedCopy([...byName.values()], (left, right) =>
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
  const { normalization, sources } = await normalizedSources(
    lisaRoot,
    projectRoot,
    types,
    config
  );
  const byName = new Map(
    sources.map(source => [
      source.projected.name,
      [...requiredStatusChecksByContext(source.rules).keys()].map(context => ({
        context,
        ruleset: source.projected.name,
        source:
          source.template === undefined
            ? GENERATED_BASE_SOURCE
            : enforcementSource(
                context,
                source.added,
                normalization.derived,
                source.template
              ),
      })),
    ])
  );
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
