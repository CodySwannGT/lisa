/** Install Lisa's complete project-scoped Codex overlay. */
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { collectLisaMcpServers } from "../agy/mcp-installer.js";
import type { ProjectType } from "../core/config.js";
import {
  projectPluginFilter,
  selectProjectLisaPlugins,
} from "../core/lisa-plugin-selection.js";
import { createDetectorRegistry } from "../detection/index.js";
import { discoverLisaAgents, installAgents } from "./agent-installer.js";
import { installAgentsMd } from "./agents-md-installer.js";
import { readManagedManifest, writeManagedManifest } from "./manifest.js";
import { installCodexMcpConfig } from "./mcp-installer.js";
import { installCodexMarketplace } from "./plugin-marketplace-installer.js";
import { retireProjectHooks } from "./project-hooks-cleanup.js";
import { installSettings } from "./settings-installer.js";
import { installSkills } from "./skills-installer.js";

/** Summary of one project overlay reconciliation. */
export interface CodexProjectOverlayResult {
  readonly agentCount: number;
  readonly catalogEntryCount: number;
  readonly hookCount: number;
  readonly mcpServerCount: number;
  readonly marketplacePluginCount: number;
  readonly modelVisibleSkillCount: number;
  readonly settingsCreated: boolean;
  readonly staleAgentCount: number;
  readonly staleHookRuleCount: number;
  readonly staleSkillCount: number;
}

/**
 * Reconcile all Lisa-owned Codex surfaces inside one project.
 * @param lisaDir Lisa package root.
 * @param destDir Host project root.
 * @param detectedTypes Expanded detected project types.
 * @returns Counts used by the CLI and lifecycle logs.
 */
export async function installCodexProjectOverlay(
  lisaDir: string,
  destDir: string,
  detectedTypes: readonly ProjectType[]
): Promise<CodexProjectOverlayResult> {
  const previous = await readManagedManifest(destDir);
  const selectedPlugins = await selectProjectLisaPlugins(
    destDir,
    detectedTypes
  );
  const agentSources = await discoverLisaAgents(
    lisaDir,
    projectPluginFilter(selectedPlugins)
  );
  const agentResult = await installAgents(
    agentSources,
    destDir,
    previous.files
  );
  const hooksResult = await retireProjectHooks(destDir, previous.files);
  const settingsResult = await installSettings(destDir);
  const mcpResult = await installCodexMcpConfig(
    destDir,
    collectLisaMcpServers(path.join(lisaDir, "plugins"), detectedTypes)
  );
  const skillsResult = await installSkills(
    lisaDir,
    destDir,
    previous.files,
    detectedTypes
  );
  const marketplaceResult = await installCodexMarketplace(
    lisaDir,
    destDir,
    detectedTypes
  );
  await installAgentsMd(destDir);

  await writeManagedManifest(
    destDir,
    Array.from(
      new Set([
        ...agentResult.managedFiles,
        ...settingsResult.managedFiles,
        ...mcpResult.managedFiles,
        ...skillsResult.managedFiles,
      ])
    )
  );

  return {
    agentCount: agentResult.installed.length,
    catalogEntryCount: skillsResult.installed.length,
    hookCount: 0,
    mcpServerCount: mcpResult.serverCount,
    marketplacePluginCount: marketplaceResult.pluginEntries,
    modelVisibleSkillCount: skillsResult.modelVisible,
    settingsCreated: settingsResult.created,
    staleAgentCount: agentResult.deleted.length,
    staleHookRuleCount: hooksResult.deleted.length,
    staleSkillCount: skillsResult.deleted.length,
  };
}

/** Install only the project overlay when this module is run as a lifecycle CLI. */
async function runDirect(): Promise<void> {
  const destDir = path.resolve(process.argv[2] ?? process.cwd());
  const lisaDir = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    ".."
  );
  const registry = createDetectorRegistry();
  const detected = registry.expandAndOrderTypes(
    await registry.detectAll(destDir)
  );
  const result = await installCodexProjectOverlay(lisaDir, destDir, detected);
  process.stderr.write(
    `Lisa Codex overlay: ${result.modelVisibleSkillCount} native skills from ${result.marketplacePluginCount} project plugins.\n`
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await runDirect();
}
