/**
 * @file learnings-retire.ts
 * @description Fingerprint-guarded removal of one project-learnings entry
 * @module core/learnings-retire
 */
import * as path from "node:path";
import { writeFileAtomically } from "../utils/atomic-file-write.js";
import {
  MAX_STABLE_TOKEN_BYTES,
  type LearningEntry,
} from "./learnings-contract.js";
import {
  assertDocumentBudget,
  parseLearningsFile,
  renderLearningsFile,
} from "./learnings-document.js";
import {
  assertLearningsUnchanged,
  assertSafeLearningParents,
  readExistingLearnings,
  resolveSafeLearningTarget,
} from "./learnings-file-safety.js";
import { withLearningTargetLock } from "./learnings-lock.js";
import { type StaleSupersedeTarget } from "./learnings-supersede.js";
import {
  readProjectConfig,
  resolveProjectLearningsFile,
} from "./project-config.js";

const STABLE_TOKEN = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
/** The 12-hex invariant hash a `[lisa-gardener] key=ledger:<id>+<hash>` marker carries. */
const GARDENER_MARKER_HASH = /^[0-9a-f]{12}$/;
/** A `learningFingerprint` value, complete or cut short. */
const HASH_FINGERPRINT = /^learning-([0-9a-f]+)$/;
/** Hex digits `learningFingerprint` emits after its `learning-` prefix. */
const HASH_FINGERPRINT_HEX_LENGTH = 20;

/** Outcome vocabulary for {@link retireLearningEntry}. */
export type RetireLearningStatus = "retired" | "stale" | "not-found";

/** Caller diagnostics for {@link retireLearningEntry}. */
export interface RetireLearningOptions {
  /**
   * Called, inside the lock and before returning, when the live entry's
   * fingerprint no longer equals the caller's expected fingerprint. Uses the
   * same report shape as a stale consolidation target so one handler can
   * serve both writers.
   */
  readonly onStale?: (target: StaleSupersedeTarget) => void;
}

/** Structured no-throw outcome of a fingerprint-guarded retirement. */
export interface RetireLearningResult {
  /** Removed, refused because the entry drifted, or nothing to remove. */
  readonly status: RetireLearningStatus;
  /** The entry id the caller asked to retire. */
  readonly id: string;
  /**
   * Absolute learnings file path whenever the file exists. Absent only when
   * the learnings file itself does not exist.
   */
  readonly file?: string;
  /** The full fingerprint the caller observed when it proposed the retire. */
  readonly expectedFingerprint: string;
  /** The live fingerprint, reported only when it refused a `stale` retire. */
  readonly actualFingerprint?: string;
  /** The exact entry removed, present only when `status` is `retired`. */
  readonly retired?: LearningEntry;
}

/**
 * Remove exactly one ledger entry, but only if it is still the version the
 * caller audited (CodySwannGT/lisa#4530).
 *
 * This is a compare-and-swap delete. A gardener RETIRE row is approved some
 * time after it was audited, and in between a learner run may consolidate new
 * lessons into the same id — `persistConsolidatedLearning` keeps the target id
 * while the fingerprint changes. Deleting by id alone would silently discard
 * those merged lessons, so inside the ledger lock this re-reads the live entry
 * and refuses (`stale`, nothing written, `onStale` called) unless its
 * fingerprint equals `expectedFingerprint`. On a match it removes that entry,
 * leaves every other entry byte-identical, re-checks the shared budgets on the
 * rendered document, and writes atomically behind the same unchanged-guard the
 * persist writers use. A missing file or unknown id is a structured
 * `not-found` no-op; a missing file creates no directories or locks.
 * @param projectRoot - Absolute path to the host project root
 * @param id - Stable id of the entry to retire
 * @param expectedFingerprint - The FULL live `entry.fingerprint` observed at
 *   audit time — never the 12-hex gardener marker hash or any prefix of it
 * @param options - Optional stale-target diagnostic
 * @returns Structured outcome; throws only for invalid input, an unsafe or
 *   malformed ledger, or a concurrent write
 */
