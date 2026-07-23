/**
 * Durable holding area for learnings the ledger had no budget to accept.
 *
 * ## Why this exists
 *
 * When a judged-durable capture cannot fit the ledger's hard caps, the writer
 * drops it. Before this module the dropped CONTENT survived only in the capture
 * report's text, so once that scrolled away a genuinely valuable learning was
 * gone and the gardener had nothing to drain (CodySwannGT/lisa#1996).
 * CodySwannGT/lisa#1959 raised the byte budget and added the
 * `[lisa-ledger-saturated]` tracker signal — the signal says "saturated"; this
 * file says "and here is exactly what was dropped".
 *
 * ## Why it is git-tracked, in the ledger's own format
 *
 * A learner pass runs on its own `learning/<fingerprint>` branch in its own
 * worktree, and those worktrees are disposable. An untracked, machine-local
 * overflow would be deleted by ordinary worktree cleanup before any gardener
 * saw it — durable in name only, and invisible to a gardener running anywhere
 * else. So the overflow ships to `main` on the same pull request as the capture
 * that produced it.
 *
 * Being tracked means it has the very concurrent-writer problem the ledger just
 * had (CodySwannGT/lisa#1995), which is exactly why it reuses the ledger's
 * canonical document format verbatim: one `.gitattributes` line binds it to the
 * SAME union-by-id merge driver, `parseLearningsFile` gives it the SAME
 * conflict-marker guard, and `checkLearningsBudget` can gate it in CI unchanged.
 * A bespoke format would have needed all of that written a second time.
 *
 * ## Why it carries the same budget
 *
 * The overflow is a hand-off buffer the gardener drains, not an archive. Letting
 * it grow without bound would relocate the very context-bloat problem the
 * contract exists to prevent, and a repository file that only ever grows is its
 * own incident. So it is capped exactly like the ledger, nothing is ever
 * silently evicted from it, and an overflow that is itself full surfaces as a
 * loud failure naming both surfaces.
 *
 * ## Lock discipline
 *
 * The ledger lock and the overflow lock are NEVER held at the same time. The
 * writer's ledger transaction fails and fully releases its lock before
 * {@link preserveDroppedLearning} takes the overflow lock, so the two paths are
 * strictly sequential and the pair cannot deadlock regardless of acquisition
 * order between processes.
 * @module core/learnings-overflow
 */
import * as fse from "fs-extra";
import * as path from "node:path";
import { writeFileAtomically } from "../utils/atomic-file-write.js";
import { type LearningEntry } from "./learnings-contract.js";
import {
  LearningsBudgetError,
  assertDocumentBudget,
  parseLearningsFile,
  renderLearningsFile,
} from "./learnings-document.js";
import {
  assertSafeLearningParents,
  readExistingLearnings,
  resolveSafeLearningTarget,
} from "./learnings-file-safety.js";
import { withFileTargetLock } from "./learnings-lock.js";
import {
  readProjectConfig,
  resolveProjectLearningsFile,
} from "./project-config.js";

/** Suffix distinguishing the overflow from the ledger it belongs to. */
const OVERFLOW_SUFFIX = ".overflow";

/**
 * Derive the overflow path from a project's configured ledger path.
 *
 * Derived rather than separately configurable so a project that relocates its
 * ledger through `learnings.file` cannot end up with the two halves of one
 * mechanism in different directories — and so there is no second config key to
 * validate, contain, and keep in sync.
 * @param learningsFile - Project-relative ledger path
 * @returns Project-relative overflow path
 */
export function resolveLearningsOverflowFile(learningsFile: string): string {
  const extension = path.posix.extname(learningsFile);
  const base = learningsFile.slice(0, learningsFile.length - extension.length);
  return `${base}${OVERFLOW_SUFFIX}${extension}`;
}

/** Resolved overflow location for one project. */
interface OverflowTarget {
  readonly root: string;
  readonly target: string;
}

/**
 * Resolve and contain the overflow target for one project.
 * @param projectRoot - Absolute path to the host project root
 * @returns Resolved project root and absolute overflow path
 */
async function resolveOverflowTarget(
  projectRoot: string
): Promise<OverflowTarget> {
  const config = await readProjectConfig(projectRoot);
  const relative = resolveLearningsOverflowFile(
    resolveProjectLearningsFile(config)
  );
  return resolveSafeLearningTarget(projectRoot, relative);
}

/**
 * Read the entries currently held in the overflow.
 * @param target - Absolute overflow path
 * @returns Validated entries, empty when the file does not exist
 */
async function readOverflowEntries(
  target: string
): Promise<readonly LearningEntry[]> {
  const existing = await readExistingLearnings(target);
  return existing === undefined ? [] : parseLearningsFile(existing);
}

/** Entries currently awaiting drain, and where they live. */
export interface LearningsOverflowContents {
  /** Absolute overflow path, whether or not the file exists yet. */
  readonly file: string;
  /** Validated entries awaiting drain. */
  readonly entries: readonly LearningEntry[];
}

/**
 * Read the overflow without modifying it.
 *
 * An absent file is the common, expected case and reads as empty — a project
 * that has never dropped a capture must not have to special-case its absence.
 * @param projectRoot - Absolute path to the host project root
 * @returns Overflow path and the entries awaiting drain
 */
