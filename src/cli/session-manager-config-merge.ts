/**
 * Merge the committed and local `sessionManager` blocks the way the runtime
 * does (#4448), so doctor judges the block the manager actually runs with.
 *
 * `config-resolution` makes `.lisa.config.local.json` override
 * `.lisa.config.json` per key. The runtime resolver (`mergeConfigLayers` in the
 * secrets-access validator, used by the session-manager `config.mjs`) applies
 * that deeply: plain objects merge recursively, arrays and scalars are
 * replaced, prototype keys are dropped. A shallow merge here once let a local
 * `capacity: { maxWorkers: 2 }` erase the committed `capacity` for doctor
 * only. `src/` ships without the plugin payload, so it cannot import that
 * script; this is a copy, and `tests/unit/cli/session-manager-config-merge`
 * pins it to the runtime resolver.
 */

/** A parsed JSON object. */
type JsonRecord = Record<string, unknown>;

/** Keys a parsed JSON layer may not contribute to a merged object. */
const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/**
 * Whether a value is a plain object (not null, not an array).
 * @param value - Candidate
 * @returns True for `{}`-shaped values
 */
function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Merge layers key by key, later layers winning, deep for plain objects.
 * @param layers - Lowest precedence first
 * @returns A new object; no layer is mutated
 */
function mergeLayers(...layers: readonly unknown[]): JsonRecord {
  const objects = layers.filter(isRecord);
  const keys = [...new Set(objects.flatMap(Object.keys))].filter(
    key => !UNSAFE_KEYS.has(key)
  );
  return Object.fromEntries(
    keys.map(key => {
      const values = objects
        .filter(layer => Object.hasOwn(layer, key))
        .map(layer => layer[key]);
      const top = values.at(-1);
      return [
        key,
        isRecord(top) ? mergeLayers(...values.filter(isRecord)) : top,
      ];
    })
  );
}

/**
 * Merge the `sessionManager` blocks of the two config files, local winning.
 * @param committed - `.lisa.config.json` contents
 * @param local - `.lisa.config.local.json` contents
 * @returns The merged block, or undefined when neither declares one
 */
export function mergeSessionManagerBlocks(
  committed: JsonRecord | undefined,
  local: JsonRecord | undefined
): JsonRecord | undefined {
  const blocks = [committed?.sessionManager, local?.sessionManager].filter(
    isRecord
  );
  return blocks.length === 0 ? undefined : mergeLayers(...blocks);
}
