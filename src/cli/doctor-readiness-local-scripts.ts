/**
 * Bounded expansion of repo-local shell wrappers referenced by workflow run
 * steps.
 * @module cli/doctor-readiness-local-scripts
 */
import { open, realpath } from "node:fs/promises";
import * as path from "node:path";
import type {
  ParsedWorkflow,
  ParsedWorkflowJob,
  ParsedWorkflowStep,
} from "./doctor-readiness-workflows.js";

/** Most bytes read from one local wrapper script during offline expansion. */
const MAX_LOCAL_SCRIPT_BYTES = 16_384;

/** Most wrapper scripts expanded across one readiness scan. */
const MAX_LOCAL_SCRIPT_EXPANSIONS = 64;

/** Separators that end one shell invocation for this conservative scan. */
const SHELL_INVOCATION_SEPARATOR = /\n|&&|\|\||[;&|]/;

/** Shell commands that execute another shell script path. */
const SHELL_SCRIPT_RUNNERS = new Set(["bash", "sh", "source", "."]);

/** Shell runners that accept option flags before the script path. */
const OPTIONED_SHELL_RUNNERS = new Set(["bash", "sh"]);

/** Prefix assignments that set env only for the following shell invocation. */
const SHELL_ENV_ASSIGNMENT = /^[A-Za-z_]\w*=.*$/u;

/** Expansion result plus the remaining aggregate script budget. */
interface ExpansionResult<T> {
  readonly value: T;
  readonly remainingScripts: number;
  readonly unresolved: readonly string[];
}

/** Result of reading local script bodies from one workflow step. */
interface BodyExpansion {
  readonly value: readonly string[];
  readonly remainingScripts: number;
  readonly skippedScripts: readonly string[];
}

/**
 * Whether a word is a shell-runner option rather than the script path.
 * @param word - Shell token
 * @returns True when the token should be skipped after bash/sh
 */
function isShellRunnerOption(word: string): boolean {
  return word.startsWith("-") && word !== "-";
}

/**
 * Find the first non-assignment token in one shell invocation.
 * @param words - Whitespace-split shell invocation
 * @param index - Current scan index
 * @returns Index of the command token
 */
function firstCommandIndex(words: readonly string[], index = 0): number {
  return SHELL_ENV_ASSIGNMENT.test(words[index] ?? "")
    ? firstCommandIndex(words, index + 1)
    : index;
}

/**
 * Find the first non-option script argument after a shell runner.
 * @param words - Whitespace-split shell invocation
 * @param index - Current scan index
 * @returns Index of the script argument
 */
function firstShellScriptIndex(
  words: readonly string[],
  index: number
): number {
  return isShellRunnerOption(words[index] ?? "")
    ? firstShellScriptIndex(words, index + 1)
    : index;
}

/**
 * Locate the word in one invocation that names the script to expand.
 * @param words - Whitespace-split shell invocation
 * @returns Script word and whether a shell runner selected it
 */
function scriptCandidate(
  words: readonly string[]
): { candidate: string; usesRunner: boolean } | null {
  const index = firstCommandIndex(words);
  const command = words[index];
  if (command === undefined) {
    return null;
  }
  const usesRunner = SHELL_SCRIPT_RUNNERS.has(command);
  if (!usesRunner) {
    return { candidate: command, usesRunner };
  }
  const candidateIndex = OPTIONED_SHELL_RUNNERS.has(command)
    ? firstShellScriptIndex(words, index + 1)
    : index + 1;
  const candidate = words[candidateIndex];
  return candidate === undefined ? null : { candidate, usesRunner };
}

/**
 * Extract repo-relative shell scripts named directly by a workflow run step.
 * @param command - Workflow step command
 * @returns Unique repo-relative script paths
 */
