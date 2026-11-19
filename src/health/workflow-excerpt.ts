/**
 * Reduces a workflow file to the lines an agentic Health evaluator needs:
 * gate-control keys, the job each one sits in, and the comments around them.
 * @module health/workflow-excerpt
 */

const WORKFLOW_CONTROL =
  /^\s*(?:skip_jobs|verify_enforced|mutation(?:_gate)?(?:_enabled)?)\s*:/u;
const YAML_COMMENT = /^\s*#/u;
const JOB_IDENTIFIER = /^ {2}[a-zA-Z0-9_-]+:\s*(?:#.*)?$/u;

/** How the scan classifies a line; earlier kinds win, as in the source order of checks. */
type LineKind = "job" | "comment" | "control" | "other";

/**
 * Classify one line.
 * @param line - Raw workflow line
 * @returns The line's kind
 */
function kindOf(line: string): LineKind {
  if (JOB_IDENTIFIER.test(line)) return "job";
  if (YAML_COMMENT.test(line)) return "comment";
  if (WORKFLOW_CONTROL.test(line)) return "control";
  return "other";
}

/**
 * How many entries of an ascending index list are below a bound (binary search).
 * @param sorted - Ascending line indexes
 * @param bound - Exclusive upper bound
 * @param low - Search window start
 * @param high - Search window end (exclusive)
 * @returns The count of entries below `bound`
 */
function countBelow(
  sorted: readonly number[],
  bound: number,
  low = 0,
  high = sorted.length
): number {
  if (low >= high) return low;
  const middle = (low + high) >>> 1;
  return (sorted[middle] ?? bound) < bound
    ? countBelow(sorted, bound, middle + 1, high)
    : countBelow(sorted, bound, low, middle);
}

/**
 * The largest entry below a bound.
 * @param sorted - Ascending line indexes
 * @param bound - Exclusive upper bound
 * @returns The entry, or undefined when none is below
 */
function lastBelow(
  sorted: readonly number[],
  bound: number
): number | undefined {
  return sorted[countBelow(sorted, bound) - 1];
}

/**
 * The smallest entry above a bound.
 * @param sorted - Ascending line indexes
 * @param bound - Exclusive lower bound
 * @returns The entry, or undefined when none is above
 */
function firstAbove(
  sorted: readonly number[],
  bound: number
): number | undefined {
  return sorted[countBelow(sorted, bound + 1)];
}

/**
 * Reduce workflow YAML to controls, the job each control sits in, and the
 * comment blocks directly against a control (above it, or below it until the
 * next non-comment line). Each line is decided from its neighbours by binary
 * search, so the excerpt costs O(n log n) and holds no mutable state.
 * @param source - Workflow file contents
 * @returns Numbered excerpt lines, empty when the workflow has no controls
 */
export function workflowExcerpt(source: string): string {
  const lines = source.split(/\r?\n/u);
  const kinds = lines.map(kindOf);
  const indexesOf = (wanted: (kind: LineKind) => boolean): number[] =>
    kinds.flatMap((kind, index) => (wanted(kind) ? [index] : []));
  const jobs = indexesOf(kind => kind === "job");
  const controls = indexesOf(kind => kind === "control");
  const nonComments = indexesOf(kind => kind !== "comment");
  const ownedJobs = new Set(controls.map(index => lastBelow(jobs, index)));
  const isControl = (index: number | undefined): boolean =>
    index !== undefined && kinds[index] === "control";
  const kept = (kind: LineKind, index: number): boolean => {
    if (kind === "control") return true;
    if (kind === "job") return ownedJobs.has(index);
    if (kind !== "comment") return false;
    return (
      isControl(firstAbove(nonComments, index)) ||
      isControl(lastBelow(nonComments, index))
    );
  };
  return lines
    .flatMap((line, index) =>
      kept(kinds[index] ?? "other", index) ? [`${index + 1}: ${line}`] : []
    )
    .join("\n");
}
