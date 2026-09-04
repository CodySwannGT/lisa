/** Memoized expression resolver for scope-aware child_process provenance. */
import ts from "typescript";

import {
  isChildProcessAcquisition,
  lookupChildBinding,
  returnedChildExpression,
} from "./test-run-child-process-bindings.js";
import {
  accessedChildProperty,
  childAccessReceiver,
  unwrapChildExpression,
  type ChildProcessBinding,
  type ChildProcessProvenance,
  type ChildProcessScope,
} from "./test-run-child-process-model.js";
import {
  childBindingPropertyProvenance,
  childOwnerAccessProvenance,
  mergeChildAlternatives,
} from "./test-run-child-process-provenance.js";
import { isProcessBearing } from "./test-run-child-process-source.js";

/** Resolver caches and lexical ownership shared by recursive resolution. */
interface ChildProcessResolverState {
  readonly active: ReadonlySet<ChildProcessBinding>;
  readonly source: ts.SourceFile;
  readonly root: ChildProcessScope;
  readonly scopes: WeakMap<ts.Node, ChildProcessScope>;
}

/**
 * Resolve one container literal and its process-tainted members.
 * @param expression - Container literal to inspect
 * @param scope - Lexical scope owning the literal
 * @param state - Resolver state
 * @returns Container provenance
 */
