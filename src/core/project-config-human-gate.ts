/**
 * The `.lisa.config.json` `humanGate` block: how wide the human gate is
 * (CodySwannGT/lisa#4687).
 *
 * The default is that an agent performs every act it has access to perform. A
 * person is needed only for an act the agent genuinely lacks access to — an
 * interactive login, a credential it cannot create or reach, spending money, a
 * legal signature, an action only a person's account can take, or a hold the
 * operator asked for. That is `mode: "access-only"`. A project that wants the
 * older, wider gate sets `mode: "strict"`: a compliance sign-off, naming an
 * accountable person and Lisa's own policy calls count as human gates again,
 * and two other settings fall back to their stricter defaults
 * (`dependencies.humanSignOff: "default"`, `learnings.lowConfidence:
 * "human-triage"`). A value either of those keys sets explicitly always wins
 * over the mode. `humanOnly` widens the gate in both modes.
 *
 * ## Why an invalid value degrades instead of throwing
 *
 * Same contract as `project-config-dependencies`: the block changes what
 * governed prose and the shipped classifier ask an agent to do, nothing
 * `lisa apply` writes depends on it, so a typo must not stop the apply. An
 * invalid value resolves to the default and is REPORTED
 * ({@link humanGateSettingsWarnings}, printed by `lisa apply`), because a
 * project that meant `"strict"` and silently got `"access-only"` would see no
 * other symptom. That fallback is not the safe direction for such a project;
 * it is the only value that can be proven, which is why it is reported. The
 * mode is compared trimmed and lower-cased first, so `"Strict"` is strict.
 *
 * The shipped classifier (`plugins/src/base/scripts/human-gate-act.mjs`) and
 * the resolved-config session hook keep their own copies of the vocabulary —
 * both ship inside a plugin payload and cannot import this module — and tests
 * pin those copies against {@link HUMAN_GATE_MODES}. The classifier also reads
 * `.lisa.config.local.json`, where a declared key replaces the global one;
 * this module resolves the committed `.lisa.config.json` snapshot only, like
 * every other `ProjectConfig` reader.
 * @module core/project-config-human-gate
 */

/** The closed vocabulary of `humanGate.mode`. */
export const HUMAN_GATE_MODES = ["access-only", "strict"] as const;

/** One accepted value of `humanGate.mode`. */
export type HumanGateMode = (typeof HUMAN_GATE_MODES)[number];

/** Mode in force when the key is absent or invalid. */
export const DEFAULT_HUMAN_GATE_MODE: HumanGateMode = "access-only";

/**
 * The optional `humanGate` block, as declared.
 *
 * Values are kept exactly as the file spelled them — possibly invalid — so
 * the resolver decides validity and can report what it rejected.
 */
export interface HumanGateConfig {
  /** Raw declared mode; resolve with {@link resolveHumanGateSettings}. */
  readonly mode?: unknown;
  /** Raw declared human-only decision classes. */
  readonly humanOnly?: unknown;
  /** The raw `humanGate` value when it was not an object. */
  readonly rejectedBlock?: unknown;
}

/** Minimum project-config shape the resolver reads. */
export interface ConfigWithHumanGate {
  readonly humanGate?: HumanGateConfig;
}

/** One declared value the resolver could not use. */
export type RejectedHumanGateValue = Readonly<{
  /** Dotted config key the value was declared at. */
  key: "humanGate" | "humanGate.mode" | "humanGate.humanOnly";
  /** JSON spelling of the declared value. */
  value: string;
}>;

/** Effective human-gate settings derived from one config snapshot. */
export type ResolvedHumanGateSettings = Readonly<{
  /** The mode in force. */
  mode: HumanGateMode;
  /** The declared human-only classes that are usable strings. */
  humanOnly: readonly string[];
  /** Whether the project declared the block at all, valid or not. */
  declared: boolean;
  /** Every declared value that was rejected, in declaration order. */
  rejected: readonly RejectedHumanGateValue[];
}>;

/**
 * Validate the optional `humanGate` block. Never throws.
 * @param value - Raw `humanGate` value
 * @param _source - Config source; kept for parity with the other block
 *   validators, unused because nothing here throws
 * @returns The block, or undefined when absent
 */
export function validateHumanGateConfig(
  value: unknown,
  _source: string
): HumanGateConfig | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { rejectedBlock: value };
  }
  const { mode, humanOnly } = value as Record<string, unknown>;
  return {
    ...(mode === undefined ? {} : { mode }),
    ...(humanOnly === undefined ? {} : { humanOnly }),
  };
}

