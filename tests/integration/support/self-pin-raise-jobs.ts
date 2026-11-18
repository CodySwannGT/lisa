/**
 * Read-only views of the deploy workflow's two self-pin raise jobs
 * (CodySwannGT/lisa#4951), shared by the suites that hold each job to its
 * security and correctness contract.
 * @module tests/integration/support/self-pin-raise-jobs
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { load as loadYaml } from "js-yaml";
import { expect } from "vitest";

import { evaluateIf } from "../../helpers/workflow-job-graph.js";

/** Repository root, resolved from this file rather than the process cwd. */
const ROOT = path.join(import.meta.dirname, "..", "..", "..");

/** The workflow whose release job owns the self-pin raise. */
const DEPLOY_WORKFLOW = ".github/workflows/deploy.yml";

/** One deploy-workflow step, with the inputs and env this test reads. */
export interface DeployStep {
  /** The step's shell command, when it has one. */
  readonly run?: string;
  /** The action the step uses, when it uses one. */
  readonly uses?: string;
  /** The action's inputs. */
  readonly with?: Record<string, string | number | boolean>;
  /** The step's environment. */
  readonly env?: Record<string, string>;
  /** The step's run condition. */
  readonly if?: string;
}

/** One deploy-workflow job, as far as the raise wiring needs to see it. */
export interface DeployJob {
  /** Jobs this one waits for. */
  readonly needs?: readonly string[];
  /** The job's run condition. */
  readonly if?: string;
  /** The job's environment. */
  readonly env?: Record<string, string>;
  /** The job's steps. */
  readonly steps?: readonly DeployStep[];
}

/** The job that computes and proves the raise, holding no secret. */
export const PREPARE_JOB = "prepare_self_pin_raise";

/** The job that pushes the raise with the deploy key. */
export const PUSH_JOB = "push_self_pin_raise";

/** The only secret reference either job may carry, and only in one place. */
export const DEPLOY_KEY = "${{ secrets.DEPLOY_KEY }}";

/**
 * One job of the deploy workflow.
 * @param name - The job id.
 * @returns The job definition.
 */
export function deployJob(name: string): DeployJob {
  const workflow = loadYaml(
    readFileSync(path.join(ROOT, DEPLOY_WORKFLOW), "utf8")
  ) as { jobs: Record<string, DeployJob> };
  const job = workflow.jobs[name];
  expect(job, `${DEPLOY_WORKFLOW} has no ${name} job`).toBeDefined();
  return job as DeployJob;
}

/**
 * The `run:` bodies of a job's steps, in order.
 * @param name - The job id.
 * @returns One string per step, empty for action steps.
 */
export function runs(name: string): readonly string[] {
  return (deployJob(name).steps ?? []).map(step => step.run ?? "");
}

/**
 * Index of the first step whose `run:` contains the text.
 * @param name - The job id.
 * @param text - The text to find.
 * @returns The step index, or -1.
 */
export function stepIndex(name: string, text: string): number {
  return runs(name).findIndex(run => run.includes(text));
}

/**
 * A reference to the `secrets` context, in dot (`secrets.NAME`) or indexed
 * (`secrets['NAME']`) form — GitHub Actions accepts both.
 */
const SECRETS_CONTEXT = /\bsecrets\s*[.[]/;

/**
 * Every place a job mentions a secret, as `step-index:field` strings.
 * @param job - The job definition.
 * @returns Where secrets are referenced.
 */
export function secretReferencesIn(job: DeployJob): readonly string[] {
  const jobLevel = Object.values(job.env ?? {}).some(value =>
    SECRETS_CONTEXT.test(value)
  )
    ? ["job:env"]
    : [];
  const stepLevel = (job.steps ?? []).flatMap((step, index) =>
    SECRETS_CONTEXT.test(
      JSON.stringify({ with: step.with, env: step.env, run: step.run })
    )
      ? [`${index}`]
      : []
  );
  return [...jobLevel, ...stepLevel];
}

/**
 * Every place a deploy-workflow job mentions a secret.
 * @param name - The job id.
 * @returns Where secrets are referenced.
 */
export function secretReferences(name: string): readonly string[] {
  return secretReferencesIn(deployJob(name));
}

/**
 * Every `bun install` command in a job's run bodies, wrapped or not.
 * @param name - The job id.
 * @returns The trimmed lines that run `bun install`.
 */
export function installs(name: string): readonly string[] {
  return runs(name)
    .flatMap(run => run.split("\n"))
    .map(line => line.trim())
    .filter(line => /(?:^|[\s;&|(])bun\s+install\b/.test(line));
}

/**
 * Split an expression at a top-level operator, ignoring any inside parentheses.
 * @param body - The expression text.
 * @param operator - `&&` or `||`.
 * @returns The operands, untrimmed.
 */
function splitTopLevel(body: string, operator: "&&" | "||"): readonly string[] {
  const parts: string[] = [];
  const state = { depth: 0, start: 0 };
  Array.from(body).forEach((character, index) => {
    if (character === "(") state.depth += 1;
    if (character === ")") state.depth -= 1;
    if (state.depth === 0 && body.startsWith(operator, index)) {
      parts.push(body.slice(state.start, index));
      state.start = index + operator.length;
    }
  });
  return [...parts, body.slice(state.start)];
}

/**
 * Evaluate a job's `if:` — a conjunction whose terms may each be one
 * parenthesized disjunction — using the shared evaluator for every leaf.
 * @param expression - The raw `if:` value.
 * @param context - The `needs` context to evaluate against.
 * @returns Whether GitHub would start the job.
 */
export function guardPasses(
  expression: string,
  context: Record<string, unknown>
): boolean {
  const body = expression
    .trim()
    .replace(/^\$\{\{/, "")
    .replace(/\}\}$/, "");
  return splitTopLevel(body, "&&").every(term => {
    const text = term.trim();
    return text.startsWith("(") && text.endsWith(")")
      ? splitTopLevel(text.slice(1, -1), "||").some(leaf =>
          evaluateIf(leaf, context)
        )
      : evaluateIf(text, context);
  });
}

/**
 * The `actions/checkout` steps of a job.
 * @param name - The job id.
 * @returns Every checkout step in that job.
 */
export function checkouts(name: string): readonly DeployStep[] {
  return (deployJob(name).steps ?? []).filter(step =>
    (step.uses ?? "").startsWith("actions/checkout@")
  );
}
