/** Deterministic persistence for project-local learnings. */
import * as fse from "fs-extra";
import * as path from "node:path";
import { writeFileAtomically } from "../utils/atomic-file-write.js";
import {
  applySupersedeAliases,
  findCallerMintedAliasError,
} from "./learnings-alias.js";
import { type LearningEntry } from "./learnings-contract.js";
import {
  LearningsBudgetError,
  assertDocumentBudget,
  parseLearningsFile,
  renderLearningsFile,
} from "./learnings-document.js";
import { requireIsoDate, validateLearningEntry } from "./learnings-entry.js";
import {
  assertLearningsUnchanged,
  assertSafeLearningParents,
  readExistingLearnings,
  resolveSafeLearningTarget,
} from "./learnings-file-safety.js";
import { withLearningTargetLock } from "./learnings-lock.js";
import { preserveDroppedLearning } from "./learnings-overflow.js";
import {
  planLearningSupersede,
  validateLearningEntryStamps,
  type LearningEntryStamp,
  type StaleSupersedeTarget,
} from "./learnings-supersede.js";
import {
  readProjectConfig,
  resolveProjectLearningsFile,
} from "./project-config.js";

/** Write-time consolidation options for {@link persistConsolidatedLearning}. */
export interface ConsolidatedLearningOptions {
  /** Exact versions of existing entries the new entry merges or replaces. */
  readonly supersede?: readonly LearningEntryStamp[];
  /** Called when any target no longer matches its observed version stamp. */
  readonly onStaleSupersede?: (
    targets: readonly StaleSupersedeTarget[]
  ) => void;
  /**
   * Compatibility diagnostic for targets that are absent (not merely changed).
   * @deprecated Use {@link onStaleSupersede}, which distinguishes both cases.
   */
  readonly onAbsentSupersede?: (ids: readonly string[]) => void;
  /**
   * Called when a `supersedes:` alias reference did not fit inside the entry's
   * provenance cap and was dropped. A reference that is about to stop resolving
   * must never disappear silently; the write still succeeds.
   */
  readonly onAliasesDropped?: (references: readonly string[]) => void;
}

/**
 * Persist one already-selected learning without generating or truncating it.
 * Append-only: a duplicate id always throws. Kept as the stable back-compat
 * entry point; consolidation-aware writers use
 * {@link persistConsolidatedLearning} instead.
 * @param projectRoot - Absolute path to the host project root
 * @param candidate - Untrusted eight-field learning entry
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
 * @param candidate - Untrusted eight-field learning entry
 * @param options - Optional consolidation directives
 * @returns Absolute path to the persisted learnings file
 */
export async function persistConsolidatedLearning(
  projectRoot: string,
  candidate: unknown,
  options: ConsolidatedLearningOptions = {}
): Promise<string> {
  const entry = validateLearningEntry(candidate);
  const mintedAlias = findCallerMintedAliasError(entry);
  if (mintedAlias !== undefined) {
    throw mintedAlias;
  }
  const supersede = validateLearningEntryStamps(options.supersede);
  const config = await readProjectConfig(projectRoot);
  const relativeFile = resolveProjectLearningsFile(config);
  const { root, target } = resolveSafeLearningTarget(projectRoot, relativeFile);
  // Fast budget fail on the lone entry before any directory is created.
  renderNextDocument([], entry);
  await assertSafeLearningParents(root, path.dirname(target));
  await fse.ensureDir(path.dirname(target));
  try {
    return await writeLearningEntriesWithLock(
      { root, target },
      entry,
      supersede,
      options
    );
  } catch (error) {
    if (!(error instanceof LearningsBudgetError)) {
      throw error;
    }
    // The ledger lock is fully released by now — `withLearningTargetLock`
    // releases in a `finally` — so the overflow lock below is taken with no
    // other learnings lock held. The two are never nested.
    return preserveDroppedLearning(projectRoot, entry, error);
  }
}

/**
 * Perform the locked read-validate-write transaction for a learnings update.
 * @param location - Resolved project root and absolute learnings file path
 * @param location.root - Resolved project root
 * @param location.target - Absolute learnings file path
 * @param entry - New validated entry
 * @param supersede - Exact versions of existing entries the new entry replaces
 * @param options - Caller diagnostics for absent targets and dropped aliases
 * @returns Absolute path to the persisted learnings file
 */
