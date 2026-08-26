/**
 * Provenance cleanup routing for human-authored UI config writes.
 * @module cli/ui-config-write-provenance
 */
import type { JsonValue } from "../sync/json-path.js";
import { SYNC_REGISTRY } from "../sync/registry.js";
import { populationPropertyPath } from "../sync/sync-population.js";

/**
 * Resolve descendant human edits to literal registry-owner provenance paths.
 * @param changes - Committed registry-root or descendant edits
 * @returns Unique exact paths under `_lisaSync.populated`
 */
export function provenanceRemovals(
  changes: Readonly<Record<string, JsonValue>>
): readonly (readonly string[])[] {
  const owners = Object.keys(changes)
    .map(syncOwnerKey)
    .filter((owner): owner is string => owner !== undefined);
  return [...new Set(owners)].map(populationPropertyPath);
}

/**
 * Find the most specific registry owner for one already-routed key.
 * @param key - Registry root or descendant dot path
 * @returns Owning registry key, when present
 */
function syncOwnerKey(key: string): string | undefined {
  return SYNC_REGISTRY.reduce<string | undefined>((owner, entry) => {
    if (key !== entry.key && !key.startsWith(`${entry.key}.`)) {
      return owner;
    }
    return owner === undefined || entry.key.length > owner.length
      ? entry.key
      : owner;
  }, undefined);
}
