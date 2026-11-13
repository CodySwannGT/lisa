/** Deterministic persistence for project-local learnings. */
import * as fse from "fs-extra";
import * as path from "node:path";
import { writeFileAtomically } from "../utils/atomic-file-write.js";
import {
  applySupersedeAliases,
  findCallerMintedAliasError,
} from "./learnings-alias.js";
import {
  LEARNINGS_CONTRACT,
  estimateLearningTokens,
  type LearningEntry,
} from "./learnings-contract.js";
import {
  LEARNINGS_OVER_BUDGET_READ_CEILING,
  LearningsBudgetError,
  assertDocumentBudget,
  isLedgerOverBudget,
  parseLearningsFile,
  renderLearningsFile,
  type LearningsReadOptions,
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
    // Only a supersede can shrink the ledger, so only a supersede may open an
    // over-cap one (CodySwannGT/lisa#4536); a plain append keeps the strict
    // read and its budget refusal routes the capture to the overflow.
    const readPolicy: LearningsReadOptions = {
      allowOverBudget: supersede.length > 0,
    };
    const existing = await readExistingLearnings(target, readPolicy);
    const entries =
      existing === undefined ? [] : parseLearningsFile(existing, readPolicy);
    const plan = planLearningSupersede(entries, entry, supersede);
    // Report stale targets BEFORE rendering: a caller guard that throws from
    // the callback must run before a budget refusal can reach the overflow,
    // so a refused gardening write leaves nothing on disk.
    reportStaleSupersede(plan.stale, options);
    const aliased = aliasSupersededEntries(plan.removed, plan.entry, options);
    const rendered = renderSupersededDocument(plan.retained, aliased, {
      existing,
      existingCount: entries.length,
      removedCount: plan.removed.length,
    });
    await writeFileAtomically(target, rendered, {
      beforeRename: async () => {
        await assertSafeLearningParents(root, path.dirname(target));
        await assertLearningsUnchanged(target, existing, readPolicy);
      },
    });
    return target;
  });
}

/**
 * Tell the caller which supersede targets no longer matched their stamps.
 * @param stale - Stale targets from the locked plan
 * @param options - Caller diagnostics
 */
function reportStaleSupersede(
  stale: readonly StaleSupersedeTarget[],
  options: ConsolidatedLearningOptions
): void {
  if (stale.length === 0) {
    return;
  }
  const absent = stale
    .filter(target => target.reason === "absent")
    .map(target => target.expected.id);
  options.onStaleSupersede?.(stale);
  if (absent.length > 0) options.onAbsentSupersede?.(absent);
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
  const nextEntries = composeNextEntries(entries, entry);
  const rendered = renderLearningsFile(nextEntries);
  assertDocumentBudget(rendered, nextEntries.length, "Learnings file");
  return rendered;
}

/** What the locked transaction knew about the ledger it is rewriting. */
interface SupersedeBaseline {
  /** Ledger bytes read under the lock, if any. */
  readonly existing: string | undefined;
  /** Entry count of the ledger read under the lock. */
  readonly existingCount: number;
  /** How many existing entries the plan removed. */
  readonly removedCount: number;
}

/**
 * Render the planned document, permitting a budget breach only when the
 * existing ledger is already over budget and this write strictly shrinks it.
 *
 * An over-budget ledger used to refuse every writer, including the supersede
 * that would bring it back down (CodySwannGT/lisa#4536). "Over budget" is
 * {@link isLedgerOverBudget} — over the byte cap OR over `maxEntries` — the
 * same definition the retire writer uses. On such a ledger a write is allowed
 * when it removed at least one entry AND either the bytes strictly shrink or,
 * when the breach is by entry count, the count strictly shrinks. A write that
 * does neither — a plain append, or a stale stamp that removes nothing — keeps
 * the budget refusal and its overflow routing. An in-budget ledger is
 * unaffected.
 *
 * Fewer bytes alone is not enough: a non-canonical (padded) ledger re-renders
 * smaller even when an entry is merely appended, so the removal is required —
 * otherwise a stale supersede could push the entry count past `maxEntries`
 * while appearing to shrink. A count-shrinking write may still add bytes, so
 * it is also refused past {@link LEARNINGS_OVER_BUDGET_READ_CEILING}: a ledger
 * beyond the tolerant read ceiling could not be opened by any shrink-only
 * writer again, re-creating the lockout.
 * @param entries - Existing entries retained by the plan
 * @param entry - Planned entry carrying its final stable id
 * @param baseline - What the locked read observed
 * @returns Next canonical document
 */
function renderSupersededDocument(
  entries: readonly LearningEntry[],
  entry: LearningEntry,
  baseline: SupersedeBaseline
): string {
  try {
    return renderNextDocument(entries, entry);
  } catch (error) {
    if (!(error instanceof LearningsBudgetError)) {
      throw error;
    }
    const nextEntries = composeNextEntries(entries, entry);
    const rendered = renderLearningsFile(nextEntries);
    if (permitsOverBudgetShrink(baseline, rendered, nextEntries.length)) {
      return rendered;
    }
    throw error;
  }
}

/**
 * Decide whether a budget-breaching write still repairs an over-budget ledger.
 * @param baseline - What the locked read observed
 * @param baseline.existing - Ledger bytes read under the lock, if any
 * @param baseline.existingCount - Entry count of the ledger read under the lock
 * @param baseline.removedCount - How many existing entries the plan removed
 * @param rendered - Candidate next document
 * @param nextCount - Entry count of the candidate document
 * @returns True when the write removed an entry and strictly shrinks the breach
 */
function permitsOverBudgetShrink(
  { existing, existingCount, removedCount }: SupersedeBaseline,
  rendered: string,
  nextCount: number
): boolean {
  if (existing === undefined || removedCount === 0) {
    return false;
  }
  const existingBytes = estimateLearningTokens(existing);
  if (!isLedgerOverBudget(existingBytes, existingCount)) {
    return false;
  }
  const renderedBytes = estimateLearningTokens(rendered);
  if (renderedBytes > LEARNINGS_OVER_BUDGET_READ_CEILING) {
    return false;
  }
  const countBreach = existingCount > LEARNINGS_CONTRACT.maxEntries;
  return (
    renderedBytes < existingBytes || (countBreach && nextCount < existingCount)
  );
}

/**
 * Add the planned entry to the retained set in stable id order, refusing any
 * identity collision.
 * @param entries - Existing entries retained by the plan
 * @param entry - Planned entry carrying its final stable id
 * @returns Next entries, sorted by id
 */
function composeNextEntries(
  entries: readonly LearningEntry[],
  entry: LearningEntry
): readonly LearningEntry[] {
  if (entries.some(current => current.id === entry.id)) {
    throw new Error(`Duplicate learning id: ${entry.id}`);
  }
  if (entries.some(current => current.fingerprint === entry.fingerprint)) {
    throw new Error(`Duplicate learning fingerprint: ${entry.fingerprint}`);
  }
  return [...entries, entry].sort((left, right) =>
    left.id.localeCompare(right.id)
  );
}
