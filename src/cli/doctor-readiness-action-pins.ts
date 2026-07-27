/**
 * Mutable action-reference checks for release-path readiness.
 * @module cli/doctor-readiness-action-pins
 */
import type {
  ParsedWorkflow,
  ParsedWorkflowJob,
  ParsedWorkflowStep,
} from "./doctor-readiness-workflows.js";
import {
  describeStep,
  findPublishSteps,
} from "./doctor-readiness-release-path.js";
import { ancestorJobs } from "./doctor-readiness-reusable-callers.js";

const PINNED_ACTION_REF = /^[a-f0-9]{40}$/i;
const PINNED_DOCKER_ACTION_REF = /^docker:\/\/.+@sha256:[a-f0-9]{64}$/i;

/**
 * Whether an action reference points at a mutable tag or branch instead of an
 * immutable commit.
 * @param uses - Raw `uses:` value
 * @returns True when a third-party action is not pinned to a full SHA
 */
function isMutableActionRef(uses: string): boolean {
  const trimmed = uses.trim();
  if (trimmed === "" || trimmed.startsWith("./") || trimmed.startsWith("../")) {
    return false;
  }
  if (trimmed.startsWith("docker://")) {
    return !PINNED_DOCKER_ACTION_REF.test(trimmed);
  }
  const [, ref] = trimmed.split("@");
  return ref === undefined || !PINNED_ACTION_REF.test(ref);
}

/**
 * Report mutable action references in a release-path job.
 * @param workflow - The workflow declaring the job
 * @param job - The job to assess
 * @param step - The action step to report
 * @param role - Why this job is release-path relevant
 * @returns One B2 evidence line
 */
function mutableActionEvidence(
  workflow: ParsedWorkflow,
  job: ParsedWorkflowJob,
  step: ParsedWorkflowStep,
  role: string
): string {
  return (
    `${workflow.file} job \`${job.id}\` step \`${describeStep(step)}\` ` +
    `uses mutable action reference \`${step.uses}\` in ${role}; pin it to a ` +
    "full commit SHA so the release path cannot change without a reviewed " +
    "workflow diff"
  );
}

/**
 * Report mutable action references in one job.
 * @param workflow - The workflow declaring the job
 * @param job - The job to assess
 * @param role - Why this job is release-path relevant
 * @returns B2 evidence lines for unpinned action refs
 */
function mutableActionViolations(
  workflow: ParsedWorkflow,
  job: ParsedWorkflowJob,
  role: string
): readonly string[] {
  return job.steps.flatMap(step =>
    isMutableActionRef(step.uses)
      ? [mutableActionEvidence(workflow, job, step, role)]
      : []
  );
}

/**
 * Report mutable action references in jobs that publish release artifacts or
 * provide the validation those publishing jobs rely on.
 * A release job has deployment authority, so an action tag such as `@v4` or
 * `@main` is supply-chain authority handed to whoever can move that ref. The
 * same is true for the validating ancestors in the publishing job's `needs:`
 * closure: their output is what makes the artifact trusted.
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
  return [
    ...mutableActionViolations(workflow, job, "a publishing job"),
    ...ancestorJobs(workflow, job).flatMap(ancestor =>
      mutableActionViolations(
        workflow,
        ancestor,
        "a validating ancestor of a publishing job"
      )
    ),
  ];
}
