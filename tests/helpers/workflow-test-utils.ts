import * as fs from "fs-extra";
import yaml from "js-yaml";

/** Shape of a single step inside a workflow job's `steps:` list. */
export interface WorkflowStep {
  id?: string;
  name?: string;
  run?: string;
  uses?: string;
  if?: string;
  env?: Record<string, unknown>;
  with?: Record<string, unknown>;
}

/** Shape of a single job inside a workflow's `jobs:` map. */
export interface WorkflowJob {
  /**
   * The display name GitHub renders as the job's check row.
   *
   * Load-bearing rather than cosmetic: the row's name composes with its
   * conclusion into what a reader believes, so it is assertable (#3917).
   */
  name?: string;
  steps?: WorkflowStep[];
  if?: string;
  uses?: string;
  with?: Record<string, unknown>;
  outputs?: Record<string, string>;
}

/** Shape of one `workflow_call` input declaration. */
export interface WorkflowInput {
  description?: string;
  required?: boolean;
  default?: unknown;
  type?: string;
}

/**
 * Root shape of a parsed GitHub Actions workflow.
 *
 * `on` survives as a string key because js-yaml parses with the YAML 1.2 core
 * schema, where it is not the boolean it would be under YAML 1.1.
 */
export interface ParsedWorkflow {
  jobs: Record<string, WorkflowJob>;
  on?: {
    workflow_call?: {
      inputs?: Record<string, WorkflowInput>;
    };
  };
}

/**
 * Parses a workflow YAML file into the shape the assertions consume.
 * @param workflowPath Absolute path to the workflow file.
 * @returns The parsed workflow.
 */
export function loadWorkflow(workflowPath: string): ParsedWorkflow {
  return yaml.load(fs.readFileSync(workflowPath, "utf8")) as ParsedWorkflow;
}

/**
 * Flattens every job's steps into a single list.
 * @param workflow The parsed workflow.
 * @returns All steps across all jobs.
 */
export function stepsOf(workflow: ParsedWorkflow): WorkflowStep[] {
  return Object.values(workflow.jobs).flatMap(job => job.steps ?? []);
}
