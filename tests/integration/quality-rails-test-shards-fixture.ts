/**
 * Shared helpers for the `quality-rails.yml` `test_shards` suites
 * (CodySwannGT/lisa#4560): the parsed workflow, job and step lookups, a
 * condition evaluator that accepts hyphenated job ids, and a step runner.
 */
import * as path from "node:path";

import {
  evaluateCondition,
  executeStep,
  type ShardSuiteJob,
} from "./quality-unit-test-shards-fixture.js";
import {
  loadWorkflow,
  type WorkflowStep,
} from "../helpers/workflow-test-utils.js";

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const SCRIPT = path.join(
  REPO_ROOT,
  "rails/copy-overwrite/scripts/lisa-rspec-shards.mjs"
);
export const workflow = loadWorkflow(
  path.join(REPO_ROOT, ".github/workflows/quality-rails.yml")
);
export const SKIP_TOKEN =
  "!contains(format(',{0},', inputs.skip_jobs), ',test,')";

export const DATABASES = [
  { db: "postgres", label: "PostgreSQL" },
  { db: "mysql", label: "MySQL" },
] as const;

/** A job with the keys these suites read. */
export type Job = ShardSuiteJob & {
  services?: Record<string, unknown>;
  env?: Record<string, unknown>;
  permissions?: Record<string, string>;
};

/**
 * A job of quality-rails.yml.
 * @param id - Job id
 * @returns The job
 */
export function job(id: string): Job {
  const found = workflow.jobs[id];
  if (!found) throw new Error(`quality-rails.yml has no job ${id}`);
  return found as Job;
}

/**
 * A named step of a job.
 * @param id - Job id
 * @param name - Step name
 * @returns The step
 */
export function step(id: string, name: string): WorkflowStep {
  const found = (job(id).steps ?? []).find(entry => entry.name === name);
  if (!found) throw new Error(`${id} has no step "${name}"`);
  return found;
}

/**
 * Evaluate a step condition. The shared evaluator reads `[\w.]` identifiers,
 * so hyphenated job ids are respelled with underscores on both sides.
 * @param expression - The `if:` text
 * @param context - Values by (underscored) name
 * @returns Its value
 */
export function holds(
  expression: string | undefined,
  context: Record<string, string | number>
): boolean {
  return evaluateCondition(
    (expression ?? "").replace(
      /needs\.([\w-]+)\./g,
      (_, id: string) => `needs.${id.replace(/-/g, "_")}.`
    ),
    context
  );
}

/**
 * Run a step body after a setup prelude, in a registered scratch directory.
 * @param register - Records the scratch directory for cleanup
 * @param prelude - Shell run first, in the same directory
 * @param body - The step's `run:`
 * @param env - Step environment
 * @returns The outcome
 */
export function execute(
  register: (directory: string) => void,
  prelude: string,
  body: string | undefined,
  env: Record<string, string> = {}
) {
  return executeStep(`${prelude}\n${body ?? ""}`, env, register);
}

/** Install the planner and a small spec tree into the step's directory. */
export const PROJECT = [
  "mkdir -p scripts spec/models",
  `cp ${JSON.stringify(SCRIPT)} scripts/lisa-rspec-shards.mjs`,
  ": > scripts/lisa_rspec_shard_recorder.rb",
  ": > scripts/lisa_simplecov_collate.rb",
  "printf 'aaaaaaaaaa' > spec/a_spec.rb",
  "printf 'bbbbb' > spec/models/b_spec.rb",
  "printf 'cc' > spec/c_spec.rb",
].join("\n");
