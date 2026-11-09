/**
 * Decide which enabled plugin keys can be installed from the Lisa marketplace.
 *
 * A `<name>@lisa` key whose `<name>` the Lisa marketplace manifest does not
 * list cannot be installed: the CLI fails it on every attempt, which warned on
 * every `lisa apply` and kept the plugin sync from ever completing
 * (CodySwannGT/lisa#4645). Such keys are skipped with one warning naming them,
 * and the skip does not count as a failed install.
 *
 * Only `@lisa` keys are judged — another marketplace's keys are never skipped.
 * When the manifest cannot be read, or names no plugin, nothing is skipped, so an unreadable
 * manifest falls back to the previous install-everything behaviour rather
 * than silently dropping real plugins.
 * @module core/plugin-marketplace-filter
 */
import type { MarketplaceCatalog } from "../utils/marketplace-manifest.js";
import { RETIRED_STACK_PLUGIN_KEYS } from "./retired-plugin-keys.js";

const LISA_SUFFIX = "@lisa";

/** Enabled keys split into what to install and what to skip. */
export interface PluginMarketplacePartition {
  readonly installable: readonly string[];
  readonly skipped: readonly string[];
}

/**
 * Split enabled plugin keys by whether the Lisa marketplace can supply them.
 * @param plugins - Enabled plugin keys
 * @param catalog - The Lisa marketplace catalog, or null when unreadable
 * @returns Installable keys and skipped keys, each in input order
 */
export function partitionByLisaMarketplace(
  plugins: readonly string[],
  catalog: MarketplaceCatalog | null
): PluginMarketplacePartition {
  // A manifest that names no plugin is as untrustworthy as an unreadable one:
  // skipping against it would drop every real Lisa plugin.
  if (catalog === null || catalog.plugins.length === 0) {
    return { installable: plugins, skipped: [] };
  }
  const known = new Set(catalog.plugins.map(plugin => plugin.name));
  const isMissing = (key: string): boolean =>
    key.endsWith(LISA_SUFFIX) && !known.has(key.slice(0, -LISA_SUFFIX.length));
  return {
    installable: plugins.filter(key => !isMissing(key)),
    skipped: plugins.filter(isMissing),
  };
}

/**
 * The one warning line for a skipped key, naming its successor when it is a
 * key Lisa itself retired.
 * @param key - Skipped plugin key
 * @returns Warning text
 */
export function describeSkippedPluginKey(key: string): string {
  const successor = RETIRED_STACK_PLUGIN_KEYS.get(key)?.successor;
  const base = `Skipping plugin ${key}: not in the Lisa marketplace`;
  return successor === undefined
    ? base
    : `${base} (retired; its successor is ${successor})`;
}
