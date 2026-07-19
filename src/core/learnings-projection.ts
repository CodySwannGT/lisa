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
  return left.id.localeCompare(right.id);
}

/**
 * Compute the bounded serving projection: the top entries by
 * {@link compareForProjection} accumulated in priority order until the next
 * entry would exceed either the entry-count or the estimated-token budget, at
 * which point accumulation stops (a greedy priority prefix, never skipping a
 * high-priority entry to fit a lower-priority one). Per-entry token cost is the
 * conservative byte-length upper bound of the entry's canonical JSONL rendering,
 * matching how the document itself is serialized.
 * @param entries - Validated learning entries (any order)
 * @returns The served slice and the count of entries it omitted
 */
export function projectLearnings(
  entries: readonly LearningEntry[]
): LearningsProjection {
  const ordered = [...entries].sort(compareForProjection);
  const accumulated = ordered.reduce<ProjectionAccumulator>(
    (accumulator, entry) => {
      if (accumulator.stopped) {
        return accumulator;
      }
      const entryTokens = estimateLearningTokens(JSON.stringify(entry));
      if (
        accumulator.kept.length >= LEARNINGS_CONTRACT.maxEntries ||
        accumulator.tokens + entryTokens > LEARNINGS_CONTRACT.maxTokens
      ) {
        return { ...accumulator, stopped: true };
      }
      return {
        kept: [...accumulator.kept, entry],
        tokens: accumulator.tokens + entryTokens,
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
