/**
 * Required-status-check normalization shared by every expected-ruleset reader:
 * per-repository additions, run-gate contexts, the no-workflows strip, and
 * `dropRequiredChecks`, applied in the same order as the shell applier.
 * @module health/ruleset-normalize
 */
import type { HealthRuleset } from "./ruleset-gh.js";

/** GitHub Actions' integration id, the default author of a required check. */
export const ACTIONS_INTEGRATION_ID = 15_368;
/** The ruleset that owns the quality workflow's contexts. */
const QUALITY_RULESET_NAME = "quality checks";
const REQUIRED_STATUS_CHECKS = "required_status_checks";

/** One required-status-check declaration. */
export type RequiredCheck = Readonly<Record<string, unknown>>;

/**
 * Read the required-check list of a `required_status_checks` rule.
 * @param rule - One ruleset rule
 * @returns The rule's parameters and checks, or undefined for any other rule
 */
function requiredChecksOf(
  rule: unknown
): { readonly parameters: object; readonly checks: unknown[] } | undefined {
  if (
    rule === null ||
    typeof rule !== "object" ||
    Reflect.get(rule, "type") !== REQUIRED_STATUS_CHECKS
  ) {
    return undefined;
  }
  const parameters = Reflect.get(rule, "parameters");
  if (parameters === null || typeof parameters !== "object") return undefined;
  const checks = Reflect.get(parameters, REQUIRED_STATUS_CHECKS);
  return Array.isArray(checks) ? { parameters, checks } : undefined;
}

/**
 * Merge additions into a rule list that already holds a required-check rule.
 * @param existing - Rules holding a `required_status_checks` rule
 * @param added - Checks to append when their context is not yet present
 * @returns The rules with the additions merged
 */
function mergeIntoRequiredRule(
  existing: readonly unknown[],
  added: readonly RequiredCheck[]
): unknown[] {
  return existing.map(rule => {
    const required = requiredChecksOf(rule);
    if (required === undefined) return rule;
    const present = new Set(
      required.checks.flatMap(check => {
        const context =
          check !== null && typeof check === "object"
            ? Reflect.get(check, "context")
            : undefined;
        return typeof context === "string" ? [context] : [];
      })
    );
    return {
      ...(rule as object),
      parameters: {
        ...required.parameters,
        [REQUIRED_STATUS_CHECKS]: [
          ...required.checks,
          ...added.filter(check => !present.has(String(check.context))),
        ],
      },
    };
  });
}

/**
 * Merge per-repo additions into a template's rules, exactly as apply does.
 *
 * Runs BEFORE the no-workflows strip and before `dropRequiredChecks`, so both
 * of those still win over an addition — matching the shell applier's ordering.
 * @param rules - Template ruleset rules
 * @param added - Checks the repository adds
 * @returns The rules with the additions merged
 */
function withAddedChecks(
  rules: unknown,
  added: readonly RequiredCheck[]
): unknown {
  if (added.length === 0) return rules;
  const existing = Array.isArray(rules) ? rules : [];
  const hasRequiredRule = existing.some(
    rule =>
      rule !== null &&
      typeof rule === "object" &&
      Reflect.get(rule, "type") === REQUIRED_STATUS_CHECKS
  );
  if (hasRequiredRule) return mergeIntoRequiredRule(existing, added);
  return [
    ...existing,
    {
      type: REQUIRED_STATUS_CHECKS,
      parameters: {
        strict_required_status_checks_policy: false,
        do_not_enforce_on_create: true,
        [REQUIRED_STATUS_CHECKS]: added,
      },
    },
  ];
}

/**
 * Add derived checks only to the ruleset that owns the quality workflow.
 * @param rules - Candidate ruleset rules
 * @param rulesetName - Ruleset receiving the candidate rules
 * @param checks - Derived workflow-posted checks
 * @returns The rules, with the derived checks merged into the quality ruleset
 */
function withDerivedRunGateChecks(
  rules: unknown,
  rulesetName: string,
  checks: readonly RequiredCheck[]
): unknown {
  return rulesetName === QUALITY_RULESET_NAME
    ? withAddedChecks(rules, checks)
    : rules;
}

/**
 * Apply workflow and configured required-check normalization used by apply.
 * @param rules - Rules after additions
 * @param hasWorkflows - Whether Actions contexts can report
 * @param dropped - Contexts the repository explicitly drops
 * @returns The normalized rules, without required-check rules left empty
 */
function normalizeExpectedRules(
  rules: unknown,
  hasWorkflows: boolean,
  dropped: ReadonlySet<string>
): unknown {
  if (!Array.isArray(rules)) return rules;
  return rules.flatMap(rule => {
    const required = requiredChecksOf(rule);
    if (required === undefined) return [rule];
    const retained = required.checks.filter(check => {
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
        ...(rule as object),
        parameters: {
          ...required.parameters,
          [REQUIRED_STATUS_CHECKS]: retained,
        },
      },
    ];
  });
}

/** Repository facts every expected ruleset is normalized against. */
export interface RulesetNormalization {
  readonly derived: readonly RequiredCheck[];
  readonly hasWorkflows: boolean;
  readonly dropped: ReadonlySet<string>;
}

/**
 * Normalize one ruleset exactly as the applier does.
 * @param projected - Projected ruleset document
 * @param configured - Per-repository configured additions
 * @param normalization - Derived checks, workflow presence and dropped contexts
 * @returns The normalized rules
 */
export function normalizedProjectRules(
  projected: HealthRuleset,
  configured: readonly RequiredCheck[],
  normalization: RulesetNormalization
): unknown {
  return normalizeExpectedRules(
    withAddedChecks(
      withDerivedRunGateChecks(
        projected.rules,
        projected.name,
        normalization.derived
      ),
      configured
    ),
    normalization.hasWorkflows,
    normalization.dropped
  );
}

/**
 * Extract required status checks by context from a material ruleset.
 * @param rules - Ruleset rules
 * @returns Each required check keyed by its context
 */
export function requiredStatusChecksByContext(
  rules: unknown
): ReadonlyMap<string, unknown> {
  if (!Array.isArray(rules)) return new Map();
  const entries = rules.flatMap(rule => {
    const required = requiredChecksOf(rule);
    if (required === undefined) return [];
    return required.checks.flatMap(check => {
      if (check === null || typeof check !== "object") return [];
      const context = Reflect.get(check, "context");
      return typeof context === "string" ? [[context, check] as const] : [];
    });
  });
  return new Map(entries);
}
