/**
 * Putting a before-enforce run together, and printing it as a table an
 * operator can read.
 *
 * One row per register entry, in register order: what it came out as, which
 * entry it is, the moment that was tried, what happened to the violating
 * change, and what the tool's own command made of it. Under each row is the
 * sentence that says the same in plain words. The layout depends only on the
 * results, so the same results always print the same lines.
 * @module controls/before-enforce-report
 */
import type { AuditFinding } from "./audit-report-types.js";
import {
  BEFORE_ENFORCE_MODE,
  BEFORE_ENFORCE_RESULTS,
  BEFORE_ENFORCE_SCHEMA_VERSION,
  type BeforeEnforceCopy,
  type BeforeEnforceCounts,
  type BeforeEnforceEntry,
  type BeforeEnforceOutcome,
  type BeforeEnforceRun,
} from "./before-enforce-types.js";
import { BEFORE_ENFORCE_LIMITS, runReason } from "./before-enforce-wording.js";

/** The table's column headings, in order. */
const HEADINGS = ["RESULT", "ENTRY", "MOMENT", "CHANGE", "TOOL"] as const;

/** What a cell holds when there is nothing to put in it. */
const NOTHING = "-";

/** The gap between two columns. */
const GAP = "  ";

/**
 * Say what a whole run came to, from how many entries came out as each
 * result.
 * @param counts - The counts
 * @param total - How many entries there are
 * @returns The outcome
 */
function outcomeOf(
  counts: BeforeEnforceCounts,
  total: number
): BeforeEnforceOutcome {
  if (total === 0) return "nothing-declared";
  if (counts.unknown > 0) return "incomplete";
  if (counts["not-enforced"] > 0) return "findings";
  return counts.enforced > 0 ? "nothing-found" : "nothing-exercised";
}

/**
 * Put entry results together as one run.
 * @param parts - What the run found
 * @param parts.entries - One result per register entry, in register order
 * @param parts.copy - The fresh clone, or `null` when none was made
 * @param parts.findings - The findings offered to the audit report
 * @returns The run
 */
export function beforeEnforceRunOf(parts: {
  readonly entries: readonly BeforeEnforceEntry[];
  readonly copy: BeforeEnforceCopy | null;
  readonly findings: readonly AuditFinding[];
}): BeforeEnforceRun {
  const { entries } = parts;
  const counts = Object.fromEntries(
    BEFORE_ENFORCE_RESULTS.map(result => [
      result,
      entries.filter(entry => entry.result === result).length,
    ])
  ) as BeforeEnforceCounts;
  const outcome = outcomeOf(counts, entries.length);
  return {
    schema_version: BEFORE_ENFORCE_SCHEMA_VERSION,
    mode: BEFORE_ENFORCE_MODE,
    outcome,
    reason: runReason(outcome, counts),
    copy: parts.copy,
    wrote: [],
    counts,
    entries,
    audit_findings: parts.findings,
    limits: BEFORE_ENFORCE_LIMITS,
  };
}

/**
 * Say what a recorded command showed, in a few words.
 * @param record - The canary or the tool's record, or `null`
 * @returns For example `accepted (exit 0)`
 */
function cell(
  record: {
    readonly outcome: string;
    readonly exit_status: number | null;
  } | null
): string {
  if (record === null) return NOTHING;
  return record.exit_status === null
    ? record.outcome
    : `${record.outcome} (exit ${String(record.exit_status)})`;
}

/**
 * Write a before-enforce run's results as a table.
 * @param run - The results
 * @returns The table's lines; empty when there are no entries
 */
export function renderBeforeEnforceTable(
  run: BeforeEnforceRun
): readonly string[] {
  if (run.entries.length === 0) return [];
  const rows = run.entries.map(entry => [
    entry.result,
    entry.entry_id,
    entry.moment ?? NOTHING,
    cell(entry.canary),
    cell(entry.tool),
  ]);
  const widths = HEADINGS.map((heading, column) =>
    Math.max(heading.length, ...rows.map(cells => cells[column]?.length ?? 0))
  );
  const line = (cells: readonly string[]): string =>
    cells
      .map((text, column) => text.padEnd(widths[column] ?? 0))
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
