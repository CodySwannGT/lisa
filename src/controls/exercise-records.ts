/**
 * Turn verified typed exercises into the evidence the verdict can use.
 * @module controls/exercise-records
 */
import { canonicalText } from "./canonical-json.js";
import {
  ARTIFACT_EXERCISED,
  DEFAULT_FRESHNESS_SECONDS,
  exerciseRecordId,
  type ChecksBinding,
  type EvidenceBatch,
  type EvidenceRecord,
} from "./evidence-types.js";
import {
  readExerciseObservations,
  type ExerciseObservation,
} from "./exercise-observations.js";
import { isRequiredBeyondTheAuthor } from "./register-tier-rule.js";
import type { ControlRegister } from "./register-types.js";

/** What a record says without copying raw producer logs or credentials. */
const DESCRIPTION = {
  "AC5.5": "The authoritative gate refused the known violation.",
  "AC6.4":
    "The expected connection verified an identity on the declared execution surface.",
  "AC7.2":
    "The rollback restored the preceding generation and verified recovery.",
  "AC8.9": "The shadow comparison and adversarial qualification both passed.",
} as const;

/** Exercise records and operator diagnostics derived from the same inputs. */
interface ExerciseRecords {
  readonly batch: EvidenceBatch;
  readonly notes: readonly string[];
}

/**
 * Match saved exercise records to records rebuilt from authorized statements.
 * @param stored - Evidence records already on disk
 * @param rebuilt - Exercise records authenticated for the current binding
 * @returns The verified ids and whether the stored set differs
 */
export function compareExerciseRecords(
  stored: readonly EvidenceRecord[],
  rebuilt: readonly EvidenceRecord[]
) {
  const saved = stored.filter(record => record.exercise !== undefined);
  const exact = new Map(
    saved.map(record => [record.id, canonicalText(record)])
  );
  const current = new Set(
    rebuilt.flatMap(record =>
      exact.get(record.id) === canonicalText(record) ? [record.id] : []
    )
  );
  return {
    current,
    differs: current.size !== saved.length || current.size !== rebuilt.length,
  };
}

/**
 * Check that an exercise plan covers each authoritative gate in its own scope.
 * @param register - The current controls
 * @param observations - The declared target observations from this repository
 * @returns The gate entries the plan omitted
 */
function uncoveredGates(
  register: ControlRegister,
  observations: readonly ExerciseObservation[]
): readonly string[] {
  const gates = observations.flatMap(({ target }) =>
    target.criterion === "AC5.5" ? [target] : []
  );
  if (gates.length === 0) return [];
  return register.entries
    .filter(
      entry =>
        entry.tier === "authoritative" &&
        isRequiredBeyondTheAuthor(entry.enforcement_points) &&
        !gates.some(
          target => target.gate === entry.gate && target.scope === entry.scope
        )
    )
    .map(entry => entry.id);
}

/**
 * Record one exercised artifact with its independently verifiable identity.
 * @param observation - A result that was just verified
 * @param checksDigest - Current definitions of the checks
 * @returns A record when the measurement stood, or no record
 */
function evidenceOf(
  observation: ExerciseObservation,
  checksDigest: string
): EvidenceRecord | null {
  const { result, target } = observation;
  if (result === null) return null;
  return {
    id: exerciseRecordId(target.criterion, target.id),
    criterion: target.criterion,
    entry_id: null,
    scope: target.scope,
    rung: "exercised",
    exercise: { target: target.id, statement_sha256: result.statementDigest },
    moment: null,
    result: "held",
    reason: ARTIFACT_EXERCISED,
    detail: DESCRIPTION[target.criterion],
    commit: null,
    checks_digest: checksDigest,
    command: null,
    exit_status: null,
    started_at: result.completedAt,
    completed_at: result.completedAt,
    freshness_seconds: DEFAULT_FRESHNESS_SECONDS,
    output_excerpt: "",
    output_truncated: false,
  };
}

/**
 * Rebuild the complete evidence for each criterion from current signed results.
 * @param root - Real checkout path
 * @param register - Current repository controls
 * @param checks - Current check binding to compare with the signed results
 * @param now - The time against which the results' freshness is checked
 * @returns The artifact batch and any gaps the operator must address
 */
export async function verifiedExerciseRecords(
  root: string,
  register: ControlRegister,
  checks: ChecksBinding,
  now: Date
): Promise<ExerciseRecords> {
  const { targets, problems } = await readExerciseObservations({
    root,
    register,
    checks,
    now,
  });
  const missingGates = uncoveredGates(register, targets);
  const incomplete = new Set(
    targets.flatMap(({ target, problem }) =>
      problem === null ? [] : [target.criterion]
    )
  );
  const exercises = targets.flatMap(row => {
    const { criterion } = row.target;
    if (
      incomplete.has(criterion) ||
      (criterion === "AC5.5" && missingGates.length > 0)
    )
      return [];
    const record = evidenceOf(row, checks.digest);
    return record === null ? [] : [record];
  });
  const notes = [
    ...problems,
    ...missingGates.map(
      entry =>
        `AC5.5 is missing an exercise target for the authoritative gate ${entry}.`
    ),
    ...targets.flatMap(({ target, problem }) =>
      problem === null
        ? []
        : [`${target.criterion} exercise ${target.id}: ${problem}`]
    ),
  ];
  return { batch: { entries: [], moments: [], results: [], exercises }, notes };
}
