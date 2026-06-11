/**
 * Install a repo-local Codex plugin marketplace for Lisa.
 *
 * Codex discovers repo marketplaces from `<repo>/.agents/plugins/marketplace.json`.
 * In downstream projects, Lisa lives under `node_modules/@codyswann/lisa`, so
 * this marketplace points Codex at the Lisa plugin directories shipped there.
 */
import * as fse from "fs-extra";
import { readFile, writeFile } from "node:fs/promises";
import * as path from "node:path";

/** Location of the Codex marketplace file relative to a host project root */
export const CODEX_MARKETPLACE_PATH = path.join(
  ".agents",
  "plugins",
  "marketplace.json"
);

/** Lisa plugin names exposed to Codex */
const LISA_CODEX_PLUGINS = [
  "lisa",
  "lisa-typescript",
  "lisa-expo",
  "lisa-nestjs",
  "lisa-cdk",
  "lisa-harper-fabric",
  "lisa-phaser",
  "lisa-rails",
  "lisa-wiki",
] as const;

/** Marketplace category should match each generated `.codex-plugin` manifest. */
const LISA_CODEX_PLUGIN_CATEGORIES: Readonly<Record<string, string>> = {
  lisa: "Productivity",
  "lisa-typescript": "Productivity",
  "lisa-expo": "Coding",
  "lisa-nestjs": "Coding",
  "lisa-cdk": "Coding",
  "lisa-harper-fabric": "Coding",
  "lisa-phaser": "Coding",
  "lisa-rails": "Coding",
  "lisa-wiki": "Productivity",
};

/** Result of a marketplace install pass */
export interface MarketplaceInstallResult {
  readonly created: boolean;
  readonly pluginEntries: number;
}

/**
 * Install or merge Lisa's Codex marketplace entries.
 * @param lisaDir - Absolute path to the Lisa repo or installed package root
 * @param destDir - Absolute path to the host project root
 * @returns Install result
 */
export async function installCodexMarketplace(
  lisaDir: string,
  destDir: string
): Promise<MarketplaceInstallResult> {
  const marketplacePath = path.join(destDir, CODEX_MARKETPLACE_PATH);
  await fse.ensureDir(path.dirname(marketplacePath));
  const exists = await fse.pathExists(marketplacePath);
  const existing = exists
    ? JSON.parse(await readFile(marketplacePath, "utf8"))
    : createEmptyMarketplace();
  const merged = mergeLisaMarketplace(existing, lisaDir, destDir);
  await writeFile(
    marketplacePath,
    `${JSON.stringify(merged, null, 2)}\n`,
    "utf8"
  );
  return { created: !exists, pluginEntries: LISA_CODEX_PLUGINS.length };
}

/**
 * Merge Lisa plugin entries into an existing marketplace object.
 * @param existing - Existing marketplace JSON
 * @param lisaDir - Lisa package root
 * @param destDir - Host project root
 * @returns Merged marketplace JSON
 */
export function mergeLisaMarketplace(
  existing: unknown,
  lisaDir: string,
  destDir: string
): Record<string, unknown> {
  const base = normalizeMarketplace(existing);
  const hostPlugins = base.plugins.filter(
    plugin =>
      !LISA_CODEX_PLUGINS.includes(
        plugin.name as (typeof LISA_CODEX_PLUGINS)[number]
      )
  );
  return {
    name: base.name,
    interface: base.interface,
    plugins: [
      ...hostPlugins,
      ...LISA_CODEX_PLUGINS.map(pluginName =>
        lisaPluginMarketplaceEntry(pluginName, lisaDir, destDir)
      ),
    ],
  };
}

/**
 * Create Lisa's marketplace shell.
 * @returns Empty Lisa marketplace
 */
function createEmptyMarketplace(): Record<string, unknown> {
  return {
    name: "lisa",
    interface: {
      displayName: "Lisa Plugins",
    },
    plugins: [],
  };
}

/**
 * Normalize an arbitrary marketplace object enough for Lisa to merge entries.
 * @param raw - Existing parsed JSON
 * @returns Marketplace fields Lisa preserves
 */
function normalizeMarketplace(raw: unknown): {
  readonly name: string;
  readonly interface: Record<string, unknown>;
  readonly plugins: readonly Record<string, unknown>[];
} {
  if (raw === null || typeof raw !== "object") {
    return normalizeMarketplace(createEmptyMarketplace());
  }
  const obj = raw as Record<string, unknown>;
  return {
    name: typeof obj.name === "string" ? obj.name : "lisa",
    interface:
      obj.interface !== null && typeof obj.interface === "object"
        ? (obj.interface as Record<string, unknown>)
        : { displayName: "Lisa Plugins" },
    plugins: Array.isArray(obj.plugins)
      ? obj.plugins.filter(
          (plugin): plugin is Record<string, unknown> =>
            plugin !== null && typeof plugin === "object"
        )
      : [],
  };
}

/**
 * Build one Lisa plugin marketplace entry.
 * @param pluginName - Lisa plugin directory name
 * @param lisaDir - Lisa package root
 * @param destDir - Host project root
 * @returns Marketplace entry
 */
function lisaPluginMarketplaceEntry(
  pluginName: string,
  lisaDir: string,
  destDir: string
): Record<string, unknown> {
  return {
    name: pluginName,
    source: {
      source: "local",
      path: toMarketplaceRelativePath(
        path.join(lisaDir, "plugins", pluginName),
        destDir
      ),
    },
    policy: {
      installation:
        pluginName === "lisa" ? "INSTALLED_BY_DEFAULT" : "AVAILABLE",
      authentication: "ON_INSTALL",
    },
    category: LISA_CODEX_PLUGIN_CATEGORIES[pluginName] ?? "Coding",
  };
}

/**
 * Render a marketplace path relative to the host root.
 * @param targetPath - Absolute path to the plugin directory
 * @param destDir - Absolute host root
 * @returns `./`-prefixed POSIX-style relative path
 */
function toMarketplaceRelativePath(
  targetPath: string,
  destDir: string
): string {
  const relative = path.relative(destDir, targetPath).split(path.sep).join("/");
  return relative.startsWith(".") ? relative : `./${relative}`;
}