function containerProvenance(
  expression: ts.ObjectLiteralExpression | ts.ArrayLiteralExpression,
  scope: ChildProcessScope,
  state: ChildProcessResolverState
): ChildProcessProvenance {
  if (ts.isArrayLiteralExpression(expression)) {
    return {
      kind: "container",
      values: new Map(
        expression.elements.map((value, index) => [
          String(index),
          resolveChildExpression(state, value, scope),
        ])
      ),
    };
  }
  const entries = expression.properties.flatMap(property => {
    if (ts.isPropertyAssignment(property)) {
      const name = property.name
        .getText(state.source)
        .replace(/^['"]|['"]$/gu, "");
      return [
        [
          name,
          resolveChildExpression(state, property.initializer, scope),
        ] as const,
      ];
    }
    return ts.isShorthandPropertyAssignment(property)
      ? [
          [
            property.name.text,
            resolveChildExpression(state, property.name, scope),
          ] as const,
        ]
      : [];
  });
  return { kind: "container", values: new Map(entries) };
}

/**
 * Resolve dot/computed access for namespaces, containers, and Reflect.
 * @param expression - Candidate property access
 * @param scope - Lexical scope owning the access
 * @param state - Resolver state
 * @returns Access provenance or undefined for non-access expressions
 */
function accessProvenance(
  expression: ts.Expression,
  scope: ChildProcessScope,
  state: ChildProcessResolverState
): ChildProcessProvenance | undefined {
  const receiver = childAccessReceiver(expression);
  if (receiver === undefined) return undefined;
  const property = accessedChildProperty(expression);
  if (
    ts.isIdentifier(receiver) &&
    receiver.text === "Reflect" &&
    lookupChildBinding(scope, "Reflect") === undefined &&
    (property === "apply" || property === "construct")
  ) {
    return { kind: "reflect", operation: property };
  }
  const owner = resolveChildExpression(state, receiver, scope);
  return childOwnerAccessProvenance(owner, property);
}

/**
 * Resolve one binding while refusing alias cycles.
 * @param state - Resolver state
 * @param binding - Binding to resolve
 * @returns Resolved binding provenance
 */
function resolveChildBinding(
  state: ChildProcessResolverState,
  binding: ChildProcessBinding
): ChildProcessProvenance {
  if (state.active.has(binding))
    return binding.previous === undefined
      ? { kind: "tainted", reason: "cyclic alias" }
      : resolveChildBinding(state, binding.previous);
  const nextState = { ...state, active: new Set([...state.active, binding]) };
  const expressionValue =
    binding.expression === undefined
      ? (binding.seeded ?? { kind: "local" as const })
      : resolveChildExpression(
          nextState,
          binding.expression,
          binding.expressionScope ?? binding.scope
        );
  const inherited = binding.factory
    ? { kind: "factory" as const, result: expressionValue }
    : expressionValue;
  const result =
    binding.property === undefined
      ? inherited
      : childBindingPropertyProvenance(inherited, binding.property);
  return binding.previous === undefined
    ? result
    : mergeChildAlternatives(
        [resolveChildBinding(nextState, binding.previous), result],
        binding.ambiguityReason ?? "binding"
      );
}
/**
 * Resolve conditional, sequence, and logical binary expression provenance.
 * @param state - Resolver state
 * @param expression - Candidate control-flow expression
 * @param scope - Lexical scope owning the expression
 * @returns Merged provenance or undefined for another expression kind
 */
function controlFlowProvenance(
  state: ChildProcessResolverState,
  expression: ts.Expression,
  scope: ChildProcessScope
): ChildProcessProvenance | undefined {
  if (ts.isConditionalExpression(expression)) {
    return mergeChildAlternatives(
      [
        resolveChildExpression(state, expression.whenTrue, scope),
        resolveChildExpression(state, expression.whenFalse, scope),
      ],
      "conditional"
    );
  }
  if (!ts.isBinaryExpression(expression)) return undefined;
  const operator = expression.operatorToken.kind;
  if (operator === ts.SyntaxKind.CommaToken) {
    const left = resolveChildExpression(state, expression.left, scope);
    return isProcessBearing(left)
      ? { kind: "tainted", reason: "child_process sequence escape" }
      : resolveChildExpression(state, expression.right, scope);
  }
  if (
    ![
      ts.SyntaxKind.AmpersandAmpersandToken,
      ts.SyntaxKind.BarBarToken,
      ts.SyntaxKind.QuestionQuestionToken,
    ].includes(operator)
  )
    return undefined;
  return mergeChildAlternatives(
    [
      resolveChildExpression(state, expression.left, scope),
      resolveChildExpression(state, expression.right, scope),
    ],
    "logical expression"
  );
}

/**
 * Resolve a function expression as a provenance-returning factory.
 * @param state - Resolver state
 * @param expression - Candidate function expression
 * @param scope - Lexical scope owning the expression
 * @returns Factory provenance or undefined for a non-function
 */
function functionProvenance(
  state: ChildProcessResolverState,
  expression: ts.Expression,
  scope: ChildProcessScope
): ChildProcessProvenance | undefined {
  if (!ts.isFunctionExpression(expression) && !ts.isArrowFunction(expression)) {
    return undefined;
  }
  const returned = returnedChildExpression(expression);
  return returned === undefined
    ? { kind: "local" }
    : {
        kind: "factory",
        result: resolveChildExpression(
          state,
          returned,
          state.scopes.get(returned) ?? scope
        ),
      };
}

/**
 * Resolve a bound child-process or Reflect call target.
 * @param state - Resolver state
 * @param expression - Candidate bind call
 * @param scope - Lexical scope owning the call
 * @returns Bound provenance or undefined for another call shape
 */
function boundCallProvenance(
  state: ChildProcessResolverState,
  expression: ts.Expression,
  scope: ChildProcessScope
): ChildProcessProvenance | undefined {
  if (
    !ts.isCallExpression(expression) ||
    accessedChildProperty(expression.expression) !== "bind"
  )
    return undefined;
  const target = childAccessReceiver(expression.expression);
  const owner =
    target === undefined
      ? { kind: "unknown" as const }
      : resolveChildExpression(state, target, scope);
  if (owner.kind === "api") {
    return { kind: "tainted", reason: `bound child_process.${owner.api}` };
  }
  return owner.kind === "reflect"
    ? {
        kind: "tainted",
        reason: `bound Reflect.${owner.operation} child_process acquisition`,
      }
    : owner;
}

/**
 * Fail closed when unmodeled descendants carry process provenance.
 * @param state - Resolver state
 * @param expression - Expression whose descendants are inspected
 * @param scope - Lexical scope owning the expression
 * @returns Local or tainted provenance
 */
function nestedProvenance(
  state: ChildProcessResolverState,
  expression: ts.Expression,
  scope: ChildProcessScope
): ChildProcessProvenance {
  const nested = expression
    .getChildren()
    .flatMap(child =>
      ts.isExpression(child)
        ? [
            resolveChildExpression(
              state,
              child,
              state.scopes.get(child) ?? scope
            ),
          ]
        : []
    );
  return nested.some(isProcessBearing)
    ? {
        kind: "tainted",
        reason: `unmodeled child_process ${ts.SyntaxKind[expression.kind]}`,
      }
    : { kind: "local" };
}

/**
 * Resolve acquisitions, functions, containers, and lexical identifiers.
 * @param state - Resolver state
 * @param expression - Candidate direct expression
 * @param scope - Lexical scope owning the expression
 * @returns Direct provenance or undefined for another expression kind
 */
function directProvenance(
  state: ChildProcessResolverState,
  expression: ts.Expression,
  scope: ChildProcessScope
): ChildProcessProvenance | undefined {
  if (isChildProcessAcquisition(expression, scope))
    return { kind: "namespace" };
  const factory = functionProvenance(state, expression, scope);
  if (factory !== undefined) return factory;
  if (
    ts.isObjectLiteralExpression(expression) ||
    ts.isArrayLiteralExpression(expression)
  ) {
    return containerProvenance(expression, scope, state);
  }
  if (!ts.isIdentifier(expression)) return undefined;
  const binding = lookupChildBinding(scope, expression.text);
  return binding === undefined
    ? { kind: "unknown" }
    : resolveChildBinding(state, binding);
}

/**
 * Resolve bound calls, property access, and control-flow alternatives.
 * @param state - Resolver state
 * @param expression - Candidate derived expression
 * @param scope - Lexical scope owning the expression
 * @returns Derived provenance or undefined for another expression kind
 */
function derivedProvenance(
  state: ChildProcessResolverState,
  expression: ts.Expression,
  scope: ChildProcessScope
): ChildProcessProvenance | undefined {
  const bound = boundCallProvenance(state, expression, scope);
  if (bound !== undefined) return bound;
  const accessed = accessProvenance(expression, scope, state);
  if (accessed !== undefined) return accessed;
  return controlFlowProvenance(state, expression, scope);
}
/**
 * Resolve one expression against its nearest lexical binding.
 * @param state - Resolver state
 * @param raw - Expression to resolve
 * @param scope - Lexical scope owning the expression
 * @returns Resolved expression provenance
 */
function resolveChildExpression(
  state: ChildProcessResolverState,
  raw: ts.Expression,
  scope = state.scopes.get(raw) ?? state.root
): ChildProcessProvenance {
  const expression = unwrapChildExpression(raw);
  const direct = directProvenance(state, expression, scope);
  if (direct !== undefined) return direct;
  const derived = derivedProvenance(state, expression, scope);
  if (derived !== undefined) return derived;
  if (ts.isCallExpression(expression)) {
    const callee = resolveChildExpression(state, expression.expression, scope);
    return callee.kind === "factory" ? callee.result : { kind: "local" };
  }
  return nestedProvenance(state, expression, scope);
}

/**
 * Create one memoized resolver over a completed lexical scope tree.
 * @param source - Parsed source owning every expression
 * @param root - Root lexical scope
 * @param scopes - Per-node lexical scope lookup
 * @returns Recursive memoized expression resolver
 */
export function createChildProcessResolver(
  source: ts.SourceFile,
  root: ChildProcessScope,
  scopes: WeakMap<ts.Node, ChildProcessScope>
): (value: ts.Expression, owner?: ChildProcessScope) => ChildProcessProvenance {
  const state: ChildProcessResolverState = {
    active: new Set(),
    source,
    root,
    scopes,
  };
  return (value, owner) => resolveChildExpression(state, value, owner);
}
