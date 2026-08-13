/**
 * A minimal GitHub Actions job-graph simulator, for questions of the form
 * "how many times does this command actually run?".
 *
 * Reading a workflow and asserting that a job exists proves nothing about
 * execution counts — the counts fall out of matrix fan-out, `needs` edges, and
 * job/step `if` guards interacting. This module evaluates those three things
 * against a parsed workflow so a test can assert the number directly.
 *
 * The expression evaluator supports exactly the grammar Lisa's workflows use in
 * their guards: `&&`-joined terms of `!cancelled()` / `always()` / `success()`,
 * `contains(fromJSON('[…]'), path)`, `path == 'literal'`, `path != 'literal'`,
 * and a bare truthiness path. Anything outside that grammar THROWS rather than
 * evaluating to whatever is convenient — a simulator that quietly mis-parses a
 * guard would prove the opposite of what its test claims.
 *
 * @module tests/helpers/workflow-job-graph
 */

/** A job result GitHub can report to a dependent job. */
export type JobResult = "success" | "failure" | "skipped";

/** The subset of a step this simulator reads. */
export interface SimulatedStep {
  id?: string;
  name?: string;
  run?: string;
  if?: string;
  env?: Record<string, unknown>;
}

/** The subset of a job this simulator reads. */
export interface SimulatedJob {
  needs?: string | string[];
  if?: string;
  outputs?: Record<string, string>;
  strategy?: { matrix?: Record<string, unknown> };
  steps?: SimulatedStep[];
}

/** The subset of a workflow this simulator reads. */
export interface SimulatedWorkflow {
  jobs: Record<string, SimulatedJob>;
}

/** One job's simulated outcome. */
export interface JobOutcome {
  /** Whether the job's guard passed, i.e. GitHub would start it. */
  ran: boolean;
  /** How many runner instances it fans out to (1 unless it has a matrix). */
  instances: number;
  result: JobResult;
  outputs: Record<string, string>;
}

/** What a simulated run produced. */
export interface SimulationResult {
  jobs: Record<string, JobOutcome>;
  /** How many step instances executed each `${{ inputs.<name> }}` command. */
  commandExecutions: Record<string, number>;
}

/** Options for one simulated run. */
export interface SimulationOptions {
  /** The seed job every other job depends on, and the outputs it published. */
  seed: { name: string; outputs: Record<string, string> };
  /** The caller's `with:` block. */
  inputs: Record<string, unknown>;
  /** Force a job that DOES start to conclude with this result instead. */
  forcedResults?: Record<string, JobResult>;
}

const SUCCESS: JobResult = "success";
const SKIPPED: JobResult = "skipped";

const ALWAYS_TRUE = ["!cancelled()", "always()", "success()"];
const ALWAYS_FALSE = ["cancelled()", "failure()"];
const CONTAINS_RE = /^contains\(fromJSON\('(.+)'\),\s*([\w.]+)\)$/;
const COMPARISON_RE = /^([\w.]+)\s*(==|!=)\s*'([^']*)'$/;
const BARE_PATH_RE = /^[\w.]+$/;
const MATRIX_RE = /^\$\{\{\s*fromJSON\((.+)\)\s*\}\}$/;
const COMMAND_RE = /\$\{\{\s*inputs\.(\w+)\s*\}\}/;

/** The `needs` / `inputs` a guard can see. */
type ExpressionContext = Record<string, unknown>;

/**
 * Resolves a dotted context path such as `needs.pre_suite.result`.
 *
 * @param ctx The evaluation context.
 * @param dotted The dotted path.
 * @returns The resolved value, or undefined when any segment is missing.
 */
const resolvePath = (ctx: ExpressionContext, dotted: string): unknown =>
  dotted
    .split(".")
    .reduce<unknown>(
      (acc, segment) =>
        acc !== null && typeof acc === "object"
          ? (acc as Record<string, unknown>)[segment]
          : undefined,
      ctx
    );

/**
 * GitHub's truthiness: a real boolean, or any non-empty string.
 *
 * @param value The resolved value.
 * @returns Whether the value is truthy.
 */
const isTruthy = (value: unknown): boolean =>
  typeof value === "boolean" ? value : String(value ?? "") !== "";

/**
 * Evaluates one `&&`-separated term of a guard.
 *
 * @param term The term source text.
 * @param ctx The evaluation context.
 * @returns Whether the term is truthy.
 */
const evaluateTerm = (term: string, ctx: ExpressionContext): boolean => {
  const text = term.trim();
  const contains = CONTAINS_RE.exec(text);
  const comparison = COMPARISON_RE.exec(text);
  if (ALWAYS_TRUE.includes(text)) return true;
  if (ALWAYS_FALSE.includes(text)) return false;
  if (contains) {
    const allowed = JSON.parse(contains[1]) as string[];
    return allowed.includes(String(resolvePath(ctx, contains[2]) ?? ""));
  }
  if (comparison) {
    const actual = String(resolvePath(ctx, comparison[1]) ?? "");
    return comparison[2] === "=="
      ? actual === comparison[3]
      : actual !== comparison[3];
  }
  if (BARE_PATH_RE.test(text)) return isTruthy(resolvePath(ctx, text));
  throw new Error(`unsupported expression term in workflow guard: '${text}'`);
};

