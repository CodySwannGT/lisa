/**
 * Ownership contract for the one mutation-score floor that lives in two files.
 *
 * `.lisa.config.json` (`quality.mutation.strykerThresholds`) owns the value;
 * `stryker.conf.json` (`thresholds`) is where Stryker reads it. Every other
 * sync artifact is written wholesale (`pointer: ""`), so a hand-edit to one of
 * those is obviously wrong and gets overwritten. `stryker.conf.json` is the
 * only partial binding in the registry: editing 17 of its 18 keys is correct
 * and editing the 18th is silently wrong — which is exactly the file that
 * drifted (CodySwannGT/lisa#2968).
 *
 * This module is deliberately named after that single instance rather than
 * generalised. A framework for a one-instance problem is a bigger mistake than
 * the instance; if a second partial binding is ever added, the registry test
 * that pins "exactly one partial binding" fails and forces the decision then.
 *
 * Two controls live here:
 *
 * 1. {@link describeMutationFloorDivergence} — the message the config sync
 *    fails with when the two floors disagree. Sync refuses in BOTH directions:
 *    writing the config value can raise the floor above the score the codebase
 *    actually measures (reddening the mutation gate on unchanged code), and
 *    absorbing the file value would silently lower a declared floor.
 * 2. {@link checkMutationFloorOwnership} — the executable form of the
 *    ownership statement carried in `stryker.conf.json` itself, so that a
 *    hand-edit of `thresholds` fails a test instead of relying on a comment
 *    being read.
 * @module sync/stryker-thresholds-ownership
 */
import {
  getAtPath,
  isJsonObject,
  jsonEquals,
  type JsonObject,
} from "./json-path.js";

/** Config key that owns the mutation-score floor. */
export const MUTATION_FLOOR_CONFIG_KEY = "quality.mutation.strykerThresholds";

/** Config file that owns the mutation-score floor. */
export const MUTATION_FLOOR_CONFIG_FILE = ".lisa.config.json";

/** Artifact file that mirrors the mutation-score floor. */
export const MUTATION_FLOOR_ARTIFACT_FILE = "stryker.conf.json";

/** Dot path of the mirrored floor inside the artifact file. */
export const MUTATION_FLOOR_ARTIFACT_POINTER = "thresholds";

/** Artifact key stating, in the file itself, who owns `thresholds`. */
export const MUTATION_FLOOR_OWNER_FIELD = "_thresholdsOwner";

/** Artifact key declaring a deliberate, temporary, fully-recorded divergence. */
export const MUTATION_FLOOR_DIVERGENCE_FIELD = "_thresholdsDivergence";

/**
 * Whether a registry binding is the single config-owned mutation floor.
 * @param key - Registry entry key being synced
 * @param file - Artifact file the binding writes
 * @param pointer - Dot path inside that file
 * @returns True for the one guarded binding
 */
export function isMutationFloorBinding(
  key: string,
  file: string,
  pointer: string
): boolean {
  return (
    key === MUTATION_FLOOR_CONFIG_KEY &&
    file === MUTATION_FLOOR_ARTIFACT_FILE &&
    pointer === MUTATION_FLOOR_ARTIFACT_POINTER
  );
}

/**
 * Render a value for an operator-readable diagnosis.
 * @param value - Any JSON value
 * @returns Compact JSON text
 */
function show(value: unknown): string {
  return JSON.stringify(value ?? null);
}

/**
 * Build the operator-readable divergence diagnosis, naming both values and the
 * file each came from.
 * @param configValue - Floor declared in the config
 * @param artifactValue - Floor enforced by the artifact
 * @returns Multi-line failure message
 */
export function describeMutationFloorDivergence(
  configValue: unknown,
  artifactValue: unknown
): string {
  return [
    "Mutation-score floor divergence — refusing to sync.",
    "",
    `  ${MUTATION_FLOOR_CONFIG_FILE}  ${MUTATION_FLOOR_CONFIG_KEY} = ${show(configValue)}`,
    `  ${MUTATION_FLOOR_ARTIFACT_FILE}  ${MUTATION_FLOOR_ARTIFACT_POINTER} = ${show(artifactValue)}`,
    "",
    `\`${MUTATION_FLOOR_ARTIFACT_POINTER}\` in ${MUTATION_FLOOR_ARTIFACT_FILE} is owned by ${MUTATION_FLOOR_CONFIG_FILE},`,
    "and the two disagree. Sync will not resolve that in either direction: writing the",
    "declared floor can raise it above the score the codebase actually measures, which",
    "reddens the mutation gate on code that did not change, and absorbing the enforced",
    "floor would silently lower a declared standard.",
    "",
    "Measure the real aggregate mutation score, then set BOTH files to one value and re-run.",
  ].join("\n");
}

/** Config sync refused to write because the two mutation floors disagree. */
export class MutationFloorDivergenceError extends Error {
  /** Floor declared in the config. */
  readonly configValue: unknown;

  /** Floor enforced by the artifact on disk. */
  readonly artifactValue: unknown;

