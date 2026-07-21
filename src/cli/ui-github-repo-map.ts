/**
 * Pure mappers from GitHub API JSON onto repository panel rows.
 * @module cli/ui-github-repo-map
 */
import type {
  GithubRepoSettings,
  GithubRulesetRow,
} from "./ui-github-repo-gh.js";

/**
 * Require a boolean field from a plain object.
 * @param record - Source object
 * @param key - Property name
 * @returns Boolean value
 */
function requireBoolean(record: object, key: string): boolean {
  const value = Reflect.get(record, key);
  if (typeof value !== "boolean") {
    throw new TypeError(`Repository settings omitted boolean ${key}`);
  }
  return value;
}

/**
 * Require a string field from a plain object.
 * @param record - Source object
 * @param key - Property name
 * @returns String value
 */
function requireString(record: object, key: string): string {
  const value = Reflect.get(record, key);
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`Repository settings omitted string ${key}`);
  }
  return value;
}

/**
 * Derive secret-scanning enabled from the security_and_analysis payload.
 * @param record - Repository API object
 * @returns Whether secret scanning is enabled
 */
function secretScanningEnabled(record: object): boolean {
  const security = Reflect.get(record, "security_and_analysis");
  if (security === null || typeof security !== "object") {
    return false;
  }
  const scanning = Reflect.get(security, "secret_scanning");
  if (scanning === null || typeof scanning !== "object") {
    return false;
  }
  return Reflect.get(scanning, "status") === "enabled";
}

/**
 * Map repository JSON into the panel settings shape.
 * @param raw - Parsed `gh api repos/{owner}/{repo}` payload
 * @returns Settings for the console
 */
export function mapRepoSettings(raw: unknown): GithubRepoSettings {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new TypeError("Repository settings response was not an object");
  }
  return {
    allow_merge_commit: requireBoolean(raw, "allow_merge_commit"),
    allow_squash_merge: requireBoolean(raw, "allow_squash_merge"),
    allow_rebase_merge: requireBoolean(raw, "allow_rebase_merge"),
    allow_auto_merge: requireBoolean(raw, "allow_auto_merge"),
    allow_update_branch: requireBoolean(raw, "allow_update_branch"),
    delete_branch_on_merge: requireBoolean(raw, "delete_branch_on_merge"),
    merge_commit_title: requireString(raw, "merge_commit_title"),
    has_issues: requireBoolean(raw, "has_issues"),
    has_wiki: requireBoolean(raw, "has_wiki"),
    secret_scanning: secretScanningEnabled(raw),
    default_branch: requireString(raw, "default_branch"),
  };
}

/**
 * Humanize ruleset ref includes for the Applies-to column.
 * @param includes - Ruleset condition include list
 * @returns Display string
 */
function formatAppliesTo(includes: readonly string[]): string {
  if (includes.length === 0) {
    return "—";
  }
  return includes
    .map(entry =>
      entry
        .replace(/^refs\/heads\//u, "")
        .replace(/^refs\/tags\//u, "")
        .replace(/^~DEFAULT_BRANCH$/u, "default")
    )
    .join(" · ");
}

/**
 * Extract ref_name.include strings from a ruleset conditions object.
 * @param conditions - Ruleset conditions payload
 * @returns Include list, or empty when absent
 */
function rulesetIncludes(conditions: unknown): readonly string[] {
  if (
    conditions === null ||
    typeof conditions !== "object" ||
    Array.isArray(conditions)
  ) {
    return [];
  }
  const refName = Reflect.get(conditions, "ref_name");
  if (
    refName === null ||
    typeof refName !== "object" ||
    Array.isArray(refName)
  ) {
    return [];
  }
  const include = Reflect.get(refName, "include");
  if (!Array.isArray(include)) {
    return [];
  }
  return include.filter((entry): entry is string => typeof entry === "string");
}

/**
 * Extract rule type names from a ruleset rules array.
 * @param rules - Ruleset rules payload
 * @returns Rule type strings
 */
function rulesetRuleTypes(rules: unknown): readonly string[] {
  if (!Array.isArray(rules)) {
    return [];
  }
  return rules
    .map(rule => {
      if (rule === null || typeof rule !== "object") {
        return undefined;
      }
      const type = Reflect.get(rule, "type");
      return typeof type === "string" ? type : undefined;
    })
    .filter((type): type is string => type !== undefined);
}

/**
 * Whether a required-status-check rule contains at least one context.
 * @param rules - Raw ruleset rules
 * @returns Whether at least one required check context is configured
 */
function hasRequiredStatusChecks(rules: unknown): boolean {
  if (!Array.isArray(rules)) return false;
  return rules.some(rule => {
    if (
      rule === null ||
      typeof rule !== "object" ||
      Reflect.get(rule, "type") !== "required_status_checks"
    ) {
      return false;
    }
    const parameters = Reflect.get(rule, "parameters");
    if (parameters === null || typeof parameters !== "object") return false;
    const checks = Reflect.get(parameters, "required_status_checks");
    return Array.isArray(checks) && checks.length > 0;
  });
}

/**
 * Map a detailed ruleset payload into a panel row.
 * @param raw - One ruleset object from gh api
 * @returns Panel row
 */
export function mapRulesetRow(raw: unknown): GithubRulesetRow {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new TypeError("Ruleset entry was not an object");
  }
  const ruleTypes = rulesetRuleTypes(Reflect.get(raw, "rules"));
  const includes = rulesetIncludes(Reflect.get(raw, "conditions"));
  return {
    name: requireString(raw, "name"),
    appliesTo: formatAppliesTo(rulesetIncludes(Reflect.get(raw, "conditions"))),
    enforces: ruleTypes.length > 0 ? ruleTypes.join(", ") : "—",
    active: Reflect.get(raw, "enforcement") === "active",
    targetsDefaultBranch: includes.includes("~DEFAULT_BRANCH"),
    requiresPullRequest: ruleTypes.includes("pull_request"),
    requiresStatusChecks: hasRequiredStatusChecks(Reflect.get(raw, "rules")),
  };
}

/**
 * Require a non-empty string field (shared by label/secret list parsers).
 * @param record - Source object
 * @param key - Property name
 * @returns String value
 */
export function requireNamedString(record: object, key: string): string {
  return requireString(record, key);
}
