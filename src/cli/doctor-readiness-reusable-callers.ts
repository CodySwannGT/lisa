/**
 * Local reusable-workflow caller resolution for B2 delivery/authority readiness.
 * @module cli/doctor-readiness-reusable-callers
 */
import type {
  ParsedWorkflow,
  ParsedWorkflowJob,
} from "./doctor-readiness-workflows.js";

/** What local caller workflows prove about a reusable workflow invocation. */
export type ReusableCallerValidation = "validated" | "unvalidated" | "unknown";

/**
 * Walk a job's transitive `needs:` closure within its workflow.
 * @param workflow - The workflow declaring the job
 * @param job - The job whose ancestors to resolve
 * @returns Every job the given job transitively depends on
 */
export function ancestorJobs(
  workflow: ParsedWorkflow,
  job: ParsedWorkflowJob
): readonly ParsedWorkflowJob[] {
  const byId = new Map(workflow.jobs.map(entry => [entry.id, entry]));
  const walk = (
    ids: readonly string[],
    seen: readonly string[]
  ): readonly ParsedWorkflowJob[] => {
    const fresh = ids.filter(id => !seen.includes(id));
    if (fresh.length === 0) {
      return [];
    }
    const jobs = fresh.flatMap(id => {
      const ancestor = byId.get(id);
      return ancestor ? [ancestor] : [];
    });
    return [
      ...jobs,
      ...walk(
        jobs.flatMap(ancestor => ancestor.needs),
        [...seen, ...fresh]
      ),
    ];
  };
  return walk(job.needs, []);
}

/**
 * Normalize a local reusable workflow reference to a repo-relative workflow path.
 * @param uses - Raw `job.uses` value
 * @returns Repo-relative workflow path when the reference is local
 */
function localReusableWorkflowPath(uses: string): string | null {
  const withoutRef = uses.split("@")[0]?.trim() ?? "";
  if (!withoutRef.startsWith("./.github/workflows/")) {
    return null;
  }
  return withoutRef.slice(2);
}

/**
 * Resolve whether known local callers validate before invoking a reusable
 * publishing workflow. Unknown external callers stay unresolved; known local
 * callers without a validating ancestor prove a bypass.
 * @param workflow - The reusable workflow being assessed
 * @param allWorkflows - Every parsed workflow in the repository
 * @param isValidatingJob - Predicate for validation jobs
 * @returns The local caller validation state
 */
export function reusableCallerValidation(
  workflow: ParsedWorkflow,
  allWorkflows: readonly ParsedWorkflow[] | undefined,
  isValidatingJob: (job: ParsedWorkflowJob) => boolean
): ReusableCallerValidation {
  if (
    !(
      workflow.on.events.length > 0 &&
      workflow.on.events.every(event => event === "workflow_call")
    )
  ) {
    return "unknown";
  }
  const callers = (allWorkflows ?? []).flatMap(candidate =>
    candidate.jobs
      .filter(job => localReusableWorkflowPath(job.uses) === workflow.file)
      .map(job => ({ workflow: candidate, job }))
  );
  if (callers.length === 0) {
    return "unknown";
  }
  return callers.every(caller =>
    ancestorJobs(caller.workflow, caller.job).some(isValidatingJob)
  )
    ? "validated"
    : "unvalidated";
}
