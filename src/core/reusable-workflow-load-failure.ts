/**
 * Distinguish a reusable workflow that failed to LOAD from one that failed to
 * RUN (CodySwannGT/lisa#3581).
 *
 * When an upstream commit makes a reusable workflow unparseable, GitHub
 * rejects the file before creating any job. The run has zero jobs, no
 * annotation naming the offending line, and a display `name` that degrades to
 * its `path` because GitHub never got as far as reading the `name:` key.
 * Nothing that watches for a failing JOB can see it — there is no red job to
 * open. Sibling module `core/reusable-workflow-pin` records the same failure
 * from the other end: "Actions creates zero jobs, so a required check is
 * ABSENT rather than red."
 *
 * ## Which moment this is open at
 *
 * On a pull request the exposure is CLOSED, and by something that already
 * exists: `check-skipped-required-checks --pr=<n>` raises
 * `absent_required_check` for a ruleset-required context that posted no
 * check-run at all, and a required context that never reports blocks the
 * merge regardless. Off a pull request — a `push` or `schedule` handler — no
 * arm looks. That is where the incident behind this ticket happened: a
 * consumer's handler failed five times in a row before anyone noticed, ~40
 * minutes after the upstream commit landed, with nothing changed on the
 * consumer side. So the gap is not that detection was never built; it is that
 * detection exists at exactly one moment and the failure occurs at every
 * moment.
 *
 * ## The one arm that discriminates, and the three that do not
 *
 * `referenced_workflows` on `GET /repos/{owner}/{repo}/actions/runs/{id}`
 * carries the resolved SHA of every reusable workflow a run actually used. A
 * caller that DECLARED one and RESOLVED ZERO did not parse; there is no other
 * way to reach that state.
 *
 * It is only meaningful INSIDE its population — runs whose caller declares a
 * reusable workflow at all. Measured on one consumer, 19 failing runs in a
 * day: the 5 in population all resolved at least one; the 14 outside it all
 * resolved zero. Read bare, the field reports 14 false positives out of 19.
 *
 * Three cheaper signals are each refuted by a measured run:
 *
 *  - `conclusion == "failure"` — six failures in that window, four load
 *    failures.
 *  - `jobs == 0` — one run IN the population resolved its workflow and still
 *    produced zero jobs, so an empty run is not the signature.
 *  - `name == path` — a display coincidence. Any workflow that omits `name:`
 *    satisfies it while perfectly healthy, so it corroborates and never
 *    decides.
 *
 * ## The false-red this must not become
 *
 * A dead runner produces a nearly identical run: `conclusion: failure`, no
 * useful output, nothing to open. The difference is structural and total —
 * **a load failure has NO JOBS AT ALL; a dead runner has JOBS THAT EXIST AND
 * ARE EMPTY.** Collapsing them would report every runner outage as a Lisa
 * regression. A skipped or cancelled run is excluded for the same reason: it
 * never intended to resolve anything, so calling it a load failure would be a
 * control that can only manufacture a red.
 * @module core/reusable-workflow-load-failure
 */

/**
 * A job-level `uses:` naming a reusable workflow in another repository.
 *
 * The path shape is what discriminates, not a roster of known callers: a
 * reusable workflow is always `<owner>/<repo>/.github/workflows/<file>@<ref>`.
 * A step action is `<owner>/<repo>@<ref>` with no path, so `actions/checkout@v6`
 * cannot match — which matters, because reading step actions as declarations
 * is exactly what produced 14 false positives out of 19.
 */
