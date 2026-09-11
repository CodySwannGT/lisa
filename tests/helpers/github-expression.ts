/** Evaluate shipped workflow conditions with GitHub's expression interpreter. */
import { data, Evaluator, Lexer, Parser } from "@actions/expressions";

/**
 * Interpret a workflow condition without executing it as JavaScript.
 * @param expression The shipped expression, optionally wrapped in delimiters.
 * @param context Plain workflow contexts for this case.
 * @param cancelled Whether this case represents a canceled workflow.
 * @returns Whether the expression resolves to true.
 */
export function githubCondition(
  expression: string,
  context: Record<string, unknown>,
  cancelled = false
): boolean {
  const source = expression
    .trim()
    .replace(/^\$\{\{|\}\}$/gu, "")
    .trim();
  const functions = [
    {
      name: "always",
      minArgs: 0,
      maxArgs: 0,
      call: () => new data.BooleanData(true),
    },
    {
      name: "cancelled",
      minArgs: 0,
      maxArgs: 0,
      call: () => new data.BooleanData(cancelled),
    },
  ];
  const tokens = new Lexer(source).lex().tokens;
  const parsed = new Parser(tokens, Object.keys(context), functions).parse();
  const values = JSON.parse(
    JSON.stringify(context),
    data.reviver
  ) as data.Dictionary;
  const evaluator = new Evaluator(
    parsed,
    values,
    new Map(functions.map(fn => [fn.name, fn]))
  );
  return evaluator.evaluate().coerceString() === "true";
}
