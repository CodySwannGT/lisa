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
 *
 * `pushGate.admission` (CodySwannGT/lisa#4596) routes heavy runs — every
 * `lisa-test-run` suite, and the slow-lint, typecheck and build-once push
 * steps — through headroom-based admission (`lisa admit`). Off when absent,
 * and then heavy runs start immediately exactly as before. The gate runner
 * reads it through `scripts/lib/push-admission.mjs`; `lisa-test-run` reads it
 * through `core/admission-settings`.
 *
 * `pushGate.affectedTests` (CodySwannGT/lisa#4600) lets the push test gate run
 * only the tests a change can affect, falling back to the full suite whenever
 * the selection could be wrong. Off when absent. `pushGate.affectedCoverage`
 * says what a partial run does about coverage-adequacy at push: `full`
 * (default) keeps the full coverage suite wherever coverage-adequacy is
 * declared at push, `changed-files` holds each changed source file to the
 * thresholds on its own, and `skip` leaves coverage to CI. Both keys are read
 * at push by `scripts/lib/affected-tests.mjs`, which refuses the same shapes.
 *
 * "Off when absent" is the shape this file validates. At run time a TypeScript
 * project gets `cache`, `admission`, `affectedTests` and
 * `affectedCoverage: "changed-files"` by default (CodySwannGT/lisa#4611), from
 * `all/copy-overwrite/scripts/lib/push-gate-defaults.mjs`, which every reader
 * applies before validating. An explicit value always wins.
 *
 * Rails hosts read the same two keys through `scripts/lib/rspec-selection.mjs`
 * (CodySwannGT/lisa#4612), with the same validation and two different
 * defaults: `affectedTests` is ON for a Rails project when absent, and
 * `affectedCoverage` defaults to `changed-files` (owner decision). An explicit
 * value always wins.
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
  /** Remember push-gate passes by content (CodySwannGT/lisa#4594). */
  readonly cache?: boolean;
  /** Build once per push and let later steps skip a build on a matching tree. */
  readonly buildOnce?: boolean;
  /** Admit heavy runs only when the machine has headroom for them. */
  readonly admission?: boolean;
  /** Run only the tests the change can affect at push. */
  readonly affectedTests?: boolean;
  /** What a partial selection does about coverage-adequacy at push. */
  readonly affectedCoverage?: AffectedCoverageMode;
}

/** The boolean switches `pushGate` accepts. */
const SWITCHES = ["buildOnce", "cache", "admission", "affectedTests"] as const;

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
  const coverage = block["affectedCoverage"];
  if (coverage === undefined) {
    return Object.fromEntries(entries) as PushGateConfig;
  }
  if (!AFFECTED_COVERAGE_MODES.includes(coverage as AffectedCoverageMode)) {
    throw new Error(
      `Invalid pushGate.affectedCoverage in ${configPath}: expected one of ${AFFECTED_COVERAGE_MODES.join(", ")}`
    );
  }
  return {
    ...Object.fromEntries(entries),
    affectedCoverage: coverage as AffectedCoverageMode,
  } as PushGateConfig;
}