/**
 * The comparable form of a declared mode: trimmed and lower-cased.
 * @param value - Raw declared value
 * @returns The normalized value; a non-string is returned unchanged
 */
function normalizeMode(value: unknown): unknown {
  return typeof value === "string" ? value.trim().toLowerCase() : value;
}

/**
 * Whether a raw value is one of the accepted modes.
 * @param value - Raw declared value
 * @returns True for a member of {@link HUMAN_GATE_MODES}
 */
function isHumanGateMode(value: unknown): value is HumanGateMode {
  return (HUMAN_GATE_MODES as readonly unknown[]).includes(value);
}

/**
 * Resolve the declared human-only classes, keeping the usable strings.
 * @param declared - Raw `humanGate.humanOnly`
 * @returns The usable classes, and whether anything was dropped
 */
function resolveHumanOnly(declared: unknown): {
  humanOnly: readonly string[];
  dropped: boolean;
} {
  if (declared === undefined) return { humanOnly: [], dropped: false };
  if (!Array.isArray(declared)) return { humanOnly: [], dropped: true };
  const humanOnly = declared.filter(
    (entry): entry is string =>
      typeof entry === "string" && entry.trim().length > 0
  );
  return { humanOnly, dropped: humanOnly.length !== declared.length };
}

/**
 * Resolve the effective `humanGate` settings.
 * @param config - Validated project config snapshot
 * @returns The mode and classes in force, and anything rejected
 */
export function resolveHumanGateSettings(
  config: ConfigWithHumanGate
): ResolvedHumanGateSettings {
  const block = config.humanGate;
  if (block === undefined) {
    return Object.freeze({
      mode: DEFAULT_HUMAN_GATE_MODE,
      humanOnly: [],
      declared: false,
      rejected: [],
    });
  }
  if ("rejectedBlock" in block) {
    return Object.freeze({
      mode: DEFAULT_HUMAN_GATE_MODE,
      humanOnly: [],
      declared: true,
      rejected: [
        {
          key: "humanGate",
          value: JSON.stringify(block.rejectedBlock),
        } as const,
      ],
    });
  }
  const mode = normalizeMode(block.mode);
  const modeValid = mode === undefined || isHumanGateMode(mode);
  const { humanOnly, dropped } = resolveHumanOnly(block.humanOnly);
  const rejected: RejectedHumanGateValue[] = [
    ...(modeValid
      ? []
      : [
          { key: "humanGate.mode", value: JSON.stringify(block.mode) } as const,
        ]),
    ...(dropped
      ? [
          {
            key: "humanGate.humanOnly",
            value: JSON.stringify(block.humanOnly),
          } as const,
        ]
      : []),
  ];
  return Object.freeze({
    mode: isHumanGateMode(mode) ? mode : DEFAULT_HUMAN_GATE_MODE,
    humanOnly,
    declared: true,
    rejected,
  });
}

/**
 * The effective mode alone, for the mode-aware defaults of other blocks.
 * @param config - Validated project config snapshot
 * @returns The mode in force
 */
export function resolveHumanGateMode(
  config: ConfigWithHumanGate
): HumanGateMode {
  return resolveHumanGateSettings(config).mode;
}

/**
 * The warnings to print for an unusable `humanGate` declaration.
 * @param config - Validated project config snapshot
 * @returns One line per rejected value; empty when everything was usable
 */
export function humanGateSettingsWarnings(
  config: ConfigWithHumanGate
): readonly string[] {
  const accepted = HUMAN_GATE_MODES.map(value => `"${value}"`).join(" | ");
  const fallback = `treated as "${DEFAULT_HUMAN_GATE_MODE}", so only acts an agent lacks access to are held for a person.`;
  return resolveHumanGateSettings(config).rejected.map(({ key, value }) => {
    if (key === "humanGate") {
      return `Invalid humanGate in .lisa.config.json: ${value} is not an object; humanGate.mode is ${fallback}`;
    }
    if (key === "humanGate.mode") {
      return `Invalid humanGate.mode in .lisa.config.json: ${value} is not one of ${accepted}; ${fallback}`;
    }
    return `Invalid humanGate.humanOnly in .lisa.config.json: ${value} is not a list of non-empty strings; only its string entries are used.`;
  });
}
