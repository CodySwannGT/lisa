/**
 * Validated `.lisa.config.json` settings for the project-learnings ledger.
 *
 * Keeping the closed nested schema and its pure resolver together gives every
 * mutating caller one typed snapshot: the ledger path and merge-driver opt-out
 * can no longer be read through independent parsers that disagree on errors or
 * timing.
 * @module core/project-config-learnings
 */
import { DEFAULT_PROJECT_LEARNINGS_FILE } from "./learnings-location.js";
import { validateConfiguredLearningsFile } from "./configured-learnings-path.js";

const LEARNINGS_FIELDS = ["file", "mergeDriver"] as const;

/** Optional `learnings` configuration block in `.lisa.config.json`. */
export interface LearningsConfig {
  /** Safe repo-relative override for the machine-managed learnings ledger. */
  readonly file?: string;
  /** Explicit false declines local merge-driver installation. */
  readonly mergeDriver?: boolean;
}

/** Minimum project-config shape consumed by the pure settings resolver. */
interface ConfigWithLearnings {
  readonly learnings?: LearningsConfig;
}

/** Resolved learnings behavior derived from one validated config snapshot. */
export type ResolvedLearningsSettings = Readonly<{
  learningsFile: string;
  mergeDriverEnabled: boolean;
}>;

/**
 * Validate a `learnings.file` override outside every eager context surface.
 * @param value - Raw configured path
 * @param source - Config source for errors
 * @returns Validated project-relative learnings path
 */
export function validateLearningsFile(value: unknown, source: string): string {
  return validateConfiguredLearningsFile(value, source);
}

/**
 * Validate the closed optional `learnings` block.
 * @param value - Raw learnings value
 * @param source - Config source for errors
 * @returns Typed learnings config, or undefined when absent
 */
export function validateLearningsConfig(
  value: unknown,
  source: string
): LearningsConfig | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Invalid learnings in ${source}: expected an object`);
  }
  const object = value as Record<string, unknown>;
  const unknown = Object.keys(object).find(
    key => !(LEARNINGS_FIELDS as readonly string[]).includes(key)
  );
  if (unknown !== undefined) {
    throw new Error(
      `Invalid learnings.${unknown} in ${source}: unknown field; expected file or mergeDriver`
    );
  }
  const file =
    object.file === undefined
      ? undefined
      : validateLearningsFile(object.file, source);
  const mergeDriver = validateMergeDriver(object.mergeDriver, source);
  return {
    ...(file === undefined ? {} : { file }),
    ...(mergeDriver === undefined ? {} : { mergeDriver }),
  };
}

/**
 * Resolve ledger location and merge-driver policy from one config snapshot.
 *
 * The driver is strictly opt-out: only literal false disables it. Runtime
 * config reads validate the boolean before this resolver runs; keeping the
 * comparison here as `!== false` preserves the safe default for typed callers.
 * @param config - Validated project config snapshot
 * @returns Resolved ledger path and merge-driver enablement
 */
export function resolveLearningsSettings(
  config: ConfigWithLearnings
): ResolvedLearningsSettings {
  return Object.freeze({
    learningsFile: resolveProjectLearningsFile(config),
    mergeDriverEnabled: config.learnings?.mergeDriver !== false,
  });
}

/**
 * Resolve the validated ledger path while preserving the established public
 * API used by writers and generated agent instructions.
 * @param config - Project config carrying an optional learnings block
 * @returns Safe project-relative learnings Markdown path
 */
export function resolveProjectLearningsFile(
  config: ConfigWithLearnings
): string {
  return config.learnings?.file === undefined
    ? DEFAULT_PROJECT_LEARNINGS_FILE
    : validateLearningsFile(config.learnings.file, ".lisa.config.json");
}

/**
 * Validate an optional merge-driver flag while preserving absence.
 * @param value - Raw mergeDriver setting
 * @param source - Config source for errors
 * @returns Boolean setting or undefined
 */
function validateMergeDriver(
  value: unknown,
  source: string
): boolean | undefined {
  if (value === undefined || typeof value === "boolean") {
    return value;
  }
  throw new Error(
    `Invalid learnings.mergeDriver in ${source}: expected boolean, received ${JSON.stringify(
      value
    )}`
  );
}
