/**
 * Fingerprint-guarded, shrink-only removal of one project learning
 * (CodySwannGT/lisa#4536).
 *
 * The ledger had no supported way to get smaller: supersede always appends a
 * replacement, the overflow drain only touches the overflow, and the gardener's
 * RETIRE verdict named no tool. Worse, once a ledger slipped over `maxTokens`
 * no writer could even open it. This writer opens an over-cap ledger through
 * the bounded tolerant read, removes exactly the entry the caller stamped, and
 * publishes through the same lock, containment checks, and compare-and-swap
 * atomic write as every other ledger writer.
 *
 * It fails closed. An unknown id or a stale fingerprint returns a structured
 * outcome and writes NOTHING — neither the ledger nor the overflow file — so a
 * gardening script that tried a retire which did not apply can abort with the
 * disk exactly as it found it.
 * @module core/learnings-retire
 */
import * as path from "node:path";
import { writeFileAtomically } from "../utils/atomic-file-write.js";
import {
  LEARNINGS_CONTRACT,
  estimateLearningTokens,
  type LearningEntry,
} from "./learnings-contract.js";
import {
  parseLearningsFile,
  renderLearningsFile,
  type LearningsReadOptions,
} from "./learnings-document.js";
import {
  assertLearningsUnchanged,
  assertSafeLearningParents,
  readExistingLearnings,
  resolveSafeLearningTarget,
} from "./learnings-file-safety.js";
import { withLearningTargetLock } from "./learnings-lock.js";
import {
  validateLearningEntryStamps,
  type LearningEntryStamp,
} from "./learnings-supersede.js";
import {
  readProjectConfig,
  resolveProjectLearningsFile,
} from "./project-config.js";

/** Shrink-only writers may open a ledger that is already over the cap. */
const RETIRE_READ_POLICY: LearningsReadOptions = { allowOverBudget: true };

/** The stamped entry was removed. */
export interface RetiredLearningResult {
  readonly status: "retired";
  /** Id of the removed entry. */
  readonly id: string;
  /** Absolute learnings file path that was rewritten. */
  readonly file: string;
  /** The exact entry that was removed, for the caller's proof record. */
  readonly retired: LearningEntry;
  /** Caller-supplied reason, echoed for the proof record. */
  readonly reason: string;
  /** Ledger size before the retire. */
  readonly bytesBefore: number;
  /** Ledger size after the retire; always smaller than `bytesBefore`. */
  readonly bytesAfter: number;
  /** Whether the rewritten ledger is within its hard entry and byte budget. */
  readonly withinBudget: boolean;
}

/** The id exists but now names different content; nothing was written. */
export interface StaleRetireResult {
  readonly status: "stale";
  readonly id: string;
  readonly file: string;
  /** Fingerprint the caller observed. */
  readonly expectedFingerprint: string;
  /** Fingerprint currently stored at that id. */
  readonly actualFingerprint: string;
}

/** No entry has that id (or the ledger is absent); nothing was written. */
export interface NotFoundRetireResult {
  readonly status: "not-found";
  readonly id: string;
  /** Absolute learnings path; absent only when the ledger does not exist. */
  readonly file?: string;
}

/** Structured outcome of {@link retireLearningEntry}. */
export type RetireLearningResult =
  | RetiredLearningResult
  | StaleRetireResult
  | NotFoundRetireResult;

/**
 * Remove exactly one stamped entry from the project learnings ledger.
 * @param projectRoot - Absolute path to the host project root
 * @param stamp - Exact `{id, fingerprint}` the caller observed
 * @param reason - Non-empty, human-readable reason for the retirement
 * @returns Structured outcome; a stale or unknown stamp writes nothing
 */
