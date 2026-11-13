/**
 * The `.lisa.config.json` `dependencies` block: whether dependency decisions
 * ever wait on a person (CodySwannGT/lisa#4651).
 *
 * `dependency-trust-classes` requires human ratification for some classes —
 * a runtime-critical service client to be added or major-upgraded, a thin
 * wrapper to be kept, a temporary dependency to be extended. A project whose
 * owner has decided no dependency should ever need a person's approval had no
 * way to say so, and an autonomous build loop stopped for sign-off at every new
 * vendor SDK. `humanSignOff: "none"` is that switch.
 *
 * ## The default follows `humanGate.mode` (CodySwannGT/lisa#4687)
 *
 * An agent performs every act it has access to perform, and ratifying a
 * dependency is such an act. So under the default `humanGate.mode:
 * "access-only"` an undeclared `humanSignOff` resolves to `"none"`: the agent
 * ratifies and records its reasoning. Under `"strict"` it resolves to
 * `"default"`, today's ratification requirements. A value the project declares
 * always wins over the mode.
 *
 * ## Why an invalid value degrades instead of throwing
 *
 * Every other closed config value in Lisa is rejected outright. This one is
 * not, because it changes only what governed prose asks an agent to do —
 * nothing Lisa writes depends on it — so a typo must not stop `lisa apply`.
 * It degrades to the mode's default, the same value an undeclared key gets, so
 * a typo behaves exactly like not having typed anything. It is still REPORTED ({@link dependencySettingsWarning}, and an `INVALID` note in
 * the session's resolved-config block), because a project that meant `"none"`
 * and silently got the other value would otherwise see no symptom at all.
 *
 * The same holds for the block's SHAPE. A `dependencies` value that is not an
 * object degrades to the mode's default and is reported too, rather than throwing like
 * other config blocks do: a project that already carried any-shaped
 * `dependencies` key before this setting existed must not find `lisa apply`
 * broken by an upgrade, and the session hook already reports that shape as
 * the same fallback — the CLI must not disagree with it.
 *
 * The resolved-config session hook keeps its own copy of the vocabulary — it
 * ships inside a plugin payload and cannot import this module — and its
 * wiring test pins that copy against {@link DEPENDENCY_HUMAN_SIGN_OFF_VALUES}.
 * @module core/project-config-dependencies
 */
import {
  type ConfigWithHumanGate,
  type HumanGateMode,
  resolveHumanGateMode,
} from "./project-config-human-gate.js";

/** The closed vocabulary of `dependencies.humanSignOff`. */
export const DEPENDENCY_HUMAN_SIGN_OFF_VALUES = ["default", "none"] as const;

/** One accepted value of `dependencies.humanSignOff`. */
export type DependencyHumanSignOff =
  (typeof DEPENDENCY_HUMAN_SIGN_OFF_VALUES)[number];

/**
 * Value in force when the key is absent or invalid under the default
 * `humanGate.mode: "access-only"`: the agent ratifies.
 */
export const DEFAULT_DEPENDENCY_HUMAN_SIGN_OFF: DependencyHumanSignOff = "none";

/** Value in force when the key is absent or invalid under `"strict"`. */
export const STRICT_DEPENDENCY_HUMAN_SIGN_OFF: DependencyHumanSignOff =
  "default";

/**
 * The `humanSignOff` an undeclared or invalid key resolves to under a mode.
 * @param mode - The `humanGate.mode` in force
 * @returns The mode's default
 */
export function defaultDependencyHumanSignOff(
  mode: HumanGateMode
): DependencyHumanSignOff {
  return mode === "strict"
    ? STRICT_DEPENDENCY_HUMAN_SIGN_OFF
    : DEFAULT_DEPENDENCY_HUMAN_SIGN_OFF;
}

/**
 * The optional `dependencies` block, as declared.
 *
 * `humanSignOff` is kept exactly as the file spelled it — possibly invalid —
 * so the resolver, not the reader, decides validity and can report the
 * rejected value. Unknown sibling keys are ignored rather than rejected, for
 * the same reason an invalid value is not fatal.
 */
export interface DependenciesConfig {
  /** Raw declared value; resolve with {@link resolveDependencySettings}. */
  readonly humanSignOff?: unknown;
  /**
   * The raw `dependencies` value when it was not an object. Present only then;
   * the resolver reports it and falls back to the default.
   */
  readonly rejectedBlock?: unknown;
}

