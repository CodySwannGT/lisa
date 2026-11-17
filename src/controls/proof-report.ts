/**
 * A proof run's results as a table an operator can read.
 *
 * One row per register entry, in register order: its result, which entry it
 * is, the moment the proof stands for, and what each half showed. Under each
 * row is the sentence that says what happened in plain words. The layout
 * depends only on the results, so the same results always print the same
 * lines.
 * @module controls/proof-report
 */
import type {
  ProofEntryResult,
  ProofHalfResult,
  ProofRun,
} from "./proof-types.js";

/** The table's column headings, in order. */
const HEADINGS = ["RESULT", "ENTRY", "MOMENT", "HALVES"] as const;

/** What a cell holds when there is nothing to put in it. */
const NOTHING = "-";

/** The gap between two columns. */
const GAP = "  ";

/**
 * Say what one half showed, in a few words.
 * @param half - The half's result
 * @returns For example `violation rejected (exit 1)`
 */
function halfCell(half: ProofHalfResult): string {
  const how =
    half.exit_status === null
      ? half.reason
      : `exit ${String(half.exit_status)}`;
  return `${half.half} ${half.outcome} (${how})`;
}

/**
 * The cells of one entry's row.
 * @param entry - The entry's result
 * @returns One cell per heading
 */
function rowCells(entry: ProofEntryResult): readonly string[] {
  const result =
    entry.failed_halves.length > 0
      ? `${entry.outcome} (${entry.failed_halves.join(", ")})`
      : entry.outcome;
  return [
    result,
    entry.entry_id,
    entry.moment ?? NOTHING,
    entry.halves.length === 0
      ? "not run"
      : entry.halves.map(half => halfCell(half)).join("; "),
  ];
}

/**
 * Say how many entries got each result.
 * @param run - The results
 * @returns For example `1 of 3 entries proved: 1 passed, 1 failed, 0 unproved, 1 unknown`
 */
export function proofSummary(run: ProofRun): string {
  const { passed, failed, unproved, unknown } = run.counts;
  const total = run.entries.length;
  return `${String(passed)} of ${String(total)} ${total === 1 ? "entry" : "entries"} proved: ${String(passed)} passed, ${String(failed)} failed, ${String(unproved)} unproved, ${String(unknown)} unknown`;
}

/**
 * Write a proof run's results as a table.
 * @param run - The results
 * @returns The table's lines; empty when there are no entries
 */
export function renderProofTable(run: ProofRun): readonly string[] {
  if (run.entries.length === 0) return [];
  const rows = run.entries.map(entry => rowCells(entry));
  const widths = HEADINGS.map((heading, column) =>
    Math.max(heading.length, ...rows.map(cells => cells[column]?.length ?? 0))
  );
  const line = (cells: readonly string[]): string =>
    cells
      .map((cell, column) => cell.padEnd(widths[column] ?? 0))
      .join(GAP)
      .trimEnd();
  const indent = " ".repeat((widths[0] ?? 0) + GAP.length);
  return [
    line(HEADINGS),
    ...run.entries.flatMap((entry, index) => [
      line(rows[index] ?? []),
      `${indent}${entry.detail}`,
    ]),
  ];
}
