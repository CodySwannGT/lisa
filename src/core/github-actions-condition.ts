/**
 * A deliberately small evaluator for the subset of GitHub Actions expression
 * syntax that Lisa's deploy workflows use in a job-level `if:`, plus the rule
 * that turns the result into "this job RAN" or "this job was SKIPPED".
 *
 * It exists because the defect in #3467 is invisible to anything that only
 * reads the YAML for the presence or absence of a substring. What went wrong
 * was a job OUTCOME — a deploy that was skipped rather than failed — and an
 * outcome is what has to be established. Lisa never runs a host's deploy
 * workflow itself, so no observation of CI can stand in for that; the
 * expression has to be evaluated against a scenario.
 *
 * ## Why this is production code and not a test helper
 *
 * It began as one, under `tests/integration/`. It moved here when #3740 needed
 * the same question answered in a host repository — *would this job skip
 * because the release failed?* — by `lisa doctor` and by the migration that
 * repairs an already-seeded `deploy.yml`. Reimplementing GitHub's implicit
 * `success()` rule a second time in `src/` would have put two subtly different
 * copies of one semantics in the tree, which is the drift this repository
 * repeatedly pays for. There is one implementation, and the test that made it
 * imports it from here.
 *
 * The evaluator THROWS on anything outside the supported subset rather than
 * guessing. An expression it cannot parse must never quietly evaluate to a
 * plausible-looking boolean: a caller that cannot read a condition must say so,
 * because reporting a confident verdict about an expression nobody understood
 * is the failure mode this whole family of checks exists to catch.
 *
 * Supported: `&&`, `||`, `!`, `==`, `!=`, parentheses, single-quoted strings,
 * `true`/`false`, the status functions `always()` / `cancelled()` / `success()`
 * / `failure()`, the string functions `startsWith()` / `contains()`, and
 * context paths under `needs.`, `github.` and `inputs.`.
 * @module core/github-actions-condition
 */

/** The four conclusions a `needs` job can report to a dependent job. */
export type JobResult = "success" | "failure" | "cancelled" | "skipped";

/** One upstream job as a dependent job sees it. */
export interface NeedsEntry {
  readonly result: JobResult;
  readonly outputs?: Readonly<Record<string, string>>;
}

/** The run state a job-level `if:` is evaluated against. */
export interface RunScenario {
  readonly needs: Readonly<Record<string, NeedsEntry>>;
  /** Flattened `github.*` paths, e.g. `github.event.head_commit.message`. */
  readonly github: Readonly<Record<string, string>>;
  /** Flattened `inputs.*` values. */
  readonly inputs?: Readonly<Record<string, string>>;
  /** Whether an operator cancelled the run. */
  readonly cancelled: boolean;
}

/** What an evaluated expression yields. */
type Value = string | boolean;

/** One parse result: the value, and where the parser got to. */
interface Parsed {
  readonly value: Value;
  readonly index: number;
}

/** The status functions whose presence removes GitHub's implicit `success()`. */
const STATUS_FUNCTIONS = ["always", "cancelled", "success", "failure"] as const;

/** The two-character operators, matched before the single-character ones. */
const PAIR_OPERATORS = ["&&", "||", "==", "!="];

/**
 * Read the single token at the head of the text.
 * @param text - Expression text with leading whitespace already removed
 * @returns The token, quotes included for a string literal
 */
function headToken(text: string): string {
  if (text.startsWith("'")) {
    const close = text.indexOf("'", 1);
    if (close < 0) {
      throw new Error(`unterminated string in expression: ${text}`);
    }
    return text.slice(0, close + 1);
  }
  if (PAIR_OPERATORS.includes(text.slice(0, 2))) {
    return text.slice(0, 2);
  }
  if ("()!,".includes(text.slice(0, 1))) {
    return text.slice(0, 1);
  }
  const word = /^[A-Za-z0-9_.-]+/.exec(text)?.[0];
  if (!word) {
    throw new Error(
      `unsupported character '${text.slice(0, 1)}' in expression`
    );
  }
  return word;
}

/**
 * Split an expression into tokens.
 * @param source - Raw `if:` text, with any `${{ }}` wrapper already stripped
 * @returns The token list
 */
export function tokenize(source: string): readonly string[] {
  const text = source.trimStart();
  if (text === "") {
    return [];
  }
  const token = headToken(text);
  return [token, ...tokenize(text.slice(token.length))];
}

