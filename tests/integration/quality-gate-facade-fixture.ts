import * as fs from "fs-extra";
import { pathToFileURL } from "node:url";

import { loadWorkflow } from "../helpers/workflow-test-utils.js";
import type {
  ParsedWorkflow,
  WorkflowJob,
  WorkflowStep,
} from "../helpers/workflow-test-utils.js";

import {
  GATES_SCRIPT,
  PLAYWRIGHT_YML,
  QUALITY_YML,
} from "./quality-gate-facade-jobs.js";

// Re-exported so every suite keeps one import site. The split below is
// internal bookkeeping forced by the file-length cap; it is not a change to
// what these suites read.
export {
  CONVERTED,
  GATES_SCRIPT,
  PLAYWRIGHT_YML,
  QUALITY_YML,
} from "./quality-gate-facade-jobs.js";
export type { ConvertedJob } from "./quality-gate-facade-jobs.js";

/** The one field of a registry entry these tests read. */
export interface GateDefinition {
  label: string;
}

/** The condition selecting the project's own task. */
export const CONFIGURED = "steps.gate.outputs.configured == 'true'";

/**
 * The condition selecting Lisa's shipped tooling.
 *
 * `== 'false'`, deliberately, not `!= 'true'`. There are THREE states, and the
 * negative form collapses two of them: a project that declared the gate `off`
 * and a project that never mentioned it both failed `!= 'true'`, so the
 * fallback ran either way and `off` could not turn a job off. That shipped, and
 * two zero-suite repositories went red on a job whose declaration said not to
 * run it.
 */
export const NOT_CONFIGURED = "steps.gate.outputs.configured == 'false'";

/** The condition value emitted when the project declared the gate `off`. */
export const DECLARED_OFF = "steps.gate.outputs.configured == 'off'";

/**
 * Steps allowed to carry an UNCONDITIONAL `continue-on-error`.
 *
 * A failing job that reports green is the exact defect the façade exists to
 * prevent, so the set is pinned rather than checked only on the converted jobs:
 * growing it anywhere in this workflow has to fail here. It stays a list of
 * one — the pre-existing carrier on the SonarCloud fallback path.
 */
export const PREEXISTING_CONTINUE_ON_ERROR = ["📊 SonarCloud Scan"];

/** The step every façade job runs the project's own prover through. */
export const GATE_RUN_ID = "gate_run";

/**
 * The only conditional `continue-on-error` the façade may carry.
 *
 * Not a literal `true` anywhere, and not keyed on `configured`: the value is
 * the DECLARED LEVEL, so a gate blocks unless its own declaration said not to.
 * The workflow used to collapse `optional` and `required` into `configured=true`
 * and carry no `continue-on-error` at all, which made a gate declared "show me
 * the red, do not block on it" fail the reusable workflow, fail the caller's
 * `release` job, and skip everything sequenced after it.
 *
 * Pinned as an exact string because the whole point is that ONE level is
 * exempted. A looser assertion would pass for
 * `steps.gate.outputs.level != 'off'`, which exempts `required` too.
 */
export const OPTIONAL_ONLY = "${{ steps.gate.outputs.level == 'optional' }}";

/** The generic runner's spelling of the same rule, read off the matrix. */
export const MATRIX_OPTIONAL_ONLY = "${{ matrix.level == 'optional' }}";

/** The step that keeps a non-blocking failure visible. */
export const OPTIONAL_REPORT_STEP = "🟡 Report the optional gate that failed";

/** Every workflow this fixture knows how to parse, in declaration order. */
export const WORKFLOW_FILES: readonly string[] = [QUALITY_YML, PLAYWRIGHT_YML];

/** Parsed once each, because every accessor below reads them per assertion. */
const PARSED = new Map<string, ParsedWorkflow>(
  WORKFLOW_FILES.map(file => [file, loadWorkflow(file)])
);

/** Read once each, for the assertions that search a whole file as text. */
const SOURCES = new Map<string, string>(
  WORKFLOW_FILES.map(file => [file, fs.readFileSync(file, "utf8")])
);

/**
 * One parsed workflow.
 * @param file Absolute path, one of `WORKFLOW_FILES`.
 * @returns The parsed workflow.
 */
export function workflowIn(file: string): ParsedWorkflow {
  const parsed = PARSED.get(file);
  if (parsed === undefined) {
    throw new Error(
      `${file} is not a workflow this fixture parses. Add it to WORKFLOW_FILES.`
    );
  }
  return parsed;
}

/**
 * One workflow as text, for assertions about comments and documentation.
 * @param file Absolute path, one of `WORKFLOW_FILES`.
 * @returns The file's contents.
 */
export function sourceOf(file: string): string {
  const text = SOURCES.get(file);
  if (text === undefined) {
    throw new Error(
      `${file} is not a workflow this fixture parses. Add it to WORKFLOW_FILES.`
    );
  }
  return text;
}

/** The parsed quality workflow. */
export const workflow: ParsedWorkflow = workflowIn(QUALITY_YML);

/** The quality workflow as text, for assertions about comments. */
export const source: string = sourceOf(QUALITY_YML);

/**
 * One job of one workflow.
 *
 * THROWS on an absent job rather than returning undefined. Every accessor
 * below funnels through this one, so a job that moved to another file — or was
 * renamed, or deleted — fails here by name instead of letting `?.` turn each
 * assertion about it into an assertion about nothing. A required status check
 * that runs zero steps reports SATISFIED on GitHub; a test that inspects zero
 * steps reports PASSED, and the two failures rhyme.
 * @param job Job id.
 * @param file The workflow declaring it; defaults to `quality.yml`.
 * @returns The job definition.
 */
export function jobIn(job: string, file: string = QUALITY_YML): WorkflowJob {
  const definition = workflowIn(file).jobs[job];
  if (definition === undefined) {
    throw new Error(
      `${job} is not declared in ${path.basename(file)}. It was either renamed, ` +
        "deleted, or moved to another workflow — say which file it lives in " +
        "rather than asserting against a job that is not there."
    );
  }
  return definition;
}

/**
 * The gate registry, imported from the shipped `.mjs` at call time.
 * @returns The registry keyed by gate id.
 */
export async function loadRegistry(): Promise<Record<string, GateDefinition>> {
  const loaded = (await import(pathToFileURL(GATES_SCRIPT).href)) as {
    REGISTRY: Record<string, GateDefinition>;
  };
  return loaded.REGISTRY;
}

/**
 * The steps of one job.
 * @param job Job id.
 * @param file The workflow declaring it; defaults to `quality.yml`.
 * @returns Its steps.
 */
export const stepsIn = (
  job: string,
  file: string = QUALITY_YML
): WorkflowStep[] => jobIn(job, file).steps ?? [];

/**
 * One named step of one job.
 * @param job Job id.
 * @param name Exact step name.
 * @param file The workflow declaring the job; defaults to `quality.yml`.
 * @returns The step, or undefined.
 */
export const stepNamed = (
  job: string,
  name: string,
  file: string = QUALITY_YML
): WorkflowStep | undefined =>
  stepsIn(job, file).find(step => step.name === name);

/**
 * The gate-resolution step of one job.
 * @param job Job id.
 * @param file The workflow declaring the job; defaults to `quality.yml`.
 * @returns The step, or undefined.
 */
export const resolveStep = (
  job: string,
  file: string = QUALITY_YML
): WorkflowStep | undefined =>
  stepsIn(job, file).find(step => step.id === "gate");
