/**
 * Mutable action-reference checks for release-path readiness.
 * @module cli/doctor-readiness-action-pins
 */
import type {
  ParsedWorkflow,
  ParsedWorkflowJob,
} from "./doctor-readiness-workflows.js";
import {
  describeStep,
  findPublishSteps,
} from "./doctor-readiness-release-path.js";

const PINNED_ACTION_REF = /^[a-f0-9]{40}$/i;

/**
 * Whether an action reference points at a mutable tag or branch instead of an
 * immutable commit.
 * @param uses - Raw `uses:` value
 * @returns True when a third-party action is not pinned to a full SHA
 */
function isMutableActionRef(uses: string): boolean {
  const trimmed = uses.trim();
  if (
    trimmed === "" ||
    trimmed.startsWith("./") ||
    trimmed.startsWith("../") ||
    trimmed.startsWith("docker://")
  ) {
    return false;
  }
  const [, ref] = trimmed.split("@");
  return ref === undefined || !PINNED_ACTION_REF.test(ref);
}

/**
 * Report mutable action references in jobs that publish release artifacts.
 * A release job has deployment authority, so an action tag such as `@v4` or
 * `@main` is supply-chain authority handed to whoever can move that ref.
 * @param workflow - The workflow declaring the job
 * @param job - The job to assess
 * @returns B2 evidence lines for unpinned action refs
 */
export function unpinnedPublishingActionViolations(
  workflow: ParsedWorkflow,
  job: ParsedWorkflowJob
): readonly string[] {
  if (findPublishSteps(job).length === 0) {
    return [];
  }
  return job.steps.flatMap(step =>
    isMutableActionRef(step.uses)
      ? [
          `${workflow.file} job \`${job.id}\` step \`${describeStep(step)}\` ` +
            `uses mutable action reference \`${step.uses}\` in a publishing ` +
            "job; pin it to a full commit SHA so the release path cannot change " +
            "without a reviewed workflow diff",
        ]
      : []
  );
}
