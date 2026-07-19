/**
 * Bounded serving projection over validated project-learnings entries.
 *
 * The ledger lives cold on disk at `.lisa/PROJECT_LEARNINGS.md` and is never
 * raw-injected into any agent session. Consumers request a *projection* — the
 * highest-priority slice that fits inside the shared token/entry budget — so a
 * ledger that grows past what any session should carry still yields a bounded,
 * deterministic view. This module is pure: it never touches disk and never
 * mutates the caller's array.
 * @module learnings-projection
 */
import {
  LEARNINGS_CONTRACT,
  estimateLearningTokens,
  type LearningConfidence,
  type LearningEntry,
} from "./learnings-contract.js";
import { renderLearningsFile } from "./learnings-document.js";

/** The bounded slice the contract serves, plus how many entries it dropped. */
export interface LearningsProjection {
  /** Highest-priority entries that fit the budget, in serving order. */
  readonly entries: readonly LearningEntry[];
  /** How many validated entries were left out of the served slice. */
  readonly omittedCount: number;
}

/** Serving priority of each confidence level (higher wins). */
const CONFIDENCE_RANK: Readonly<Record<LearningConfidence, number>> =
  Object.freeze({
    high: 3,
    medium: 2,
    low: 1,
  });

/**
 * Byte cost of the canonical document wrapper — the header, the JSONL code
 * fences, and their separators — measured once from an empty render. The serving
 * slice must fit inside the same budget the on-disk document is checked against,
 * so this fixed overhead is subtracted from `maxTokens` before entries are
 * accumulated. Deterministic: `renderLearningsFile([])` has no entry bytes.
 */
const DOCUMENT_WRAPPER_TOKENS = estimateLearningTokens(renderLearningsFile([]));

/** Byte cost of the single `\n` that joins one rendered entry to the previous. */
const ENTRY_SEPARATOR_TOKENS = estimateLearningTokens("\n");

/** Running state threaded through the greedy budget accumulation. */
interface ProjectionAccumulator {
  readonly kept: readonly LearningEntry[];
  readonly tokens: number;
  readonly stopped: boolean;
}

/**
 * Order two entries by serving priority: confidence descending
 * (`high` > `medium` > `low`), then `last_confirmed` descending (ISO dates sort
 * lexicographically), then `id` ascending as a stable tiebreak.
 * @param left - First entry
 * @param right - Second entry
 * @returns Negative when `left` sorts first, positive when `right` does
 */
function compareForProjection(
  left: LearningEntry,
  right: LearningEntry
): number {
  const byConfidence =
    CONFIDENCE_RANK[right.confidence] - CONFIDENCE_RANK[left.confidence];
  if (byConfidence !== 0) {
    return byConfidence;
  }
  if (left.last_confirmed !== right.last_confirmed) {
    return left.last_confirmed < right.last_confirmed ? 1 : -1;
  }
  // Codepoint comparison (not localeCompare) so the tiebreak is deterministic
  // and locale-independent across every runtime that serves the projection.
  if (left.id === right.id) {
    return 0;
  }
  return left.id < right.id ? -1 : 1;
}

/**
 * Compute the bounded serving projection: the top entries by
 * {@link compareForProjection} accumulated in priority order until the next
 * entry would exceed either the entry-count or the token budget, at which point
 * accumulation stops (a greedy priority prefix, never skipping a high-priority
 * entry to fit a lower-priority one).
 *
 * Token accounting mirrors the on-disk document exactly: the fixed document
 * wrapper ({@link DOCUMENT_WRAPPER_TOKENS} — header + JSONL fences) is subtracted
 * from `maxTokens` once, and each entry costs the byte length of its canonical
 * `JSON.stringify` rendering plus, for every entry after the first, the single
 * `\n` that joins it to the previous line. So `kept.tokens + wrapper` equals the
 * byte length of `renderLearningsFile(projection.entries)`, the same quantity the
 * budget gate measures.
 * @param entries - Validated learning entries (any order)
 * @returns The served slice and the count of entries it omitted
 */
export function projectLearnings(
  entries: readonly LearningEntry[]
): LearningsProjection {
  const ordered = [...entries].sort(compareForProjection);
  const entryBudget = LEARNINGS_CONTRACT.maxTokens - DOCUMENT_WRAPPER_TOKENS;
  const accumulated = ordered.reduce<ProjectionAccumulator>(
    (accumulator, entry) => {
      if (accumulator.stopped) {
        return accumulator;
      }
      const separator =
        accumulator.kept.length === 0 ? 0 : ENTRY_SEPARATOR_TOKENS;
      const incremental =
        separator + estimateLearningTokens(JSON.stringify(entry));
      if (
        accumulator.kept.length >= LEARNINGS_CONTRACT.maxEntries ||
        accumulator.tokens + incremental > entryBudget
      ) {
        return { ...accumulator, stopped: true };
      }
      return {
        kept: [...accumulator.kept, entry],
        tokens: accumulator.tokens + incremental,
        stopped: false,
      };
    },
    { kept: [], tokens: 0, stopped: false }
  );
  return {
    entries: accumulated.kept,
    omittedCount: entries.length - accumulated.kept.length,
  };
}
