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

/** Separators that end one shell invocation for this conservative scan. */
const SHELL_INVOCATION_SEPARATOR = /\n|&&|\|\||[;&|]/;

/** Shell commands that execute another shell script path. */
const SHELL_SCRIPT_RUNNERS = new Set(["bash", "sh", "source", "."]);

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
          const usesRunner = SHELL_SCRIPT_RUNNERS.has(words[0] ?? "");
          const candidate = usesRunner ? words[1] : words[0];
          if (
            candidate === undefined ||
            !candidate.endsWith(".sh") ||
            candidate.includes("..")
          ) {
            return [];
          }
          if (
            !usesRunner &&
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
 * @param step - Parsed workflow step
 * @returns Step with script bodies appended to `run`, when present
 */
async function expandLocalScriptStep(
  root: string,
  step: ParsedWorkflowStep
): Promise<ParsedWorkflowStep> {
  const scripts = await Promise.all(
    localScriptPaths(step.run).map(
      async script => await readLocalScript(root, script)
    )
  );
  const scriptBodies = scripts.filter(
    (content): content is string => content !== null
  );
  return scriptBodies.length === 0
    ? step
    : { ...step, run: [step.run, ...scriptBodies].join("\n") };
}

/**
 * Expand directly invoked local shell scripts in one parsed job.
 * @param root - Repository root
 * @param job - Parsed workflow job
 * @returns Job with script-expanded steps
 */
async function expandLocalScriptJob(
  root: string,
  job: ParsedWorkflowJob
): Promise<ParsedWorkflowJob> {
  return {
    ...job,
    steps: await Promise.all(
      job.steps.map(async step => await expandLocalScriptStep(root, step))
    ),
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
  return await Promise.all(
    workflows.map(async workflow => ({
      ...workflow,
      jobs: await Promise.all(
        workflow.jobs.map(async job => await expandLocalScriptJob(root, job))
      ),
    }))
  );
}
