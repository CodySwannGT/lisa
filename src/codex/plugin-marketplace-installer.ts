/** Install a filtered repository-local Codex marketplace for Lisa plugins. */
import * as fse from "fs-extra";
import { readFile, writeFile } from "node:fs/promises";
import * as path from "node:path";
import type { ProjectType } from "../core/config.js";
import { selectProjectLisaPlugins } from "../core/lisa-plugin-selection.js";

/** Marketplace file discovered from the repository, never from user config. */
export const CODEX_MARKETPLACE_PATH = path.join(
  ".agents",
  "plugins",
  "marketplace.json"
);

/** Lisa plugin names the reconciler owns and may remove when no longer selected. */
export const LISA_CODEX_PLUGINS = [
  "lisa",
  "lisa-typescript",
  "lisa-expo",
  "lisa-nestjs",
  "lisa-cdk",
  "lisa-harper-fabric",
  "lisa-phaser",
  "lisa-rails",
  "lisa-wiki",
  "lisa-openclaw",
] as const;

const LISA_PLUGIN_NAMES = new Set<string>(LISA_CODEX_PLUGINS);
const PRODUCTIVITY_PLUGINS = new Set([
  "lisa",
  "lisa-typescript",
  "lisa-wiki",
  "lisa-openclaw",
]);

/** Result of one repository marketplace reconciliation. */
export interface MarketplaceInstallResult {
  readonly created: boolean;
  readonly pluginEntries: number;
}

/**
 * Reconcile only applicable Lisa entries while preserving host marketplace
 * fields and unrelated plugins.
 * @param lisaDir Lisa package root.
 * @param destDir Host project root.
 * @param detectedTypes Expanded detected project types.
 * @returns Marketplace reconciliation result.
 */
export async function installCodexMarketplace(
  lisaDir: string,
  destDir: string,
  detectedTypes: readonly ProjectType[] = []
): Promise<MarketplaceInstallResult> {
  const marketplacePath = path.join(destDir, CODEX_MARKETPLACE_PATH);
  const existed = await fse.pathExists(marketplacePath);
  const existing = existed
    ? JSON.parse(await readFile(marketplacePath, "utf8"))
    : createEmptyMarketplace();
  const selected = await selectProjectLisaPlugins(destDir, detectedTypes);
  const availableSelected = (
    await Promise.all(
      [...selected].map(async pluginName => ({
        pluginName,
        exists: await fse.pathExists(
          path.join(
            lisaDir,
            "plugins",
            pluginName,
            ".codex-plugin",
            "plugin.json"
          )
        ),
      }))
    )
  )
    .filter(entry => entry.exists && LISA_PLUGIN_NAMES.has(entry.pluginName))
    .map(entry => entry.pluginName);
  const merged = mergeLisaMarketplace(
    existing,
    availableSelected,
    lisaDir,
    destDir
  );
  await fse.ensureDir(path.dirname(marketplacePath));
  await writeFile(
    marketplacePath,
    `${JSON.stringify(merged, null, 2)}\n`,
    "utf8"
  );
  return { created: !existed, pluginEntries: availableSelected.length };
}

/**
 * Merge selected Lisa entries into an arbitrary marketplace document.
 * @param existing Existing marketplace document.
 * @param selectedPlugins Applicable Lisa plugin names.
 * @param lisaDir Lisa package root.
 * @param destDir Host project root.
 * @returns Merged marketplace document.
 */
export function mergeLisaMarketplace(
  existing: unknown,
  selectedPlugins: readonly string[],
  lisaDir: string,
  destDir: string
): Record<string, unknown> {
  const base = normalizeMarketplace(existing);
  return {
    ...base.document,
    name: base.name,
    interface: base.interface,
    plugins: [
      ...base.plugins.filter(
        plugin => !LISA_PLUGIN_NAMES.has(plugin.name as string)
      ),
      ...selectedPlugins.map(pluginName =>
        lisaPluginMarketplaceEntry(pluginName, lisaDir, destDir)
      ),
    ],
  };
}

/**
 * Create the default Lisa repository marketplace shell.
 * @returns Empty Lisa repository marketplace.
 */
function createEmptyMarketplace(): Record<string, unknown> {
  return {
    name: "lisa",
    interface: { displayName: "Lisa Plugins" },
    plugins: [],
  };
}

/**
 * Normalize only fields required for a safe ownership merge.
 * @param raw Untrusted marketplace document.
 * @returns Preserved document and normalized fields.
 */
function normalizeMarketplace(raw: unknown): {
  readonly document: Record<string, unknown>;
  readonly name: string;
  readonly interface: Record<string, unknown>;
  readonly plugins: readonly Record<string, unknown>[];
} {
  const document =
    raw !== null && typeof raw === "object"
      ? (raw as Record<string, unknown>)
      : createEmptyMarketplace();
  return {
    document,
    name: typeof document.name === "string" ? document.name : "lisa",
    interface:
      document.interface !== null && typeof document.interface === "object"
        ? (document.interface as Record<string, unknown>)
        : { displayName: "Lisa Plugins" },
    plugins: Array.isArray(document.plugins)
      ? document.plugins.filter(
          (plugin): plugin is Record<string, unknown> =>
            plugin !== null && typeof plugin === "object"
        )
      : [],
  };
}

/**
 * Build one repository-local Lisa plugin entry.
 * @param pluginName Plugin directory name.
 * @param lisaDir Lisa package root.
 * @param destDir Host project root.
 * @returns Marketplace plugin entry.
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
      path: toPosixRelativePath(
        path.join(lisaDir, "plugins", pluginName),
        destDir
      ),
    },
    policy: {
      installation: "INSTALLED_BY_DEFAULT",
      authentication: "ON_INSTALL",
    },
    category: PRODUCTIVITY_PLUGINS.has(pluginName) ? "Productivity" : "Coding",
  };
}

/**
 * Render a host-relative marketplace path with POSIX separators.
 * @param targetPath Absolute plugin path.
 * @param destDir Host project root.
 * @returns Dot-prefixed relative path.
 */
function toPosixRelativePath(targetPath: string, destDir: string): string {
  const relative = path.relative(destDir, targetPath).split(path.sep).join("/");
  return relative.startsWith(".") ? relative : `./${relative}`;
}
