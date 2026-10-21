/**
 * Helpers for `quality-unit-test-shards.test.ts` (#4479).
 *
 * Split out for the file-length cap. Two instruments live here: one runs a
 * workflow step's shell body with GitHub's file-command files in place, and
 * one evaluates a job or step `if:` the way the runner does, for the small
 * expression grammar the shard conditions use.
 */
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { env as processEnv } from "node:process";

import { stepsIn } from "./quality-gate-facade-fixture.js";
import { boundedSpawnSync } from "../helpers/io-latency-budget.js";
import type {
  WorkflowJob,
  WorkflowStep,
} from "../helpers/workflow-test-utils.js";

/** The job fields the suite reads that the shared shape leaves out. */
export type ShardSuiteJob = WorkflowJob & {
  needs?: string[];
  strategy?: { "fail-fast"?: boolean; matrix?: Record<string, unknown> };
  "timeout-minutes"?: unknown;
};

/** What one executed step left behind. */
export interface StepOutcome {
  readonly status: number | null;
  readonly stdout: string;
  readonly output: string;
  readonly env: string;
  readonly runnerTemp: string;
}

/**
 * One named step of one job, failing by name when it is absent.
 * @param job - Job id
 * @param name - Step display name
 * @returns The step
 */
export function stepNamed(job: string, name: string): WorkflowStep {
  const found = stepsIn(job).find(candidate => candidate.name === name);
  if (found === undefined) throw new Error(`${job} has no step "${name}"`);
  return found;
}

/**
 * Lay out GitHub's file-command files in a fresh registered directory.
 * @param register - Suite-local teardown registry
 * @returns The file-command paths and the directory holding them
 */
function fileCommands(register: (directory: string) => void) {
  const root = fs.mkdtempSync(path.join(tmpdir(), "lisa-unit-shards-"));
  const files = {
    GITHUB_OUTPUT: path.join(root, "output"),
    GITHUB_ENV: path.join(root, "env"),
    RUNNER_TEMP: path.join(root, "runner-temp"),
  };
  register(root);
  fs.writeFileSync(files.GITHUB_OUTPUT, "");
  fs.writeFileSync(files.GITHUB_ENV, "");
  fs.mkdirSync(files.RUNNER_TEMP);
  return { root, files };
}

/**
 * Run one workflow shell body with GitHub's file-command files in place.
 * @param body - Step `run:` source
 * @param env - Step environment
 * @param register - Suite-local teardown registry
 * @returns Exit status, output, and what the step wrote to GITHUB_OUTPUT/ENV
 */
export function executeStep(
  body: string | undefined,
  env: Record<string, string>,
  register: (directory: string) => void
): StepOutcome {
  const { root, files } = fileCommands(register);
  const result = boundedSpawnSync({
    label: "unit-test shard workflow step",
    command: "bash",
    args: ["--noprofile", "--norc", "-c", body ?? ""],
    cwd: root,
    env: { ...processEnv, ...files, ...env },
  });
  return {
    status: result.status,
    stdout: result.stdout,
    output: fs.readFileSync(files.GITHUB_OUTPUT, "utf8"),
    env: fs.readFileSync(files.GITHUB_ENV, "utf8"),
    runnerTemp: files.RUNNER_TEMP,
  };
}

/** A parsed prefix: its value and the tokens after it. */
type Parsed = readonly [boolean, readonly string[]];

/** The values an expression reads, by context path. */
type Context = Readonly<Record<string, string | number>>;

/**
 * One comparison operand as the string GitHub compares it as.
 * @param token - Literal or context path
 * @param context - Context values
 * @returns The operand's value
 */
function operand(token: string | undefined, context: Context): string {
  if (token === undefined) throw new Error("expression ended mid-comparison");
  if (token.startsWith("'")) return token.slice(1, -1);
  if (/^-?\d+(\.\d+)?$/.test(token)) return token;
  const value = context[token];
  if (value === undefined) throw new Error(`no value for "${token}"`);
  return String(value);
}

/**
 * A parenthesised group or one `==` / `!=` comparison.
 * @param tokens - Remaining tokens
 * @param context - Context values
 * @returns Its value and the tokens after it
 */
function primary(tokens: readonly string[], context: Context): Parsed {
  const [head, operator, right, ...tail] = tokens;
  if (head === "(") {
    const [value, after] = disjunction(tokens.slice(1), context);
    if (after[0] !== ")") throw new Error("unbalanced (");
    return [value, after.slice(1)];
  }
  const left = operand(head, context);
  const other = operand(right, context);
  if (operator === "==") return [left === other, tail];
  if (operator === "!=") return [left !== other, tail];
  throw new Error(`unsupported operator "${String(operator)}"`);
}

/**
 * A run of `&&`-joined comparisons.
 * @param tokens - Remaining tokens
 * @param context - Context values
 * @returns Its value and the tokens after it
 */
function conjunction(tokens: readonly string[], context: Context): Parsed {
  const [value, after] = primary(tokens, context);
  if (after[0] !== "&&") return [value, after];
  const [rest, remaining] = conjunction(after.slice(1), context);
  return [value && rest, remaining];
}

/**
 * A run of `||`-joined conjunctions.
 * @param tokens - Remaining tokens
 * @param context - Context values
 * @returns Its value and the tokens after it
 */
function disjunction(tokens: readonly string[], context: Context): Parsed {
  const [value, after] = conjunction(tokens, context);
  if (after[0] !== "||") return [value, after];
  const [rest, remaining] = disjunction(after.slice(1), context);
  return [value || rest, remaining];
}

/**
 * Evaluate a GitHub `if:` built from `&&`, `||`, parentheses and `==`/`!=`
 * comparisons of context paths with literals — the whole grammar the shard
 * conditions use. Anything else throws rather than guessing, so a condition
 * that outgrows this evaluator fails its test instead of passing it.
 * @param expression - The condition, without `${{ }}`
 * @param context - Value for every context path the condition reads
 * @returns The condition's truth value
 */
export function evaluateCondition(
  expression: string,
  context: Context
): boolean {
  const tokens = expression.match(/'[^']*'|[\w.]+|&&|\|\||==|!=|[()]/g) ?? [];
  const [value, rest] = disjunction(tokens, context);
  if (rest.length > 0) throw new Error(`unparsed tail in ${expression}`);
  return value;
}
