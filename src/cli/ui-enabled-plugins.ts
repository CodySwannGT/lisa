/**
 * Live-status probe for the console Plugins & MCP section.
 *
 * Reads project `.claude/settings.json` `enabledPlugins` and joins against
 * marketplace catalogs on disk. READ-ONLY — never fabricates enablement.
 * @module cli/ui-enabled-plugins
 */
import { readFile } from "node:fs/promises";
import { homedir as defaultHomedir } from "node:os";
import * as path from "node:path";
import type { JsonValue } from "../sync/json-path.js";
import type { ProbeResult, StatusProbe } from "./ui-status.js";

/** One plugin entry from a marketplace.json catalog. */
export type MarketplacePlugin = {
  readonly name: string;
  readonly description?: string;
};

/** One plugin row emitted by the enabled-plugins probe. */
export type EnabledPluginRow = {
  readonly [key: string]: JsonValue;
  readonly id: string;
  readonly status: "enabled" | "available";
  readonly description: string;
};

/** Structured value emitted by the enabled-plugins live-status probe. */
export type EnabledPluginsValue = {
  readonly [key: string]: JsonValue;
  /** False when `.claude/settings.json` is absent (empty-state trigger). */
  readonly settingsPresent: boolean;
  /** Enabled and available-not-enabled plugins; never demo data. */
  readonly plugins: EnabledPluginRow[];
};

/** Injectable collaborators for focused tests. */
export type EnabledPluginsProbeDependencies = {
  /** Home directory used to locate `~/.claude/plugins/known_marketplaces.json`. */
  readonly homedir?: () => string;
  /** Override marketplace discovery for unit tests. */
  readonly listMarketplacePlugins?: (
    cwd: string,
    home: string
  ) => Promise<ReadonlyMap<string, string>>;
};

const ENABLED_PLUGINS_PROBE_ID = "enabled-plugins";
const SETTINGS_RELATIVE = path.join(".claude", "settings.json");
const MARKETPLACE_JSON = path.join(".claude-plugin", "marketplace.json");

/**
 * Read and parse JSON with a real parser; never hand-roll.
 * @param filePath - Absolute path to a JSON file
 * @returns Parsed value
 */
async function readJsonFile(filePath: string): Promise<unknown> {
  const content = await readFile(filePath, "utf8");
  return JSON.parse(content) as unknown;
}

/**
 * Extract `plugin@marketplace` → description pairs from one marketplace.json.
 * @param marketplacePath - Absolute path to marketplace.json
 * @param fallbackName - Name used when the file omits `name`
 * @returns Catalog entries (may be empty on read/parse failure)
 */
async function readMarketplaceEntries(
  marketplacePath: string,
  fallbackName: string
): Promise<readonly (readonly [string, string])[]> {
  try {
    const parsed = await readJsonFile(marketplacePath);
    if (typeof parsed !== "object" || parsed === null) {
      return [];
    }
    const nameRaw = Reflect.get(parsed, "name");
    const marketplaceName =
      typeof nameRaw === "string" && nameRaw.trim().length > 0
        ? nameRaw.trim()
        : fallbackName;
    const plugins = Reflect.get(parsed, "plugins");
    if (!Array.isArray(plugins)) {
      return [];
    }
    return plugins.flatMap(entry => {
      if (typeof entry !== "object" || entry === null) {
        return [];
      }
      const pluginName = Reflect.get(entry, "name");
      if (typeof pluginName !== "string" || pluginName.trim().length === 0) {
        return [];
      }
      const descriptionRaw = Reflect.get(entry, "description");
      const description =
        typeof descriptionRaw === "string" ? descriptionRaw : "";
      return [
        [`${pluginName.trim()}@${marketplaceName}`, description],
      ] as const;
    });
  } catch {
    return [];
  }
}

/**
 * Read install locations from `~/.claude/plugins/known_marketplaces.json`.
 * @param home - Home directory
 * @returns Marketplace name → installLocation pairs
 */
async function readKnownMarketplaceInstalls(
  home: string
): Promise<readonly (readonly [string, string])[]> {
  const knownPath = path.join(
    home,
    ".claude",
    "plugins",
    "known_marketplaces.json"
  );
  try {
    const known = await readJsonFile(knownPath);
    if (typeof known !== "object" || known === null || Array.isArray(known)) {
      return [];
    }
    return Object.entries(known).flatMap(([marketplaceName, entry]) => {
      if (typeof entry !== "object" || entry === null) {
        return [];
      }
      const installLocation = Reflect.get(entry, "installLocation");
      if (typeof installLocation !== "string" || installLocation.length === 0) {
        return [];
      }
      return [[marketplaceName, installLocation]] as const;
    });
  } catch {
    return [];
  }
}

/**
 * Collect plugin id → description from known Claude marketplaces on disk.
 * @param cwd - Project root (checked for a local `.claude-plugin/marketplace.json`)
 * @param home - Home directory containing `~/.claude/plugins`
 * @returns Map of `plugin@marketplace` ids to descriptions
 */
export async function listMarketplacePluginsFromDisk(
  cwd: string,
  home: string
): Promise<ReadonlyMap<string, string>> {
  const localEntries = await readMarketplaceEntries(
    path.join(cwd, MARKETPLACE_JSON),
    "lisa"
  );
  const installs = await readKnownMarketplaceInstalls(home);
  const knownEntries = (
    await Promise.all(
      installs.map(async ([marketplaceName, installLocation]) =>
        readMarketplaceEntries(
          path.join(installLocation, MARKETPLACE_JSON),
          marketplaceName
        )
      )
    )
  ).flat();
  // Later entries win so the project's local marketplace takes precedence.
  return new Map([...knownEntries, ...localEntries]);
}

