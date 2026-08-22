/**
 * Counts for the gate report, each stating its denominator and its unknowns.
 *
 * A header reading "31 of 34 healthy" where three were never checked is the
 * defect this report is organised against, so nothing here folds an `unknown`
 * into a green count. `bucketUnknown` is a first-class number sitting beside
 * A/B/C/D rather than being absorbed into D.
 * @module cli/gate-report-summary
 */
import type {
  Bucket,
  GateMomentCell,
  GateReportRow,
  GateReportSummary,
} from "./gate-report-types.js";
import { isUpstreamFinding } from "./gate-report-upstream.js";

/** Levels that put a gate into service. */
const ACTIVE_LEVELS = new Set(["required", "optional"]);

/**
 * Whether a gate carries at least one live declaration anywhere.
 * @param row - One gate's row
 * @returns True when some moment declares it required or optional
 */
function isGoverned(row: GateReportRow): boolean {
  return row.moments.some(cell => ACTIVE_LEVELS.has(cell.declaration));
}

/**
 * Whether a gate is mentioned by the settings file only to be turned off.
 * @param row - One gate's row
 * @returns True when every declaration is `off` and there is at least one
 */
function isOffOnly(row: GateReportRow): boolean {
  return (
    !isGoverned(row) && row.moments.some(cell => cell.declaration === "off")
  );
}

/**
 * Whether an undeclared pair is proved anyway by a written-in command.
 *
 * This is bucket B stated as a number, and it is the sentence a non-technical
 * operator can act on: the check is running, so the repository looks healthy,
 * and the settings file has no say over it.
 * @param cell - One (gate, moment) pair
 * @returns True when nothing declares it and a script runs it regardless
 */
function isProvedAnyway(cell: GateMomentCell): boolean {
  return (
    !ACTIVE_LEVELS.has(cell.declaration) &&
    cell.executors.some(entry => entry.kind !== "gate-runner")
  );
}

/**
 * Whether a declared pair resolves to a command the project does not have.
 * @param cell - One (gate, moment) pair
 * @returns True when it is bucket C's sharp case
 */
function isDeclaredWithoutCommand(cell: GateMomentCell): boolean {
  return (
    ACTIVE_LEVELS.has(cell.declaration) &&
    cell.commandExists.state === "verified" &&
    !cell.commandExists.value
  );
}

/**
 * Count the cells classified into one bucket.
 * @param cells - Every legal cell
 * @param bucket - The bucket to count
 * @returns The count
 */
function countBucket(cells: readonly GateMomentCell[], bucket: Bucket): number {
  return cells.filter(
    cell => cell.bucket.state === "verified" && cell.bucket.value === bucket
  ).length;
}

/**
 * Summarise the report.
 * @param rows - Every gate row
 * @param momentCount - Moments on the report's axis
 * @returns The summary block
 */
export function summarise(
  rows: readonly GateReportRow[],
  momentCount: number
): GateReportSummary {
  const cells = rows.flatMap(row => row.moments.filter(cell => cell.legal));
  const governedBySettings = rows.filter(isGoverned).length;
  const declaredOffOnly = rows.filter(isOffOnly).length;
  return {
    gateCount: rows.length,
    momentCount,
    governedBySettings,
    declaredOffOnly,
    notDeclared: rows.length - governedBySettings - declaredOffOnly,
    legalCells: cells.length,
    buckets: {
      A: countBucket(cells, "A"),
      B: countBucket(cells, "B"),
      C: countBucket(cells, "C"),
      D: countBucket(cells, "D"),
    },
    bucketUnknown: cells.filter(cell => cell.bucket.state !== "verified")
      .length,
    bucketUnknownUpstream: cells.filter(cell => isUpstreamFinding(cell.bucket))
      .length,
    declaredWithoutCommand: cells.filter(isDeclaredWithoutCommand).length,
    provedAnyway: cells.filter(isProvedAnyway).length,
  };
}
