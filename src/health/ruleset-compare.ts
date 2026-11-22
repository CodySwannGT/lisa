/**
 * Canonical comparison of expected and live material ruleset documents.
 * @module health/ruleset-compare
 */
import { sortedCopy, type HealthRuleset } from "./ruleset-gh.js";
import { requiredStatusChecksByContext } from "./ruleset-normalize.js";

/** Ruleset comparison result containing names only. */
export interface RulesetDrift {
  readonly missing: readonly string[];
  readonly drifted: readonly string[];
}

/** Required-check drift grouped by the ruleset that should enforce it. */
export interface NamedRulesetContextDrift {
  readonly ruleset: string;
  readonly contexts: readonly string[];
}

/**
 * Canonicalize semantically unordered JSON objects and arrays.
 * @param value - JSON value
 * @returns The value with arrays and object keys in canonical order
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
 * @param value - JSON value
 * @returns The value without GitHub's empty `required_reviewers` default
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
 * Project actual rules onto expected required-check contexts.
 *
 * Host-added required contexts are enforcement, not drift. Comparing the whole
 * live list would make doctor pressure operators to remove checks Lisa cannot
 * preserve safely.
 * @param actualRules - Live ruleset rules
 * @param expectedRules - Expected ruleset rules
 * @returns The live rules restricted to the expected required contexts
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
 * @param expected - Expected ruleset
 * @param actual - Live ruleset of the same name, if any
 * @returns Missing contexts, sorted
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
 * @param expected - Expected rulesets
 * @param actual - Live rulesets
 * @returns Each ruleset with the contexts it fails to enforce
 */
export function requiredContextDrift(
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
 * @param expected - Expected rulesets
 * @param actual - Live rulesets
 * @returns Names of missing and materially drifted rulesets
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