/** Minimum project-config shape the resolver reads. */
interface ConfigWithDependencies extends ConfigWithHumanGate {
  readonly dependencies?: DependenciesConfig;
}

/** Effective dependency settings derived from one config snapshot. */
export type ResolvedDependencySettings = Readonly<{
  /** The value in force. */
  humanSignOff: DependencyHumanSignOff;
  /** Whether the project declared the key at all, valid or not. */
  declared: boolean;
  /** JSON spelling of a declared value that was rejected, when one was. */
  rejected?: string;
  /**
   * Set to `"dependencies"` when the rejected value was the whole block (not an
   * object) rather than `humanSignOff` itself.
   */
  rejectedAt?: "dependencies";
}>;

/**
 * Validate the optional `dependencies` block.
 *
 * Never throws. A bad `humanSignOff` value is carried through as declared, and
 * a block that is not an object is carried as `rejectedBlock`; the resolver
 * reports either and resolves it to the default (see the module preamble).
 * @param value - Raw `dependencies` value
 * @param _source - Config source; kept for parity with the other block
 *   validators, unused because nothing here throws
 * @returns The block, or undefined when absent
 */
export function validateDependenciesConfig(
  value: unknown,
  _source: string
): DependenciesConfig | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { rejectedBlock: value };
  }
  const { humanSignOff } = value as Record<string, unknown>;
  return humanSignOff === undefined ? {} : { humanSignOff };
}

/**
 * Whether a raw value is one of the accepted sign-off values.
 * @param value - Raw declared value
 * @returns True for a member of {@link DEPENDENCY_HUMAN_SIGN_OFF_VALUES}
 */
function isHumanSignOff(value: unknown): value is DependencyHumanSignOff {
  return (DEPENDENCY_HUMAN_SIGN_OFF_VALUES as readonly unknown[]).includes(
    value
  );
}

/**
 * Resolve the effective `dependencies.humanSignOff`.
 * @param config - Validated project config snapshot
 * @returns The value in force, whether it was declared, and any rejected value
 */
export function resolveDependencySettings(
  config: ConfigWithDependencies
): ResolvedDependencySettings {
  const fallback = defaultDependencyHumanSignOff(resolveHumanGateMode(config));
  const block = config.dependencies;
  if (block !== undefined && "rejectedBlock" in block) {
    return Object.freeze({
      humanSignOff: fallback,
      declared: true,
      rejected: JSON.stringify(block.rejectedBlock),
      rejectedAt: "dependencies",
    });
  }
  const declared = block?.humanSignOff;
  if (declared === undefined) {
    return Object.freeze({
      humanSignOff: fallback,
      declared: false,
    });
  }
  if (isHumanSignOff(declared)) {
    return Object.freeze({ humanSignOff: declared, declared: true });
  }
  return Object.freeze({
    humanSignOff: fallback,
    declared: true,
    rejected: JSON.stringify(declared),
  });
}

/**
 * The warning to print for an invalid `dependencies.humanSignOff`, or for a
 * `dependencies` block that is not an object.
 * @param config - Validated project config snapshot
 * @returns One warning line, or undefined when the value is absent or valid
 */
export function dependencySettingsWarning(
  config: ConfigWithDependencies
): string | undefined {
  const { humanSignOff, rejected, rejectedAt } =
    resolveDependencySettings(config);
  if (rejected === undefined) {
    return undefined;
  }
  const effect =
    humanSignOff === "none"
      ? "so the agent ratifies dependency decisions and records its reasoning."
      : "so dependency sign-off stays required where the trust-class rule asks for it.";
  const consequence = `treated as "${humanSignOff}" (the humanGate.mode default), ${effect}`;
  if (rejectedAt === "dependencies") {
    return `Invalid dependencies in .lisa.config.json: ${rejected} is not an object; humanSignOff is ${consequence}`;
  }
  const accepted = DEPENDENCY_HUMAN_SIGN_OFF_VALUES.map(
    value => `"${value}"`
  ).join(" | ");
  return `Invalid dependencies.humanSignOff in .lisa.config.json: ${rejected} is not one of ${accepted}; ${consequence}`;
}