export async function retireLearningEntry(
  projectRoot: string,
  id: string,
  expectedFingerprint: string,
  options: RetireLearningOptions = {}
): Promise<RetireLearningResult> {
  if (typeof id !== "string" || id.trim() === "") {
    throw new Error("Invalid learning id: expected a non-empty string");
  }
  const fingerprint = requireFullFingerprint(expectedFingerprint);
  const config = await readProjectConfig(projectRoot);
  const relativeFile = resolveProjectLearningsFile(config);
  const { root, target } = resolveSafeLearningTarget(projectRoot, relativeFile);
  await assertSafeLearningParents(root, path.dirname(target));
  // Probe outside the lock so a missing file creates no directories or locks.
  const probe = await readExistingLearnings(target);
  if (probe === undefined) {
    return { status: "not-found", id, expectedFingerprint: fingerprint };
  }
  return withLearningTargetLock(target, async () => {
    await assertSafeLearningParents(root, path.dirname(target));
    const existing = await readExistingLearnings(target);
    const entries = existing === undefined ? [] : parseLearningsFile(existing);
    const current = entries.find(entry => entry.id === id);
    const base = {
      id,
      file: target,
      expectedFingerprint: fingerprint,
    } as const;
    if (current === undefined) {
      return { status: "not-found", ...base };
    }
    if (current.fingerprint !== fingerprint) {
      options.onStale?.({
        expected: { id, fingerprint },
        actualFingerprint: current.fingerprint,
        reason: "fingerprint-mismatch",
      });
      return {
        status: "stale",
        ...base,
        actualFingerprint: current.fingerprint,
      };
    }
    const rendered = renderRetiredDocument(
      entries.filter(entry => entry.id !== id)
    );
    await writeFileAtomically(target, rendered, {
      beforeRename: async () => {
        await assertSafeLearningParents(root, path.dirname(target));
        await assertLearningsUnchanged(target, existing);
      },
    });
    return { status: "retired", ...base, retired: current };
  });
}

/**
 * Reject anything that is not a complete entry fingerprint before any
 * filesystem work. The gardener marker's 12-hex hash and a truncated
 * `learning-<hex>` value are the two plausible caller mistakes: either would
 * only ever produce `stale`, hiding the bug behind a safe-looking refusal.
 * Legacy non-hash fingerprints (a v1 id carried forward) stay valid.
 * @param value - Untrusted expected fingerprint
 * @returns The validated full fingerprint
 */
function requireFullFingerprint(value: unknown): string {
  if (typeof value !== "string" || value === "") {
    throw new Error(
      "Invalid expectedFingerprint: expected the full entry fingerprint string"
    );
  }
  if (
    Buffer.byteLength(value, "utf8") > MAX_STABLE_TOKEN_BYTES ||
    !STABLE_TOKEN.test(value)
  ) {
    throw new Error("Invalid expectedFingerprint: expected a stable token");
  }
  if (GARDENER_MARKER_HASH.test(value)) {
    throw new Error(
      "Invalid expectedFingerprint: this is the 12-hex gardener marker hash, not the entry fingerprint"
    );
  }
  const hex = HASH_FINGERPRINT.exec(value)?.[1];
  if (hex !== undefined && hex.length !== HASH_FINGERPRINT_HEX_LENGTH) {
    throw new Error(
      `Invalid expectedFingerprint: learning-<hex> fingerprints carry exactly ${HASH_FINGERPRINT_HEX_LENGTH} hex digits`
    );
  }
  return value;
}

/**
 * Render and budget-check the post-retirement document through the same path
 * every other writer uses, so a retire can never persist an invalid ledger.
 * @param entries - Entries that remain after the retired one is removed
 * @returns Next canonical document
 */
function renderRetiredDocument(entries: readonly LearningEntry[]): string {
  const rendered = renderLearningsFile(entries);
  assertDocumentBudget(rendered, entries.length, "Learnings file");
  return rendered;
}
