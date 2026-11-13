/**
 * Validated `.lisa.config.json` settings for the project-learnings ledger.
 *
 * Keeping the closed nested schema and its pure resolver together gives every
 * mutating caller one typed snapshot: the ledger path, merge-driver opt-out,
 * and low-confidence PR routing can no longer be read through independent
 * parsers that disagree on errors or timing.
 * @module core/project-config-learnings
 */
import { DEFAULT_PROJECT_LEARNINGS_FILE } from "./learnings-location.js";
import { validateConfiguredLearningsFile } from "./configured-learnings-path.js";
import {
  type ConfigWithHumanGate,
  type HumanGateMode,
  resolveHumanGateMode,
} from "./project-config-human-gate.js";

const LEARNINGS_FIELDS = ["file", "mergeDriver", "lowConfidence"] as const;

const HUMAN_TRIAGE = "human-triage";
const AUTO_MERGE = "auto-merge";

/**
 * How `lisa-persist-learning` submits a low-confidence learning PR.
 *
 * `human-triage` keeps auto-merge off and waits for a human at the
 * `learning:needs-triage` gate. `auto-merge` submits it like a high-confidence
 * PR — through the project's normal gates — and the gardener
 * (`lisa-learnings-audit`) re-reviews those entries first
 * (CodySwannGT/lisa#4659).
 *
 * The default follows `humanGate.mode` (CodySwannGT/lisa#4687): an agent
 * performs every act it has access to, so under the default `"access-only"`
 * mode an undeclared value is `auto-merge`; under `"strict"` it is
 * `human-triage`. A declared value always wins over the mode.
 */
export const LOW_CONFIDENCE_ROUTINGS = [HUMAN_TRIAGE, AUTO_MERGE] as const;

/** One closed value of `learnings.lowConfidence`. */
export type LowConfidenceRouting = (typeof LOW_CONFIDENCE_ROUTINGS)[number];

/**
 * Routing used when `learnings.lowConfidence` is absent under the default
 * `humanGate.mode: "access-only"`.
 */
export const DEFAULT_LOW_CONFIDENCE_ROUTING: LowConfidenceRouting = AUTO_MERGE;

/** Routing used when `learnings.lowConfidence` is absent under `"strict"`. */
export const STRICT_LOW_CONFIDENCE_ROUTING: LowConfidenceRouting = HUMAN_TRIAGE;

/**
 * The routing an undeclared `learnings.lowConfidence` resolves to under a mode.
 * @param mode - The `humanGate.mode` in force
 * @returns The mode's default routing
 */
export function defaultLowConfidenceRouting(
  mode: HumanGateMode
): LowConfidenceRouting {
  return mode === "strict"
    ? STRICT_LOW_CONFIDENCE_ROUTING
    : DEFAULT_LOW_CONFIDENCE_ROUTING;
}

/** Optional `learnings` configuration block in `.lisa.config.json`. */
export interface LearningsConfig {
  /** Safe repo-relative override for the machine-managed learnings ledger. */
  readonly file?: string;
  /** Explicit false declines local merge-driver installation. */
  readonly mergeDriver?: boolean;
  /**
   * How low-confidence learning PRs are submitted; when absent, `auto-merge`
   * under `humanGate.mode: "access-only"` and `human-triage` under `"strict"`.
   */
  readonly lowConfidence?: LowConfidenceRouting;
}

/** Minimum project-config shape consumed by the pure settings resolver. */
interface ConfigWithLearnings extends ConfigWithHumanGate {
  readonly learnings?: LearningsConfig;
}

/** Resolved learnings behavior derived from one validated config snapshot. */
export type ResolvedLearningsSettings = Readonly<{
  learningsFile: string;
  mergeDriverEnabled: boolean;
  lowConfidence: LowConfidenceRouting;
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
      `Invalid learnings.${unknown} in ${source}: unknown field; expected file, mergeDriver, or lowConfidence`
    );
  }
  const file =
    object.file === undefined
      ? undefined
      : validateLearningsFile(object.file, source);
  const mergeDriver = validateMergeDriver(object.mergeDriver, source);
  const lowConfidence = validateLowConfidence(object.lowConfidence, source);
  return {
    ...(file === undefined ? {} : { file }),
    ...(mergeDriver === undefined ? {} : { mergeDriver }),
    ...(lowConfidence === undefined ? {} : { lowConfidence }),
  };
}

/**
 * Resolve ledger location and merge-driver policy from one config snapshot.
 *
 * The driver is strictly opt-out: only literal false disables it. Runtime
 * config reads validate the boolean before this resolver runs; keeping the
 * comparison here as `!== false` preserves the safe default for typed callers.
 * Low-confidence routing honours a declared value and otherwise follows the
 * `humanGate.mode` default ({@link defaultLowConfidenceRouting}).
 * @param config - Validated project config snapshot
 * @returns Resolved ledger path, merge-driver enablement, and low-confidence routing
 */
export function resolveLearningsSettings(
  config: ConfigWithLearnings
): ResolvedLearningsSettings {
  return Object.freeze({
    learningsFile: resolveProjectLearningsFile(config),
    mergeDriverEnabled: config.learnings?.mergeDriver !== false,
    lowConfidence: resolveLowConfidence(config),
  });
}

/**
 * The routing in force. A declared value wins; an ABSENT one follows the
 * `humanGate.mode` default. A value that is present but not a routing — only
 * reachable by a typed caller that skipped validation, since the reader
 * rejects it — fails safe, to `human-triage`.
 * @param config - Project config snapshot
 * @returns The routing in force
 */
function resolveLowConfidence(
  config: ConfigWithLearnings
): LowConfidenceRouting {
  const declared = config.learnings?.lowConfidence;
  if (declared === undefined) {
    return defaultLowConfidenceRouting(resolveHumanGateMode(config));
  }
  return (LOW_CONFIDENCE_ROUTINGS as readonly unknown[]).includes(declared)
    ? declared
    : STRICT_LOW_CONFIDENCE_ROUTING;
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

/**
 * Validate an optional low-confidence routing value while preserving absence.
 * @param value - Raw lowConfidence setting
 * @param source - Config source for errors
 * @returns Closed routing value or undefined
 */
function validateLowConfidence(
  value: unknown,
  source: string
): LowConfidenceRouting | undefined {
  if (value === undefined) {
    return undefined;
  }
  // Trimmed and lower-cased first, like `humanGate.mode`, so "Auto-Merge" is
  // the routing the project meant rather than a rejected config.
  const normalized =
    typeof value === "string" ? value.trim().toLowerCase() : value;
  if ((LOW_CONFIDENCE_ROUTINGS as readonly unknown[]).includes(normalized)) {
    return normalized as LowConfidenceRouting;
  }
  throw new Error(
    `Invalid learnings.lowConfidence in ${source}: expected "${AUTO_MERGE}" or "${HUMAN_TRIAGE}", received ${JSON.stringify(
      value
    )}`
  );
}
