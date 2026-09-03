/**
 * Vitest Configuration - Coverage include resolution (authority)
 *
 * Decides whether a run's `coverage.include` actually names any source files,
 * because a coverage gate measuring an empty file set reports a number it never
 * measured.
 *
 * THE DEFECT THIS EXISTS FOR (CodySwannGT/lisa#3468). A stack preset's
 * `coverage.include` is written for the layout that stack normally has. Applied
 * to a project laid out differently the globs match nothing, coverage is
 * computed over zero files, and the totals become `0/0`.
 *
 * `0/0` is not a percentage, and vitest says so — the json-summary reporter
 * serializes `"pct":"Unknown"`, a STRING. Every consumer then coerces that
 * non-answer its own way, which is why one defect produced two opposite field
 * reports:
 *
 * - vitest's own threshold check SKIPS `0/0` entirely, so the gate exits 0.
 *   Measured on vitest 4.1.9: two fixtures with identical thresholds of 80 and
 *   an identical passing suite, differing only in whether the include glob
 *   resolved — the unresolved one exited 0 with thresholds never evaluated,
 *   the resolved one at 50% exited 1 naming all three shortfalls.
 * - a reader doing `pct || 0` renders it `0%`, which reads as an urgent
 *   coverage collapse rather than a broken configuration. That is how the
 *   defect was originally reported.
 *
 * Both are the same non-answer wearing different clothes, and the more
 * dangerous of the two is the silent pass.
 *
 * WHY CONFIG TIME, AND NOT A CHECK ON THE REPORT. Downstream, an unresolved
 * include and genuinely uncovered code are indistinguishable in the NUMBER —
 * both read 0. They differ only in the denominator, `0/0` against `n/m`, which
 * survives into the JSON summary but appears in neither the text table nor the
 * threshold verdict. The threshold verdict is the one output the gate consumes.
 * So a report-side check would have to be repeated by every consumer, on a
 * field the primary consumer already ignores. Resolving the globs once, before
 * the run, is the only place the difference is unambiguous.
 *
 * WHAT IT DOES NOT DO. A partial miss is not a failure. Patterns are checked as
 * a UNION: if any one of them matches a file, coverage has a real population
 * and the gate is meaningful, so a preset naming `lib/**` and `util/**` still
 * passes in a project that has only `lib/`. Failing there would break correctly
 * configured consumers to catch nothing. The per-pattern counts are reported
 * inside the failure message, where they say which half was wrong.
 *
 * Exclusions are deliberately not applied. The question asked here is the one
 * the acceptance criteria ask — do the include patterns resolve — and answering
 * a wider question would make the message name patterns that did resolve.
 * @see {@link module:configs/vitest/coverage-include-global-setup} for the hook that acts on this
 * @module configs/vitest/coverage-include-authority
 */
import { globSync } from "node:fs";

/** One include pattern and how many files it matched. */
export interface CoverageIncludeMatch {
  /** The glob exactly as the config declared it. */
  readonly pattern: string;
  /** Number of files the pattern resolved to under the project root. */
  readonly matches: number;
}

/** The parts of a resolved vitest config this module needs. */
export interface CoverageIncludeQuery {
  /** Whether coverage is being collected on this run. */
  readonly enabled: boolean;
  /** `coverage.include` as the resolved config carries it. */
  readonly include?: readonly string[] | undefined;
  /** Directory the patterns resolve against. */
  readonly root: string;
}

/**
 * Resolve each include pattern against the project root.
 *
 * A pattern that cannot be resolved at all counts as zero rather than throwing.
 * An unreadable root is itself a reason the population is empty, and reporting
 * it as "matched nothing" routes it to the same refusal instead of replacing a
 * clear message with a stack trace.
 * @param include - Include globs from the coverage config
 * @param root - Directory the globs resolve against
 * @returns One entry per pattern, in declaration order
 */
export function resolveCoverageInclude(
  include: readonly string[],
  root: string
): readonly CoverageIncludeMatch[] {
  return include.map(pattern => {
    try {
      return { pattern, matches: globSync(pattern, { cwd: root }).length };
    } catch {
      return { pattern, matches: 0 };
    }
  });
}

/**
 * The refusal text, or undefined when the run may proceed.
 *
 * Undefined in three cases, each for its own reason: coverage is not being
 * collected, so there is no measurement to protect; the config names no
 * include, so vitest's own defaults decide the population and this module has
 * no assumption to check; or at least one pattern resolved, so the population
 * is real.
 * @param query - The coverage-relevant slice of the resolved config
 * @returns The refusal message, or undefined when nothing is wrong
 */
export function describeCoverageIncludeFailure(
  query: CoverageIncludeQuery
): string | undefined {
  if (!query.enabled) return undefined;
  const include = query.include ?? [];
  if (include.length === 0) return undefined;

  const resolved = resolveCoverageInclude(include, query.root);
  if (resolved.some(entry => entry.matches > 0)) return undefined;

  const width = Math.max(...resolved.map(entry => entry.pattern.length));
  const listing = resolved
    .map(entry => `  ${entry.pattern.padEnd(width)}  ${entry.matches} files`)
    .join("\n");

  return (
    `coverage.include matched no files under ${query.root}, so coverage ` +
    `would be computed over an empty file set. Every pattern, and what it ` +
    `matched:\n${listing}\n` +
    `An empty include is always a configuration error and never a legitimate ` +
    `state. With 0/0 files the totals are not a percentage — vitest reports ` +
    `"Unknown%" and SKIPS the thresholds, so the coverage gate passes having ` +
    `measured nothing, while any reader that coerces "Unknown" renders it as ` +
    `0% and reads as an urgent coverage collapse. Same non-answer either way.\n` +
    `Point coverage.include at this project's source layout, then run again.`
  );
}
