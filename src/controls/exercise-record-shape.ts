/** Structural requirements for an exercised artifact in the evidence file. */
import {
  ARTIFACT_EXERCISED,
  exerciseRecordId,
  type EvidenceRecord,
  type ExerciseRecordIdentity,
} from "./evidence-types.js";
import { EXERCISE_CRITERIA } from "./exercise-declaration.js";

/**
 * Check the exercise's identity, outcome and relationship to the evidence file.
 * @param record - A record whose fields are individually well formed
 * @param exercise - Its typed artifact identity
 * @returns Why its fields cannot form an exercised artifact, if anything differs
 */
export function exerciseRecordProblems(
  record: EvidenceRecord,
  exercise: ExerciseRecordIdentity
): string[] {
  return record.rung === "exercised" &&
    record.result === "held" &&
    record.reason === ARTIFACT_EXERCISED &&
    record.entry_id === null &&
    record.moment === null &&
    record.command === null &&
    record.commit === null &&
    record.exit_status === null &&
    record.output_excerpt === "" &&
    !record.output_truncated &&
    record.half === undefined &&
    EXERCISE_CRITERIA.some(criterion => criterion === record.criterion) &&
    record.id === exerciseRecordId(record.criterion, exercise.target)
    ? []
    : [
        "An artifact exercise needs its typed criterion and target, the exercised rung and a held result without a gate or half",
      ];
}
