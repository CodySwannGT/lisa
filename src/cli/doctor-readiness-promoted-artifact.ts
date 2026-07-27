/**
 * Promoted-artifact checks shared by delivery/authority readiness.
 * @module cli/doctor-readiness-promoted-artifact
 */
import type {
  ParsedWorkflowJob,
  ParsedWorkflowStep,
} from "./doctor-readiness-workflows.js";
import type { ReleasePathOutcome } from "./doctor-readiness-release-path.js";

/** The GitHub Actions promotion step Lisa recognizes for CI-built artifacts. */
export const PROMOTION_ACTION = "actions/download-artifact";

/**
 * Whether an action reference is the trusted artifact-promotion action.
 * @param uses - Raw action reference
 * @returns True when the action id is exactly actions/download-artifact
 */
export function isPromotionAction(uses: string): boolean {
  const actionId = uses.split("@")[0]?.trim();
  return actionId === PROMOTION_ACTION;
}

/**
 * Whether the job promotes an artifact produced by another job.
 * @param job - The publishing job
 * @param publishStep - The step that ships
 * @returns True when a download-artifact step is present before publication
 */
export function promotesValidatedArtifact(
  job: ParsedWorkflowJob,
  publishStep: ParsedWorkflowStep
): boolean {
  return job.steps
    .slice(0, job.steps.indexOf(publishStep))
    .some(step => isPromotionAction(step.uses));
}

/**
 * A downloaded artifact without linked validation is unestablished, not clean.
 * @param where - Evidence location label
 * @returns The unresolved outcome
 */
export function unresolvedPromotedArtifact(where: string): ReleasePathOutcome {
  return {
    kind: "unresolved",
    reason:
      `${where} promotes an artifact via \`${PROMOTION_ACTION}\`, but no ` +
      "validating job precedes it in this workflow or resolved caller chain, so " +
      "the downloaded artifact cannot be tied to anything that was validated",
  };
}