/**
 * Evaluates a whole `if:` expression, with or without its `${{ }}` wrapper.
 *
 * @param expression The raw `if:` value, or undefined for an absent guard.
 * @param ctx The evaluation context.
 * @returns Whether the guard passes.
 */
export const evaluateIf = (
  expression: string | undefined,
  ctx: ExpressionContext
): boolean => {
  if (expression === undefined) return true;
  const body = expression
    .trim()
    .replace(/^\$\{\{/, "")
    .replace(/\}\}$/, "");
  return body.split("&&").every(term => evaluateTerm(term, ctx));
};

/**
 * Normalizes a job's `needs` to a list.
 *
 * @param job The job.
 * @returns The dependency job names.
 */
const needsOf = (job: SimulatedJob): string[] =>
  typeof job.needs === "string" ? [job.needs] : (job.needs ?? []);

/**
 * Builds the context a job's guards evaluate against.
 *
 * @param job The job.
 * @param jobs The outcomes of jobs simulated so far.
 * @param inputs The caller's inputs.
 * @returns The evaluation context.
 */
const contextFor = (
  job: SimulatedJob,
  jobs: Record<string, JobOutcome>,
  inputs: Record<string, unknown>
): ExpressionContext => ({
  inputs,
  needs: Object.fromEntries(
    needsOf(job).map(dependency => [
      dependency,
      {
        result: jobs[dependency]?.result ?? SKIPPED,
        outputs: jobs[dependency]?.outputs ?? {},
      },
    ])
  ),
});

/**
 * Decides whether GitHub would start the job.
 *
 * An absent `if:` means the implicit default — every dependency succeeded.
 *
 * @param job The job.
 * @param ctx The evaluation context.
 * @param jobs The outcomes of jobs simulated so far.
 * @returns Whether the job starts.
 */
const guardPasses = (
  job: SimulatedJob,
  ctx: ExpressionContext,
  jobs: Record<string, JobOutcome>
): boolean =>
  job.if === undefined
    ? needsOf(job).every(dependency => jobs[dependency]?.result === SUCCESS)
    : evaluateIf(job.if, ctx);

/**
 * Counts the runner instances a job fans out to.
 *
 * @param job The job.
 * @param ctx The evaluation context.
 * @returns The instance count (1 when the job has no matrix).
 */
const instancesOf = (job: SimulatedJob, ctx: ExpressionContext): number => {
  const expression = job.strategy?.matrix?.platform;
  if (typeof expression !== "string") return 1;
  const inner = MATRIX_RE.exec(expression);
  if (!inner) return 1;
  const resolved = resolvePath(ctx, inner[1].trim());
  return (JSON.parse(String(resolved ?? "[]")) as string[]).length;
};

/**
 * Counts this job's `${{ inputs.<name> }}` step executions.
 *
 * @param job The job.
 * @param ctx The evaluation context.
 * @param instances How many runner instances the job fans out to.
 * @returns Per-input execution counts contributed by this job alone.
 */
const tallyOf = (
  job: SimulatedJob,
  ctx: ExpressionContext,
  instances: number
): Record<string, number> =>
  (job.steps ?? []).reduce<Record<string, number>>((acc, step) => {
    const match = COMMAND_RE.exec(step.run ?? "");
    return match && evaluateIf(step.if, ctx)
      ? { ...acc, [match[1]]: (acc[match[1]] ?? 0) + instances }
      : acc;
  }, {});

/**
 * Sums two per-input execution tallies.
 *
 * @param base The running tally.
 * @param added One job's contribution.
 * @returns A new merged tally.
 */
const mergeTallies = (
  base: Record<string, number>,
  added: Record<string, number>
): Record<string, number> =>
  Object.entries(added).reduce(
    (acc, [key, count]) => ({ ...acc, [key]: (acc[key] ?? 0) + count }),
    base
  );

/**
 * Simulates a whole workflow run and counts command executions.
 *
 * Jobs are visited in declaration order, which every workflow this is used
 * against keeps topological.
 *
 * @param workflow The parsed workflow.
 * @param options The seed job's outputs, the caller inputs, and forced results.
 * @returns The per-job outcomes and per-input execution counts.
 */
export const simulateRun = (
  workflow: SimulatedWorkflow,
  options: SimulationOptions
): SimulationResult =>
  Object.entries(workflow.jobs).reduce<SimulationResult>(
    (state, [name, job]) => {
      if (name === options.seed.name) return state;
      const ctx = contextFor(job, state.jobs, options.inputs);
      const started = guardPasses(job, ctx, state.jobs);
      const result = started
        ? (options.forcedResults?.[name] ?? SUCCESS)
        : SKIPPED;
      const instances = started ? instancesOf(job, ctx) : 0;
      const contributed =
        result === SUCCESS ? tallyOf(job, ctx, instances) : {};
      return {
        jobs: {
          ...state.jobs,
          [name]: { ran: started, instances, result, outputs: {} },
        },
        commandExecutions: mergeTallies(state.commandExecutions, contributed),
      };
    },
    {
      jobs: {
        [options.seed.name]: {
          ran: true,
          instances: 1,
          result: SUCCESS,
          outputs: options.seed.outputs,
        },
      },
      commandExecutions: {},
    }
  );
