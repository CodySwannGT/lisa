/**
 * Per-file kill counts from a Stryker JSON report, and the assertion that a
 * withheld guard was contributing kills before it was withheld.
 *
 * ## What this is for
 *
 * `mutation-gate-bite` weakens the gate by withholding a guard's suites and
 * requires the score to drop. That proof has a premise it never checked: that
 * the withheld guard was contributing kills in the first place. If a guard's
 * coverage ever became entirely invisible to the gate — which is exactly the
 * failure `vitest.config.mutation.ts` exists because of, a suite dropping out
 * of the module graph — withholding its suites would remove nothing, the two
 * runs would score the same, and the bite test would report that as *the gate
 * failing to bite* when the truth is that it never had anything to bite with
 * (CodySwannGT/lisa#2992).
 *
 * The premise does obtain today. Measured across all four withheld guards
 * (CodySwannGT/lisa#2936, four scoped runs of the committed configuration):
 * `lisa-work-item.mjs` 1,113 kills, `lisa-gates.mjs` 787, `lisa-mutation.mjs`
 * 389, `lisa-destructive-guard.mjs` 147. So this guards a future state rather
 * than a present one, which is the direction a bite test should be wrong in.
 *
 * ## Why the JSON reporter and not the clear-text table
 *
 * The clear-text reporter renders a **directory tree**, not a flat list. A
 * ten-file `mutate` list produces rows indented by directory depth with the
 * path split across them, directory rows carrying the same columns as file
 * rows, a header spanning two lines, and a left column whose width moves with
 * the longest path component (measured in CodySwannGT/lisa#2992). A text
 * parser for that is a second thing to keep in step with a tool.
 *
 * The JSON report is keyed by the **repo-relative path of the mutated file**,
 * which is the same string `stryker.conf.json`'s `mutate` list uses, so no path
 * reconstruction is needed at all.
 *
 * And reading per-case `covered N` lines instead would need `logTests: true`,
 * which is precisely what put the weakened run's output past Node's 1 MiB
 * `maxBuffer` (CodySwannGT/lisa#2943, CodySwannGT/lisa#2944). The JSON reporter
 * writes to a **file**, so it adds one line to the captured stdout and cannot
 * re-arm that trap.
 *
 * ## Every "no data" path FAILS
 *
 * A missing report, an unparseable one, one with no `files`, a file entry with
 * no `mutants`, or a guard absent from the report all raise. That is the whole
 * point of the ticket: a contribution check that shrugged when it could not
 * measure would be a second inert guard added while fixing the first.
 *
 * ## `Killed` only, and `Timeout` deliberately not counted
 *
 * The acceptance criterion names the reporter's `# killed` column, and that
 * column counts `Killed` alone — `# timeout` is a separate column. Stryker
 * scores a timed-out mutant AS killed, so counting `Timeout` here would be
 * defensible; it is not counted because the stricter reading can only fail
 * where the looser one passes, and a bite test that fails loudly and gets
 * looked at is the safe direction. {@link killCounts} returns the timeout count
 * alongside so a failure message can say when that is what happened.
 * @module tests/helpers/mutation-kill-counts
 */
import * as fs from "node:fs";

/** How Stryker spells a mutant a test killed. Matches the `# killed` column. */
const KILLED = "Killed";

/** How Stryker spells a mutant killed by the clock. The `# timeout` column. */
const TIMEOUT = "Timeout";

/** What one mutated file contributed to a run. */
export interface FileKillCounts {
  /** Mutants with status `Killed` — the reporter's `# killed` column. */
  readonly killed: number;
  /** Mutants with status `Timeout`, reported but never counted as kills. */
  readonly timeout: number;
  /** Every mutant the report holds for the file, whatever its status. */
  readonly total: number;
}

/** The shape of a Stryker JSON report this module reads, and only that. */
interface RawReport {
  readonly files?: Readonly<
    Record<
      string,
      { readonly mutants?: readonly { readonly status?: string }[] }
    >
  >;
}

/**
 * Read a Stryker JSON report from disk.
 *
 * Separate from {@link killCounts} so that the parse can be exercised against a
 * transcribed real report without a filesystem, and so that a missing file
 * reports as a missing file rather than as a parse failure.
 * @param reportPath - Absolute path the run's `jsonReporter.fileName` named
 * @param arm - Which run it was, for the failure text
 * @returns The report's raw JSON text
 */
