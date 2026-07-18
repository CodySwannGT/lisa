import * as path from "node:path";
import { createDetectorRegistry } from "../detection/index.js";
import type { JsonObject } from "../sync/json-path.js";
import { readJsonOrNull } from "../utils/index.js";
import {
  DEFAULT_STARTUP_ARTIFACTS,
  manifestRequirements,
  REMOTE_AGENTS,
  REMOTE_ENVIRONMENT_MANIFEST,
  type RemoteAgent,
  type RemoteEnvironmentManifest,
  type RemoteEnvironmentStartupStatus,
  type RemoteEnvironmentStatus,
  uniqueRequirements,
} from "./remote-environment-contract.js";
import { configuredIntegrationRequirements } from "./remote-environment-catalog.js";
import {
  detectedProjectRequirements,
  projectFileExists,
} from "./remote-environment-detection.js";

export type {
  RemoteEnvironmentStartupStatus,
  RemoteEnvironmentStatus,
  RemoteEnvironmentVariableStatus,
} from "./remote-environment-contract.js";

/**
 * Restrict manifest artifacts to files beneath the host project.
 * @param candidate - Project-owned manifest value
 * @returns Whether the value is a safe project-relative path
 */
function isSafeProjectArtifact(candidate: string): boolean {
  return (
    candidate.length > 0 &&
    !path.isAbsolute(candidate) &&
    !candidate.split(/[\\/]/u).includes("..")
  );
}

/**
 * Resolve an explicitly configured or discovered startup artifact for one agent.
 * @param destDir - Project root
 * @param agent - Supported coding agent
 * @param manifest - Project-owned manifest
 * @returns Startup artifact status
 */
async function resolveStartupScript(
  destDir: string,
  agent: RemoteAgent,
  manifest: RemoteEnvironmentManifest | null
): Promise<RemoteEnvironmentStartupStatus> {
  const configured = manifest?.startupScripts?.[agent];
  const explicit =
    typeof configured === "string" && isSafeProjectArtifact(configured)
      ? configured
      : undefined;
  const candidates =
    explicit === undefined ? DEFAULT_STARTUP_ARTIFACTS[agent] : [explicit];
  const existence = await Promise.all(
    candidates.map(async artifact => ({
      artifact,
      exists: await projectFileExists(destDir, artifact),
    }))
  );
  const installed = existence.find(candidate => candidate.exists);
  return installed === undefined
    ? {
        agent,
        ...(explicit === undefined ? {} : { artifact: explicit }),
        installed: false,
      }
    : { agent, artifact: installed.artifact, installed: true };
}

/**
 * Inspect requirements for this particular project without exposing values.
 * @param destDir - Project root
 * @param config - Merged Lisa project config
 * @param environment - Environment visible to the Lisa process
 * @returns Project-aware variable and startup-artifact status
 */
export async function inspectRemoteEnvironment(
  destDir: string,
  config: JsonObject,
  environment: NodeJS.ProcessEnv
): Promise<RemoteEnvironmentStatus> {
  const detectorRegistry = createDetectorRegistry();
  const [detectedTypes, manifest] = await Promise.all([
    detectorRegistry.detectAll(destDir),
    readJsonOrNull<RemoteEnvironmentManifest>(
      path.join(destDir, REMOTE_ENVIRONMENT_MANIFEST)
    ),
  ]);
  const projectTypes = detectorRegistry.expandAndOrderTypes(detectedTypes);
  const requirements = uniqueRequirements([
    ...configuredIntegrationRequirements(config),
    ...(await detectedProjectRequirements(destDir, projectTypes)),
    ...manifestRequirements(manifest),
  ]);
  const startupScripts = await Promise.all(
    REMOTE_AGENTS.map(agent => resolveStartupScript(destDir, agent, manifest))
  );
  return {
    projectTypes,
    variables: requirements.map(requirement => ({
      ...requirement,
      set:
        typeof environment[requirement.name] === "string" &&
        environment[requirement.name]!.length > 0,
    })),
    startupScripts,
  };
}
