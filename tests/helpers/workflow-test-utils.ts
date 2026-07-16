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
  steps?: WorkflowStep[];
  if?: string;
  uses?: string;
  with?: Record<string, unknown>;
  outputs?: Record<string, string>;
}

/** Root shape of a parsed GitHub Actions workflow. */
export interface ParsedWorkflow {
  jobs: Record<string, WorkflowJob>;
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
