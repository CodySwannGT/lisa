/**
 * Validation contract for `pushGate` in `.lisa.config.json`.
 *
 * `pushGate.buildOnce` (CodySwannGT/lisa#4595) makes the push gate runner
 * build once before the first gate and hand later steps a marker that lets them
 * skip their own build while the tree is unchanged. Off when absent. The gate
 * runner reads the same key through `scripts/lib/build-marker.mjs` and refuses
 * the same invalid shapes, so apply and push cannot disagree about it.
 *
 * `pushGate.affectedTests` (CodySwannGT/lisa#4600) lets the push test gate run
 * only the tests a change can affect, falling back to the full suite whenever
 * the selection could be wrong. Off when absent. `pushGate.affectedCoverage`
 * says what a partial run does about coverage-adequacy at push: `full`
 * (default) keeps the full coverage suite wherever coverage-adequacy is
 * declared at push, `changed-files` holds each changed source file to the
 * thresholds on its own, and `skip` leaves coverage to CI. Both keys are read
 * at push by `scripts/lib/affected-tests.mjs`, which refuses the same shapes.
 */

/** How a partial push-time selection treats coverage-adequacy. */
export type AffectedCoverageMode = "full" | "changed-files" | "skip";

/** Every coverage mode, default first. */
export const AFFECTED_COVERAGE_MODES: readonly AffectedCoverageMode[] = [
  "full",
  "changed-files",
  "skip",
];

/** Push-gate behaviour persisted in `.lisa.config.json`. */
export interface PushGateConfig {
  /** Build once per push and let later steps skip a build on a matching tree. */
  readonly buildOnce?: boolean;
  /** Run only the tests the change can affect at push. */
  readonly affectedTests?: boolean;
  /** What a partial selection does about coverage-adequacy at push. */
  readonly affectedCoverage?: AffectedCoverageMode;
}

/**
 * Validate one optional boolean key.
 * @param block - The `pushGate` object
 * @param key - Key to read
 * @param configPath - Config source shown in errors
 * @returns The boolean, or undefined when absent
 */
function optionalBoolean(
  block: Readonly<Record<string, unknown>>,
  key: "buildOnce" | "affectedTests",
  configPath: string
): boolean | undefined {
  const value = block[key];
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") {
    throw new Error(
      `Invalid pushGate.${key} in ${configPath}: expected true or false`
    );
  }
  return value;
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
  const block = value as Record<string, unknown>;
  const buildOnce = optionalBoolean(block, "buildOnce", configPath);
  const affectedTests = optionalBoolean(block, "affectedTests", configPath);
  const coverage = block["affectedCoverage"];
  if (
    coverage !== undefined &&
    !AFFECTED_COVERAGE_MODES.includes(coverage as AffectedCoverageMode)
  ) {
    throw new Error(
      `Invalid pushGate.affectedCoverage in ${configPath}: expected one of ${AFFECTED_COVERAGE_MODES.join(", ")}`
    );
  }
  return {
    ...(buildOnce === undefined ? {} : { buildOnce }),
    ...(affectedTests === undefined ? {} : { affectedTests }),
    ...(coverage === undefined
      ? {}
      : { affectedCoverage: coverage as AffectedCoverageMode }),
  };
}
