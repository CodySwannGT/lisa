import * as path from "node:path";
import type { ProjectType } from "../core/config.js";
import { RETIRED_STACK_PLUGIN_KEYS } from "../core/retired-plugin-keys.js";
import { readJsonOrNull, writeJson } from "../utils/json-utils.js";
import type {
  Migration,
  MigrationContext,
  MigrationResult,
} from "./migration.interface.js";

const SETTINGS_REL_PATH = path.join(".claude", "settings.json");

/** Minimal shape of a Claude `.claude/settings.json` for plugin pruning. */
interface ClaudeSettings {
  readonly enabledPlugins?: Readonly<Record<string, boolean>>;
  readonly [key: string]: unknown;
}

/**
 * The retired keys in `enabledPlugins` that are safe to remove: those whose
 * successor is already present, and those whose stack type no longer applies.
 * A retired key whose type still applies but whose successor is missing is
 * kept — removing it would leave the stack with no plugin key at all.
 * @param enabledPlugins - Current enabledPlugins map
 * @param detectedTypes - Detected project types (already parent-expanded)
 * @returns Retired keys to remove, in file order
 */
function findRemovableRetiredKeys(
  enabledPlugins: Readonly<Record<string, boolean>>,
  detectedTypes: readonly ProjectType[]
): readonly string[] {
  return Object.keys(enabledPlugins).filter(key => {
    const retired = RETIRED_STACK_PLUGIN_KEYS.get(key);
    if (retired === undefined) {
      return false;
    }
    return (
      Object.hasOwn(enabledPlugins, retired.successor) ||
      !detectedTypes.includes(retired.type)
    );
  });
}

/**
 * Read the project's `.claude/settings.json`, returning null when absent.
 * @param projectDir - Destination project directory
 * @returns Parsed settings or null when missing/invalid
 */
async function readClaudeSettings(
  projectDir: string
): Promise<ClaudeSettings | null> {
  return readJsonOrNull<ClaudeSettings>(
    path.join(projectDir, SETTINGS_REL_PATH)
  );
}

/**
 * Migration: remove the stack plugin keys Lisa once shipped and later renamed
 * (see {@link RETIRED_STACK_PLUGIN_KEYS} for the exact keys and the commits
 * that prove them).
 *
 * `reconcile-claude-stack-plugins` manages only `lisa-<type>@lisa` keys, and
 * the merge strategy only adds keys, so nothing ever removed the old names.
 * Every apply and every new worktree then tried to install a plugin that does
 * not exist, warned, and the worktree bootstrap never settled
 * (CodySwannGT/lisa#4645).
 *
 * Registered after `reconcile-claude-stack-plugins`, so a successor that
 * migration adds retires its predecessor in the same apply. Host-added keys,
 * including any other `<name>@lisa` key, are never touched.
 */
export class PruneRetiredClaudeStackPluginKeysMigration implements Migration {
  readonly name = "prune-retired-claude-stack-plugin-keys";
  readonly description =
    "Remove renamed Lisa stack plugin keys (e.g. typescript@lisa) from .claude/settings.json";

  /**
   * Whether any retired key can be removed.
   * @param ctx - Migration context
   * @returns True when at least one retired key is removable
   */
  async applies(ctx: MigrationContext): Promise<boolean> {
    const settings = await readClaudeSettings(ctx.projectDir);
    if (!settings?.enabledPlugins) {
      return false;
    }
    return (
      findRemovableRetiredKeys(settings.enabledPlugins, ctx.detectedTypes)
        .length > 0
    );
  }

  /**
   * Remove the removable retired keys and name each one.
   * @param ctx - Migration context
   * @returns Result naming the keys removed
   */
  async apply(ctx: MigrationContext): Promise<MigrationResult> {
    const settings = await readClaudeSettings(ctx.projectDir);
    const enabledPlugins = settings?.enabledPlugins;
    if (!settings || !enabledPlugins) {
      return { name: this.name, action: "noop" };
    }
    const removed = findRemovableRetiredKeys(enabledPlugins, ctx.detectedTypes);
    if (removed.length === 0) {
      return { name: this.name, action: "noop" };
    }

    const message = `Removed retired plugin ${removed.length === 1 ? "key" : "keys"}: ${removed.join(", ")}`;
    const result: MigrationResult = {
      name: this.name,
      action: "applied",
      changedFiles: [SETTINGS_REL_PATH],
      message,
    };

    if (ctx.dryRun) {
      ctx.logger.dry(`Would update ${SETTINGS_REL_PATH}: ${message}`);
      return result;
    }

    const removedSet = new Set(removed);
    await writeJson(path.join(ctx.projectDir, SETTINGS_REL_PATH), {
      ...settings,
      enabledPlugins: Object.fromEntries(
        Object.entries(enabledPlugins).filter(([key]) => !removedSet.has(key))
      ),
    });
    ctx.logger.success(message);
    return result;
  }
}
