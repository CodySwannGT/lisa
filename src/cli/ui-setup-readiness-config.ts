/** Config-backed Setup readiness findings with independent provider lanes. */
import { isJsonObject, type JsonObject } from "../sync/json-path.js";
import { SETUP_PROVIDER_REQUIREMENTS } from "../sync/registry.js";
import { resolveMutationPolicy } from "./doctor-readiness-journey-freshness.js";
import {
  setupFinding,
  type SetupReadinessFinding,
} from "./ui-setup-readiness-contract.js";

const EXPLORATION_CHECK = "setup.exploration";
const STARTER_PROVENANCE_CHECK = "setup.starter-provenance";

/**
 * Return whether a dot path resolves to a non-empty string.
 * @param config - Merged Lisa project configuration
 * @param dotPath - Dot-delimited property path to inspect
 * @returns Whether the property contains non-empty text
 */
function hasString(config: JsonObject, dotPath: string): boolean {
  const value = dotPath.split(".").reduce<unknown>((current, segment) => {
    if (!isJsonObject(current)) return undefined;
    return current[segment];
  }, config);
  return typeof value === "string" && value.trim().length > 0;
}

/** Provider lane whose requirements are owned by the sync registry. */
type ProviderLane = keyof typeof SETUP_PROVIDER_REQUIREMENTS;

/**
 * Evaluate one provider lane from the shared sync-registry requirements.
 * @param config - Merged Lisa project configuration
 * @param lane - Provider lane to validate
 * @param check - Setup finding identifier for the lane
 * @param selectionHint - Operator-facing setup commands for invalid providers
 * @returns Deterministic readiness finding for the provider lane
 */
function providerLaneFinding(
  config: JsonObject,
  lane: ProviderLane,
  check: "setup.tracker" | "setup.prd-source",
  selectionHint: string
): SetupReadinessFinding {
  const provider = config[lane];
  const providers = SETUP_PROVIDER_REQUIREMENTS[lane];
  if (typeof provider !== "string" || !Object.hasOwn(providers, provider)) {
    return setupFinding(
      check,
      "fail",
      `${lane === "tracker" ? "Work tracker" : "PRD source"} is missing or unsupported. Run ${selectionHint}.`
    );
  }
  const requirement = providers[provider]!;
  const missingAll = requirement.allOf.filter(key => !hasString(config, key));
  const missingAny =
    requirement.anyOf !== undefined &&
    !requirement.anyOf.some(key => hasString(config, key))
      ? [requirement.anyOf.join(" or ")]
      : [];
  const missing = [...missingAll, ...missingAny];
  return missing.length === 0
    ? setupFinding(
        check,
        "pass",
        `${lane === "tracker" ? "Tracker" : "PRD source"} provider and required scope identifiers are configured.`
      )
    : setupFinding(
        check,
        "fail",
        `Missing required configuration: ${missing.join(", ")}. Run ${requirement.setupHint}.`
      );
}

/**
 * Read tracker readiness independently from the PRD source.
 * @param config - Merged Lisa project configuration
 * @returns Work-tracker readiness finding
 */
export function trackerFinding(config: JsonObject): SetupReadinessFinding {
  return providerLaneFinding(
    config,
    "tracker",
    "setup.tracker",
    "/lisa:setup:jira, /lisa:setup:github, or /lisa:setup:linear"
  );
}

/**
 * Read PRD-source readiness independently from the work tracker.
 * @param config - Merged Lisa project configuration
 * @returns PRD-source readiness finding
 */
export function prdSourceFinding(config: JsonObject): SetupReadinessFinding {
  return providerLaneFinding(
    config,
    "source",
    "setup.prd-source",
    "/lisa:setup:notion, /lisa:setup:confluence, /lisa:setup:linear, or /lisa:setup:github"
  );
}

/**
 * Require an explicit exploration environment, policy, and test identity.
 * @param config - Merged Lisa project configuration
 * @returns Exploration-environment readiness finding
 */
export function explorationFinding(config: JsonObject): SetupReadinessFinding {
  const exploration = config.exploration;
  if (!isJsonObject(exploration)) {
    return setupFinding(
      EXPLORATION_CHECK,
      "warn",
      "Exploration environments are not configured in .lisa.config.json."
    );
  }
  const environmentName = exploration.default;
  const environments = exploration.environments;
  if (
    typeof environmentName !== "string" ||
    environmentName.trim().length === 0 ||
    !isJsonObject(environments) ||
    !isJsonObject(environments[environmentName])
  ) {
    return setupFinding(
      EXPLORATION_CHECK,
      "warn",
      "Exploration requires a default environment with a matching environments entry."
    );
  }
  const environment = environments[environmentName];
  const mutation = environment.mutation;
  if (
    typeof mutation !== "string" ||
    !["forbidden", "read-only", "full"].includes(mutation)
  ) {
    return setupFinding(
      EXPLORATION_CHECK,
      "warn",
      "The default exploration environment needs an explicit mutation policy."
    );
  }
  if (
    typeof environment.identity !== "string" ||
    environment.identity.trim().length === 0
  ) {
    return setupFinding(
      EXPLORATION_CHECK,
      "warn",
      "The default exploration environment needs a dedicated test identity reference."
    );
  }
  const effective = resolveMutationPolicy(config);
  return effective === mutation
    ? setupFinding(
        EXPLORATION_CHECK,
        "pass",
        `The default exploration environment has an explicit ${effective} policy and test identity reference.`
      )
    : setupFinding(
        EXPLORATION_CHECK,
        "warn",
        `The configured mutation policy is unsafe for the selected environment and resolves to ${effective}.`
      );
}

/**
 * Require at least one bounded starter template provenance record.
 * @param config - Merged Lisa project configuration
 * @returns Starter-provenance readiness finding
 */
export function starterProvenanceFinding(
  config: JsonObject
): SetupReadinessFinding {
  const starter = config.starter;
  const templates = isJsonObject(starter) ? starter.templates : undefined;
  if (!Array.isArray(templates) || templates.length === 0) {
    return setupFinding(
      STARTER_PROVENANCE_CHECK,
      "warn",
      "Optional starter provenance is not recorded in starter.templates."
    );
  }
  const invalid = templates.some(
    template =>
      !isJsonObject(template) ||
      typeof template.repo !== "string" ||
      template.repo.trim().length === 0 ||
      typeof template.ref !== "string" ||
      template.ref.trim().length === 0
  );
  return invalid
    ? setupFinding(
        STARTER_PROVENANCE_CHECK,
        "warn",
        "Starter provenance contains a template without both repo and ref."
      )
    : setupFinding(
        STARTER_PROVENANCE_CHECK,
        "pass",
        `${templates.length} starter template provenance record${templates.length === 1 ? " is" : "s are"} configured.`
      );
}
