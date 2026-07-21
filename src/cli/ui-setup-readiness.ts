/** Current read-only Setup checklist readiness projection for `lisa ui`. */
import { realpath } from "node:fs/promises";
import * as path from "node:path";
import { runDeterministicHealth } from "../health/deterministic.js";
import type { HealthResult } from "../health/contract.js";
import type { JsonObject } from "../sync/json-path.js";
import {
  createAutomationsProbe,
  type AutomationsProbeValue,
} from "./ui-automations.js";
import {
  readOriginRemote,
  resolveExpectedAutomationEntries,
} from "./ui-automations-adapters.js";
import { readConfinedDetectedStacks } from "./ui-detected-stacks.js";
import { readConfinedMergedConfig } from "./ui-confined-project-read.js";
import {
  explorationFinding,
  prdSourceFinding,
  starterProvenanceFinding,
  trackerFinding,
} from "./ui-setup-readiness-config.js";
import {
  healthEvidenceFinding,
  readWorkflowSecretNames,
  standardsFinding,
  agentReadyFinding,
  wikiSetupFinding,
} from "./ui-setup-readiness-local.js";
import { installFinding } from "./ui-setup-readiness-install.js";
import {
  automationsFinding,
  githubGovernanceFinding,
  secretsFinding,
} from "./ui-setup-readiness-remote.js";
import {
  validateSetupReadinessResult,
  type SetupReadinessResult,
} from "./ui-setup-readiness-contract.js";
import {
  createGithubRepoProbe,
  type GithubRepoPanelValue,
} from "./ui-github-repo.js";
import {
  createDeployPipelineProbe,
  type DeployPipelineValue,
} from "./ui-deploy-pipeline.js";
import { runProbe, type ProbeResult } from "./ui-status.js";

const ORIGIN_REMOTE_TIMEOUT_MS = 2_500;

/** Bounded inputs captured for one projection. */
export interface SetupReadinessObservations {
  readonly config: JsonObject;
  readonly health?: HealthResult;
  readonly github: ProbeResult<GithubRepoPanelValue>;
  readonly deployPipeline: ProbeResult<DeployPipelineValue>;
  readonly automations: ProbeResult<AutomationsProbeValue>;
  readonly expectedAutomationIds?: readonly string[];
  readonly expectedSecretNames: readonly string[];
  readonly observedAt?: Date;
}

/** Injectable readers for endpoint and focused integration tests. */
export interface SetupReadinessDependencies {
  readonly readConfig?: (projectRoot: string) => Promise<JsonObject>;
  readonly readHealth?: (projectRoot: string) => Promise<HealthResult>;
  readonly readGithub?: (
    projectRoot: string,
    config: JsonObject
  ) => Promise<ProbeResult<GithubRepoPanelValue>>;
  readonly readDeployPipeline?: (
    projectRoot: string
  ) => Promise<ProbeResult<DeployPipelineValue>>;
  readonly readAutomations?: (
    projectRoot: string
  ) => Promise<ProbeResult<AutomationsProbeValue>>;
  readonly readExpectedAutomationIds?: (
    projectRoot: string,
    config: JsonObject
  ) => Promise<readonly string[]>;
  readonly readExpectedSecretNames?: (
    projectRoot: string
  ) => Promise<readonly string[]>;
  readonly now?: () => Date;
}

/**
 * Read the same committed-plus-local merged config used by the console.
 * @param projectRoot - Project root whose Lisa config should be read.
 * @returns The bounded merged UI configuration.
 */
export async function readMergedUiConfig(
  projectRoot: string
): Promise<JsonObject> {
  return await readConfinedMergedConfig(projectRoot);
}

/**
 * Produce the exact twelve findings from already captured observations.
 * @param projectRoot - Canonical project root for local evidence checks.
 * @param observations - Bounded observations captured for this projection.
 * @returns The validated twelve-finding readiness result.
 */
export async function projectSetupReadiness(
  projectRoot: string,
  observations: SetupReadinessObservations
): Promise<SetupReadinessResult> {
  const [install, agentReady, wiki] = await Promise.all([
    installFinding(projectRoot, observations.config, observations.health),
    agentReadyFinding(projectRoot),
    wikiSetupFinding(projectRoot, observations.health),
  ]);
  const findings = [
    install,
    healthEvidenceFinding(
      "setup.sync",
      observations.health,
      ["config.required", "config.sync"],
      "Required Lisa config and mirrored artifacts are populated and synchronized.",
      "fail"
    ),
    agentReady,
    standardsFinding(observations.health),
    trackerFinding(observations.config),
    prdSourceFinding(observations.config),
    githubGovernanceFinding(
      observations.health,
      observations.github,
      observations.deployPipeline
    ),
    secretsFinding(observations.github, observations.expectedSecretNames),
    automationsFinding(
      observations.automations,
      observations.expectedAutomationIds
    ),
    explorationFinding(observations.config),
    wiki,
    starterProvenanceFinding(observations.config),
  ];
  return validateSetupReadinessResult({
    schemaVersion: 1,
    observedAt: (observations.observedAt ?? new Date()).toISOString(),
    findings,
  });
}