  /**
   * Build the refusal carrying both floors.
   * @param configValue - Floor declared in the config
   * @param artifactValue - Floor enforced by the artifact
   */
  constructor(configValue: unknown, artifactValue: unknown) {
    super(describeMutationFloorDivergence(configValue, artifactValue));
    this.name = "MutationFloorDivergenceError";
    this.configValue = configValue;
    this.artifactValue = artifactValue;
  }
}

/**
 * Check the ownership statement carried by `stryker.conf.json` itself.
 * @param strykerConf - Parsed `stryker.conf.json`
 * @param configValue - Floor declared in the owning config key
 * @returns One problem string per violation; empty when the file is in step
 */
export function checkMutationFloorOwnership(
  strykerConf: unknown,
  configValue: unknown
): readonly string[] {
  const file: JsonObject = isJsonObject(strykerConf) ? strykerConf : {};
  const thresholds = getAtPath(file, MUTATION_FLOOR_ARTIFACT_POINTER);
  return [
    ...ownerStatementProblems(file[MUTATION_FLOOR_OWNER_FIELD]),
    ...divergenceProblems(
      file[MUTATION_FLOOR_DIVERGENCE_FIELD],
      thresholds,
      configValue
    ),
  ];
}

/**
 * Validate the in-file statement that `thresholds` is config-owned.
 * @param statement - Value of the ownership field
 * @returns Problems found with the statement
 */
function ownerStatementProblems(statement: unknown): readonly string[] {
  const prefix = `${MUTATION_FLOOR_ARTIFACT_FILE} \`${MUTATION_FLOOR_ARTIFACT_POINTER}\``;
  if (typeof statement !== "string" || statement.trim() === "") {
    return [
      `${prefix} is config-owned but \`${MUTATION_FLOOR_OWNER_FIELD}\` is missing. State the owner in the file, next to the key someone would edit.`,
    ];
  }
  if (
    !statement.includes(MUTATION_FLOOR_CONFIG_FILE) ||
    !statement.includes(MUTATION_FLOOR_CONFIG_KEY)
  ) {
    return [
      `\`${MUTATION_FLOOR_OWNER_FIELD}\` must name the owner: ${MUTATION_FLOOR_CONFIG_FILE} ${MUTATION_FLOOR_CONFIG_KEY}.`,
    ];
  }
  return [];
}

/**
 * Validate `thresholds` against the owning config value and any declared,
 * deliberate divergence recorded beside it.
 * @param declaration - Value of the divergence field
 * @param thresholds - Floor enforced by this file
 * @param configValue - Floor declared in the owning config key
 * @returns Problems found with the floor or its declaration
 */
function divergenceProblems(
  declaration: unknown,
  thresholds: unknown,
  configValue: unknown
): readonly string[] {
  const prefix = `${MUTATION_FLOOR_ARTIFACT_FILE} \`${MUTATION_FLOOR_ARTIFACT_POINTER}\``;
  if (jsonEquals(thresholds, configValue)) {
    return declaration === undefined
      ? []
      : [
          `${prefix} now matches ${MUTATION_FLOOR_CONFIG_KEY}, so \`${MUTATION_FLOOR_DIVERGENCE_FIELD}\` is stale — delete it.`,
        ];
  }
  if (!isJsonObject(declaration)) {
    return [
      `${prefix} is ${show(thresholds)} but ${MUTATION_FLOOR_CONFIG_FILE} ${MUTATION_FLOOR_CONFIG_KEY} is ${show(configValue)}. Set both to one value, or record the deliberate divergence in \`${MUTATION_FLOOR_DIVERGENCE_FIELD}\` (reason, enforced, declared).`,
    ];
  }
  return declarationFieldProblems(declaration, thresholds, configValue);
}

/**
 * Check that a divergence declaration still records the live numbers.
 * @param declaration - Divergence declaration object
 * @param thresholds - Floor enforced by this file
 * @param configValue - Floor declared in the owning config key
 * @returns Problems found with the declaration's fields
 */
function declarationFieldProblems(
  declaration: Readonly<Record<string, unknown>>,
  thresholds: unknown,
  configValue: unknown
): readonly string[] {
  const reason = declaration["reason"];
  const stale = [
    !jsonEquals(declaration["enforced"], thresholds)
      ? `\`${MUTATION_FLOOR_DIVERGENCE_FIELD}.enforced\` records ${show(declaration["enforced"])} but ${MUTATION_FLOOR_ARTIFACT_FILE} \`${MUTATION_FLOOR_ARTIFACT_POINTER}\` is ${show(thresholds)} — the floor was hand-edited out of step.`
      : undefined,
    !jsonEquals(declaration["declared"], configValue)
      ? `\`${MUTATION_FLOOR_DIVERGENCE_FIELD}.declared\` records ${show(declaration["declared"])} but ${MUTATION_FLOOR_CONFIG_KEY} is ${show(configValue)}.`
      : undefined,
    typeof reason !== "string" || reason.trim() === ""
      ? `\`${MUTATION_FLOOR_DIVERGENCE_FIELD}.reason\` must say why the two floors are allowed to differ and what resolves it.`
      : undefined,
  ];
  return stale.filter((problem): problem is string => problem !== undefined);
}