/**
 * GitHub's string-to-boolean cast: only the empty string is falsy.
 * @param value - An evaluated operand
 * @returns Its truthiness
 */
function truthy(value: Value): boolean {
  return typeof value === "boolean" ? value : value !== "";
}

/**
 * GitHub compares strings case-insensitively; every operand here is a string or
 * a boolean, so a normalized string comparison is the whole rule.
 * @param left - Left operand
 * @param right - Right operand
 * @returns Whether the two are equal
 */
function equal(left: Value, right: Value): boolean {
  return String(left).toLowerCase() === String(right).toLowerCase();
}

/**
 * Resolve one `needs.*` path.
 * @param segments - The dot-split path
 * @param scenario - The run state
 * @returns The value
 */
function resolveNeeds(
  segments: readonly string[],
  scenario: RunScenario
): Value {
  const entry = scenario.needs[segments[1] ?? ""];
  if (!entry) {
    throw new Error(
      `expression reads ${segments.join(".")}, absent from needs`
    );
  }
  if (segments[2] === "result") {
    return entry.result;
  }
  if (segments[2] !== "outputs") {
    throw new Error(`unsupported needs path: ${segments.join(".")}`);
  }
  // A job that did not succeed publishes no outputs at all. Modelling that is
  // load-bearing: `needs.x.outputs.y == 'true'` is the shape that silently
  // turns an upstream failure into a skipped dependent.
  return entry.result === "success"
    ? (entry.outputs?.[segments[3] ?? ""] ?? "")
    : "";
}

/**
 * Resolve one dotted context path against the scenario.
 * @param path - A path such as `needs.release.result`
 * @param scenario - The run state
 * @returns The value, or `""` for a path that resolves to nothing
 */
function resolvePath(path: string, scenario: RunScenario): Value {
  if (path === "true" || path === "false") {
    return path === "true";
  }
  const segments = path.split(".");
  if (segments[0] === "needs") {
    return resolveNeeds(segments, scenario);
  }
  if (segments[0] === "github") {
    return scenario.github[path] ?? "";
  }
  if (segments[0] === "inputs") {
    return scenario.inputs?.[segments[1] ?? ""] ?? "";
  }
  throw new Error(`unsupported context path: ${path}`);
}

/**
 * Evaluate a call to one of the supported functions.
 * @param name - Function name
 * @param args - Already-evaluated arguments
 * @param scenario - The run state
 * @returns The call's value
 */
function callFunction(
  name: string,
  args: readonly Value[],
  scenario: RunScenario
): Value {
  const results = Object.values(scenario.needs).map(entry => entry.result);
  const first = String(args[0] ?? "").toLowerCase();
  const second = String(args[1] ?? "").toLowerCase();
  switch (name) {
    case "always":
      return true;
    case "cancelled":
      return scenario.cancelled;
    case "success":
      return !scenario.cancelled && results.every(r => r === "success");
    case "failure":
      return results.includes("failure");
    case "startsWith":
      return first.startsWith(second);
    case "contains":
      return first.includes(second);
    default:
      throw new Error(`unsupported function: ${name}()`);
  }
}

/**
 * Collect and evaluate a function call's arguments.
 * @param tokens - The token list
 * @param index - Position just after the opening parenthesis
 * @param scenario - The run state
 * @param collected - Arguments parsed so far
 * @returns The arguments and the position just after the closing parenthesis
 */
function callArguments(
  tokens: readonly string[],
  index: number,
  scenario: RunScenario,
  collected: readonly Value[]
): { readonly args: readonly Value[]; readonly index: number } {
  if (tokens[index] === ")") {
    return { args: collected, index: index + 1 };
  }
  const argument = expression(tokens, index, scenario);
  const next =
    tokens[argument.index] === "," ? argument.index + 1 : argument.index;
  return callArguments(tokens, next, scenario, [...collected, argument.value]);
}

/**
 * Parse and evaluate a primary term: a negation, a parenthesized expression, a
 * string literal, a function call, or a context path.
 * @param tokens - The token list
 * @param index - Position of the term's first token
 * @param scenario - The run state
 * @returns The term's value and the position after it
 */