/**
 * Sort enabled rows before available, then by id.
 * @param left - First row
 * @param right - Second row
 * @returns Comparator result
 */
function comparePluginRows(
  left: EnabledPluginRow,
  right: EnabledPluginRow
): number {
  if (left.status !== right.status) {
    return left.status === "enabled" ? -1 : 1;
  }
  return left.id.localeCompare(right.id);
}

/**
 * Build the probe value from settings + marketplace catalog.
 * @param settingsPresent - Whether settings.json existed
 * @param enabledPlugins - Parsed enabledPlugins map (true = enabled)
 * @param marketplace - Plugin id → description catalog
 * @returns Structured probe value
 */
export function buildEnabledPluginsValue(
  settingsPresent: boolean,
  enabledPlugins: Readonly<Record<string, boolean>>,
  marketplace: ReadonlyMap<string, string>
): EnabledPluginsValue {
  if (!settingsPresent) {
    return { settingsPresent: false, plugins: [] };
  }

  const enabledRows: EnabledPluginRow[] = Object.entries(enabledPlugins)
    .filter(
      (entry): entry is [string, true] =>
        typeof entry[0] === "string" &&
        entry[0].trim().length > 0 &&
        entry[1] === true
    )
    .map(([id]) => ({
      id,
      status: "enabled" as const,
      description: marketplace.get(id) ?? "",
    }));

  const enabledIds = new Set(enabledRows.map(row => row.id));
  const availableRows: EnabledPluginRow[] = [...marketplace.entries()]
    .filter(([id]) => !enabledIds.has(id))
    .map(([id, description]) => ({
      id,
      status: "available" as const,
      description,
    }));

  return {
    settingsPresent: true,
    plugins: [...enabledRows, ...availableRows].sort(comparePluginRows),
  };
}

/**
 * Parse `enabledPlugins` from a settings document.
 * @param settings - Parsed settings.json root
 * @returns Map of plugin id → enabled, or an error reason
 */
function parseEnabledPluginsMap(
  settings: unknown
):
  | { readonly ok: true; readonly map: Record<string, boolean> }
  | { readonly ok: false; readonly reason: string; readonly message: string } {
  if (
    typeof settings !== "object" ||
    settings === null ||
    Array.isArray(settings)
  ) {
    return {
      ok: false,
      reason: "invalid-settings",
      message: ".claude/settings.json did not contain a JSON object",
    };
  }
  if (!Object.hasOwn(settings, "enabledPlugins")) {
    return { ok: true, map: {} };
  }
  const enabledPlugins = Reflect.get(settings, "enabledPlugins");
  if (
    typeof enabledPlugins !== "object" ||
    enabledPlugins === null ||
    Array.isArray(enabledPlugins)
  ) {
    return {
      ok: false,
      reason: "invalid-enabled-plugins",
      message:
        "enabledPlugins must be a JSON object map of plugin id → boolean",
    };
  }
  const map = Object.fromEntries(
    Object.entries(enabledPlugins).filter(
      (entry): entry is [string, boolean] => typeof entry[1] === "boolean"
    )
  );
  return { ok: true, map };
}

/**
 * Classify a settings.json read failure into empty vs unknown.
 * @param error - Thrown value from read/parse
 * @returns Probe outcome when the file cannot be used
 */
function classifySettingsReadError(
  error: unknown
): ProbeResult<EnabledPluginsValue> | { readonly missing: true } {
  const code =
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof Reflect.get(error, "code") === "string"
      ? (Reflect.get(error, "code") as string)
      : undefined;
  if (code === "ENOENT") {
    return { missing: true };
  }
  if (error instanceof SyntaxError) {
    return {
      state: "unknown",
      reason: "unparseable-settings",
      message:
        error.message.trim().length > 0
          ? error.message
          : ".claude/settings.json could not be parsed as JSON",
    };
  }
  const message =
    error instanceof Error && error.message.trim().length > 0
      ? error.message
      : "Failed to read .claude/settings.json";
  return {
    state: "unknown",
    reason: "settings-read-failed",
    message,
  };
}

/**
 * Create the probe that reports project plugin enablement vs marketplace availability.
 * @param cwd - Project root containing `.claude/settings.json`
 * @param dependencies - Injectable collaborators for focused tests
 * @returns Probe emitting enabled / available-not-enabled rows, or unknown
 */
export function createEnabledPluginsProbe(
  cwd: string,
  dependencies: EnabledPluginsProbeDependencies = {}
): StatusProbe<EnabledPluginsValue> {
  const resolveHome = dependencies.homedir ?? defaultHomedir;
  const listMarketplace =
    dependencies.listMarketplacePlugins ?? listMarketplacePluginsFromDisk;

  return {
    id: ENABLED_PLUGINS_PROBE_ID,
    timeoutMs: 5_000,
    run: async (): Promise<ProbeResult<EnabledPluginsValue>> => {
      const settingsPath = path.join(cwd, SETTINGS_RELATIVE);
      const loaded = await readJsonFile(settingsPath).then(
        settings => ({ ok: true as const, settings }),
        (error: unknown) => ({ ok: false as const, error })
      );

      if (!loaded.ok) {
        const classified = classifySettingsReadError(loaded.error);
        if (!("missing" in classified)) {
          return classified;
        }
        const marketplace = await listMarketplace(cwd, resolveHome());
        return {
          state: "value",
          value: buildEnabledPluginsValue(false, {}, marketplace),
        };
      }

      const parsed = parseEnabledPluginsMap(loaded.settings);
      if (!parsed.ok) {
        return {
          state: "unknown",
          reason: parsed.reason,
          message: parsed.message,
        };
      }

      const marketplace = await listMarketplace(cwd, resolveHome());
      return {
        state: "value",
        value: buildEnabledPluginsValue(true, parsed.map, marketplace),
      };
    },
  };
}
