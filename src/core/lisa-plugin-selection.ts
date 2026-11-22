/**
 * Select the Lisa plugin sources that belong to one host project.
 *
 * Codex consumes Lisa through project-local overlays, so source discovery must
 * never walk every built plugin. The base plugin is universal within a
 * Lisa-managed project; stack plugins follow detected project types; the
 * knowledge plugin follows the required `knowledge` role.
 * @module core/lisa-plugin-selection
 */
import * as path from "node:path";
import { readJsonOrNull } from "../utils/json-utils.js";
import type { ProjectType } from "./config.js";
import { knowledgePluginFor } from "./knowledge-role.js";

/** Minimal `.lisa.config.json` shape used for standalone plugin selection. */
type LisaProjectConfig = Readonly<Record<string, unknown>>;

/**
 * Read project configuration without making a missing or malformed optional
 * file fatal to Codex emission.
 *
 * Reads through `readJsonOrNull` rather than the `fs-extra` namespace: `readJson`
 * is one of the `graceful-fs` passthroughs Node's ESM loader does not expose, so
 * `fse.readJson(...)` was `undefined` in the shipped `dist/` and threw a
 * `TypeError` straight into the `catch` this function used to have (#2487). Every
 * project therefore read as unconfigured, and the plugins keyed off this config
 * were never once selected.
 *
 * The old `catch` is gone rather than repaired. It could only ever mask the
 * failure of its own recovery, and it did not even cover the case it looked like
 * it covered: a file parsing to `null` threw no error here and crashed
 * downstream on property access instead.
 * @param destDir Host project root.
 * @returns Parsed project configuration, or an empty object.
 */
async function readProjectConfig(destDir: string): Promise<LisaProjectConfig> {
  const parsed = await readJsonOrNull<unknown>(
    path.join(destDir, ".lisa.config.json")
  );
  return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
    ? (parsed as LisaProjectConfig)
    : {};
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
  return selectProjectLisaPluginsFromState(config, detectedTypes);
}

/**
 * Select plugins from already-safe project state without filesystem access.
 * @param config - Parsed project config
 * @param detectedTypes - Expanded, ordered project types
 * @returns Stable selected plugin set
 */
export function selectProjectLisaPluginsFromState(
  config: LisaProjectConfig,
  detectedTypes: readonly ProjectType[]
): ReadonlySet<string> {
  const knowledgePlugin = knowledgePluginFor(config.knowledge);
  return new Set([
    "lisa",
    ...detectedTypes.map(type => `lisa-${type}`),
    ...(knowledgePlugin === undefined ? [] : [knowledgePlugin]),
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
