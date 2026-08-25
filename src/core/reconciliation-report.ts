/**
 * The durable record of what the lockfile-reconciliation trampoline actually did.
 *
 * `lisa apply` runs from a host project's `postinstall`, which means bun (and
 * every other package manager) writes the lockfile BEFORE apply rewrites
 * package.json. The detached trampoline exists to close that gap: it waits for
 * the package manager to exit, re-applies, and regenerates the lockfiles.
 *
 * It runs with `stdio: "ignore"` — it has to, because it outlives the terminal
 * that started it — and its regen step swallows failures on purpose, because a
 * missing package-manager binary must never cascade into a failed install. Both
 * are correct, and together they made the control indistinguishable from its own
 * failure: a trampoline that never spawned, one that died on arrival, and one
 * that ran and correctly did nothing all produced exactly the same evidence,
 * which is none (CodySwannGT/lisa#2750). The only signal anyone could use was
 * the apply receipt, and only because it happens to be written for an unrelated
 * reason.
 *
 * So the trampoline now reports. The parent records `scheduled` before it
 * spawns; the child records `started` as its first act, which is what separates
 * "never spawned" from "spawned and died"; and the child records a terminal
 * outcome naming what it regenerated or why it could not. A report still sitting
 * at `scheduled` or `started` long after it was written is a reconciliation that
 * never landed, and `lisa doctor` says so (see `cli/doctor-reconciliation`).
 *
 * Machine-local and gitignored for the same reason as the apply receipt: it
 * describes this checkout's last install, not the project.
 * @module core/reconciliation-report
 */