export const readReport = (reportPath: string, arm: string): string => {
  if (!fs.existsSync(reportPath))
    throw new Error(
      `the ${arm} run wrote no JSON report at ${reportPath}, so there is no per-file kill data to check; the run measured nothing rather than measuring zero`
    );
  return fs.readFileSync(reportPath, "utf8");
};

/**
 * Per-file kill counts from a Stryker JSON report.
 * @param raw - The report's JSON text
 * @param arm - Which run it was, for the failure text
 * @returns Counts keyed by the repo-relative path of each mutated file
 */
export const killCounts = (
  raw: string,
  arm: string
): ReadonlyMap<string, FileKillCounts> => {
  const parsed: unknown = parseOrThrow(raw, arm);
  const files = (parsed as RawReport).files;
  if (files === undefined || files === null || typeof files !== "object")
    throw new Error(
      `the ${arm} run's JSON report has no "files" object, so no per-file kill count can be read from it`
    );
  const entries = Object.entries(files);
  if (entries.length === 0)
    throw new Error(
      `the ${arm} run's JSON report names zero mutated files, so it measured nothing; a report with no files is not a report of no kills`
    );
  return new Map(
    entries.map(([file, result]) => [file, countOne(file, result, arm)])
  );
};

/**
 * Parse the report text, naming a syntax failure as one.
 * @param raw - The report's JSON text
 * @param arm - Which run it was, for the failure text
 * @returns The parsed value, untyped
 */
const parseOrThrow = (raw: string, arm: string): unknown => {
  try {
    return JSON.parse(raw) as unknown;
  } catch (error) {
    throw new Error(
      `the ${arm} run's JSON report could not be parsed (${(error as Error).message}); a report that cannot be read is not a report of no kills`
    );
  }
};

/**
 * Count one file's mutants by status.
 * @param file - The repo-relative path the report keyed it under
 * @param result - The report's entry for that file
 * @param arm - Which run it was, for the failure text
 * @returns That file's counts
 */
const countOne = (
  file: string,
  result:
    | { readonly mutants?: readonly { readonly status?: string }[] }
    | undefined,
  arm: string
): FileKillCounts => {
  const mutants = result?.mutants;
  if (!Array.isArray(mutants))
    throw new Error(
      `the ${arm} run's JSON report has no mutants array for ${file}, so its contribution is unmeasured rather than zero`
    );
  return {
    killed: mutants.filter(mutant => mutant.status === KILLED).length,
    timeout: mutants.filter(mutant => mutant.status === TIMEOUT).length,
    total: mutants.length,
  };
};

/**
 * Require that every named guard contributed kills to the run being read.
 *
 * A guard absent from the report is a failure, not a zero: it means the run
 * never mutated it, so nothing about its contribution was measured. A guard
 * present with zero kills is the failure the ticket describes — withholding its
 * suites would remove nothing, and the weakened run scoring the same as the
 * intact one would then be read as the gate failing to bite.
 * @param counts - Per-file counts from {@link killCounts}
 * @param guards - The guards whose suites the weakened arm withholds
 * @param arm - Which run it was, for the failure text
 */
export const assertGuardsContributedKills = (
  counts: ReadonlyMap<string, FileKillCounts>,
  guards: readonly string[],
  arm: string
): void => {
  if (guards.length === 0)
    throw new Error(
      `no guards were named to check against the ${arm} run, so the contribution check would pass vacuously`
    );
  for (const guard of guards) {
    const found = counts.get(guard);
    if (found === undefined)
      throw new Error(
        `${guard} is withheld to weaken the gate but the ${arm} run's JSON report does not mutate it (it names ${counts.size}: ${[...counts.keys()].join(", ")}), so its contribution is unmeasured`
      );
    if (found.killed === 0)
      throw new Error(
        `${guard} killed 0 of its ${found.total} mutants in the ${arm} run (${found.timeout} timed out, which this check does not count as kills), so withholding its suites removes nothing and the comparison between the two runs proves nothing about the gate`
      );
  }
};
