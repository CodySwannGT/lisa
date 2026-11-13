/**
 * Helpers for `quality-integration-test-shards.test.ts` (#4599).
 *
 * `test_integration` and its shard legs run ONE step list, and which steps run
 * is decided by each step's `if:` against the job it runs in. This walks that
 * list the way the runner does, in order, so the suite can say exactly which
 * steps run in the unsharded job, in the sharded aggregate and in each leg.
 *
 * The evaluator covers the grammar the list uses: `&&`, `||`, `!`, parentheses,
 * `==`, `!=`, `>`, `always()`, literals and context paths. Anything else
 * throws, so a condition that outgrows it fails its test instead of passing.
 */
import type { WorkflowStep } from "../helpers/workflow-test-utils.js";

/** A value an expression can produce. */
type Value = string | number | boolean | null;

/** The values every context path a condition reads resolves to. */
export type Context = Readonly<Record<string, Value>>;

/** One parse result: its value and the tokens after it. */
type Parsed = readonly [Value, readonly string[]];

const TOKENS = /'[^']*'|always\(\)|[\w.-]+|&&|\|\||==|!=|>|!|[()]/g;

/**
 * Coerce a value to a boolean the way GitHub does.
 * @param value - Value
 * @returns Its truthiness
 */
const truthy = (value: Value): boolean =>
  value !== null && value !== false && value !== 0 && value !== "";

/**
 * Compare loosely, the way GitHub's `==` treats numbers and numeric strings.
 * @param left - Left operand
 * @param right - Right operand
 * @returns Whether they are equal
 */
function equal(left: Value, right: Value): boolean {
  if (typeof left === "number" || typeof right === "number")
    return Number(left) === Number(right);
  return String(left ?? "") === String(right ?? "");
}

/**
 * A literal, context path, `always()` or parenthesised group, optionally
 * negated.
 * @param tokens - Remaining tokens
 * @param context - Context values
 * @returns Value and the tokens after it
 */
function unary(tokens: readonly string[], context: Context): Parsed {
  const [head, ...rest] = tokens;
  if (head === "!") {
    const [value, after] = unary(rest, context);
    return [!truthy(value), after];
  }
  if (head === "(") {
    const [value, after] = disjunction(rest, context);
    if (after[0] !== ")") throw new Error("unbalanced (");
    return [value, after.slice(1)];
  }
  if (head === undefined) throw new Error("expression ended early");
  if (head === "always()") return [true, rest];
  if (head.startsWith("'")) return [head.slice(1, -1), rest];
  if (/^\d+$/.test(head)) return [Number(head), rest];
  if (!Object.hasOwn(context, head)) throw new Error(`no value for ${head}`);
  return [context[head] ?? null, rest];
}

/**
 * A comparison, or a lone operand.
 * @param tokens - Remaining tokens
 * @param context - Context values
 * @returns Value and the tokens after it
 */
function comparison(tokens: readonly string[], context: Context): Parsed {
  const [left, after] = unary(tokens, context);
  const operator = after[0];
  if (operator !== "==" && operator !== "!=" && operator !== ">")
    return [left, after];
  const [right, rest] = unary(after.slice(1), context);
  if (operator === ">") return [Number(left) > Number(right), rest];
  const same = equal(left, right);
  return [operator === "==" ? same : !same, rest];
}

/**
 * A run of `&&`-joined comparisons.
 * @param tokens - Remaining tokens
 * @param context - Context values
 * @returns Value and the tokens after it
 */
function conjunction(tokens: readonly string[], context: Context): Parsed {
  const [value, after] = comparison(tokens, context);
  if (after[0] !== "&&") return [value, after];
  const [rest, remaining] = conjunction(after.slice(1), context);
  return [truthy(value) ? rest : value, remaining];
}

/**
 * A run of `||`-joined conjunctions.
 * @param tokens - Remaining tokens
 * @param context - Context values
 * @returns Value and the tokens after it
 */
function disjunction(tokens: readonly string[], context: Context): Parsed {
  const [value, after] = conjunction(tokens, context);
  if (after[0] !== "||") return [value, after];
  const [rest, remaining] = disjunction(after.slice(1), context);
  return [truthy(value) ? value : rest, remaining];
}

/**
 * Evaluate a step condition.
 * @param expression - The `if:`, without `${{ }}`
 * @param context - Context values
 * @returns Whether the step runs
 */
export function evaluate(expression: string, context: Context): boolean {
  const [value, rest] = disjunction(expression.match(TOKENS) ?? [], context);
  if (rest.length > 0) throw new Error(`unparsed tail in ${expression}`);
  return truthy(value);
}

/** The outputs a step leaves when it runs, by step id. */
const RAN_OUTPUTS: Readonly<Record<string, Readonly<Record<string, string>>>> =
  {
    gate: { configured: "true", level: "required" },
    check_script: { exists: "true" },
  };

/** Every output key a guard in the step list reads. */
const OUTPUT_KEYS = ["configured", "level", "exists", "marker", "shard"];

/**
 * The state after a step with this id succeeded.
 * @param state - State before the step
 * @param id - The step's id, if any
 * @returns State with its outcome and outputs set
 */
function ranState(state: Context, id: string | undefined): Context {
  if (!id) return state;
  return {
    ...state,
    [`steps.${id}.outcome`]: "success",
    ...Object.fromEntries(
      Object.entries(RAN_OUTPUTS[id] ?? {}).map(([key, value]) => [
        `steps.${id}.outputs.${key}`,
        value,
      ])
    ),
  };
}

/**
 * Walk a step list in order and name the steps that run. A skipped step
 * leaves empty outputs and the outcome `skipped`; a run one succeeds and
 * leaves the outputs a Lisa run would (`RAN_OUTPUTS`).
 * @param steps - The step list
 * @param job - The job's context values
 * @returns Names of the steps that run
 */
export function stepsThatRun(
  steps: readonly WorkflowStep[],
  job: Context
): string[] {
  const initial: Context = Object.fromEntries(
    steps
      .flatMap(step => (step.id ? [step.id] : []))
      .flatMap(id => [
        [`steps.${id}.outcome`, "skipped"],
        ...OUTPUT_KEYS.map(key => [`steps.${id}.outputs.${key}`, ""] as const),
      ])
  );
  return steps.reduce<{ readonly state: Context; readonly ran: string[] }>(
    ({ state, ran }, step) =>
      step.if !== undefined && !evaluate(step.if, { ...job, ...state })
        ? { state, ran }
        : { state: ranState(state, step.id), ran: [...ran, step.name ?? ""] },
    { state: initial, ran: [] }
  ).ran;
}

/**
 * The context of one job of a Lisa pull-request run.
 * @param shards - `inputs.integration_test_shards`
 * @param total - `strategy.job-total`
 * @param index - `strategy.job-index`
 * @returns Context values
 */
export function lisaJob(shards: number, total: number, index: number): Context {
  return {
    "inputs.integration_test_shards": shards,
    "strategy.job-total": total,
    "strategy.job-index": index,
    "github.repository": "CodySwannGT/lisa",
    "github.event.pull_request.base.sha": "a".repeat(40),
    "inputs.package_manager": "bun",
    "inputs.cache_dependencies": true,
    "needs.test_integration_shard_plan.result":
      shards === 1 ? "skipped" : "success",
    "needs.test_integration_shard_build.result":
      shards === 1 ? "skipped" : "success",
  };
}