export async function readLearningsOverflow(
  projectRoot: string
): Promise<LearningsOverflowContents> {
  const { target } = await resolveOverflowTarget(projectRoot);
  return { file: target, entries: await readOverflowEntries(target) };
}

/** Outcome of draining entries the gardener has finished with. */
export interface LearningsOverflowDrain {
  /** Absolute overflow path. */
  readonly file: string;
  /** Ids that were present and have now been removed. */
  readonly drained: readonly string[];
  /** Requested ids that were not in the overflow — reported, never fatal. */
  readonly absent: readonly string[];
  /** How many entries still await drain. */
  readonly remaining: number;
}

/**
 * Remove entries the gardener has durably captured elsewhere.
 *
 * Drain is BY ID and never "empty the file", because the gardener's real
 * sequence is read → file a ticket per entry → drain. Clearing everything up
 * front would lose any entry whose ticket failed to file; removing only the ids
 * that already have a durable home makes a partial run safely resumable.
 *
 * An unknown id is reported rather than thrown, for the same reason an absent
 * supersede target is tolerated: on a re-run, an id another pass already drained
 * is indistinguishable from a bogus one, and failing the drain would strand
 * every other entry in the batch.
 * @param projectRoot - Absolute path to the host project root
 * @param ids - Entry ids to remove
 * @returns Which ids were drained, which were absent, and what remains
 */
export async function drainLearningsOverflow(
  projectRoot: string,
  ids: readonly string[]
): Promise<LearningsOverflowDrain> {
  const requested = new Set(validateOverflowIds(ids));
  const { root, target } = await resolveOverflowTarget(projectRoot);
  await assertSafeLearningParents(root, path.dirname(target));
  return withFileTargetLock(target, async () => {
    // The pre-lock check can go stale while waiting on the lock, so the
    // containment guarantee has to be re-established once the read is
    // actually about to happen. Same discipline as the ledger writer.
    await assertSafeLearningParents(root, path.dirname(target));
    const entries = await readOverflowEntries(target);
    const drained = entries
      .filter(entry => requested.has(entry.id))
      .map(entry => entry.id);
    const retained = entries.filter(entry => !requested.has(entry.id));
    if (drained.length > 0) {
      await publishOverflow(root, target, retained);
    }
    return {
      file: target,
      drained,
      absent: [...requested].filter(id => !drained.includes(id)),
      remaining: retained.length,
    };
  });
}

/**
 * Render, budget-check, and atomically publish the overflow document.
 * @param root - Resolved project root
 * @param target - Absolute overflow path
 * @param entries - Entries the overflow should now hold
 */
async function publishOverflow(
  root: string,
  target: string,
  entries: readonly LearningEntry[]
): Promise<void> {
  const rendered = renderLearningsFile(entries);
  assertDocumentBudget(rendered, entries.length, "Learnings overflow");
  await fse.ensureDir(path.dirname(target));
  await writeFileAtomically(target, rendered, {
    beforeRename: () => assertSafeLearningParents(root, path.dirname(target)),
  });
}

/**
 * Preserve a capture the ledger had no budget for, then re-raise the breach.
 *
 * Never returns normally: the capture genuinely did not land in the ledger, and
 * a caller that treated preservation as success would report a learning as
 * persisted when the projection will never serve it. The re-raised error names
 * the overflow file so the drop is actionable rather than merely fatal.
 *
 * If the overflow is itself full, the original ledger breach is re-raised with
 * both surfaces named. Nothing is evicted to make room — silently discarding an
 * older dropped learning to store a newer one is the exact data loss this whole
 * mechanism exists to prevent.
 * @param projectRoot - Absolute path to the host project root
 * @param entry - The validated entry the ledger rejected
 * @param breach - The budget breach the ledger write raised
 * @returns Never — always throws
 */
export async function preserveDroppedLearning(
  projectRoot: string,
  entry: LearningEntry,
  breach: LearningsBudgetError
): Promise<never> {
  const { root, target } = await resolveOverflowTarget(projectRoot);
  await assertSafeLearningParents(root, path.dirname(target));
  const preserved = await withFileTargetLock(target, async () => {
    // Re-establish containment after the lock wait; see drainLearningsOverflow.
    await assertSafeLearningParents(root, path.dirname(target));
    const entries = await readOverflowEntries(target);
    if (entries.some(current => current.id === entry.id)) {
      return true;
    }
    try {
      await publishOverflow(root, target, [...entries, entry]);
      return true;
    } catch (error) {
      if (error instanceof LearningsBudgetError) {
        return false;
      }
      throw error;
    }
  });
  throw new LearningsBudgetError(
    preserved
      ? `${breach.message} — the capture was preserved in ${target}; drain it with \`lisa learnings-overflow\` (the gardener does this automatically)`
      : `${breach.message} — the overflow at ${target} is full too, so the capture could not be preserved; drain the overflow, then promote or retire a learning`
  );
}

/**
 * Reject malformed drain directives before any filesystem work.
 * @param ids - Caller-supplied (possibly untrusted) entry ids
 * @returns Deduplicated list of validated ids
 */
function validateOverflowIds(ids: readonly string[]): readonly string[] {
  if (
    !Array.isArray(ids) ||
    ids.some(id => typeof id !== "string" || id.trim() === "")
  ) {
    throw new Error(
      "Invalid overflow drain ids: expected non-empty learning id strings"
    );
  }
  return [...new Set(ids)];
}
