/**
 * Validation contract for `pushGate` in `.lisa.config.json`.
 *
 * `pushGate.buildOnce` (CodySwannGT/lisa#4595) makes the push gate runner
 * build once before the first gate and hand later steps a marker that lets them
 * skip their own build while the tree is unchanged. Off when absent. The gate
 * runner reads the same key through `scripts/lib/build-marker.mjs` and refuses
 * the same invalid shapes, so apply and push cannot disagree about it.
 */

/** Push-gate behaviour persisted in `.lisa.config.json`. */
export interface PushGateConfig {
  /** Build once per push and let later steps skip a build on a matching tree. */
  readonly buildOnce?: boolean;
}

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
  const { buildOnce } = value as Record<string, unknown>;
  if (buildOnce === undefined) return {};
  if (typeof buildOnce !== "boolean") {
    throw new Error(
      `Invalid pushGate.buildOnce in ${configPath}: expected true or false`
    );
  }
  return { buildOnce };
}
