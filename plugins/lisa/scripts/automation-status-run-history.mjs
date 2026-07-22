#!/usr/bin/env node
/**
 * Shared read-only run-history projection for `/lisa:automation-status`.
 *
 * The durable run-outcome substrate (RBC-3, `automation-run-record.mjs`) stores
 * one bounded JSONL file per registered loop under `.lisa/automations/runs/`.
 * This module turns that substrate — plus the checked-in per-loop runbook
 * (`automation-runbook-contract`) — into the per-item display fields both
 * runtime adapters attach to their status rows, so the Codex and Claude
 * adapters never diverge on how the contract, last outcome, and bounded history
 * are rendered.
 *
 * STRICTLY READ-ONLY: it stats the runbook and reads the run-record file. It
 * never creates the runs directory, a runbook, or a run record — a status read
 * must leave the fleet byte-identical.
 */

import fs from "node:fs/promises";
import path from "node:path";

import {
  automationRunRecordPath,
  readAutomationRunRecords,
} from "./automation-run-record.mjs";

/**
 * Inline history cap: the newest N outcomes are listed, the remainder is only
 * counted. A bounded view of an already-bounded file, with the trim stated in
 * the output rather than applied silently.
 */
export const AUTOMATION_RUN_HISTORY_DISPLAY_LIMIT = 5;

/** The recorded outcome that signals a loop could not finish its own work. */
export const RECOVERY_REQUIRED_OUTCOME = "recovery-required";

/**
 * How many trailing `recovery-required` runs in a row flip a loop to `FAILING`.
 * The RBC-5 acceptance criteria pin "last three runs" as the escalation
 * trigger; that wins over the ticket prose's looser "five in a row" pattern.
 */
export const RECOVERY_REQUIRED_ESCALATION_THRESHOLD = 3;

const RUNBOOK_NOT_SCAFFOLDED_LINE =
  "not scaffolded — run /lisa:setup-automations";
const NO_RECORDED_RUNS_LINE = "no recorded runs yet";

/**
 * @typedef {{
 *   readonly ts: string
 *   readonly outcome: string
 *   readonly summary: string
 * }} AutomationLastOutcome
 *
 * @typedef {{
 *   readonly runbook: string
 *   readonly lastOutcome?: AutomationLastOutcome
 *   readonly outcomeHistory: readonly string[]
 *   readonly olderRecordCount: number
 *   readonly recoveryRequiredStreak: number
 *   readonly recoverySummaries: readonly string[]
 *   readonly skippedCorruptLines: number
 * }} AutomationRunDisplay
 */

/**
 * Resolve the read-only run-history display fields for one registered loop.
 *
 * @param {{
 *   readonly projectRoot?: string
 *   readonly loopId: string
 *   readonly runbookPath?: string
 * }} input
 * @returns {Promise<AutomationRunDisplay>}
 */
export async function resolveAutomationRunDisplay(input) {
  const projectRoot = path.resolve(input.projectRoot ?? process.cwd());
  const runbook = await resolveRunbookLine(projectRoot, input.runbookPath);
  const { records, skippedCorruptLines } = await readAutomationRunRecords(
    automationRunRecordPath(projectRoot, input.loopId)
  );

  const newestFirst = records.toReversed();
  const latest = records.at(-1);
  const lastOutcome = latest
    ? { ts: latest.ts, outcome: latest.outcome, summary: latest.summary }
    : undefined;
  const outcomeHistory = newestFirst
    .slice(0, AUTOMATION_RUN_HISTORY_DISPLAY_LIMIT)
    .map(record => record.outcome);
  const olderRecordCount = Math.max(
    0,
    records.length - AUTOMATION_RUN_HISTORY_DISPLAY_LIMIT
  );
  const trailingRecovery = collectTrailingRecoveryRuns(records);

  return {
    runbook,
    lastOutcome,
    outcomeHistory,
    olderRecordCount,
    recoveryRequiredStreak: trailingRecovery.length,
    recoverySummaries: trailingRecovery.map(record => record.summary),
    skippedCorruptLines,
  };
}

/**
 * Force a `FAILING` verdict when a loop has recorded three or more consecutive
 * `recovery-required` runs — the fleet-health signal the scheduler surface
 * cannot see on its own. Returns a run-signal-shaped escalation, or null when
 * the streak is below the threshold.
 *
 * @param {AutomationRunDisplay | undefined} runDisplay
 * @returns {{ readonly status: "FAILING", readonly summary: string, readonly remediation: string } | null}
 */
export function resolveRecoveryEscalation(runDisplay) {
  if (
    !runDisplay ||
    runDisplay.recoveryRequiredStreak < RECOVERY_REQUIRED_ESCALATION_THRESHOLD
  ) {
    return null;
  }

  // Number the citations rather than joining on a delimiter: recorded summaries
  // carry their own `;` and `.`, so a `; `-separated list is ambiguous. `(1) …
  // (2) …` stays legible no matter what punctuation a summary contains.
  const citations = runDisplay.recoverySummaries
    .map((summary, index) => `(${index + 1}) ${summary}`)
    .join(" ");
  return {
    status: "FAILING",
    summary: `the last ${runDisplay.recoveryRequiredStreak} recorded runs all required recovery`,
    remediation: `Repeated recovery-required runs — ${citations} Inspect the loop's runbook and the cited runs, fix the recurring failure, then let the next scheduled run confirm recovery.`,
  };
}

/**
 * @param {string} projectRoot
 * @param {string | undefined} runbookPath
 * @returns {Promise<string>}
 */
async function resolveRunbookLine(projectRoot, runbookPath) {
  if (!runbookPath) {
    return RUNBOOK_NOT_SCAFFOLDED_LINE;
  }
  const scaffolded = await runbookIsScaffolded(
    path.join(projectRoot, runbookPath)
  );
  return scaffolded ? runbookPath : RUNBOOK_NOT_SCAFFOLDED_LINE;
}

/**
 * Read-only existence check for a checked-in runbook. Any stat failure — the
 * file is absent, unreadable, or not a regular file — degrades to "not
 * scaffolded" so the status read never implies health it could not confirm and
 * never throws mid-report.
 *
 * @param {string} runbookAbsolutePath
 * @returns {Promise<boolean>}
 */
async function runbookIsScaffolded(runbookAbsolutePath) {
  try {
    const stat = await fs.stat(runbookAbsolutePath);
    return stat.isFile();
  } catch {
    return false;
  }
}

/**
 * @param {readonly import("./automation-run-record.mjs").AutomationRunRecord[]} records
 * @returns {readonly import("./automation-run-record.mjs").AutomationRunRecord[]} trailing recovery-required runs, newest first
 */
function collectTrailingRecoveryRuns(records) {
  const trailing = [];
  for (let index = records.length - 1; index >= 0; index -= 1) {
    if (records[index].outcome !== RECOVERY_REQUIRED_OUTCOME) {
      break;
    }
    trailing.push(records[index]);
  }
  return trailing;
}

export { RUNBOOK_NOT_SCAFFOLDED_LINE, NO_RECORDED_RUNS_LINE };