const CROSS_REPO_USES =
  /^[ \t]*uses:[ \t]*["']?[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+\/\.github\/workflows\/[A-Za-z0-9._-]+\.ya?ml@[^\s"'#]+/u;

/**
 * A job-level `uses:` naming a reusable workflow in the caller's own
 * repository.
 *
 * Unlike the cross-repo arm this one is NOT backed by a measured run — the
 * ticket's evidence is all cross-repo. It is included because the path shape
 * is unambiguous and excluding it would leave local reusable workflows
 * undetectable, but if this detector ever reports a false positive, this is
 * the first line to suspect.
 */
const LOCAL_USES =
  /^[ \t]*uses:[ \t]*["']?\.\/\.github\/workflows\/[A-Za-z0-9._-]+\.ya?ml/u;

/** Whether a line is entirely a YAML comment. */
const COMMENT_LINE = /^\s*#/u;

/**
 * Conclusions that can be reached before a single job is created.
 *
 * `startup_failure` is GitHub's own name for this class and is the conclusion
 * a load failure most often carries; `failure` is what the runs measured for
 * this ticket carried. Anything else — `success`, `cancelled`, `neutral` — is
 * never a load failure, and treating it as one is how a detector starts
 * inventing reds.
 */
const PRE_JOB_FAILURES: readonly string[] = ["failure", "startup_failure"];

/** How a run's relationship to reusable-workflow loading was resolved. */
export type RunLoadClass =
  /** In population, declared a reusable workflow, resolved none. */
  | "load-failure"
  /** Jobs exist but are empty — a runner problem, not a parse problem. */
  | "dead-runner"
  /** Resolved at least one reusable workflow; it loaded. */
  | "resolved"
  /** The caller declares no reusable workflow, so the field says nothing. */
  | "out-of-population"
  /** Never intended to resolve anything. */
  | "skipped"
  /** Terminated without running and without failing. */
  | "inconclusive"
  /** Not finished; asking yet would read an unfinished field. */
  | "in-flight";

/** The four run facts this classification needs. */
export interface RunLoadFacts {
  /** Whether the caller workflow declares a reusable workflow at all. */
  readonly inPopulation: boolean;
  /** Length of the run's `referenced_workflows` array. */
  readonly referencedCount: number;
  /** Number of jobs the run created. */
  readonly jobCount: number;
  /** The run's `conclusion`, or null while it is still in flight. */
  readonly conclusion: string | null;
}

/**
 * Whether a caller workflow declares any reusable workflow.
 *
 * This is the population gate, and it is DERIVED from the caller's own source
 * rather than read from a roster. There is deliberately no list of known
 * callers or known upstream repositories anywhere in this module: a roster
 * would silently exclude every caller nobody remembered to add, which is the
 * failure mode this codebase already has a ticket for one level up.
 * @param source - Full text of a caller's workflow file
 * @returns True when at least one non-comment line calls a reusable workflow
 */
export function callerDeclaresReusableWorkflow(source: string): boolean {
  return source
    .split("\n")
    .some(
      line =>
        !COMMENT_LINE.test(line) &&
        (CROSS_REPO_USES.test(line) || LOCAL_USES.test(line))
    );
}

/**
 * Classify what a finished run says about reusable-workflow loading.
 *
 * The order of these tests is the whole design, so it is worth stating: a run
 * that RESOLVED something is settled before the population gate is consulted,
 * because resolution is direct evidence that loading worked and the gate is
 * only a heuristic about whether the field can speak. That way an
 * under-detecting population gate can never manufacture a load-failure
 * verdict — it can only cause one to be missed, which is the direction a
 * detector should fail in.
 * @param facts - The four run facts
 * @returns The single class this run belongs to
 */
export function classifyRunLoad(facts: RunLoadFacts): RunLoadClass {
  const { inPopulation, referencedCount, jobCount, conclusion } = facts;

  if (conclusion === null) return "in-flight";
  if (conclusion === "skipped") return "skipped";
  // Resolution outranks the population gate: see the note above.
  if (referencedCount > 0) return "resolved";
  if (!inPopulation) return "out-of-population";
  // Jobs that exist and are empty are a dead runner, not a parse failure.
  if (jobCount > 0) return "dead-runner";
  if (!PRE_JOB_FAILURES.includes(conclusion)) return "inconclusive";
  return "load-failure";
}

/** How far back a page set actually read. */
export interface WindowScan {
  /** Timestamp of the oldest run read, or null when none was read. */
  readonly oldestSeen: string | null;
  /** Timestamp the caller intended to cover back to. */
  readonly windowStart: string;
  /** Whether paging stopped because the history ran out. */
  readonly exhausted: boolean;
}

/** Whether a scan covered its window, and why not when it did not. */
export interface WindowVerdict {
  /** True only when every run in the window was actually read. */
  readonly covered: boolean;
  /** Operator-readable reason, empty when covered. */
  readonly reason: string;
}

/**
 * Whether a page set actually covered the window it claims to report on.
 *
 * A first implementation of this detector read one page of runs and filtered
 * by timestamp. On a busy repository the window's start fell off page one, so
 * it reported "OK, 100 runs inspected" across a period that contained four
 * known load failures. It was clean because it could not see. A scan that
 * cannot cover its window must report an ERROR, never a pass — a detector
 * that reports success for the range it failed to read is worse than no
 * detector, because it also retires the suspicion.
 * @param scan - How far back the page set reached
 * @returns Covered, or not covered with the reason
 */
export function windowCoverage(scan: WindowScan): WindowVerdict {
  const { oldestSeen, windowStart, exhausted } = scan;

  // An exhausted history is covered even when it stops short: a repository
  // younger than the window has no earlier runs to read, and refusing it
  // would be a red nobody can ever clear.
  if (exhausted) return { covered: true, reason: "" };

  if (oldestSeen === null) {
    return {
      covered: false,
      reason: `read no runs at all, so it did not reach ${windowStart}. An empty read is not an empty window.`,
    };
  }

  const oldest = Date.parse(oldestSeen);
  const start = Date.parse(windowStart);
  if (Number.isNaN(oldest) || Number.isNaN(start)) {
    return {
      covered: false,
      reason: `could not read \`${oldestSeen}\` or \`${windowStart}\` as a timestamp, so it did not reach the start of the window. An unreadable bound is not a satisfied one.`,
    };
  }

  if (oldest > start) {
    return {
      covered: false,
      reason: `paging stopped at ${oldestSeen} and did not reach ${windowStart}, so any load failure older than that was never read. Page further, or narrow the window.`,
    };
  }

  return { covered: true, reason: "" };
}
