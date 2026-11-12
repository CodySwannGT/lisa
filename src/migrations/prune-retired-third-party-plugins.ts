import * as path from "node:path";
import { readJsonOrNull, writeJson } from "../utils/json-utils.js";
import type {
  Migration,
  MigrationContext,
  MigrationResult,
} from "./migration.interface.js";

const SETTINGS_REL_PATH = path.join(".claude", "settings.json");

/**
 * Third-party plugin keys Lisa once enabled or pinned, and has retired.
 *
 * - `impeccable@impeccable` — an unpinned design plugin the Expo and Rails
 *   templates enabled from `pbakaus/impeccable` (#311).
 * - `cc-safety-net@cc-marketplace` — the upstream safety-net plugin's real
 *   name. Lisa's `parity-safety-net.sh` hook already screens every Bash
 *   command, so it double-screened them (#1960).
 * - `safety-net@cc-marketplace` — the name #1960 pinned to `false`, which
 *   matches no plugin, which is why the real one stayed on (#4799).
 * - `code-review@claude-plugins-official` — superseded by Claude Code's
 *   built-in `/code-review`; other agents use Lisa's `lisa-parity-code-review`.
 * - `code-simplifier@claude-plugins-official` — replaced by a simplification
 *   instruction in Lisa's coding-philosophy rule, which every agent loads.
 * - `skill-creator@claude-plugins-official` — retired by the owner, along
 *   with Lisa's `lisa-parity-skill-creator` reimplementation.
 */
export const RETIRED_THIRD_PARTY_PLUGIN_KEYS: readonly string[] = [
  "impeccable@impeccable",
  "cc-safety-net@cc-marketplace",
  "safety-net@cc-marketplace",
  "code-review@claude-plugins-official",
  "code-simplifier@claude-plugins-official",
  "skill-creator@claude-plugins-official",
];

/** The marketplaces registered only to serve those plugins. */
export const RETIRED_THIRD_PARTY_MARKETPLACES: readonly string[] = [
  "pbakaus/impeccable",
  "kenryu42/cc-marketplace",
];

/** Minimal shape of a Claude `.claude/settings.json` for this pruning. */
interface ClaudeSettings {
  readonly enabledPlugins?: Readonly<Record<string, unknown>>;
  readonly extraKnownMarketplaces?: Readonly<Record<string, unknown>>;
  readonly [key: string]: unknown;
}

/** What one settings file would lose. */
interface Removal {
  readonly plugins: readonly string[];
  readonly marketplaces: readonly string[];
}

/**
 * The retired entries present in a settings object.
 * @param settings - Parsed `.claude/settings.json`
 * @returns The plugin keys and marketplace keys to remove, in file order
 */
export function retiredEntries(settings: ClaudeSettings): Removal {
  return {
    plugins: Object.keys(settings.enabledPlugins ?? {}).filter(key =>
      RETIRED_THIRD_PARTY_PLUGIN_KEYS.includes(key)
    ),
    marketplaces: Object.keys(settings.extraKnownMarketplaces ?? {}).filter(
      key => RETIRED_THIRD_PARTY_MARKETPLACES.includes(key)
    ),
  };
}

/**
 * A copy of `record` without `keys`, or the record unchanged when it is absent.
 * @param record - An object map, possibly absent
 * @param keys - Keys to drop
 * @returns The filtered map, or undefined when there was none
 */
function without(
  record: Readonly<Record<string, unknown>> | undefined,
  keys: readonly string[]
): Record<string, unknown> | undefined {
  if (record === undefined) return undefined;
  return Object.fromEntries(
    Object.entries(record).filter(([key]) => !keys.includes(key))
  );
}

/**
 * Migration: remove retired third-party plugins and their marketplaces from a
 * host's `.claude/settings.json` (CodySwannGT/lisa#4799).
 *
 * The merge strategy only adds keys, so dropping them from the templates
 * leaves every existing host carrying them. This migration is the only path
 * by which an installed base sheds them. It removes exactly the listed keys,
 * whatever their value: a host that explicitly enabled one loses it too,
 * because the owner retired these plugins outright. Every other plugin and
 * marketplace entry is left untouched.
 */
export class PruneRetiredThirdPartyPluginsMigration implements Migration {
  readonly name = "prune-retired-third-party-plugins";
  readonly description =
    "Remove retired third-party plugins (impeccable, cc-safety-net, code-review, code-simplifier, skill-creator) and their marketplaces from .claude/settings.json";

  /**
   * Whether the host still carries any retired entry.
   * @param ctx - Migration context
   * @returns True when there is something to remove
   */
  async applies(ctx: MigrationContext): Promise<boolean> {
    const settings = await readJsonOrNull<ClaudeSettings>(
      path.join(ctx.projectDir, SETTINGS_REL_PATH)
    );
    if (!settings) return false;
    const { plugins, marketplaces } = retiredEntries(settings);
    return plugins.length + marketplaces.length > 0;
  }

  /**
   * Remove the retired entries and name each one.
   * @param ctx - Migration context
   * @returns Result naming what was removed
   */
  async apply(ctx: MigrationContext): Promise<MigrationResult> {
    const settingsPath = path.join(ctx.projectDir, SETTINGS_REL_PATH);
    const settings = await readJsonOrNull<ClaudeSettings>(settingsPath);
    if (!settings) return { name: this.name, action: "noop" };
    const { plugins, marketplaces } = retiredEntries(settings);
    if (plugins.length + marketplaces.length === 0) {
      return { name: this.name, action: "noop" };
    }

    const message = `Removed retired third-party plugins: ${[...plugins, ...marketplaces].join(", ")}`;
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

    const enabledPlugins = without(settings.enabledPlugins, plugins);
    const extraKnownMarketplaces = without(
      settings.extraKnownMarketplaces,
      marketplaces
    );
    await writeJson(settingsPath, {
      ...settings,
      ...(enabledPlugins === undefined ? {} : { enabledPlugins }),
      ...(extraKnownMarketplaces === undefined
        ? {}
        : { extraKnownMarketplaces }),
    });
    ctx.logger.success(message);
    return result;
  }
}
