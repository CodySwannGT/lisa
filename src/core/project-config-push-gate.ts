/**
 * Validation contract for `pushGate` in `.lisa.config.json`.
 *
 * `pushGate.buildOnce` (CodySwannGT/lisa#4595) makes the push gate runner
 * build once before the first gate and hand later steps a marker that lets them
 * skip their own build while the tree is unchanged. `pushGate.cache`
 * (CodySwannGT/lisa#4594) lets a push reuse a remembered pass for an identical
 * tree, and is what `lisa check` (CodySwannGT/lisa#4601) reads to decide
 * whether running the push gates ahead of the push saves anything. Both are off
 * when absent. The gate runner reads the same keys through
 * `scripts/lib/build-marker.mjs` and `scripts/lib/gate-pass-cache.mjs` and
 * refuses the same invalid shapes, so apply, check and push cannot disagree.
 */

/** Push-gate behaviour persisted in `.lisa.config.json`. */
export interface PushGateConfig {
  /** Build once per push and let later steps skip a build on a matching tree. */
  readonly buildOnce?: boolean;
  /** Remember push-gate passes by content so an identical tree skips them. */
  readonly cache?: boolean;
}

/** The boolean switches `pushGate` accepts. */
const SWITCHES = ["buildOnce", "cache"] as const;

/**
 * Validate the optional `pushGate` block.
 * @param value - Untrusted `pushGate` value
 * @param configPath - Config source shown in errors
 * @returns Valid configuration, or undefined when absent
 */
export function validatePushGateConfig(
  value: unknown,
  configPath: string
): PushGateConfig | undefined {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Invalid pushGate in ${configPath}: expected object`);
  }
  const block = value as Record<string, unknown>;
  const entries = SWITCHES.filter(name => block[name] !== undefined).map(
    name => {
      const setting = block[name];
      if (typeof setting !== "boolean") {
        throw new Error(
          `Invalid pushGate.${name} in ${configPath}: expected true or false`
        );
      }
      return [name, setting] as const;
    }
  );
  return Object.fromEntries(entries) as PushGateConfig;
}
