/**
 * Pure model for Deploy pipeline stages — parse deploy.yml, map holds, assemble.
 * @module cli/ui-deploy-pipeline-model
 */
import yaml from "js-yaml";
import { isJsonObject, type JsonValue } from "../sync/json-path.js";
import type { ProbeResult } from "./ui-status.js";

/** Stable probe id consumed by the Deploy section hydration. */
export const DEPLOY_PIPELINE_PROBE_ID = "deploy-pipeline-stages";

const NOT_AUTHENTICATED_REASON = "not-authenticated";
const ENVIRONMENT_NOT_FOUND_REASON = "environment-not-found";

/** One row in the Deploy pipeline stages table. */
export type DeployPipelineStage = {
  readonly [key: string]: JsonValue;
  readonly id: string;
  readonly name: string;
  readonly description: string;
  /** Configured GitHub environment name, or empty for workflow jobs. */
  readonly environment: string;
  /**
   * Active column: `true` = hold/job present, `false` = no hold,
   * `"unknown"` = cannot claim hold/no-hold without lying.
   */
  readonly active: boolean | "unknown";
  /** Required when `active` is false or unknown; empty otherwise. */
  readonly reason: string;
};

/** Structured value emitted by the deploy-pipeline-stages probe. */
export type DeployPipelineValue = {
  readonly [key: string]: JsonValue;
  readonly stages: DeployPipelineStage[];
};

/** One GitHub environment as returned by the Environments API. */
export type GithubEnvironmentInfo = {
  readonly name: string;
  readonly hasRequiredReviewers: boolean;
};

/** Result of listing GitHub environments — never invents a concrete hold. */
export type GithubEnvironmentsLookup =
  | {
      readonly status: "ok";
      readonly environments: readonly GithubEnvironmentInfo[];
    }
  | {
      readonly status: "not-authenticated";
      readonly message: string;
    }
  | { readonly status: "error"; readonly message: string };

/**
 * Extract ordered job stages from a deploy.yml document.
 * @param contents - Raw YAML text
 * @returns Workflow job stages in document order
 */
export function parseDeployWorkflowStages(
  contents: string
): readonly DeployPipelineStage[] {
  try {
    const loaded = yaml.load(contents) as unknown;
    if (!isJsonObject(loaded)) {
      return [];
    }
    const jobs = loaded.jobs;
    if (!isJsonObject(jobs)) {
      return [];
    }
    return Object.entries(jobs).map(([id, job]) => {
      const name =
        isJsonObject(job) && typeof job.name === "string" && job.name.length > 0
          ? job.name
          : id;
      return {
        id: `job:${id}`,
        name,
        description: `Workflow job \`${id}\` from deploy.yml`,
        environment: "",
        active: true,
        reason: "",
      };
    });
  } catch {
    return [];
  }
}

/**
 * Map one configured environment onto a hold stage using live GH evidence.
 * @param environment - Configured environment name
 * @param lookup - Live environments API result
 * @returns Approval-hold stage that never false-greens
 */
export function mapEnvironmentHoldStage(
  environment: string,
  lookup: GithubEnvironmentsLookup
): DeployPipelineStage {
  const base = {
    id: `hold:${environment}`,
    name: `Release approval — ${environment}`,
    description: `Pauses at the release_approval job until a configured reviewer approves the GitHub environment \`${environment}\``,
    environment,
  };
  if (lookup.status === "not-authenticated") {
    return {
      ...base,
      active: "unknown",
      reason: `${NOT_AUTHENTICATED_REASON}: ${lookup.message}`,
    };
  }
  if (lookup.status === "error") {
    return {
      ...base,
      active: "unknown",
      reason: `environments-api-error: ${lookup.message}`,
    };
  }
  const match = lookup.environments.find(entry => entry.name === environment);
  if (match === undefined) {
    return {
      ...base,
      active: "unknown",
      reason: `${ENVIRONMENT_NOT_FOUND_REASON}: GitHub environment '${environment}' is named in github.environments but was not found on the repository`,
    };
  }
  if (match.hasRequiredReviewers) {
    return { ...base, active: true, reason: "" };
  }
  return {
    ...base,
    active: false,
    reason: `No required reviewers on GitHub environment '${environment}'`,
  };
}

/**
 * Interleave approval holds before the first release job (or append).
 * @param jobStages - Stages parsed from deploy.yml
 * @param holdStages - Per-environment approval hold stages
 * @returns Ordered pipeline stages for the console table
 */
export function assembleDeployPipelineStages(
  jobStages: readonly DeployPipelineStage[],
  holdStages: readonly DeployPipelineStage[]
): readonly DeployPipelineStage[] {
  if (holdStages.length === 0) {
    return jobStages;
  }
  if (jobStages.length === 0) {
    return holdStages;
  }
  const releaseIndex = jobStages.findIndex(
    stage => /release/iu.test(stage.id) || /release/iu.test(stage.name)
  );
  if (releaseIndex === -1) {
    return [...jobStages, ...holdStages];
  }
  return [
    ...jobStages.slice(0, releaseIndex),
    ...holdStages,
    ...jobStages.slice(releaseIndex),
  ];
}

/**
 * Build the tri-state probe result from filesystem + live environment inputs.
 * @param workflow - deploy.yml contents, or null when absent
 * @param configuredEnvironments - Keys from github.environments
 * @param lookup - Live GitHub environments lookup
 * @returns Probe result — value, not-applicable, or unknown
 */
export function buildDeployPipelineResult(
  workflow: string | null,
  configuredEnvironments: readonly string[],
  lookup: GithubEnvironmentsLookup
): ProbeResult<DeployPipelineValue> {
  const jobStages =
    workflow === null ? [] : parseDeployWorkflowStages(workflow);
  const holdStages = configuredEnvironments.map(name =>
    mapEnvironmentHoldStage(name, lookup)
  );
  const stages = assembleDeployPipelineStages(jobStages, holdStages);
  if (stages.length === 0) {
    return { state: "not-applicable" };
  }
  return { state: "value", value: { stages: [...stages] } };
}
