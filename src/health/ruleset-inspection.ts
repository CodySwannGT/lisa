/**
 * Structured, bounded GitHub ruleset collection and canonical comparison.
 * The pieces live in ruleset-gh (live reads), ruleset-normalize and
 * ruleset-config-checks (apply-equivalent normalization), ruleset-expected
 * (what a project should hold) and ruleset-compare (drift); this module keeps
 * the finding and the stable import surface.
 * @module health/ruleset-inspection
 */
import type { ProjectType } from "../core/config.js";
import type { HealthFinding } from "./contract.js";
import { deterministicFinding, namedReason } from "./finding-utils.js";
import { compareRulesets, requiredContextDrift } from "./ruleset-compare.js";
import { expectedRulesets } from "./ruleset-expected.js";
import type { RulesetReader } from "./ruleset-gh.js";

export { compareRulesets, type RulesetDrift } from "./ruleset-compare.js";
export {
  expectedRequiredContexts,
  expectedRulesets,
  liveRequiredContexts,
} from "./ruleset-expected.js";
export {
  isWholeRulesetList,
  readGhText,
  readGithubRulesets,
  RULESET_PAGE_SIZE,
  rulesetReaderOver,
  type HealthRuleset,
  type RulesetJsonReader,
  type RulesetReader,
} from "./ruleset-gh.js";
export { ACTIONS_INTEGRATION_ID } from "./ruleset-normalize.js";

const REPOSITORY_PART = /^[A-Za-z0-9_.-]{1,100}$/u;
const RULESET_CHECK = "github.rulesets";
const WARN = "warn";

/**
 * Extract a safe GitHub target without reporting configured values.
 * @param config - Safe project config
 * @returns The owner and repository, or undefined when not safely configured
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