function localScriptPaths(command: string): readonly string[] {
  return [
    ...new Set(
      command
        .split(SHELL_INVOCATION_SEPARATOR)
        .flatMap(invocation => {
          const words = invocation.trim().split(/\s+/u);
          if (words.length === 0 || words[0]?.startsWith("#")) {
            return [];
          }
          const parsed = scriptCandidate(words);
          if (parsed === null) {
            return [];
          }
          const candidate = parsed?.candidate;
          if (
            candidate === undefined ||
            !candidate.endsWith(".sh") ||
            candidate.includes("..")
          ) {
            return [];
          }
          if (
            !parsed.usesRunner &&
            !candidate.includes("/") &&
            !candidate.startsWith("./")
          ) {
            return [];
          }
          return [candidate.replace(/^\.\//u, "")];
        })
        .filter(candidate => !candidate.startsWith("-"))
    ),
  ];
}

/**
 * Read one bounded repo-local script for offline command expansion.
 * @param root - Repository root
 * @param relativePath - Repo-relative script path
 * @returns Script content, or null when it cannot be safely read
 */
async function readLocalScript(
  root: string,
  relativePath: string
): Promise<string | null> {
  try {
    const rootPath = await realpath(root);
    const target = await realpath(path.resolve(rootPath, relativePath));
    if (!target.startsWith(`${rootPath}${path.sep}`)) {
      return null;
    }
    const file = await open(target, "r");
    try {
      const buffer = Buffer.alloc(MAX_LOCAL_SCRIPT_BYTES + 1);
      const { bytesRead } = await file.read(
        buffer,
        0,
        MAX_LOCAL_SCRIPT_BYTES + 1,
        0
      );
      return bytesRead > MAX_LOCAL_SCRIPT_BYTES
        ? null
        : buffer.subarray(0, bytesRead).toString("utf8");
    } finally {
      await file.close();
    }
  } catch {
    return null;
  }
}

/**
 * Append any bounded local script bodies referenced by a workflow step.
 * @param root - Repository root
 * @param job - Parsed workflow job
 * @param step - Parsed workflow step
 * @param remainingScripts - Remaining aggregate expansion budget
 * @returns Step with script bodies appended to `run`, when present
 */
async function expandLocalScriptStep(
  root: string,
  job: ParsedWorkflowJob,
  step: ParsedWorkflowStep,
  remainingScripts: number
): Promise<ExpansionResult<ParsedWorkflowStep>> {
  const expanded = await expandLocalScriptBodies(
    root,
    localScriptPaths(step.run),
    remainingScripts
  );
  const unresolved = expanded.skippedScripts.map(
    script =>
      `\`${job.workflow}\` job \`${job.id}\` step \`${step.name}\` invokes ` +
      "local " +
      `script \`${script}\`, but the bounded wrapper expansion budget was ` +
      "exhausted before that script could be inspected"
  );
  return {
    remainingScripts: expanded.remainingScripts,
    unresolved,
    value:
      expanded.value.length === 0
        ? step
        : { ...step, run: [step.run, ...expanded.value].join("\n") },
  };
}

/**
 * Read script bodies sequentially under the aggregate expansion budget.
 * @param root - Repository root
 * @param scripts - Candidate script paths
 * @param remainingScripts - Remaining aggregate expansion budget
 * @returns Expanded script bodies and updated budget
 */
async function expandLocalScriptBodies(
  root: string,
  scripts: readonly string[],
  remainingScripts: number
): Promise<BodyExpansion> {
  const [script, ...rest] = scripts;
  if (script === undefined) {
    return { value: [], remainingScripts, skippedScripts: [] };
  }
  if (remainingScripts <= 0) {
    return { value: [], remainingScripts, skippedScripts: scripts };
  }
  const content = await readLocalScript(root, script);
  const expanded = await expandLocalScriptBodies(
    root,
    rest,
    remainingScripts - 1
  );
  return {
    remainingScripts: expanded.remainingScripts,
    skippedScripts: expanded.skippedScripts,
    value: content === null ? expanded.value : [content, ...expanded.value],
  };
}

/**
 * Expand directly invoked local shell scripts in one parsed job.
 * @param root - Repository root
 * @param job - Parsed workflow job
 * @param remainingScripts - Remaining aggregate expansion budget
 * @returns Job with script-expanded steps
 */
async function expandLocalScriptJob(
  root: string,
  job: ParsedWorkflowJob,
  remainingScripts: number
): Promise<ExpansionResult<ParsedWorkflowJob>> {
  const expanded = await expandLocalScriptSteps(
    root,
    job,
    job.steps,
    remainingScripts
  );
  return {
    remainingScripts: expanded.remainingScripts,
    unresolved: expanded.unresolved,
    value: {
      ...job,
      steps: expanded.value,
    },
  };
}

/**
 * Expand local scripts across a job's steps under the shared budget.
 * @param root - Repository root
 * @param job - Parsed workflow job
 * @param steps - Parsed workflow steps
 * @param remainingScripts - Remaining aggregate expansion budget
 * @returns Expanded steps and updated budget
 */
async function expandLocalScriptSteps(
  root: string,
  job: ParsedWorkflowJob,
  steps: readonly ParsedWorkflowStep[],
  remainingScripts: number
): Promise<ExpansionResult<readonly ParsedWorkflowStep[]>> {
  const [step, ...rest] = steps;
  if (step === undefined) {
    return { value: [], remainingScripts, unresolved: [] };
  }
  const expandedStep = await expandLocalScriptStep(
    root,
    job,
    step,
    remainingScripts
  );
  const expandedRest = await expandLocalScriptSteps(
    root,
    job,
    rest,
    expandedStep.remainingScripts
  );
  return {
    remainingScripts: expandedRest.remainingScripts,
    unresolved: [...expandedStep.unresolved, ...expandedRest.unresolved],
    value: [expandedStep.value, ...expandedRest.value],
  };
}

/**
 * Inline directly invoked local shell scripts into the parsed workflow commands.
 * @param root - Repository root
 * @param workflows - Parsed workflow files
 * @returns Workflows with bounded script content appended to matching steps
 */
export async function expandLocalScriptCommands(
  root: string,
  workflows: readonly ParsedWorkflow[]
): Promise<readonly ParsedWorkflow[]> {
  const expanded = await expandLocalScriptCommandsWithDiagnostics(
    root,
    workflows
  );
  return expanded.value;
}

/**
 * Inline local scripts and report wrapper calls that bounded expansion skipped.
 * @param root - Repository root
 * @param workflows - Parsed workflow files
 * @returns Expanded workflows plus unresolved skipped-wrapper observations
 */
export async function expandLocalScriptCommandsWithDiagnostics(
  root: string,
  workflows: readonly ParsedWorkflow[]
): Promise<ExpansionResult<readonly ParsedWorkflow[]>> {
  return await expandLocalScriptWorkflows(
    root,
    workflows,
    MAX_LOCAL_SCRIPT_EXPANSIONS
  );
}

/**
 * Expand local scripts across workflows under the shared budget.
 * @param root - Repository root
 * @param workflows - Parsed workflow files
 * @param remainingScripts - Remaining aggregate expansion budget
 * @returns Expanded workflows and updated budget
 */
async function expandLocalScriptWorkflows(
  root: string,
  workflows: readonly ParsedWorkflow[],
  remainingScripts: number
): Promise<ExpansionResult<readonly ParsedWorkflow[]>> {
  const [workflow, ...rest] = workflows;
  if (workflow === undefined) {
    return { value: [], remainingScripts, unresolved: [] };
  }
  const expandedJobs = await expandLocalScriptJobs(
    root,
    workflow.jobs,
    remainingScripts
  );
  const expandedRest = await expandLocalScriptWorkflows(
    root,
    rest,
    expandedJobs.remainingScripts
  );
  return {
    remainingScripts: expandedRest.remainingScripts,
    unresolved: [...expandedJobs.unresolved, ...expandedRest.unresolved],
    value: [
      {
        ...workflow,
        jobs: expandedJobs.value,
      },
      ...expandedRest.value,
    ],
  };
}

/**
 * Expand local scripts across workflow jobs under the shared budget.
 * @param root - Repository root
 * @param jobs - Parsed workflow jobs
 * @param remainingScripts - Remaining aggregate expansion budget
 * @returns Expanded jobs and updated budget
 */
async function expandLocalScriptJobs(
  root: string,
  jobs: readonly ParsedWorkflowJob[],
  remainingScripts: number
): Promise<ExpansionResult<readonly ParsedWorkflowJob[]>> {
  const [job, ...rest] = jobs;
  if (job === undefined) {
    return { value: [], remainingScripts, unresolved: [] };
  }
  const expandedJob = await expandLocalScriptJob(root, job, remainingScripts);
  const expandedRest = await expandLocalScriptJobs(
    root,
    rest,
    expandedJob.remainingScripts
  );
  return {
    remainingScripts: expandedRest.remainingScripts,
    unresolved: [...expandedJob.unresolved, ...expandedRest.unresolved],
    value: [expandedJob.value, ...expandedRest.value],
  };
}
