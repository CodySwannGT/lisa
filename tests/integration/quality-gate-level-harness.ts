/**
 * Runs one façade job's declared path the way GitHub Actions would.
 *
 * The property under test is a JOB OUTCOME, and a job outcome is produced by
 * three things acting together: what the resolve step wrote to `$GITHUB_OUTPUT`,
 * whether each following step's `if` selected it, and what `continue-on-error`
 * did to the exit code of the one that ran. Asserting any of those in isolation
 * proves nothing about the outcome — a resolve step can emit a level nothing
 * reads, and a `continue-on-error` can be keyed on an output that is never set.
 *
 * So every part here is the shipped text: the resolve block, the conditions and
 * the `continue-on-error` expression are pulled out of `quality.yml` verbatim
 * and the step bodies are executed under `bash`. Nothing about the workflow is
 * restated in this file — only GitHub's own rules for combining the results.
 * @module tests/integration/quality-gate-level-harness
 */

import * as fs from "fs-extra";

import { boundedSpawnSync } from "../helpers/io-latency-budget.js";
import type { WorkflowStep } from "../helpers/workflow-test-utils.js";

/** `bash` by absolute path — never resolved through a writeable $PATH. */
const BASH = "/bin/bash";

/** What a step reports once it has run, skipped, or been continued over. */
export type Outcome = "success" | "failure" | "skipped";

/** The two contexts the façade's conditions read. */
export interface StepContext {
  outputs: Record<string, Record<string, string>>;
  outcomes: Record<string, Outcome>;
}

/** One executed step, both before and after `continue-on-error`. */
export interface StepResult {
  outcome: Outcome;
  conclusion: Outcome;
  stdout: string;
  summary: string;
}

/** The one comparison shape every façade condition is built from. */
const COMPARISON =
  /^steps\.(\w+)\.(outcome|conclusion|outputs\.\w+)\s*==\s*'([^']*)'$/;

/**
 * Creates the file GitHub would have created, and names it.
 * @param file Absolute path.
 * @returns The same path, now an empty file.
 */
const emptied = (file: string): string => {
  fs.outputFileSync(file, "");
  return file;
};

/**
 * One step's `run:` body, refused if the workflow interpolates into it.
 *
 * A body carrying `${{ }}` is one GitHub rewrites before bash ever sees it, so
 * running it verbatim would be running something the workflow does not.
 * @param step The step.
 * @returns The body.
 */
const verbatimBody = (step: WorkflowStep): string => {
  const body = step.run ?? "";
  if (body.includes("${{")) {
    throw new Error(
      `the ${step.name ?? "unnamed"} step interpolates \${{ }} into its body, ` +
        "so running it verbatim would not be running what GitHub runs."
    );
  }
  return body;
};

/**
 * Parses what a step wrote to `$GITHUB_OUTPUT`.
 * @param text The file's contents.
 * @returns The outputs, keyed by name.
 */
const parseOutputs = (text: string): Record<string, string> =>
  Object.fromEntries(
    text
      .split("\n")
      .filter(line => line.includes("="))
      .map(line => [
        line.slice(0, line.indexOf("=")),
        line.slice(line.indexOf("=") + 1),
      ])
  );

/**
 * Reads one `steps.…` operand out of a context.
 * @param step The step id.
 * @param field `outcome`, `conclusion`, or `outputs.<name>`.
 * @param context The contexts to read.
 * @returns The value, or the empty string GitHub substitutes when unset.
 */
function operand(step: string, field: string, context: StepContext): string {
  if (field.startsWith("outputs.")) {
    return context.outputs[step]?.[field.slice("outputs.".length)] ?? "";
  }
  // `conclusion` is what continue-on-error rewrote; `outcome` is what the step
  // actually did. The harness records the raw outcome and derives the other.
  return context.outcomes[step] ?? "";
}

/**
 * Evaluates one shipped condition or `continue-on-error` expression.
 *
 * Deliberately TOTAL over the syntax it supports and no wider: an unrecognised
 * term throws rather than defaulting either way. A condition that grows an
 * operator this cannot read must fail here loudly, because the alternative is a
 * simulation that silently stops mirroring the workflow it claims to mirror.
 * @param expression The expression verbatim, `${{ }}` wrapper optional.
 * @param context The contexts to evaluate against.
 * @returns Whether GitHub would select the step.
 */
export function evaluateExpression(
  expression: string,
  context: StepContext
): boolean {
  const body = expression
    .trim()
    .replace(/^\$\{\{/, "")
    .replace(/\}\}$/, "")
    .trim();
  return body
    .split("&&")
    .map(term => term.trim())
    .every(term => {
      if (term === "always()") return true;
      const match = COMPARISON.exec(term);
      if (match === null) {
        throw new Error(
          "quality.yml uses a condition term this harness cannot evaluate: " +
            `${JSON.stringify(term)}. Teach it the operator rather than ` +
            "loosening the assertion — an unread term is a simulation that " +
            "has stopped mirroring the workflow."
        );
      }
      return operand(match[1], match[2], context) === match[3];
    });
}

/**
 * Runs one step's `run:` body under bash and records what GitHub would.
 * @param step The step, verbatim from the workflow.
 * @param options Where to run it and what environment to hand it.
 * @param options.cwd Working directory.
 * @param options.env The complete environment for the body.
 * @param options.continueOnError Whether GitHub would rewrite the conclusion.
 * @returns Outcome, conclusion, output, and anything written to the summary.
 */
export function runStep(
  step: WorkflowStep,
  options: {
    cwd: string;
    env: Record<string, string>;
    continueOnError: boolean;
  }
): StepResult {
  const summaryFile = emptied(`${options.cwd}/step-summary.md`);
  const result = boundedSpawnSync({
    label: `the ${step.name ?? "unnamed"} step`,
    command: BASH,
    args: ["-c", verbatimBody(step)],
    cwd: options.cwd,
    env: { ...options.env, GITHUB_STEP_SUMMARY: summaryFile },
  });
  const outcome: Outcome = result.status === 0 ? "success" : "failure";
  return {
    outcome,
    conclusion: options.continueOnError ? "success" : outcome,
    stdout: `${result.stdout ?? ""}${result.stderr ?? ""}`,
    summary: fs.readFileSync(summaryFile, "utf8"),
  };
}

/**
 * Runs the resolve step and returns what it wrote to `$GITHUB_OUTPUT`.
 * @param step The resolve step, verbatim from the workflow.
 * @param options Where to run it and what the workflow interpolates into it.
 * @param options.cwd Working directory holding the fixture project.
 * @param options.env The complete environment, including the step's `env:`.
 * @returns Exit status, combined output, and the parsed outputs.
 */
export function runResolve(
  step: WorkflowStep,
  options: { cwd: string; env: Record<string, string> }
): { status: number; text: string; outputs: Record<string, string> } {
  const outputFile = emptied(`${options.cwd}/github-output.txt`);
  const result = boundedSpawnSync({
    label: "the quality-gate resolve step",
    command: BASH,
    args: ["-c", verbatimBody(step)],
    cwd: options.cwd,
    env: { ...options.env, GITHUB_OUTPUT: outputFile },
  });
  return {
    status: result.status ?? -1,
    text: `${result.stdout ?? ""}${result.stderr ?? ""}`,
    outputs: parseOutputs(fs.readFileSync(outputFile, "utf8")),
  };
}
