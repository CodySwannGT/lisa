/**
 * Public re-exports for the Lisa settings console probe surface.
 *
 * Kept separate from `ui-cmd.ts` so the command module stays under the
 * repository max-lines budget as sibling live-status probes accumulate.
 * @module cli/ui-cmd-reexports
 */
export {
  createGithubAuthProbe,
  runProbe,
  type GitRemoteReader,
  type GithubAuthCheck,
  type ProbeResult,
  type StatusProbe,
} from "./ui-status.js";
export { createGithubRepoProbe } from "./ui-github-repo.js";
export {
  createEnabledPluginsProbe,
  buildEnabledPluginsValue,
  listMarketplacePluginsFromDisk,
  type EnabledPluginRow,
  type EnabledPluginsValue,
  type MarketplacePlugin,
} from "./ui-enabled-plugins.js";
export {
  AUTOMATIONS_PROBE_ID,
  createAutomationsProbe,
  mapHarnessAutomations,
  type AutomationsProbeDependencies,
  type AutomationsProbeValue,
  type AutomationProjectIdentity,
  type ClaudeAutomationLister,
  type ClaudeScheduleListingReader,
  type CodexAutomationLister,
  type CodexDirReadableCheck,
  type HarnessAutomationEntry,
  type HarnessAutomationObservation,
  type ProjectIdentityResolver,
} from "./ui-automations.js";
export {
  createDeployPipelineProbe,
  DEPLOY_PIPELINE_PROBE_ID,
  type DeployPipelineStage,
  type DeployPipelineValue,
} from "./ui-deploy-pipeline.js";
export {
  createDetectedStacksProbe,
  DETECTED_STACKS_PROBE_ID,
} from "./ui-detected-stacks.js";
export {
  createLisaVersionProbe,
  mapLisaVersionCheck,
  type LisaVersionValue,
} from "./ui-lisa-version.js";
export {
  createCiQualityJobsProbe,
  computeCiQualityJobs,
  parseCiWorkflowInputs,
  CI_QUALITY_JOBS_PROBE_ID,
  type CiQualityJobEntry,
  type CiQualityJobsValue,
  type CiWorkflowInputs,
  type RepoSecretsPresence,
} from "./ui-ci-quality-jobs.js";
export { createObservabilityProviderProbes } from "./ui-observability-providers.js";
export { inspectRemoteEnvironment } from "./remote-environment.js";