/**
 * Convert a failed bounded read into an explicit unknown probe state.
 * @param reason - Stable machine-readable failure reason.
 * @returns An unknown probe result that cannot be mistaken for success.
 */
function unknownProbe(reason: string): ProbeResult<never> {
  return {
    state: "unknown",
    reason,
    message: "The setup readiness capability could not be observed.",
  };
}

/**
 * Resolve applicable automation IDs with the same origin fallback as identity.
 * @param root - Canonical project root.
 * @param config - Bounded merged Lisa configuration.
 * @returns Expected automation identifiers for the current project.
 */
async function readDefaultExpectedAutomationIds(
  root: string,
  config: JsonObject
): Promise<readonly string[]> {
  const stacks = await readConfinedDetectedStacks(root);
  const gitRemoteUrl = await readOriginRemote(
    root,
    AbortSignal.timeout(ORIGIN_REMOTE_TIMEOUT_MS)
  );
  return (
    await resolveExpectedAutomationEntries(config, stacks, gitRemoteUrl)
  ).map(entry => entry.automationId);
}

/**
 * Create a safe-to-repeat reader for one localhost UI server.
 * @param projectPath - Project path served by the local UI.
 * @param dependencies - Optional bounded reader overrides for verification.
 * @returns A read-only readiness projection reader.
 */
export function createSetupReadinessReader(
  projectPath: string,
  dependencies: SetupReadinessDependencies = {}
): () => Promise<SetupReadinessResult> {
  const readConfig = dependencies.readConfig ?? readMergedUiConfig;
  const readHealth =
    dependencies.readHealth ??
    (async (root: string) =>
      await runDeterministicHealth(root, { deadlineMs: 20_000 }));
  const readGithub =
    dependencies.readGithub ??
    (async (root: string, config: JsonObject) =>
      await runProbe(createGithubRepoProbe(root, config)));
  const readAutomations =
    dependencies.readAutomations ??
    (async (root: string) =>
      await runProbe(createAutomationsProbe({ cwd: root })));
  const readDeployPipeline =
    dependencies.readDeployPipeline ??
    (async (root: string) => await runProbe(createDeployPipelineProbe(root)));
  const readExpectedAutomationIds =
    dependencies.readExpectedAutomationIds ?? readDefaultExpectedAutomationIds;
  const readSecrets =
    dependencies.readExpectedSecretNames ?? readWorkflowSecretNames;
  return async () => {
    const projectRoot = await realpath(path.resolve(projectPath));
    const config = await readConfig(projectRoot).catch(() => ({}));
    const [
      health,
      github,
      deployPipeline,
      automations,
      expectedAutomationIds,
      expectedSecretNames,
    ] = await Promise.all([
      readHealth(projectRoot).catch(() => undefined),
      readGithub(projectRoot, config).catch(() =>
        unknownProbe("github-read-failed")
      ),
      readDeployPipeline(projectRoot).catch(() =>
        unknownProbe("deploy-pipeline-read-failed")
      ),
      readAutomations(projectRoot).catch(() =>
        unknownProbe("scheduler-read-failed")
      ),
      readExpectedAutomationIds(projectRoot, config).catch(() => undefined),
      readSecrets(projectRoot).catch(() => []),
    ]);
    return await projectSetupReadiness(projectRoot, {
      config,
      ...(health === undefined ? {} : { health }),
      github,
      deployPipeline,
      automations,
      ...(expectedAutomationIds === undefined ? {} : { expectedAutomationIds }),
      expectedSecretNames,
      ...(dependencies.now === undefined
        ? {}
        : { observedAt: dependencies.now() }),
    });
  };
}

export type {
  SetupReadinessCheck,
  SetupReadinessFinding,
  SetupReadinessResult,
} from "./ui-setup-readiness-contract.js";
export {
  SETUP_READINESS_CHECKS,
  validateSetupReadinessResult,
} from "./ui-setup-readiness-contract.js";
