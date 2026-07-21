/** Presence-only GitHub and scheduler evidence for Setup readiness. */
import type { ProbeResult } from "./ui-status.js";
import type { HealthResult } from "../health/contract.js";
import type { GithubRepoPanelValue } from "./ui-github-repo.js";
import type { AutomationsProbeValue } from "./ui-automations.js";
import type { DeployPipelineValue } from "./ui-deploy-pipeline.js";
import {
  setupFinding,
  type SetupReadinessFinding,
} from "./ui-setup-readiness-contract.js";

const GITHUB_GOVERNANCE_CHECK = "setup.github-governance";
const SECRETS_CHECK = "setup.secrets";
const AUTOMATIONS_CHECK = "setup.automations";

/**
 * Map bounded GitHub live data to governance readiness.
 * @param health - Current deterministic Health evidence, when available
 * @param github - Live GitHub repository observation
 * @param deployPipeline - Live deployment-pipeline observation
 * @returns GitHub governance readiness finding
 */
// eslint-disable-next-line sonarjs/cognitive-complexity -- independent canonical, live-repo, secret, and deployment gates stay visible together
export function githubGovernanceFinding(
  health: HealthResult | undefined,
  github: ProbeResult<GithubRepoPanelValue>,
  deployPipeline: ProbeResult<DeployPipelineValue>
): SetupReadinessFinding {
  if (github.state !== "value") {
    return setupFinding(
      GITHUB_GOVERNANCE_CHECK,
      "warn",
      `GitHub governance could not be established (${github.reason}).`
    );
  }
  const settings = github.value.settings;
  const mergeSettingsReady =
    settings.allow_merge_commit === false &&
    settings.allow_squash_merge === true &&
    settings.allow_rebase_merge === false &&
    settings.allow_auto_merge === true &&
    settings.allow_update_branch === true &&
    settings.delete_branch_on_merge === true &&
    settings.secret_scanning === true;
  const activeRuleset = github.value.rulesets.some(
    row =>
      row.active &&
      row.targetsDefaultBranch === true &&
      row.requiresPullRequest === true &&
      row.requiresStatusChecks === true
  );
  const canonicalRulesetStatus = health?.findings.find(
    finding => finding.check === "github.rulesets"
  )?.status;
  const deployKey = github.value.secrets.some(
    secret => secret.name === "DEPLOY_KEY" && secret.set
  );
  const holds =
    deployPipeline.state === "value"
      ? deployPipeline.value.stages.filter(stage =>
          stage.id.startsWith("hold:")
        )
      : [];
  const approvalGates =
    holds.length > 0 && holds.every(stage => stage.active === true);
  const missing = [
    ...(mergeSettingsReady ? [] : ["merge and security settings"]),
    ...(activeRuleset
      ? []
      : [
          "an active default-branch ruleset requiring pull requests and status checks",
        ]),
    ...(canonicalRulesetStatus === "pass"
      ? []
      : ["passing canonical github.rulesets Health evidence"]),
    ...(deployKey ? [] : ["the write deploy key"]),
    ...(approvalGates ? [] : ["deployment environment approval gates"]),
  ];
  return missing.length === 0
    ? setupFinding(
        GITHUB_GOVERNANCE_CHECK,
        "pass",
        "GitHub merge/security settings, rulesets, write deploy key, and deployment approval gates were observed."
      )
    : setupFinding(
        GITHUB_GOVERNANCE_CHECK,
        canonicalRulesetStatus === "fail" ? "fail" : "warn",
        `GitHub governance is incomplete: ${missing.join(" and ")}. Run /lisa:setup:github-repo.`
      );
}

/**
 * Map only workflow-referenced secret names to presence readiness.
 * @param github - Live GitHub repository observation
 * @param expectedSecretNames - Secret names referenced by confined workflows
 * @returns Repository-secret presence readiness finding
 */
export function secretsFinding(
  github: ProbeResult<GithubRepoPanelValue>,
  expectedSecretNames: readonly string[]
): SetupReadinessFinding {
  if (expectedSecretNames.length === 0) {
    return setupFinding(
      SECRETS_CHECK,
      "warn",
      "No explicit CI secret requirements could be established from current workflow references."
    );
  }
  if (github.state !== "value") {
    return setupFinding(
      SECRETS_CHECK,
      "warn",
      `Repository secret presence could not be established (${github.reason}); no secret values were read.`
    );
  }
  const presence = new Map(
    github.value.secrets.map(secret => [secret.name, secret.set])
  );
  const missing = expectedSecretNames.filter(
    name => presence.get(name) !== true
  );
  return missing.length === 0
    ? setupFinding(
        SECRETS_CHECK,
        "pass",
        `${expectedSecretNames.length} workflow-referenced repository secret name${expectedSecretNames.length === 1 ? " is" : "s are"} present; values were not read.`
      )
    : setupFinding(
        SECRETS_CHECK,
        "warn",
        `Missing workflow-referenced repository secret names: ${missing.join(", ")}. Values were not read.`
      );
}

/**
 * Require the exact six core scheduler entries with observed cadences.
 * @param result - Live harness scheduler observation
 * @param expectedAutomationIds - Applicable authoritative automation IDs
 * @returns Harness automation readiness finding
 */
export function automationsFinding(
  result: ProbeResult<AutomationsProbeValue>,
  expectedAutomationIds: readonly string[] | undefined
): SetupReadinessFinding {
  if (
    expectedAutomationIds === undefined ||
    expectedAutomationIds.length === 0
  ) {
    return setupFinding(
      AUTOMATIONS_CHECK,
      "warn",
      "Applicable automation contracts could not be resolved from project configuration and detected stacks."
    );
  }
  if (result.state !== "value") {
    return setupFinding(
      AUTOMATIONS_CHECK,
      "warn",
      `Harness scheduler state is unavailable (${result.reason}). Run /lisa:setup-automations.`
    );
  }
  const entries = result.value.automations.flatMap(value => {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return [];
    }
    const id = Reflect.get(value, "id");
    const cadence = Reflect.get(value, "cadence");
    const status = Reflect.get(value, "status");
    return typeof id === "string" ? [{ id, cadence, status }] : [];
  });
  const missing = expectedAutomationIds.filter(expectedId => {
    return !entries.some(entry => {
      const disabled =
        typeof entry.status === "string" &&
        ["disabled", "inactive", "paused"].includes(entry.status.toLowerCase());
      return (
        entry.id === expectedId &&
        typeof entry.cadence === "string" &&
        entry.cadence.trim().length > 0 &&
        !disabled
      );
    });
  });
  return missing.length === 0
    ? setupFinding(
        AUTOMATIONS_CHECK,
        "pass",
        `All ${expectedAutomationIds.length} applicable Lisa scheduler entries are present with observed cadences.`
      )
    : setupFinding(
        AUTOMATIONS_CHECK,
        "warn",
        `Missing, disabled, or cadence-unreadable automation entries: ${missing.join(", ")}. Run /lisa:setup-automations.`
      );
}
