/** Shared child_process provenance model and AST access primitives. */
import ts from "typescript";

/** Complete process-launch API family governed by the guard. */
export const CHILD_PROCESS_APIS = new Set([
  "exec",
  "execFile",
  "execFileSync",
  "execSync",
  "fork",
  "spawn",
  "spawnSync",
]);

/** Provenance resolved for one expression in its lexical scope. */
export type ChildProcessProvenance =
  | { readonly kind: "api"; readonly api: string }
  | {
      readonly kind: "container";
      readonly values: ReadonlyMap<string, ChildProcessProvenance>;
    }
  | { readonly kind: "factory"; readonly result: ChildProcessProvenance }
  | { readonly kind: "namespace" }
  | { readonly kind: "local" }
  | { readonly kind: "reflect"; readonly operation: string }
  | { readonly kind: "tainted"; readonly reason: string }
  | { readonly kind: "unknown" };

/** One lexical scope with shadowing-preserving bindings. */
export interface ChildProcessScope {
  readonly parent?: ChildProcessScope;
  readonly bindings: Map<string, ChildProcessBinding>;
}

/** One declaration whose initializer may inherit process provenance. */
export interface ChildProcessBinding {
  readonly scope: ChildProcessScope;
  readonly previous?: ChildProcessBinding;
  readonly ambiguityReason?: string;
  readonly expression?: ts.Expression;
  readonly expressionScope?: ChildProcessScope;
  readonly factory?: boolean;
  readonly property?: string;
  readonly seeded?: ChildProcessProvenance;
}

/** Indexed source and resolver shared by all analyzer passes. */
export interface ChildProcessScopeIndex {
  readonly source: ts.SourceFile;
  readonly scopeOf: (node: ts.Node) => ChildProcessScope;
  readonly resolve: (
    expression: ts.Expression,
    scope?: ChildProcessScope
  ) => ChildProcessProvenance;
}

/**
 * Whether a module specifier denotes Node's child-process namespace.
 * @param value - Literal module specifier
 * @returns Whether the specifier names child_process
 */
export function isChildProcessModule(value: string): boolean {
  return value === "node:child_process" || value === "child_process";
}

/**
 * Return a literal property name from dot or computed access.
 * @param expression - Candidate property access
 * @returns Literal property name or undefined for dynamic access
 */
export function accessedChildProperty(
  expression: ts.Expression
): string | undefined {
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  if (!ts.isElementAccessExpression(expression)) return undefined;
  const argument = expression.argumentExpression;
  return argument !== undefined &&
    (ts.isStringLiteral(argument) ||
      ts.isNoSubstitutionTemplateLiteral(argument))
    ? argument.text
    : undefined;
}

/**
 * Return the receiver of dot or computed access.
 * @param expression - Candidate property access
 * @returns Receiver expression or undefined
 */
export function childAccessReceiver(
  expression: ts.Expression
): ts.Expression | undefined {
  return ts.isPropertyAccessExpression(expression) ||
    ts.isElementAccessExpression(expression)
    ? expression.expression
    : undefined;
}

/**
 * Remove transparent syntax wrappers before provenance resolution.
 * @param expression - Wrapped expression
 * @returns Innermost semantic expression
 */
export function unwrapChildExpression(
  expression: ts.Expression
): ts.Expression {
  if (
    ts.isParenthesizedExpression(expression) ||
    ts.isAsExpression(expression) ||
    ts.isTypeAssertionExpression(expression) ||
    ts.isNonNullExpression(expression) ||
    ts.isAwaitExpression(expression)
  )
    return unwrapChildExpression(expression.expression);
  return expression;
}
