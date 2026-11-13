/**
 * Validation contract for `pushGate` in `.lisa.config.json`.
 *
 * `pushGate.buildOnce` (CodySwannGT/lisa#4595) makes the push gate runner
 * build once before the first gate and hand later steps a marker that lets them
 * skip their own build while the tree is unchanged. Off when absent. The gate
 * runner reads the same key through `scripts/lib/build-marker.mjs` and refuses
 * the same invalid shapes, so apply and push cannot disagree about it.
 *
 * `pushGate.admission` (CodySwannGT/lisa#4596) routes heavy runs — every
 * `lisa-test-run` suite, and the slow-lint, typecheck and build-once push
 * steps — through headroom-based admission (`lisa admit`). Off when absent,
 * and then heavy runs start immediately exactly as before. The gate runner
 * reads it through `scripts/lib/push-admission.mjs`; `lisa-test-run` reads it
 * through `core/admission-settings`.
 */

/** Push-gate behaviour persisted in `.lisa.config.json`. */
export interface PushGateConfig {
  /** Remember push-gate passes by content (CodySwannGT/lisa#4594). */
  readonly cache?: boolean;
  /** Build once per push and let later steps skip a build on a matching tree. */
  readonly buildOnce?: boolean;
  /** Admit heavy runs only when the machine has headroom for them. */
  readonly admission?: boolean;
}

/** The boolean switches `pushGate` may carry, validated identically. */
const BOOLEAN_SWITCHES = ["cache", "buildOnce", "admission"] as const;

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
  return BOOLEAN_SWITCHES.reduce<PushGateConfig>((valid, key) => {
    const setting = block[key];
    if (setting === undefined) return valid;
    if (typeof setting !== "boolean") {
      throw new Error(
        `Invalid pushGate.${key} in ${configPath}: expected true or false`
      );
    }
    return { ...valid, [key]: setting };
  }, {});
}
