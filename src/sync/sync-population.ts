/**
 * Helpers for `_lisaSync.populated` provenance metadata.
 * @module sync/sync-population
 */
import {
  getAtPath,
  isJsonObject,
  setAtPath,
  type JsonObject,
  type JsonValue,
} from "./json-path.js";

const SYNC_METADATA_KEY = "_lisaSync";

/**
 * Address one literal provenance property without interpreting dots in its key.
 * @param key - Registry key stored literally under `_lisaSync.populated`
 * @returns Exact JSON property path to the provenance record
 */
export function populationPropertyPath(key: string): readonly string[] {
  return [SYNC_METADATA_KEY, "populated", key];
}

/**
 * Read recorded sync provenance for one literal config key.
 * @param committed - Committed config object
 * @param key - Literal provenance key
 * @returns Recorded value, when present
 */
export function recordedPopulation(
  committed: JsonObject,
  key: string
): JsonValue | undefined {
  const populated = getAtPath(committed, `${SYNC_METADATA_KEY}.populated`);
  return isJsonObject(populated) ? populated[key] : undefined;
}

/**
 * Record sync provenance for one literal config key.
 * @param committed - Committed config object
 * @param key - Literal provenance key
 * @param value - Value to record
 * @returns Updated committed config
 */
export function recordPopulation(
  committed: JsonObject,
  key: string,
  value: JsonValue
): JsonObject {
  const populated = getAtPath(committed, `${SYNC_METADATA_KEY}.populated`);
  const populatedObject = isJsonObject(populated) ? populated : {};
  return setAtPath(committed, `${SYNC_METADATA_KEY}.populated`, {
    ...populatedObject,
    [key]: value,
  });
}

/**
 * Remove one literal provenance key from `_lisaSync.populated`.
 * @param committed - Committed config object
 * @param key - Literal provenance key to remove
 * @returns Updated committed config
 */
export function removePopulation(
  committed: JsonObject,
  key: string
): JsonObject {
  const populated = getAtPath(committed, `${SYNC_METADATA_KEY}.populated`);
  if (!isJsonObject(populated) || !Object.hasOwn(populated, key)) {
    return committed;
  }
  const { [key]: _removed, ...remaining } = populated;
  return setAtPath(committed, `${SYNC_METADATA_KEY}.populated`, remaining);
}
