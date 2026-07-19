/** Deterministic persistence for project-local learnings. */
import * as fse from "fs-extra";
import { rename, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { type LearningEntry } from "./learnings-contract.js";
import {
  assertDocumentBudget,
  parseLearningsFile,
  renderLearningsFile,
} from "./learnings-document.js";
import { requireIsoDate, validateLearningEntry } from "./learnings-entry.js";
import {
  assertSafeLearningParents,
  readExistingLearnings,
  resolveSafeLearningTarget,
} from "./learnings-file-safety.js";
import { withLearningTargetLock } from "./learnings-lock.js";
import {
  readProjectConfig,
  resolveProjectLearningsFile,
} from "./project-config.js";

/** Write-time consolidation options for {@link persistConsolidatedLearning}. */
export interface ConsolidatedLearningOptions {
  /** Ids of existing entries the new entry merges or replaces. */
  readonly supersede?: readonly string[];
}

/**
 * Persist one already-selected learning without generating or truncating it.
 * Append-only: a duplicate id always throws. Kept as the stable back-compat
 * entry point; consolidation-aware writers use
 * {@link persistConsolidatedLearning} instead.
 * @param projectRoot - Absolute path to the host project root
 * @param candidate - Untrusted seven-field learning entry
 * @returns Absolute path to the persisted learnings file
 */
export async function persistLearningEntry(
  projectRoot: string,
  candidate: unknown
): Promise<string> {
  return persistConsolidatedLearning(projectRoot, candidate);
}

/**
 * Persist one learning with mandatory write-time consolidation semantics:
 * entries named in `supersede` are dropped from the document in the same
 * atomic write that adds the new entry, so a related existing entry is merged
 * or replaced instead of gaining a near-duplicate sibling. The rendered
 * document is re-validated against the shared entry and file budgets after
 * consolidation. Without `supersede` this is exactly the append-only
 * {@link persistLearningEntry} behavior, including the duplicate-id throw.
 * @param projectRoot - Absolute path to the host project root
 * @param candidate - Untrusted seven-field learning entry
 * @param options - Optional consolidation directives
 * @returns Absolute path to the persisted learnings file
 */
export async function persistConsolidatedLearning(
  projectRoot: string,
  candidate: unknown,
  options: ConsolidatedLearningOptions = {}
): Promise<string> {
  const entry = validateLearningEntry(candidate);
  const supersede = validateSupersedeIds(options.supersede);
  const config = await readProjectConfig(projectRoot);
  const relativeFile = resolveProjectLearningsFile(config);
  const { root, target } = resolveSafeLearningTarget(projectRoot, relativeFile);
  // Fast budget fail on the lone entry before any directory is created.
  buildNextDocument([], entry, []);
  await assertSafeLearningParents(root, path.dirname(target));
  await fse.ensureDir(path.dirname(target));
  return withLearningTargetLock(target, async () => {
    await assertSafeLearningParents(root, path.dirname(target));
    const existing = await readExistingLearnings(target);
    const entries = existing === undefined ? [] : parseLearningsFile(existing);
    const rendered = buildNextDocument(entries, entry, supersede);
    const temporary = path.join(
      path.dirname(target),
      `.${path.basename(target)}.${process.pid}.${crypto.randomUUID()}.tmp`
    );
    try {
      await writeFile(temporary, rendered, { encoding: "utf8", flag: "wx" });
      await assertSafeLearningParents(root, path.dirname(target));
      await rename(temporary, target);
    } finally {
      await fse.remove(temporary);
    }
    return target;
  });
}

/** Outcome vocabulary for {@link confirmLearningEntry}. */
export type ConfirmLearningStatus = "confirmed" | "unchanged" | "not-found";

/** Structured no-throw outcome of a surgical `last_confirmed` bump. */
export interface ConfirmLearningResult {
  /** What happened: written, already-current no-op, or missing-target no-op. */
  readonly status: ConfirmLearningStatus;
  /** The entry id the caller asked to confirm. */
  readonly id: string;
  /** Absolute learnings file path when the file exists. */
  readonly file?: string;
  /** Previous `last_confirmed` value when the entry was advanced. */
  readonly previous?: string;
}

/**
 * Surgically advance ONLY one entry's `last_confirmed` timestamp — the
 * claim-time "this rule demonstrably applied" confirmation (#1579). Uses the
 * same lock/safety/atomic machinery as the persist writers, but is monotonic
 * and non-blocking by design: a missing file or unknown id returns a
 * structured no-op result instead of throwing, and a date at or before the
 * stored `last_confirmed` never rewrites the file (idempotent within a claim,
 * never regresses). Every other entry field is preserved byte-for-byte; the
 * updated entry is re-validated so the `last_confirmed >= first_learned`
 * invariant and all budgets still hold.
 * @param projectRoot - Absolute path to the host project root
 * @param id - Stable id of the entry to confirm
 * @param date - Confirmation date (real ISO `YYYY-MM-DD`)
 * @returns Structured outcome; never throws for a missing entry or file
 */
export async function confirmLearningEntry(
  projectRoot: string,
  id: string,
  date: string
): Promise<ConfirmLearningResult> {
  if (typeof id !== "string" || id.trim() === "") {
    throw new Error("Invalid learning id: expected a non-empty string");
  }
  const confirmedDate = requireIsoDate(date, "last_confirmed");
  const config = await readProjectConfig(projectRoot);
  const relativeFile = resolveProjectLearningsFile(config);
  const { root, target } = resolveSafeLearningTarget(projectRoot, relativeFile);
  await assertSafeLearningParents(root, path.dirname(target));
  // Probe outside the lock so a missing file creates no directories or locks.
  const probe = await readExistingLearnings(target);
  if (probe === undefined) {
    return { status: "not-found", id };
  }
  return withLearningTargetLock(target, async () => {
    await assertSafeLearningParents(root, path.dirname(target));
    const existing = await readExistingLearnings(target);
    const entries = existing === undefined ? [] : parseLearningsFile(existing);
    const current = entries.find(entry => entry.id === id);
    if (current === undefined) {
      return { status: "not-found", id };
    }
    if (confirmedDate <= current.last_confirmed) {
      return { status: "unchanged", id, file: target };
    }
    const confirmed = validateLearningEntry({
      ...current,
      last_confirmed: confirmedDate,
    });
    const nextEntries = entries.map(entry =>
      entry.id === id ? confirmed : entry
    );
    const rendered = renderConfirmedDocument(nextEntries);
    const temporary = path.join(
      path.dirname(target),
      `.${path.basename(target)}.${process.pid}.${crypto.randomUUID()}.tmp`
    );
    try {
      await writeFile(temporary, rendered, { encoding: "utf8", flag: "wx" });
      await assertSafeLearningParents(root, path.dirname(target));
      await rename(temporary, target);
    } finally {
      await fse.remove(temporary);
    }
    return {
      status: "confirmed",
      id,
      file: target,
      previous: current.last_confirmed,
    };
  });
}

export {
  parseLearningsFile,
  renderLearningsFile,
} from "./learnings-document.js";
export { validateLearningEntry } from "./learnings-entry.js";

/**
 * Render and budget-check the post-confirmation document so the write path
 * stays a pure definitions-then-write sequence.
 * @param entries - Entries with the confirmed entry already substituted
 * @returns Next canonical document
 */
function renderConfirmedDocument(entries: readonly LearningEntry[]): string {
  const rendered = renderLearningsFile(entries);
  assertDocumentBudget(rendered, entries.length, "Learnings file");
  return rendered;
}

/**
 * Build and budget-check the next canonical document, dropping superseded
 * entries before the new entry is added so consolidation and the budget
 * re-assertion happen in one deterministic step.
 * @param entries - Existing validated entries
 * @param entry - New validated entry
 * @param supersede - Ids of existing entries the new entry replaces
 * @returns Next canonical document
 */
function buildNextDocument(
  entries: readonly LearningEntry[],
  entry: LearningEntry,
  supersede: readonly string[]
): string {
  const missing = supersede.filter(
    id => !entries.some(current => current.id === id)
  );
  if (missing.length > 0) {
    throw new Error(
      `Cannot supersede unknown learning id(s): ${missing.join(", ")}`
    );
  }
  const supersededIds = new Set(supersede);
  const retained = entries.filter(current => !supersededIds.has(current.id));
  if (retained.some(current => current.id === entry.id)) {
    throw new Error(`Duplicate learning id: ${entry.id}`);
  }
  const nextEntries = [...retained, entry].sort((left, right) =>
    left.id.localeCompare(right.id)
  );
  const rendered = renderLearningsFile(nextEntries);
  assertDocumentBudget(rendered, nextEntries.length, "Learnings file");
  return rendered;
}

/**
 * Reject malformed supersede directives before any filesystem work.
 * @param supersede - Caller-supplied (possibly untrusted) supersede ids
 * @returns Deduplicated list of validated supersede ids
 */
function validateSupersedeIds(
  supersede: readonly string[] | undefined
): readonly string[] {
  if (supersede === undefined) {
    return [];
  }
  if (
    !Array.isArray(supersede) ||
    supersede.some(id => typeof id !== "string" || id.trim() === "")
  ) {
    throw new Error(
      "Invalid supersede option: expected non-empty learning id strings"
    );
  }
  return [...new Set(supersede)];
}
