/**
 * The targets an operator expects the four exercised artifact routes to cover.
 * @module controls/exercise-declaration
 */
import { isJsonObject } from "../sync/json-path.js";
import { readControlFile } from "./control-files.js";

/** Where the configure step describes the applicable exercise targets. */
export const EXERCISE_DECLARATION_PATH = ".lisa/controls/exercises.json";

/** Where attest looks for the signed results of those exercises. */
export const EXERCISE_RESULTS_PATH = ".lisa/controls/exercise-results.json";

/** The Level 1 criteria with a typed exercised artifact route. */
export const EXERCISE_CRITERIA = ["AC5.5", "AC6.4", "AC7.2", "AC8.9"] as const;

/** The requirements supported by this proof route. */

/** A target records the accountable producer and its independent reviewer. */
interface ExerciseTargetBase {
  readonly id: string;
  readonly scope: string;
  readonly producer: string;
  readonly adjudicator: string;
}

/** Criterion-specific targets determine exactly what a result must match. */
export type ExerciseTarget = ExerciseTargetBase &
  (
    | {
        readonly criterion: "AC5.5";
        readonly gate: string;
        readonly moment: string;
      }
    | {
        readonly criterion: "AC6.4";
        readonly connection: string;
        readonly surface: string;
      }
    | { readonly criterion: "AC7.2"; readonly release_track: string }
    | {
        readonly criterion: "AC8.9";
        readonly role: string;
        readonly minimum_shadow_seconds: number;
      }
  );

/** The expected exercises for a single declared environment. */
interface ExerciseDeclaration {
  readonly schema_version: 1;
  readonly environment: string;
  readonly targets: readonly ExerciseTarget[];
}

/** Parsed declaration or fixed operator diagnostics. */
export type ExerciseDeclarationRead =
  | {
      readonly declaration: ExerciseDeclaration | null;
      readonly problems: null;
    }
  | { readonly problems: readonly string[] };

/** Short identifiers usable in records and operator diagnostics. */
const EXERCISE_NAME = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/u;

/** Moments when the gate runner can report a refusal. */
const GATE_MOMENT =
  /^(?:post-tool|commit|push|pull-request|scheduled|pre-deploy:[a-z0-9][a-z0-9_-]*)$/u;

/**
 * Validate the spelling of an exercise identifier or nonsecret identity label.
 * @param value - A declaration field
 * @returns Whether the value can be safely used as a name
 */
export function isExerciseName(value: unknown): value is string {
  return typeof value === "string" && EXERCISE_NAME.test(value);
}

/**
 * Validate a single folder name in a repository-relative scope.
 * @param value - The folder path in the declaration
 * @returns Whether the scope has one canonical relative spelling
 */
function exerciseScope(value: unknown): value is string {
  return (
    typeof value === "string" &&
    (value === "." ||
      (value.length <= 512 &&
        !/[\\\u0000-\u001f\u007f]/u.test(value) &&
        value
          .split("/")
          .every(
            segment => segment !== "" && segment !== "." && segment !== ".."
          )))
  );
}

/**
 * Parse one target only when its fields match the named criterion.
 * @param value - A proposed plan entry
 * @returns The target or null when its fields do not describe an exercise
 */
function exerciseTarget(value: unknown): ExerciseTarget | null {
  if (!isJsonObject(value)) return null;
  const { id, scope, producer, adjudicator, criterion } = value;
  if (
    !isExerciseName(id) ||
    !exerciseScope(scope) ||
    !isExerciseName(producer) ||
    !isExerciseName(adjudicator) ||
    producer === adjudicator
  )
    return null;
  const base = { id, scope, producer, adjudicator };
  const fields = Object.keys(value).length;
  if (
    criterion === "AC5.5" &&
    fields === 7 &&
    isExerciseName(value.gate) &&
    typeof value.moment === "string" &&
    GATE_MOMENT.test(value.moment)
  )
    return { ...base, criterion, gate: value.gate, moment: value.moment };
  if (
    criterion === "AC6.4" &&
    fields === 7 &&
    isExerciseName(value.connection) &&
    isExerciseName(value.surface)
  )
    return {
      ...base,
      criterion,
      connection: value.connection,
      surface: value.surface,
    };
  if (
    criterion === "AC7.2" &&
    fields === 6 &&
    isExerciseName(value.release_track)
  )
    return { ...base, criterion, release_track: value.release_track };
  if (
    criterion === "AC8.9" &&
    fields === 7 &&
    isExerciseName(value.role) &&
    typeof value.minimum_shadow_seconds === "number" &&
    Number.isSafeInteger(value.minimum_shadow_seconds) &&
    value.minimum_shadow_seconds > 0
  )
    return {
      ...base,
      criterion,
      role: value.role,
      minimum_shadow_seconds: value.minimum_shadow_seconds,
    };
  return null;
}

/**
 * Read an optional exercise declaration using the ordinary control-file reader.
 * @param root - Real checkout path
 * @returns Typed targets or a reason the declaration cannot be used
 */
export async function readExerciseDeclaration(
  root: string
): Promise<ExerciseDeclarationRead> {
  const file = await readControlFile(root, EXERCISE_DECLARATION_PATH);
  if (file.kind === "missing") return { declaration: null, problems: null };
  if (file.kind !== "text")
    return { problems: ["The exercise declaration could not be read."] };
  try {
    const data: unknown = JSON.parse(file.text);
    if (
      !isJsonObject(data) ||
      Object.keys(data).length !== 3 ||
      data.schema_version !== 1 ||
      !isExerciseName(data.environment) ||
      !Array.isArray(data.targets) ||
      data.targets.length === 0
    )
      return {
        problems: [
          "The exercise declaration needs schema version 1, an environment, and at least one target.",
        ],
      };
    const targets = data.targets.map(exerciseTarget);
    const missing = targets.flatMap((target, index) =>
      target === null
        ? [
            `Exercise target ${index + 1} needs a supported criterion, a repository scope, the criterion's fields, and two independent identities.`,
          ]
        : []
    );
    if (missing.length > 0) return { problems: missing };
    const declared = targets.filter(target => target !== null);
    if (new Set(declared.map(target => target.id)).size !== declared.length)
      return { problems: ["The exercise declaration repeats a target id."] };
    return {
      problems: null,
      declaration: {
        schema_version: 1,
        environment: data.environment,
        targets: declared,
      },
    };
  } catch {
    return { problems: ["The exercise declaration is not valid JSON."] };
  }
}
