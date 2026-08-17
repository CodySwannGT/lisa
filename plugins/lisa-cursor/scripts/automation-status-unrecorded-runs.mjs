#!/usr/bin/env node
/**
 * Detect registered-loop cycles that ran and recorded nothing.
 *
 * The Automation Runbook Contract requires every run of a registered loop to
 * end in exactly one of six recorded outcomes, but the recorder is invoked only
 * by prose instruction inside each loop's `SKILL.md`. A cycle that finishes
 * without running it appends no row, and an absent row is ambiguous in the one
 * way that matters: it looks identical to a cycle that never ran.
 *
 * That ambiguity is not merely an audit gap. Cycles read the ledger tail to
 * decide whether the lane was already worked, so a missing row feeds back into
 * selection — the next cycle sees stale activity, concludes the lane is
 * unworked, and re-picks the rung a peer is already holding.
 *
 * This module resolves the ambiguity with a signal the loop does not control:
 * the scheduler's own last-run time. A row written by a cycle necessarily
 * postdates that cycle's start, so a newest row older than the last scheduler
 * run means the run in between recorded nothing. Neither side can fake it —
 * the scheduler timestamp is written by the runtime, and the ledger timestamp
 * by the recorder.
 *
 * Reporting only, never blocking, per the contract's own escape: "If recording
 * still fails, degrade, never abort." Every unreadable input degrades to `null`
 * rather than to a finding, because a detector that guesses would poison the
 * same selection loop it exists to protect.
 */

/**
 * @typedef {{
 *   readonly missedCycles: number
 *   readonly schedulerLastRunAt: string
 *   readonly ledgerLastRecordAt: string | null
 *   readonly summary: string
 *   readonly remediation: string
 * }} UnrecordedRunFinding
 */

/**
 * Remediation text shared by both finding shapes.
 *
 * It names the contract rather than the script because the omission is a
 * skipped step in the loop, not a broken recorder — a broken recorder reports
 * itself through the degradation path this module deliberately leaves alone.
 */
const UNRECORDED_RUN_REMEDIATION =
  "The loop ran without recording an outcome. Confirm the loop's SKILL.md " +
  "still ends every path by invoking `automation-run-record.mjs`, including " +
  "the paths that find no work, per the automation-runbook-contract rule.";

/**
 * Whether a scheduled run finished without appending a run record.
 *
 * Tolerance is one full cadence, not a fixed grace period. The scheduler's
 * `lastRunAt` may be stamped at either end of a cycle depending on runtime, and
 * a cycle can legitimately run for many minutes, so anything tighter would
 * report a slow-but-honest loop as a silent one. A full cadence cannot be
 * crossed by a single well-behaved run: it means an entire scheduled cycle came
 * and went between the newest row and the newest run.
 *
 * @param {{
 *   readonly schedulerLastRunAt?: string | null
 *   readonly ledgerLastRecordAt?: string | null
 *   readonly hasRunbook?: boolean
 *   readonly cadenceMs?: number | null
 * }} input - Scheduler-side run time, ledger-side newest record, and cadence.
 * @returns {UnrecordedRunFinding | null} The finding, or `null` when the
 *   comparison cannot be made from trustworthy inputs.
 */
export function resolveUnrecordedRunFinding(input) {
  const cadenceMs = input.cadenceMs;
  if (!cadenceMs || !Number.isFinite(cadenceMs) || cadenceMs <= 0) {
    return null;
  }

  // No scheduler timestamp means the runtime never reported a run, which is
  // indistinguishable from a loop registered moments ago. Silence here is the
  // honest answer, and `classifyAutomationRunSignal` already reports the
  // missing metadata separately.
  if (!input.schedulerLastRunAt) {
    return null;
  }
  const schedulerLastRun = Date.parse(input.schedulerLastRunAt);
  if (Number.isNaN(schedulerLastRun)) {
    return null;
  }

  // A loop with no runbook is not yet under the contract; `automation-status`
  // reports the un-scaffolded runbook itself, and stacking a second finding on
  // it would blame the loop for a setup step it never took.
  if (input.hasRunbook === false) {
    return null;
  }

  if (!input.ledgerLastRecordAt) {
    return {
      missedCycles: 1,
      schedulerLastRunAt: input.schedulerLastRunAt,
      ledgerLastRecordAt: null,
      summary: `scheduler reports a run at ${input.schedulerLastRunAt} but the ledger holds no record at all`,
      remediation: UNRECORDED_RUN_REMEDIATION,
    };
  }

  const ledgerLastRecord = Date.parse(input.ledgerLastRecordAt);
  if (Number.isNaN(ledgerLastRecord)) {
    return null;
  }

  const gapMs = schedulerLastRun - ledgerLastRecord;
  if (gapMs <= cadenceMs) {
    return null;
  }

  const missedCycles = Math.floor(gapMs / cadenceMs);
  return {
    missedCycles,
    schedulerLastRunAt: input.schedulerLastRunAt,
    ledgerLastRecordAt: input.ledgerLastRecordAt,
    summary: `${missedCycles} scheduled ${
      missedCycles === 1 ? "run" : "runs"
    } recorded no outcome (newest record ${input.ledgerLastRecordAt}, last run ${input.schedulerLastRunAt})`,
    remediation: UNRECORDED_RUN_REMEDIATION,
  };
}

export { UNRECORDED_RUN_REMEDIATION };