export async function retireLearningEntry(
  projectRoot: string,
  stamp: LearningEntryStamp,
  reason: string
): Promise<RetireLearningResult> {
  const [expected] = validateLearningEntryStamps([stamp]);
  if (expected === undefined) {
    throw new Error("Invalid retire stamp: expected exactly {id, fingerprint}");
  }
  if (typeof reason !== "string" || reason.trim() === "") {
    throw new Error("Invalid retire reason: expected a non-empty string");
  }
  const config = await readProjectConfig(projectRoot);
  const relativeFile = resolveProjectLearningsFile(config);
  const { root, target } = resolveSafeLearningTarget(projectRoot, relativeFile);
  await assertSafeLearningParents(root, path.dirname(target));
  // Probe outside the lock so a missing ledger creates no directories or locks.
  if ((await readExistingLearnings(target, RETIRE_READ_POLICY)) === undefined) {
    return { status: "not-found", id: expected.id };
  }
  return withLearningTargetLock(target, () =>
    retireUnderLock({ root, target }, expected, reason)
  );
}

/**
 * The locked read-decide-write transaction behind {@link retireLearningEntry}.
 * @param location - Resolved project root and absolute learnings file path
 * @param location.root - Resolved project root
 * @param location.target - Absolute learnings file path
 * @param expected - Validated caller stamp
 * @param reason - Validated retirement reason
 * @returns Structured outcome
 */
async function retireUnderLock(
  { root, target }: { readonly root: string; readonly target: string },
  expected: LearningEntryStamp,
  reason: string
): Promise<RetireLearningResult> {
  await assertSafeLearningParents(root, path.dirname(target));
  const existing = await readExistingLearnings(target, RETIRE_READ_POLICY);
  if (existing === undefined) {
    return { status: "not-found", id: expected.id };
  }
  const entries = parseLearningsFile(existing, RETIRE_READ_POLICY);
  const retired = entries.find(entry => entry.id === expected.id);
  if (retired === undefined) {
    return { status: "not-found", id: expected.id, file: target };
  }
  if (retired.fingerprint !== expected.fingerprint) {
    return {
      status: "stale",
      id: expected.id,
      file: target,
      expectedFingerprint: expected.fingerprint,
      actualFingerprint: retired.fingerprint,
    };
  }
  const remaining = entries.filter(entry => entry.id !== expected.id);
  const rendered = renderShrunkDocument(existing, remaining);
  await writeFileAtomically(target, rendered, {
    beforeRename: async () => {
      await assertSafeLearningParents(root, path.dirname(target));
      await assertLearningsUnchanged(target, existing, RETIRE_READ_POLICY);
    },
  });
  return {
    status: "retired",
    id: expected.id,
    file: target,
    retired,
    reason,
    bytesBefore: estimateLearningTokens(existing),
    bytesAfter: estimateLearningTokens(rendered),
    withinBudget: isWithinBudget(rendered, remaining.length),
  };
}

/**
 * Render the post-retire document and prove it is strictly smaller.
 *
 * Shrinking is the whole authority this writer has to open an over-cap ledger,
 * so it is asserted rather than assumed: a v1 source migrating to v2 gains a
 * fingerprint field per entry and could, in principle, grow despite losing one.
 * @param existing - Ledger bytes read under the lock
 * @param remaining - Entries left after removing the stamped one
 * @returns Next canonical document
 */
function renderShrunkDocument(
  existing: string,
  remaining: readonly LearningEntry[]
): string {
  const rendered = renderLearningsFile(remaining);
  if (estimateLearningTokens(rendered) >= estimateLearningTokens(existing)) {
    throw new Error(
      "Refusing to retire: the rewritten ledger would not be smaller than the current one. Nothing was written."
    );
  }
  return rendered;
}

/**
 * Report whether a document fits the hard entry-count and byte budget.
 * @param rendered - Canonical document
 * @param entryCount - Number of entries in it
 * @returns True when both budgets hold
 */
function isWithinBudget(rendered: string, entryCount: number): boolean {
  return (
    entryCount <= LEARNINGS_CONTRACT.maxEntries &&
    estimateLearningTokens(rendered) <= LEARNINGS_CONTRACT.maxTokens
  );
}
