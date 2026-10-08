import * as fse from "fs-extra";
import { copyFile } from "node:fs/promises";
import { isPostinstallSafeApply } from "../core/apply-mode.js";
import type { FileOperationResult } from "../core/config.js";
import type { ICopyStrategy, StrategyContext } from "./strategy.interface.js";
import { ensureParentDir } from "../utils/file-operations.js";
import {
  readJson,
  writeJson,
  deepMergeWithArrayUnion,
} from "../utils/json-utils.js";
import { JsonMergeError } from "../errors/index.js";

const OFFICIAL_SENTRY_PLUGIN = "sentry@claude-plugins-official";

/**
 * Produce the exact JSON merge result without filesystem access.
 * @param source - Lisa template object
 * @param destination - Existing host object
 * @returns Merged object with Lisa governance and explicit Sentry choice preserved
 */
export function mergeTemplateJson(
  source: Record<string, unknown>,
  destination: Record<string, unknown>
): Record<string, unknown> {
  const merged = deepMergeWithArrayUnion(destination, source);
  const existing = destination["enabledPlugins"];
  const plugins = merged["enabledPlugins"];
  if (
    !existing ||
    typeof existing !== "object" ||
    Array.isArray(existing) ||
    !plugins ||
    typeof plugins !== "object" ||
    Array.isArray(plugins)
  )
    return merged;
  const choice = (existing as Record<string, unknown>)[OFFICIAL_SENTRY_PLUGIN];
  if (typeof choice !== "boolean") return merged;
  // The official Claude plugin is optional, not a Lisa enforcement surface.
  // Other runtimes keep their native Sentry integrations; this preference only
  // names Claude's plugin. Missing choices still receive the template default.
  return {
    ...merged,
    enabledPlugins: { ...plugins, [OFFICIAL_SENTRY_PLUGIN]: choice },
  };
}

/**
 * Merge strategy: Deep merge JSON files (Lisa values take precedence)
 * - Project values serve as defaults
 * - Lisa values take precedence on conflicts
 * - Handle nested paths (.claude/settings.json)
 */
export class MergeStrategy implements ICopyStrategy {
  readonly name = "merge" as const;

  /**
   * Apply merge strategy: Deep merge JSON files with project values taking precedence
   * @param sourcePath - Source JSON file path
   * @param destPath - Destination JSON file path
   * @param relativePath - Relative path for logging
   * @param context - Strategy context with config and callbacks
   * @returns Result of the merge operation
   */
  async apply(
    sourcePath: string,
    destPath: string,
    relativePath: string,
    context: StrategyContext
  ): Promise<FileOperationResult> {
    const { config, backupFile } = context;
    const destExists = await fse.pathExists(destPath);

    if (!destExists) {
      if (!config.dryRun) {
        await ensureParentDir(destPath);
        await copyFile(sourcePath, destPath);
      }
      return { relativePath, strategy: this.name, action: "copied" };
    }

    if (isPostinstallSafeApply(config) && relativePath === "package.json") {
      return { relativePath, strategy: this.name, action: "skipped" };
    }

    const sourceJson = await readJson<object>(sourcePath).catch(() => {
      throw new JsonMergeError(
        relativePath,
        `Failed to parse source: ${sourcePath}`
      );
    });

    const destJson = await readJson<object>(destPath).catch(() => {
      throw new JsonMergeError(
        relativePath,
        `Failed to parse destination: ${destPath}`
      );
    });

    // Deep merge: Lisa (source) takes precedence, project (dest) provides defaults.
    // Arrays are unioned so Lisa templates add guardrails without removing host ones.
    const merged = mergeTemplateJson(
      sourceJson as Record<string, unknown>,
      destJson as Record<string, unknown>
    );

    // Normalize for comparison (parse and re-stringify both)
    const normalizedDest = JSON.stringify(destJson, null, 2);
    const normalizedMerged = JSON.stringify(merged, null, 2);

    if (normalizedDest === normalizedMerged) {
      return { relativePath, strategy: this.name, action: "skipped" };
    }

    if (!config.dryRun) {
      await backupFile(destPath);
      await writeJson(destPath, merged);
    }

    return { relativePath, strategy: this.name, action: "merged" };
  }
}
