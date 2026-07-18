import type { ProjectType } from "../core/config.js";
import type { JsonObject } from "../sync/json-path.js";
import type {
  IntegrationFlags,
  VariableRequirement,
} from "./remote-environment-contract.js";

const JIRA_SOURCE = "Lisa config: Jira tracker";

/**
 * Build the active Jira tracker requirements.
 * @returns Required jira-cli variables
 */
function jiraRequirements(): readonly VariableRequirement[] {
  return [
    {
      name: "JIRA_API_TOKEN",
      reason: "Jira API authentication for the active tracker",
      source: JIRA_SOURCE,
      secret: true,
    },
    {
      name: "JIRA_SERVER",
      reason: "Jira Cloud site used by jira-cli",
      source: JIRA_SOURCE,
      secret: false,
    },
    {
      name: "JIRA_LOGIN",
      reason: "Jira account used by jira-cli",
      source: JIRA_SOURCE,
      secret: false,
    },
    {
      name: "JIRA_PROJECT",
      reason: "Jira project key used by the factory",
      source: JIRA_SOURCE,
      secret: false,
    },
  ];
}

/**
 * Resolve the most specific AWS detection source.
 * @param projectTypes - Detected Lisa project types
 * @returns Human-readable detection source
 */
function awsRequirementSource(projectTypes: readonly ProjectType[]): string {
  return projectTypes.includes("cdk")
    ? "Project type: CDK"
    : "Integration: AWS";
}

/**
 * Build requirements implied by the active Lisa tracker and PRD source.
 * @param config - Merged Lisa project config
 * @returns Active integration requirements
 */
export function configuredIntegrationRequirements(
  config: JsonObject
): readonly VariableRequirement[] {
  const tracker = typeof config.tracker === "string" ? config.tracker : "";
  const source = typeof config.source === "string" ? config.source : "";
  const catalog = [
    {
      active: tracker === "github" || source === "github",
      requirements: [
        {
          name: "GH_TOKEN",
          reason: "GitHub CLI access for the active tracker or PRD source",
          source: "Lisa config: GitHub",
          secret: true,
        },
      ],
    },
    { active: tracker === "jira", requirements: jiraRequirements() },
    {
      active: tracker === "linear" || source === "linear",
      requirements: [
        {
          name: "LINEAR_API_KEY",
          reason: "Headless Linear access for the active tracker or source",
          source: "Lisa config: Linear",
          secret: true,
        },
      ],
    },
    {
      active: source === "notion",
      requirements: [
        {
          name: "NOTION_API_TOKEN",
          reason: "Notion integration access for the active PRD source",
          source: "Lisa config: Notion source",
          secret: true,
        },
      ],
    },
    {
      active: source === "confluence",
      requirements: [
        {
          name: "ATLASSIAN_API_TOKEN",
          reason: "Confluence API access for the active PRD source",
          source: "Lisa config: Confluence source",
          secret: true,
        },
      ],
    },
  ];
  return catalog.flatMap(entry => (entry.active ? entry.requirements : []));
}

/**
 * Convert active flags to names-only variable requirements.
 * @param flags - Detected integrations
 * @param projectTypes - Detected Lisa project types
 * @returns Active project requirements
 */
export function requirementsForFlags(
  flags: IntegrationFlags,
  projectTypes: readonly ProjectType[]
): readonly VariableRequirement[] {
  const catalog: readonly {
    readonly active: boolean;
    readonly requirement: VariableRequirement;
  }[] = [
    {
      active: flags.jam,
      requirement: {
        name: "JAM_PAT",
        reason: "Jam CLI access for the detected Jam integration",
        source: "Integration: @jam.dev",
        secret: true,
      },
    },
    {
      active: flags.aws,
      requirement: {
        name: "LISA_AWS_BOOTSTRAP_JSON",
        reason: "Renewable AWS CLI profiles for this AWS-enabled project",
        source: awsRequirementSource(projectTypes),
        secret: true,
      },
    },
    {
      active: flags.sonar,
      requirement: {
        name: "SONAR_TOKEN",
        reason: "SonarCloud diagnostics for the configured project",
        source: "Integration: SonarCloud",
        secret: true,
      },
    },
    {
      active: flags.sentry,
      requirement: {
        name: "SENTRY_AUTH_TOKEN",
        reason: "Sentry diagnostics and release tooling",
        source: "Integration: Sentry",
        secret: true,
      },
    },
    {
      active: flags.figma,
      requirement: {
        name: "FIGMA_ACCESS_TOKEN",
        reason: "Figma tooling referenced by the project setup",
        source: "Integration: Figma",
        secret: true,
      },
    },
    {
      active: flags.eas,
      requirement: {
        name: "EXPO_TOKEN",
        reason: "EAS operations for this Expo project",
        source: "Project type: Expo with EAS",
        secret: true,
      },
    },
    {
      active: flags.maestro,
      requirement: {
        name: "MAESTRO_API_KEY",
        reason: "Maestro Cloud verification for this project",
        source: "Integration: Maestro Cloud",
        secret: true,
      },
    },
  ];
  return catalog.filter(entry => entry.active).map(entry => entry.requirement);
}
