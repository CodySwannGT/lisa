/**
 * Reader for a Claude plugin marketplace manifest
 * (`<marketplace>/.claude-plugin/marketplace.json`).
 *
 * Used by `lisa apply`, which skips enabled `<name>@lisa` keys the Lisa
 * manifest does not list (CodySwannGT/lisa#4645). Callers need to tell "unreadable" apart from
 * "lists nothing", so an unreadable or malformed file is `null`.
 * @module utils/marketplace-manifest
 */
import { readFile } from "node:fs/promises";

/** One plugin entry from a marketplace catalog. */
export interface MarketplaceCatalogPlugin {
  readonly name: string;
  readonly description: string;
}

/** The parts of a marketplace manifest Lisa reads. */
export interface MarketplaceCatalog {
  /** The manifest's own `name`, or null when it omits one. */
  readonly name: string | null;
  readonly plugins: readonly MarketplaceCatalogPlugin[];
}

/**
 * Normalise one `plugins[]` entry, dropping anything without a usable name.
 * @param entry - Raw manifest entry
 * @returns The entry as a one-element list, or an empty list
 */
function toCatalogPlugin(entry: unknown): readonly MarketplaceCatalogPlugin[] {
  if (typeof entry !== "object" || entry === null) {
    return [];
  }
  const name = Reflect.get(entry, "name");
  if (typeof name !== "string" || name.trim().length === 0) {
    return [];
  }
  const description = Reflect.get(entry, "description");
  return [
    {
      name: name.trim(),
      description: typeof description === "string" ? description : "",
    },
  ];
}

/**
 * Read a marketplace manifest.
 * @param manifestPath - Absolute path to marketplace.json
 * @returns The catalog, or null when the file is missing, unparseable, or has
 *   no `plugins` array
 */
export async function readMarketplaceCatalog(
  manifestPath: string
): Promise<MarketplaceCatalog | null> {
  try {
    const parsed: unknown = JSON.parse(await readFile(manifestPath, "utf8"));
    if (typeof parsed !== "object" || parsed === null) {
      return null;
    }
    const plugins = Reflect.get(parsed, "plugins");
    if (!Array.isArray(plugins)) {
      return null;
    }
    const name = Reflect.get(parsed, "name");
    return {
      name:
        typeof name === "string" && name.trim().length > 0 ? name.trim() : null,
      plugins: plugins.flatMap(toCatalogPlugin),
    };
  } catch {
    return null;
  }
}
