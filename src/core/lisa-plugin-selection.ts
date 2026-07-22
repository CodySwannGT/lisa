/**
 * Select the Lisa plugin sources that belong to one host project.
 *
 * Codex consumes Lisa through project-local overlays, so source discovery must
 * never walk every built plugin. The base plugin is universal within a
 * Lisa-managed project; stack plugins follow detected project types; standalone
 * wiki/OpenClaw plugins follow explicit project configuration.
 * @module core/lisa-plugin-selection
 */
import * as fse from "fs-extra";
import * as path from "node:path";
import type { ProjectType } from "./config.js";

/** Lisa plugins that are selected by explicit project configuration. */
const STANDALONE_PLUGIN_CONFIG_KEYS = {
  openclaw: "lisa-openclaw",
  wiki: "lisa-wiki",
} as const;

/** Minimal `.lisa.config.json` shape used for standalone plugin selection. */
type LisaProjectConfig = Readonly<Record<string, unknown>>;

/**
 * Read project configuration without making a missing or malformed optional
 * file fatal to Codex emission.
 * @param destDir Host project root.
 * @returns Parsed project configuration, or an empty object.
 */
async function readProjectConfig(destDir: string): Promise<LisaProjectConfig> {
  try {
    return (await fse.readJson(
      path.join(destDir, ".lisa.config.json")
    )) as LisaProjectConfig;
  } catch {
    return {};
  }
}

/**
 * Select exactly the Lisa plugin source directories applicable to a project.
 * @param destDir Host project root.
 * @param detectedTypes Expanded, ordered project types.
 * @returns Stable set containing base, detected stacks, and configured features.
 */
export async function selectProjectLisaPlugins(
  destDir: string,
  detectedTypes: readonly ProjectType[]
): Promise<ReadonlySet<string>> {
  const config = await readProjectConfig(destDir);
  const hasLocalWiki = await fse.pathExists(
    path.join(destDir, "wiki", "lisa-wiki.config.json")
  );
  return selectProjectLisaPluginsFromState(config, detectedTypes, hasLocalWiki);
}

/**
 * Select plugins from already-safe project state without filesystem access.
 * @param config - Parsed project config
 * @param detectedTypes - Expanded, ordered project types
 * @param hasLocalWiki - Whether the local wiki contract marker exists
 * @returns Stable selected plugin set
 */
export function selectProjectLisaPluginsFromState(
  config: LisaProjectConfig,
  detectedTypes: readonly ProjectType[],
  hasLocalWiki: boolean
): ReadonlySet<string> {
  const configuredStandalonePlugins = Object.entries(
    STANDALONE_PLUGIN_CONFIG_KEYS
  )
    .filter(([configKey]) => config[configKey] !== undefined)
    .map(([, pluginName]) => pluginName);
  return new Set([
    "lisa",
    ...detectedTypes.map(type => `lisa-${type}`),
    ...configuredStandalonePlugins,
    ...(hasLocalWiki ? [STANDALONE_PLUGIN_CONFIG_KEYS.wiki] : []),
  ]);
}

/**
 * Build a discovery predicate from an already-selected project plugin set.
 * Harness fan-out variants and unrelated canonical stacks both fail closed.
 * @param selectedPlugins Canonical plugin directory names for the project.
 * @returns Predicate suitable for skill/agent discovery.
 */
export function projectPluginFilter(
  selectedPlugins: ReadonlySet<string>
): (pluginName: string) => boolean {
  return pluginName => selectedPlugins.has(pluginName);
}