import { mkdir, rename, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { readJsonOrNull } from "../utils/json-utils.js";

/** Directory-relative location of the report, for messages and gitignores. */
export const RECONCILIATION_REPORT_DISPLAY_PATH =
  ".lisa/reconciliation-report.json";

/**
 * Report schema version. Bump only alongside a reader change — an unknown
 * version is treated as no report at all rather than being misread.
 */
export const RECONCILIATION_REPORT_SCHEMA_VERSION = 1;

/**
 * What the reconciliation ended up doing.
 *
 * The two non-terminal values are the load-bearing ones. `scheduled` is written
 * by the parent apply before the spawn; `started` is written by the detached
 * child as its very first act. A report that never advances past `scheduled`
 * means the child never ran; one stuck at `started` means it ran and died. Both
 * used to look identical to success.
 */
export type ReconciliationOutcome =
  /** Parent recorded the intent; no child has reported yet. */
  | "scheduled"
  /** The detached child is alive and waiting for the package manager to exit. */
  | "started"
  /** The parent apply could not spawn the child at all. */
  | "spawn-failed"
  /** The child gave up waiting for the package manager and deliberately did not re-apply. */
  | "parent-wait-timed-out"
  /** The child ran and found package.json matching its pre-apply baseline: no lockfile can be stale. */
  | "not-needed"
  /** Every detected lockfile was regenerated successfully. */
  | "regenerated"
  /** The child started but did not finish: a regen command failed, or it aborted. */
  | "failed";

/** Outcomes that mean the reconciliation finished and nothing is outstanding. */
export const SETTLED_RECONCILIATION_OUTCOMES: readonly ReconciliationOutcome[] =
  ["not-needed", "regenerated"];

/** Outcomes that mean a child has not yet reported a terminal result. */
export const PENDING_RECONCILIATION_OUTCOMES: readonly ReconciliationOutcome[] =
  ["scheduled", "started"];

const KNOWN_OUTCOMES: readonly ReconciliationOutcome[] = [
  "scheduled",
  "started",
  "spawn-failed",
  "parent-wait-timed-out",
  "not-needed",
  "regenerated",
  "failed",
];

/** The persisted `.lisa/reconciliation-report.json` shape. */
export interface ReconciliationReport {
  readonly schema_version: number;
  /** Lisa version whose apply scheduled the reconciliation. */
  readonly lisa_version: string;
  /** Where the reconciliation got to. */
  readonly outcome: ReconciliationOutcome;
  /** ISO timestamp of the parent apply that scheduled it. */
  readonly scheduled_at: string;
  /** ISO timestamp of the most recent write — the age that makes a stall visible. */
  readonly updated_at: string;
  /** Package managers whose lockfiles the child regenerated (or tried to). */
  readonly package_managers: readonly string[];
  /** One operator-readable sentence about this outcome. */
  readonly detail: string;
}

/**
 * Narrow a persisted outcome, treating anything unrecognised as `scheduled`.
 *
 * Deliberately the most alarming reading rather than the most reassuring one: a
 * report this build cannot interpret is exactly the case where claiming the
 * reconciliation succeeded would restore the silence this file exists to end.
 * @param value - Raw value from the report
 * @returns A known outcome
 */
function toOutcome(value: unknown): ReconciliationOutcome {
  return KNOWN_OUTCOMES.find(outcome => outcome === value) ?? "scheduled";
}

/**
 * Narrow the recorded package-manager list, dropping anything non-string.
 * @param value - Raw value from the report
 * @returns The recorded managers, or an empty list
 */
function toPackageManagers(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

/**
 * Resolve the single path every reader and writer uses.
 * @param root - Project root
 * @returns Absolute path to the report
 */
export function resolveReconciliationReportPath(root: string): string {
  return path.join(root, ".lisa", "reconciliation-report.json");
}

/**
 * Read the report, returning null when it is missing, unparseable, or written
 * by a schema this build does not understand.
 * @param root - Project root
 * @returns The report, or null when there is no usable one
 */
export async function readReconciliationReport(
  root: string
): Promise<ReconciliationReport | null> {
  const parsed = await readJsonOrNull<Partial<ReconciliationReport>>(
    resolveReconciliationReportPath(root)
  );
  if (
    parsed?.schema_version !== RECONCILIATION_REPORT_SCHEMA_VERSION ||
    typeof parsed.lisa_version !== "string" ||
    typeof parsed.scheduled_at !== "string"
  ) {
    return null;
  }
  return {
    schema_version: parsed.schema_version,
    lisa_version: parsed.lisa_version,
    outcome: toOutcome(parsed.outcome),
    scheduled_at: parsed.scheduled_at,
    updated_at:
      typeof parsed.updated_at === "string"
        ? parsed.updated_at
        : parsed.scheduled_at,
    package_managers: toPackageManagers(parsed.package_managers),
    detail: typeof parsed.detail === "string" ? parsed.detail : "",
  };
}

/**
 * Write a report.
 *
 * Written atomically (temp file plus rename) so a reader never sees a partial
 * document, and never throws: a report that could not be written must not turn
 * a successful install into a failed one. That is the same trade the apply
 * receipt makes, and for the same reason — the cost of a missing record is one
 * doctor blind spot, the cost of throwing here is breaking installs.
 * @param root - Project root being reconciled
 * @param report - The record to persist
 * @returns True when the report was persisted
 */
export async function writeReconciliationReport(
  root: string,
  report: ReconciliationReport
): Promise<boolean> {
  const reportPath = resolveReconciliationReportPath(root);
  try {
    await mkdir(path.dirname(reportPath), { recursive: true });
    const tempPath = `${reportPath}.tmp`;
    await writeFile(tempPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    await rename(tempPath, reportPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Record that a reconciliation is about to be spawned.
 *
 * Written by the PARENT apply, before the spawn, precisely so that a spawn which
 * never produces a child still leaves a trace. Without this write there is
 * nothing on disk at all when the trampoline fails to launch, which is one of
 * the two failure modes #2750 could not tell apart.
 * @param root - Project root being reconciled
 * @param lisaVersion - Lisa version running the apply
 * @param now - Clock, injectable for tests
 * @returns True when the report was persisted
 */
export async function recordReconciliationScheduled(
  root: string,
  lisaVersion: string,
  now: () => Date = () => new Date()
): Promise<boolean> {
  const timestamp = now().toISOString();
  return writeReconciliationReport(root, {
    schema_version: RECONCILIATION_REPORT_SCHEMA_VERSION,
    lisa_version: lisaVersion,
    outcome: "scheduled",
    scheduled_at: timestamp,
    updated_at: timestamp,
    package_managers: [],
    detail:
      "Lisa's apply changed package.json and scheduled a detached lockfile " +
      "reconciliation. Nothing has reported back yet.",
  });
}

/**
 * Record that the parent apply could not spawn the reconciliation child.
 * @param root - Project root being reconciled
 * @param lisaVersion - Lisa version running the apply
 * @param message - The spawn error, verbatim
 * @param now - Clock, injectable for tests
 * @returns True when the report was persisted
 */
export async function recordReconciliationSpawnFailure(
  root: string,
  lisaVersion: string,
  message: string,
  now: () => Date = () => new Date()
): Promise<boolean> {
  const timestamp = now().toISOString();
  return writeReconciliationReport(root, {
    schema_version: RECONCILIATION_REPORT_SCHEMA_VERSION,
    lisa_version: lisaVersion,
    outcome: "spawn-failed",
    scheduled_at: timestamp,
    updated_at: timestamp,
    package_managers: [],
    detail: `Could not spawn the lockfile reconciliation: ${message}`,
  });
}
