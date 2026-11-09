/**
 * The third-party review evidence workflow as its tests read it: both shipped
 * copies, the steps that run the prover and publish its verdict, and the
 * contexts an event hands their expressions.
 *
 * Shared by the suite that evaluates the workflow's expressions and the suite
 * that executes its steps, so both read one definition of "the prover step"
 * and "the publish step" (CodySwannGT/lisa#4553, #4630).
 * @module tests/helpers/third-party-review-workflow
 */
import * as path from "node:path";

import { HEAD, REVIEWER } from "./third-party-review-observations.js";
import { loadWorkflow } from "./workflow-test-utils.js";

const ROOT = path.resolve(import.meta.dirname, "../..");

/** Both copies of the workflow, which must answer every case identically. */
export const COPIES = [
  ".github/workflows/third-party-review-evidence.yml",
  "typescript/create-only/.github/workflows/third-party-review-evidence.yml",
] as const;

/** A second app that posts check runs on the same heads. */
export const OTHER_APP_CHECK = "GitGuardian Security Checks";

/** One step of the evidence job, as these cases read it. */
interface WorkflowStep {
  readonly id?: string;
  readonly uses?: string;
  readonly run?: string;
  readonly with?: Record<string, string>;
  readonly env?: Record<string, string>;
}

/** The parsed parts of the workflow these cases read. */
export interface EvidenceWorkflow {
  readonly on: Record<string, unknown>;
  readonly permissions: Record<string, string>;
  readonly concurrency: { readonly group: string };
  readonly jobs: {
    readonly evidence: {
      readonly if: string;
      readonly steps: readonly WorkflowStep[];
    };
  };
}

/** A step that runs a script under an env. */
export interface ScriptStep {
  readonly id?: string | undefined;
  readonly run: string;
  readonly env: Record<string, string>;
}

/**
 * Parse one copy of the workflow.
 * @param copy - Repository-relative workflow path
 * @returns The parsed workflow
 */
export function workflowOf(copy: string): EvidenceWorkflow {
  return loadWorkflow(path.join(ROOT, copy)) as unknown as EvidenceWorkflow;
}

/**
 * The one script step whose `run:` contains a marker.
 * @param workflow - A parsed copy
 * @param marker - Text only that step's script contains
 * @param label - What the step is, for the error when it is missing
 * @returns The step
 */
function scriptStep(
  workflow: EvidenceWorkflow,
  marker: string,
  label: string
): ScriptStep {
  const step = workflow.jobs.evidence.steps.find(candidate =>
    candidate.run?.includes(marker)
  );
  if (!step?.run || !step.env) throw new Error(`no ${label} step`);
  return { id: step.id, run: step.run, env: step.env };
}

/**
 * The step that runs the prover and saves its verdict.
 * @param workflow - A parsed copy
 * @returns Its prover step
 */
export const proverStep = (workflow: EvidenceWorkflow): ScriptStep =>
  scriptStep(workflow, "check-third-party-review-evidence.mjs", "prover");

/**
 * The step that publishes the prover's verdict on the head it judged.
 * @param workflow - A parsed copy
 * @returns Its publish step
 */
export const publishStep = (workflow: EvidenceWorkflow): ScriptStep =>
  scriptStep(workflow, "--publish=", "publish");

/**
 * Workflow contexts for one triggering event.
 * @param eventName - The event that woke the run
 * @param event - Its payload
 * @param inputs - Manual inputs, for `workflow_dispatch`
 * @returns The contexts the expressions read
 */
export function contexts(
  eventName: string,
  event: Record<string, unknown>,
  inputs: Record<string, string> = {}
): Record<string, unknown> {
  return {
    github: {
      event_name: eventName,
      event,
      repository: "acme/code",
      token: "fixture-token",
    },
    inputs,
    vars: {},
  };
}

/**
 * A completed check run's event, as GitHub delivers it.
 * @param headSha - The commit the run reported on
 * @param name - The run's name, which is the reviewer's context
 * @returns The event's contexts
 */
export const reviewerCheckRun = (
  headSha = HEAD,
  name = REVIEWER
): Record<string, unknown> =>
  contexts("check_run", {
    action: "completed",
    check_run: {
      name,
      head_sha: headSha,
      status: "completed",
      conclusion: "success",
    },
  });
