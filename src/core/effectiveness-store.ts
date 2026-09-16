/** Durable recurrence identities and disposable, local run observations. */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { lstat, mkdir, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { writeFileAtomically } from "../utils/atomic-file-write.js";
import {
  invariantFingerprint,
  isEvidenceString,
  isEvidenceTime,
  parseEffectiveness,
  summarizeEffectiveness,
  type EffectivenessObservation,
} from "../utils/effectiveness.js";
import { assertSafeLearningParents } from "./learnings-file-safety.js";
import { withFileTargetLock } from "./learnings-lock.js";

export const RECURRENCE_LEDGER = ".lisa/RECURRENCES.jsonl";
export const EFFECTIVENESS_REPORTS = ".lisa/effectiveness";

/** One actual failure following a shipped learning or control. */
export interface FailureRecurrence {
  readonly invariant: string;
  readonly surface: string;
  readonly controlRef: string;
  readonly controlShippedAt: string;
  readonly occurrenceRef: string;
  readonly occurredAt: string;
}

/** Local mirror of an existing accounting row, for disposable status reports. */
export interface EffectivenessRecord {
  readonly entryId: string;
  readonly artifactRef: string;
  readonly effectiveness: EffectivenessObservation;
}

/**
 * Validate evidence before a persistent count can change.
 * @param value - Untrusted recurrence input
 * @returns Normalized recurrence
 */
export function parseRecurrence(value: unknown): FailureRecurrence {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid recurrence");
  const row = value as Record<string, unknown>;
  const fields = [
    "invariant",
    "surface",
    "controlRef",
    "controlShippedAt",
    "occurrenceRef",
    "occurredAt",
  ];
  if (
    Object.keys(row).length !== fields.length ||
    !fields.every(key => isEvidenceString(row[key])) ||
    !isEvidenceTime(row.controlShippedAt) ||
    !isEvidenceTime(row.occurredAt) ||
    Date.parse(row.occurredAt) <= Date.parse(row.controlShippedAt)
  )
    throw new Error("Recurrence requires evidence after the control shipped");
  return {
    invariant: String(row.invariant).trim().replace(/\s+/gu, " ").toLowerCase(),
    surface: String(row.surface),
    controlRef: String(row.controlRef),
    controlShippedAt: row.controlShippedAt,
    occurrenceRef: String(row.occurrenceRef),
    occurredAt: row.occurredAt,
  };
}

/**
 * Shared gardener class identity; the ledger's content-version fingerprint is different.
 * @param row - Normalized recurrence
 * @returns Gardener marker key
 */
export function recurrenceClass(row: FailureRecurrence): string {
  return `${row.surface}+${invariantFingerprint(row.invariant)}`;
}

/**
 * Read union-merged occurrences, idempotently retaining each distinct source event.
 * @param content - Append-only JSONL
 * @returns Deduplicated validated occurrences
 */
export function parseRecurrences(
  content: string
): readonly FailureRecurrence[] {
  const rows = content
    .split("\n")
    .filter(value => value.trim() !== "")
    .map(line => parseRecurrence(JSON.parse(line) as unknown));
  const keyed = rows.map(
    row =>
      [JSON.stringify([recurrenceClass(row), row.occurrenceRef]), row] as const
  );
  const occurrences = new Map(keyed);
  if (
    keyed.some(
      ([key, row]) =>
        JSON.stringify(occurrences.get(key)) !== JSON.stringify(row)
    )
  )
    throw new Error("Conflicting evidence for one recurrence identity");
  return [...occurrences.values()];
}

/**
 * Reject nonregular storage targets and preserve missing versus broken data.
 * @param target - Fixed repository-local target
 * @returns Contents, empty only if absent
 */
async function readStored(target: string): Promise<string> {
  try {
    const metadata = await lstat(target);
    if (!metadata.isFile())
      throw new Error("Effectiveness target must be a regular file");
    return await readFile(target, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw error;
  }
}

/**
 * Resolve a fixed path and confine all parent directories to the project.
 * @param root - Project root
 * @param relative - Fixed storage path
 * @returns Confined absolute target
 */
async function safeTarget(root: string, relative: string): Promise<string> {
  const target = path.resolve(root, relative);
  await assertSafeLearningParents(path.resolve(root), path.dirname(target));
  return target;
}

/**
 * Confirm the repository uses the existing built-in merge driver, including fresh clones.
 * @param root - Project root
 */
function assertUnionMerge(root: string): void {
  const attribute = execFileSync(
    // eslint-disable-next-line sonarjs/no-os-command-from-path -- fixed user-installed git executable
    "git",
    ["check-attr", "-z", "merge", "--", RECURRENCE_LEDGER],
    { cwd: root, encoding: "utf8" }
  );
  if (attribute.split("\0")[2] !== "union")
    throw new Error(
      "Recurrence history requires merge=union; update Lisa's .gitattributes first"
    );
}

/**
 * Append once under the existing cross-process lock; never rewrite prior union rows.
 * @param root - Project root
 * @param value - Observed post-control failure
 * @returns Number of distinct recurrences in this class
 */
export async function recordRecurrence(
  root: string,
  value: unknown
): Promise<number> {
  const row = parseRecurrence(value);
  const target = await safeTarget(root, RECURRENCE_LEDGER);
  assertUnionMerge(root);
  await mkdir(path.dirname(target), { recursive: true });
  return withFileTargetLock(target, async () => {
    await safeTarget(root, RECURRENCE_LEDGER);
    const existing = await readStored(target);
    const combined = `${existing}${existing && !existing.endsWith("\n") ? "\n" : ""}${JSON.stringify(row)}\n`;
    const previous = parseRecurrences(existing);
    const next = parseRecurrences(combined);
    if (next.length !== previous.length)
      await writeFileAtomically(target, combined, {
        beforeRename: async () => {
          await safeTarget(root, RECURRENCE_LEDGER);
          if ((await readStored(target)) !== existing)
            throw new Error(
              "Recurrence history changed during write; retry against the new contents"
            );
        },
      });
    return next.filter(entry => recurrenceClass(entry) === recurrenceClass(row))
      .length;
  });
}

/**
 * Validate an accounting mirror without accepting arbitrary output paths.
 * @param value - Untrusted input
 * @returns Validated accounting mirror
 */
export function parseEffectivenessRecord(value: unknown): EffectivenessRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid effectiveness record");
  const row = value as Record<string, unknown>;
  if (
    Object.keys(row).length !== 3 ||
    !isEvidenceString(row.entryId) ||
    !isEvidenceString(row.artifactRef)
  )
    throw new Error("Effectiveness record requires entryId and artifactRef");
  return {
    entryId: row.entryId,
    artifactRef: row.artifactRef,
    effectiveness: parseEffectiveness(row.effectiveness),
  };
}

/**
 * Mirror observations locally, refusing to generate tracked timing artifacts.
 * @param root - Project root
 * @param value - Correlated accounting row
 */
export async function recordEffectiveness(
  root: string,
  value: unknown
): Promise<void> {
  const row = parseEffectivenessRecord(value);
  const filename = createHash("sha256")
    .update(JSON.stringify([row.artifactRef, row.entryId]))
    .digest("hex");
  const relative = `${EFFECTIVENESS_REPORTS}/${filename}.json`;
  const target = await safeTarget(root, relative);
  // eslint-disable-next-line sonarjs/no-os-command-from-path -- fixed user-installed git executable
  execFileSync("git", ["check-ignore", "-q", "--", relative], { cwd: root });
  await mkdir(path.dirname(target), { recursive: true });
  await withFileTargetLock(target, async () => {
    await readStored(target);
    await writeFileAtomically(target, `${JSON.stringify(row)}\n`, {
      beforeRename: async () => {
        await safeTarget(root, relative);
        await readStored(target);
      },
    });
  });
}

/**
 * Count human events over unique accepted outcomes, exposing incomplete coverage.
 * @param records - Local observations reconstructed from accounting rows
 * @returns Sourced numerator and denominator without a throughput proxy
 */
export function summarizeAttention(records: readonly EffectivenessRecord[]) {
  const accepted = new Set(
    records
      .filter(row => row.effectiveness.acceptedAt !== null)
      .map(row => row.artifactRef)
  );
  const rows = records.filter(row => accepted.has(row.artifactRef));
  const complete =
    rows.length > 0 && rows.every(row => row.effectiveness.attention !== null);
  const events = new Map(
    rows.flatMap(row =>
      (row.effectiveness.attention ?? []).map(
        event => [event.id, event.source] as const
      )
    )
  );
  return {
    acceptedOutcomes: accepted.size,
    observedInterventions: events.size,
    interventionsPerAcceptedOutcome:
      complete && accepted.size > 0 ? events.size / accepted.size : null,
    complete,
    sources: [...new Set(events.values())],
  };
}

/**
 * Read existing reports and durable counts; this operation never writes.
 * @param root - Project root
 * @returns Separate clock, attention, and recurrence observations
 */
export async function readEffectivenessReport(root: string) {
  const target = await safeTarget(root, RECURRENCE_LEDGER);
  const recurrenceRows = parseRecurrences(await readStored(target));
  const reportDirectory = await safeTarget(
    root,
    `${EFFECTIVENESS_REPORTS}/probe`
  );
  const files = await readdir(path.dirname(reportDirectory)).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return [];
      throw error;
    }
  );
  const records = await Promise.all(
    files
      .filter(file => /^[a-f0-9]{64}\.json$/u.test(file))
      .map(async file =>
        parseEffectivenessRecord(
          JSON.parse(
            await readStored(path.join(path.dirname(reportDirectory), file))
          ) as unknown
        )
      )
  );
  return {
    scope:
      "Locally observed outcomes only; reconstruct missing rows from canonical usage entries before claiming queue-wide coverage",
    attention: summarizeAttention(records),
    runs: records.map(row => ({
      entryId: row.entryId,
      artifactRef: row.artifactRef,
      ...summarizeEffectiveness(row.effectiveness),
      lisaVersion: row.effectiveness.lisaVersion,
      workerConfigRevision: row.effectiveness.workerConfigRevision,
    })),
    recurrences: [...new Set(recurrenceRows.map(recurrenceClass))].map(key => ({
      key,
      count: recurrenceRows.filter(row => recurrenceClass(row) === key).length,
      occurrences: recurrenceRows
        .filter(row => recurrenceClass(row) === key)
        .map(row => row.occurrenceRef),
    })),
  };
}
