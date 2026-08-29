/**
 * The discovery predicate every OpenCode vendoring installer shares.
 *
 * OpenCode is the one agent surface where Lisa copies skills, agents, and
 * commands verbatim into the host repo (`.opencode/`), so an ungated emit puts
 * the entire bundled catalogue in front of the model — Expo/React skills with
 * JSX worked examples in an infrastructure repo, game-design agents in a
 * backend. That is not cosmetic noise: a reviewer agent will cite a vendored
 * skill as if it were the host repo's own convention.
 *
 * Two independent concerns compose into one predicate here:
 *   1. **Harness-variant exclusion** (#1412) — the `*-agy` / `*-copilot` /
 *      `*-cursor` fanout directories are reformatted copies of canonical
 *      sources; letting them into discovery ships duplicates and lets a variant
 *      body win the last-wins dedup.
 *   2. **Project-type gating** (#3437) — only the base plugin, the detected
 *      stack plugins, and explicitly configured standalone plugins belong in a
 *      given host repo. This is the same gate the Codex skills installer
 *      (`codex/skills-installer`), the Codex project overlay, the OpenCode
 *      hooks installer, and the OpenCode MCP collector already apply.
 *
 * Both are kept: the project filter alone would already fail closed on variant
 * directories (they are never in the selected set), but the harness-variant
 * predicate states the #1412 intent independently so removing one gate does not
 * silently take the other with it.
 * @module opencode/project-plugin-gate
 */
import type { ProjectType } from "../core/config.js";
import {
  projectPluginFilter,
  selectProjectLisaPlugins,
} from "../core/lisa-plugin-selection.js";
import { isHarnessVariantPlugin } from "../core/lisa-skill-sources.js";

/**
 * Build the plugin-discovery predicate for one host project's OpenCode emit.
 * @param destDir - Absolute path to the host project root.
 * @param detectedTypes - Expanded, ordered project types Lisa detected.
 * @returns Predicate accepting only canonical plugins applicable to the project.
 */
export async function opencodeProjectPluginFilter(
  destDir: string,
  detectedTypes: readonly ProjectType[]
): Promise<(pluginName: string) => boolean> {
  const inProject = projectPluginFilter(
    await selectProjectLisaPlugins(destDir, detectedTypes)
  );
  return pluginName =>
    !isHarnessVariantPlugin(pluginName) && inProject(pluginName);
}