function writeLearningEntriesWithLock(
  { root, target }: { readonly root: string; readonly target: string },
  entry: LearningEntry,
  supersede: readonly LearningEntryStamp[],
  options: ConsolidatedLearningOptions
): Promise<string> {
  return withLearningTargetLock(target, async () => {
    await assertSafeLearningParents(root, path.dirname(target));
    const existing = await readExistingLearnings(target);
    const entries = existing === undefined ? [] : parseLearningsFile(existing);
    const plan = planLearningSupersede(entries, entry, supersede);
    const aliased = aliasSupersededEntries(plan.removed, plan.entry, options);
    const rendered = renderNextDocument(plan.retained, aliased);
    if (plan.stale.length > 0) {
      options.onStaleSupersede?.(plan.stale);
      const absent = plan.stale
        .filter(target => target.reason === "absent")
        .map(target => target.expected.id);
      if (absent.length > 0) options.onAbsentSupersede?.(absent);
    }
    await writeFileAtomically(target, rendered, {
      beforeRename: async () => {
        await assertSafeLearningParents(root, path.dirname(target));
        await assertLearningsUnchanged(target, existing);
      },
    });
    return target;
  });
}

/**
 * Record, in the new entry's provenance, which entries this write replaced.
 *
 * Only targets that are genuinely PRESENT contribute an alias. A supersede
 * naming an already-consolidated id removed nothing, so claiming its reference
 * would hijack a pointer the earlier writer legitimately owns — see
 * `learnings-alias.ts` for why that distinction is what keeps the #1995
 * losing-writer guarantee intact.
 *
 * The rewritten entry is pushed back through `validateLearningEntry` rather than
 * spread-and-trusted, so the added references are held to the same schema as any
 * caller-supplied one and the persisted object stays a frozen, exactly-eight-field
 * entry.
 * @param removed - Exact targets this write will remove together
 * @param entry - New validated entry as the caller composed it
 * @param options - Caller diagnostics
 * @returns The entry to persist, carrying its supersede aliases
 */
function aliasSupersededEntries(
  removed: readonly LearningEntry[],
  entry: LearningEntry,
  options: ConsolidatedLearningOptions
): LearningEntry {
  if (removed.length === 0) {
    return entry;
  }
  const aliased = applySupersedeAliases(entry, removed);
  if (aliased.dropped.length > 0) options.onAliasesDropped?.(aliased.dropped);
  return validateLearningEntry({ ...entry, provenance: aliased.provenance });
}

/** Outcome vocabulary for {@link confirmLearningEntry}. */
export type ConfirmLearningStatus = "confirmed" | "unchanged" | "not-found";

/** Structured no-throw outcome of a surgical `last_confirmed` bump. */
export interface ConfirmLearningResult {
  /** What happened: written, already-current no-op, or missing-target no-op. */
  readonly status: ConfirmLearningStatus;
  /** The entry id the caller asked to confirm. */
  readonly id: string;
  /**
   * Absolute learnings file path whenever the file exists — including an
   * in-file `not-found` id — so callers can report a consistent target.
   * Absent only when the learnings file itself does not exist.
   */
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
      return { status: "not-found", id, file: target };
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
    await writeFileAtomically(target, rendered, {
      beforeRename: async () => {
        await assertSafeLearningParents(root, path.dirname(target));
        await assertLearningsUnchanged(target, existing);
      },
    });
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
 * Render and budget-check entries after the locked supersede planner has made
 * the only mutation decision. Keeping this helper plan-free prevents a second
 * stale/exact interpretation from drifting away from the CAS boundary.
 * @param entries - Existing entries retained by the plan
 * @param entry - Planned entry carrying its final stable id
 * @returns Next canonical document
 */
function renderNextDocument(
  entries: readonly LearningEntry[],
  entry: LearningEntry
): string {
  if (entries.some(current => current.id === entry.id)) {
    throw new Error(`Duplicate learning id: ${entry.id}`);
  }
  if (entries.some(current => current.fingerprint === entry.fingerprint)) {
    throw new Error(`Duplicate learning fingerprint: ${entry.fingerprint}`);
  }
  const nextEntries = [...entries, entry].sort((left, right) =>
    left.id.localeCompare(right.id)
  );
  const rendered = renderLearningsFile(nextEntries);
  assertDocumentBudget(rendered, nextEntries.length, "Learnings file");
  return rendered;
}
