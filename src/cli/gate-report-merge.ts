/**
 * Whether a merge is actually blocked on one gate.
 *
 * The emitter computed the per-cell half of this from the first day and the
 * renderer discarded every byte of it, which left the report unable to surface
 * the class of finding it was built to find: a check that is `required` at push
 * and gates NOTHING at merge, so the cost is paid on every developer's machine
 * while anyone pushing from a hookless path skips it and merges anyway.
 *
 * Three answers, and the middle one is the whole reason the column exists.
 * A property proved inside a job named after a different gate still blocks the
 * merge — but the red build then names a property that did not fail, and a
 * column that collapsed that into "yes" could not show it.
 *
 * The third answer is derived, not assumed: a job whose shell runs this gate's
 * task, under a name that is not this gate's, whose context the ruleset
 * requires. Where the workflows cannot be read the answer is the upstream
 * refusal rather than "no" — "not blocked" is a claim, and this run would not
 * have looked.
 * @module cli/gate-report-merge
 */
import { hookInvokesTask } from "./gate-report-executors.js";
import {
  TIER_THREE_UNKNOWABLE,
  type FacadeFacts,
} from "./gate-report-facade.js";
import type { Finding, MergeVerdict } from "./gate-report-types.js";

/** Everything one row's verdict is derived from. */
export interface MergeVerdictInputs {
  /** The context this gate's own `required` declaration implies, if any. */
  readonly expectedContext: string | null;
  /** The task this gate resolves to at the merge moment. */
  readonly task: string | null;
  /** This gate's own CI job name, so another job's name can be told apart. */
  readonly label: string;
  /** The live required contexts, or an unknown. */
  readonly required: Finding<readonly string[]>;
  /** What the project's own workflows say. */
  readonly facade: FacadeFacts;
}

/**
 * The first job that proves this task under a name that is not this gate's.
 * @param inputs - Verdict inputs
 * @param required - The live required contexts
 * @returns The blocking context and job name, or null
 */
function underAnotherName(
  inputs: MergeVerdictInputs,
  required: readonly string[]
): { context: string; job: string } | null {
  const { task, label, facade } = inputs;
  if (task === null) return null;
  for (const site of facade.jobSites) {
    if (site.name === label || !hookInvokesTask(site.shell, task)) continue;
    const context = site.contexts.find(one => required.includes(one));
    if (context !== undefined) return { context, job: site.name };
  }
  return null;
}

/**
 * Whether a merge is blocked on one gate, and under whose name.
 * @param inputs - Verdict inputs
 * @returns The verdict, or the honest refusal to give one
 */
export function mergeVerdict(
  inputs: MergeVerdictInputs
): Finding<MergeVerdict> {
  const { expectedContext, required, facade } = inputs;
  if (required.state !== "verified") return required;
  if (expectedContext !== null && required.value.includes(expectedContext)) {
    return {
      state: "verified",
      value: { verdict: "yes", context: expectedContext, underJob: null },
    };
  }
  const other = underAnotherName(inputs, required.value);
  if (other !== null) {
    return {
      state: "verified",
      value: {
        verdict: "yes-under-another-name",
        context: other.context,
        underJob: other.job,
      },
    };
  }
  // A consumer holds no copy of the workflow, so it cannot see whether one of
  // Lisa's own jobs proves this property under a different job's name. "No"
  // would be a claim this run did not check.
  if (!facade.qualityYmlPresent) return TIER_THREE_UNKNOWABLE;
  return {
    state: "verified",
    value: { verdict: "no", context: null, underJob: null },
  };
}
