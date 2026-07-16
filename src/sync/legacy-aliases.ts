/**
 * Compatibility helpers for registry settings with deprecated relative paths.
 * @module sync/legacy-aliases
 */
import { getAtPath, isJsonObject, type JsonValue } from "./json-path.js";

/** One deprecated relative path and the current path that replaces it. */
export interface LegacyAliasMapping {
  readonly currentPath: string;
  readonly legacyPath: string;
}

/**
 * Whether a value contains any declared deprecated alias. Presence is checked
 * against `undefined` so explicit `0` and `null` values remain human-owned.
 * @param value - Setting value to inspect
 * @param aliases - Relative-path alias mappings
 * @returns True when at least one legacy path is present
 */
export function hasLegacyAlias(
  value: JsonValue | undefined,
  aliases: readonly LegacyAliasMapping[] | undefined
): boolean {
  return (
    aliases?.some(alias => getAtPath(value, alias.legacyPath) !== undefined) ??
    false
  );
}

/**
 * Return a JSON value without one nested object path.
 * @param value - Value to copy
 * @param dotPath - Relative dot path to omit
 * @returns Copied value with the addressed property omitted
 */
function omitAtPath(value: JsonValue, dotPath: string): JsonValue {
  if (!isJsonObject(value)) {
    return value;
  }
  const dotIndex = dotPath.indexOf(".");
  const head = dotIndex === -1 ? dotPath : dotPath.slice(0, dotIndex);
  if (dotIndex === -1) {
    return Object.fromEntries(
      Object.entries(value).filter(([key]) => key !== head)
    );
  }
  const child = value[head];
  if (child === undefined) {
    return value;
  }
  return {
    ...value,
    [head]: omitAtPath(child, dotPath.slice(dotIndex + 1)),
  };
}

/**
 * Remove only current defaults whose legacy counterpart is present.
 * @param value - Effective entry value used to detect aliases
 * @param defaultValue - Registry default to prune
 * @param aliases - Relative-path alias mappings
 * @returns Default value safe to fill beside the effective aliases
 */
export function aliasCompatibleDefault(
  value: JsonValue,
  defaultValue: JsonValue,
  aliases: readonly LegacyAliasMapping[] | undefined
): JsonValue {
  return (
    aliases?.reduce(
      (fallback, alias) =>
        getAtPath(value, alias.legacyPath) === undefined
          ? fallback
          : omitAtPath(fallback, alias.currentPath),
      defaultValue
    ) ?? defaultValue
  );
}