function primary(
  tokens: readonly string[],
  index: number,
  scenario: RunScenario
): Parsed {
  const token = tokens[index];
  if (token === undefined) {
    throw new Error("expression ended early");
  }
  if (token === "!") {
    const inner = primary(tokens, index + 1, scenario);
    return { value: !truthy(inner.value), index: inner.index };
  }
  if (token === "(") {
    const inner = expression(tokens, index + 1, scenario);
    if (tokens[inner.index] !== ")") {
      throw new Error("unbalanced parentheses in expression");
    }
    return { value: inner.value, index: inner.index + 1 };
  }
  if (token.startsWith("'")) {
    return { value: token.slice(1, -1), index: index + 1 };
  }
  if (tokens[index + 1] === "(") {
    const call = callArguments(tokens, index + 2, scenario, []);
    return {
      value: callFunction(token, call.args, scenario),
      index: call.index,
    };
  }
  return { value: resolvePath(token, scenario), index: index + 1 };
}

/**
 * Parse and evaluate an equality comparison.
 * @param tokens - The token list
 * @param index - Position of the comparison's first token
 * @param scenario - The run state
 * @returns The comparison's value and the position after it
 */
function comparison(
  tokens: readonly string[],
  index: number,
  scenario: RunScenario
): Parsed {
  const left = primary(tokens, index, scenario);
  const operator = tokens[left.index];
  if (operator !== "==" && operator !== "!=") {
    return left;
  }
  const right = primary(tokens, left.index + 1, scenario);
  const same = equal(left.value, right.value);
  return { value: operator === "==" ? same : !same, index: right.index };
}

/**
 * Fold the `&&` / `||` operators that follow an already-parsed operand.
 * @param left - The operand parsed so far
 * @param tokens - The token list
 * @param scenario - The run state
 * @returns The folded value and the position after it
 */
function logicalTail(
  left: Parsed,
  tokens: readonly string[],
  scenario: RunScenario
): Parsed {
  const operator = tokens[left.index];
  if (operator !== "&&" && operator !== "||") {
    return left;
  }
  const right = comparison(tokens, left.index + 1, scenario);
  const value =
    operator === "&&"
      ? truthy(left.value) && truthy(right.value)
      : truthy(left.value) || truthy(right.value);
  return logicalTail({ value, index: right.index }, tokens, scenario);
}

/**
 * Parse and evaluate a full expression.
 * @param tokens - The token list
 * @param index - Position of the expression's first token
 * @param scenario - The run state
 * @returns The expression's value and the position after it
 */
function expression(
  tokens: readonly string[],
  index: number,
  scenario: RunScenario
): Parsed {
  return logicalTail(comparison(tokens, index, scenario), tokens, scenario);
}

/**
 * Evaluate a job-level `if:` under one scenario.
 * @param condition - The raw `if:` text
 * @param scenario - The run state
 * @returns Whether the condition holds
 */
export function evaluateCondition(
  condition: string,
  scenario: RunScenario
): boolean {
  const stripped = condition
    .trim()
    .replace(/^\$\{\{/, "")
    .replace(/\}\}$/, "")
    .trim();
  const tokens = tokenize(stripped);
  const parsed = expression(tokens, 0, scenario);
  if (parsed.index !== tokens.length) {
    throw new Error(`unparsed tail in expression: ${condition}`);
  }
  return truthy(parsed.value);
}

/**
 * Whether a job with this `if:` runs, applying GitHub's rule that an implicit
 * `success()` is ANDed on unless the condition names a status function.
 *
 * That implicit AND is the whole mechanism behind the rails half of #3467: the
 * condition there said nothing about the release at all, and still skipped when
 * the release failed.
 * @param condition - The raw `if:` text, or `""` when the job has none
 * @param scenario - The run state
 * @returns True when the job runs, false when GitHub skips it
 */
export function jobRuns(condition: string, scenario: RunScenario): boolean {
  const results = Object.values(scenario.needs).map(entry => entry.result);
  const dependenciesSucceeded =
    !scenario.cancelled && results.every(result => result === "success");
  if (condition.trim() === "") {
    return dependenciesSucceeded;
  }
  const namesStatusFunction = STATUS_FUNCTIONS.some(name =>
    new RegExp(`\\b${name}\\s*\\(`).test(condition)
  );
  const holds = evaluateCondition(condition, scenario);
  return namesStatusFunction ? holds : holds && dependenciesSucceeded;
}
