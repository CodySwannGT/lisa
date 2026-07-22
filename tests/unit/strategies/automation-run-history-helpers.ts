/**
 * Shared read-only fixtures for the automation-status run-history adapter tests.
 *
 * These seed the RBC-3 run-record substrate (`.lisa/automations/runs/<id>.jsonl`)
 * and the checked-in per-loop runbook under a temporary project root so both
 * runtime adapters can be exercised against real files.
 * @module tests/unit/strategies/automation-run-history-helpers
 */
import fs from "node:fs/promises";
import path from "node:path";

/** One synthetic run-record's fields. */
export type RunRecordInput = {
  /** Short loop id, e.g. `intake-prd`. */
  readonly loopId: string;
  /** Recorded outcome, e.g. `recovery-required`. */
  readonly outcome: string;
  /** Ordinal that makes the synthetic timestamp deterministic (1-9). */
  readonly n: number;
  /** Optional operator-readable summary; defaulted when omitted. */
  readonly summary?: string;
};

/**
 * Write a checked-in runbook so the adapter reports its path, not "not scaffolded".
 * @param projectRoot - Fixture project root.
 * @param loopId - Short loop id, e.g. `intake-prd`.
 * @returns Nothing.
 */
export async function scaffoldRunbook(
  projectRoot: string,
  loopId: string
): Promise<void> {
  const runbookDir = path.join(projectRoot, ".lisa", "automations");
  await fs.mkdir(runbookDir, { recursive: true });
  await fs.writeFile(
    path.join(runbookDir, `${loopId}.runbook.md`),
    `# ${loopId} runbook\n`
  );
}

/**
 * Write a per-loop JSONL run-record file where the RBC-3 substrate stores it.
 * @param projectRoot - Fixture project root.
 * @param loopId - Short loop id.
 * @param lines - Raw JSONL lines (a corrupt line may be included on purpose).
 * @returns Nothing.
 */
export async function writeRunRecordsFile(
  projectRoot: string,
  loopId: string,
  lines: readonly string[]
): Promise<void> {
  const runsDir = path.join(projectRoot, ".lisa", "automations", "runs");
  await fs.mkdir(runsDir, { recursive: true });
  await fs.writeFile(
    path.join(runsDir, `${loopId}.jsonl`),
    `${lines.join("\n")}\n`
  );
}

/**
 * Build one valid JSONL run-record line; `n` orders the synthetic timestamps so
 * append order (oldest first) is deterministic.
 * @param input - The record fields.
 * @returns The serialized JSONL line.
 */
export function runRecordLine(input: RunRecordInput): string {
  const ts = `2026-05-26T10:0${input.n}:00.000Z`;
  return JSON.stringify({
    ts,
    loop_id: input.loopId,
    outcome: input.outcome,
    summary: input.summary ?? `Run ${input.n} recorded ${input.outcome}.`,
    runbook: `.lisa/automations/${input.loopId}.runbook.md`,
    refs: [],
    run_id: `${input.loopId}:${input.n}`,
  });
}
