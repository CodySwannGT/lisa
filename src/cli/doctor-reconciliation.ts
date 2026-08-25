/**
 * Doctor check: did the lockfile reconciliation this install scheduled actually
 * land?
 *
 * `lisa apply` runs from `postinstall`, so the package manager writes the
 * lockfile before apply rewrites package.json. A detached trampoline repairs
 * that afterwards — and for bun consumers it silently did not, for as long as it
 * has existed, because its regen was gated on the child's own idempotent
 * re-apply changing package.json rather than on the drift the FIRST apply
 * created (CodySwannGT/lisa#2750). The visible symptom arrived much later and
 * somewhere else: `error: lockfile had changes, but lockfile is frozen`, in CI,
 * on a job nobody connected to an install that had looked clean.
 *
 * Fixing the gate is half the ticket. The other half is that a spawn that never
 * happened, a child that died on arrival, and a child that ran and correctly did
 * nothing were all indistinguishable — the trampoline is `stdio: "ignore"` and
 * its regen swallowed failures, so success and failure produced identical
 * evidence, which is none. That is the same shape as #2745, and leaving it in
 * place would make the next regression here invisible again.
 *
 * So the reconciliation writes `.lisa/reconciliation-report.json` and this check
 * reads it. A report that finished says so and this check stays quiet. A report
 * still sitting at `scheduled` or `started` long after it was written is a
 * reconciliation that never landed, and the two are distinguishable: `scheduled`
 * means the child never ran at all, `started` means it ran and died partway.
 *
 * Warn, not fail. The remedy is one command, the drift is real but repairable,
 * and a reconciliation legitimately in flight for the first couple of minutes
 * after an install must not redden an exit code — that is how operators learn to
 * ignore a check.
 * @module cli/doctor-reconciliation
 */
import type { ReconciliationReport } from "../core/reconciliation-report.js";
import {
  RECONCILIATION_REPORT_DISPLAY_PATH,
  readReconciliationReport,
} from "../core/reconciliation-report.js";

const CHECK_NAME = "Lockfiles reconciled after the last apply?";

/**
 * How long a reconciliation may sit unfinished before it counts as stalled.
 *
 * Generously past the worst legitimate case: the child waits up to 120 s for the
 * package manager, then runs a full re-apply and a lockfile regen, each of which
 * can take minutes on a large repository over a slow network. Anything past this
 * is not slow, it is gone.
 */
const STALL_AFTER_MS = 15 * 60 * 1000;

/** One doctor check result, structurally identical to `DoctorCheck`. */
interface ReconciliationCheck {
  name: string;
  status: "ok" | "warn" | "fail";
  detail: string;
}

/** The command that repairs the drift by hand, whatever caused it. */
const REPAIR_HINT =
  "Repair it with your package manager's script-free install " +
  "(`bun install --ignore-scripts`, `npm install --package-lock-only --ignore-scripts`, " +
  "`pnpm install --lockfile-only --ignore-scripts`). Do NOT just run a plain install " +
  "again: that re-runs postinstall, which re-applies and recreates the same drift.";

/**
 * Render an ISO timestamp as a plain calendar date, degrading to the raw value.
 * @param isoTimestamp - Timestamp from the report
 * @returns `YYYY-MM-DD`, or the input when it is not a real date
 */
function toCalendarDate(isoTimestamp: string): string {
  const parsed = new Date(isoTimestamp);
  return Number.isNaN(parsed.getTime())
    ? isoTimestamp
    : parsed.toISOString().slice(0, 10);
}

/**
 * Age of a report's last write, in milliseconds, or null when unparseable.
 * @param report - The report
 * @param now - Current time
 * @returns Milliseconds since the last write, or null
 */
function ageMs(report: ReconciliationReport, now: Date): number | null {
  const updated = new Date(report.updated_at).getTime();
  return Number.isNaN(updated) ? null : now.getTime() - updated;
}

/**
 * Describe a reconciliation that was recorded but never reported a result.
 *
 * The distinction the two pending outcomes carry is the entire point of writing
 * two of them: `scheduled` is the parent's word alone, so no child ever ran;
 * `started` is the child's own first act, so it ran and then stopped. Before
 * this, both looked exactly like a successful no-op.
 * @param report - The stalled report
 * @param scheduledOn - Calendar date the reconciliation was scheduled
 * @returns Doctor check result
 */
function stalled(
  report: ReconciliationReport,
  scheduledOn: string
): ReconciliationCheck {
  const cause =
    report.outcome === "scheduled"
      ? "The detached reconciliation child never reported in at all — it did not start."
      : "The detached reconciliation child started and then stopped without finishing.";
  return {
    name: CHECK_NAME,
    status: "warn",
    detail:
      `Lisa ${report.lisa_version} changed package.json on ${scheduledOn} and scheduled a ` +
      `lockfile reconciliation that never completed. ${cause} Your lockfiles are probably ` +
      `still describing package.json as it was BEFORE that apply, which surfaces later as ` +
      `"lockfile had changes, but lockfile is frozen" in CI. ${REPAIR_HINT} ` +
      `Details: ${RECONCILIATION_REPORT_DISPLAY_PATH}`,
  };
}

/**
 * Build the result for a report that reached a terminal outcome.
 * @param report - The report
 * @param scheduledOn - Calendar date the reconciliation was scheduled
 * @returns Doctor check result
 */
function terminal(
  report: ReconciliationReport,
  scheduledOn: string
): ReconciliationCheck {
  if (report.outcome === "regenerated") {
    return {
      name: CHECK_NAME,
      status: "ok",
      detail: `Lockfiles regenerated on ${scheduledOn} for: ${report.package_managers.join(", ")}`,
    };
  }
  if (report.outcome === "not-needed") {
    return {
      name: CHECK_NAME,
      status: "ok",
      detail: `No lockfile drift to reconcile as of ${scheduledOn}`,
    };
  }
  return {
    name: CHECK_NAME,
    status: "warn",
    detail:
      `The lockfile reconciliation scheduled by Lisa ${report.lisa_version} on ${scheduledOn} ` +
      `did not complete (${report.outcome}). ${report.detail} ${REPAIR_HINT}`,
  };
}

/**
 * Report whether the last scheduled lockfile reconciliation landed.
 * @param targetPath - Project path to inspect
 * @param now - Clock, injectable for tests
 * @returns Doctor check result
 */
export async function checkLockfileReconciliation(
  targetPath: string,
  now: () => Date = () => new Date()
): Promise<ReconciliationCheck> {
  const report = await readReconciliationReport(targetPath);
  if (report === null) {
    // Absence is not a finding. Most applies change nothing in package.json and
    // schedule no reconciliation at all, and a report is not written until one
    // is scheduled — so warning here would fire on every healthy project.
    return {
      name: CHECK_NAME,
      status: "ok",
      detail: "No lockfile reconciliation has been scheduled here",
    };
  }

  const scheduledOn = toCalendarDate(report.scheduled_at);
  if (report.outcome !== "scheduled" && report.outcome !== "started") {
    return terminal(report, scheduledOn);
  }

  const age = ageMs(report, now());
  if (age !== null && age < STALL_AFTER_MS) {
    return {
      name: CHECK_NAME,
      status: "ok",
      detail:
        "A lockfile reconciliation is still in flight; re-run doctor in a few minutes",
    };
  }
  return stalled(report, scheduledOn);
}
