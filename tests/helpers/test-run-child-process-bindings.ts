/** Lexical binding materialization for child_process alias analysis. */
import ts from "typescript";

import {
  createChildProcessScopePlan,
  type BindingEvent,
  type PlannedBinding,
} from "./test-run-child-process-binding-plan.js";
import {
  isChildProcessModule,
  unwrapChildExpression,
  type ChildProcessBinding,
  type ChildProcessScope,
} from "./test-run-child-process-model.js";

export { returnedChildExpression } from "./test-run-child-process-binding-plan.js";

/** Root scope and per-node lexical scope lookup. */
export interface ChildProcessScopeTree {
  readonly root: ChildProcessScope;
  readonly scopes: WeakMap<ts.Node, ChildProcessScope>;
}

/**
 * Find the nearest declaration for one identifier.
 * @param scope - Starting lexical scope
 * @param name - Identifier to resolve
 * @returns Nearest binding or undefined
 */
export function lookupChildBinding(
  scope: ChildProcessScope,
  name: string
): ChildProcessBinding | undefined {
  return (
    scope.bindings.get(name) ??
    (scope.parent === undefined
      ? undefined
      : lookupChildBinding(scope.parent, name))
  );
}

/** Indexed immutable binding maps for every planned scope. */
type ScopeBindings = ReadonlyMap<number, Map<string, ChildProcessBinding>>;

/**
 * Find an indexed binding and the scope that owns it.
 * @param maps - Completed binding maps so far
 * @param parents - Parent scope identifiers
 * @param scopeId - Scope where lookup starts
 * @param name - Identifier to resolve
 * @returns Binding plus its owning scope identifier
 */
function lookupPlannedBinding(
  maps: ScopeBindings,
  parents: readonly (number | undefined)[],
  scopeId: number,
  name: string
):
  | { readonly binding: ChildProcessBinding; readonly scopeId: number }
  | undefined {
  const binding = maps.get(scopeId)?.get(name);
  if (binding !== undefined) return { binding, scopeId };
  const parent = parents[scopeId];
  return parent === undefined
    ? undefined
    : lookupPlannedBinding(maps, parents, parent, name);
}

/**
 * Materialize one planned binding against stable scope objects.
 * @param value - Planned binding data
 * @param scope - Owning lexical scope
 * @param scopes - Every stable scope object
 * @returns Materialized binding
 */
function materializeBinding(
  value: PlannedBinding,
  scope: ChildProcessScope,
  scopes: readonly ChildProcessScope[]
): ChildProcessBinding {
  return {
    scope,
    ...(value.expression === undefined ? {} : { expression: value.expression }),
    ...(value.expressionScopeId === undefined
      ? {}
      : { expressionScope: scopes[value.expressionScopeId] }),
    ...(value.factory === undefined ? {} : { factory: value.factory }),
    ...(value.property === undefined ? {} : { property: value.property }),
    ...(value.seeded === undefined ? {} : { seeded: value.seeded }),
  };
}

/**
 * Apply one source-ordered binding event to immutable scope maps.
 * @param maps - Binding maps completed before the event
 * @param event - Declaration or assignment to apply
 * @param parents - Parent scope identifiers
 * @param scopes - Stable lexical scope objects
 * @returns Updated immutable binding maps
 */
function applyBindingEvent(
  maps: ScopeBindings,
  event: BindingEvent,
  parents: readonly (number | undefined)[],
  scopes: readonly ChildProcessScope[]
): ScopeBindings {
  const found = lookupPlannedBinding(maps, parents, event.scopeId, event.name);
  const targetId =
    event.kind === "assign" && found !== undefined
      ? found.scopeId
      : event.scopeId;
  const target = maps.get(targetId) ?? new Map<string, ChildProcessBinding>();
  const previous = target.get(event.name);
  const base = materializeBinding(event.value, scopes[targetId]!, scopes);
  const assigned = event.kind === "assign" && found !== undefined;
  const replacement =
    assigned &&
    found.binding.expression === undefined &&
    found.binding.seeded?.kind === "local"
      ? base
      : previous === undefined
        ? base
        : {
            ...base,
            previous,
            ambiguityReason: assigned
              ? `multiple assignments to ${event.name}`
              : `duplicate variable binding ${event.name}`,
          };
  return new Map([
    ...maps,
    [targetId, new Map([...target, [event.name, replacement]])],
  ]);
}

/**
 * Build every lexical scope and declaration in one traversal.
 * @param source - Parsed source to index
 * @returns Root scope and per-node scope lookup
 */
export function buildChildProcessScopes(
  source: ts.SourceFile
): ChildProcessScopeTree {
  const plan = createChildProcessScopePlan(source);
  const scopes: readonly ChildProcessScope[] = plan.parents.map(
    (parentId, scopeId) => ({
      get parent(): ChildProcessScope | undefined {
        return parentId === undefined ? undefined : scopes[parentId];
      },
      get bindings(): Map<string, ChildProcessBinding> {
        return bindingMaps.get(scopeId) ?? new Map();
      },
    })
  );
  const bindingMaps = plan.events.reduce(
    (maps, event) => applyBindingEvent(maps, event, plan.parents, scopes),
    new Map<number, Map<string, ChildProcessBinding>>()
  );
  const root = scopes[0]!;
  return {
    root,
    scopes: new WeakMap(
      plan.nodeScopes.map(([node, scopeId]) => [node, scopes[scopeId]!])
    ),
  };
}

/**
 * Recognize an unshadowed require or dynamic-import module acquisition.
 * @param expression - Candidate module-loader call
 * @param scope - Lexical scope used to reject shadowed require
 * @returns Whether the expression loads child_process
 */
export function isChildProcessAcquisition(
  expression: ts.Expression,
  scope: ChildProcessScope
): boolean {
  const value = unwrapChildExpression(expression);
  if (!ts.isCallExpression(value) || value.arguments.length !== 1) return false;
  const argument = value.arguments[0];
  if (argument === undefined || !ts.isStringLiteral(argument)) return false;
  if (!isChildProcessModule(argument.text)) return false;
  return (
    value.expression.kind === ts.SyntaxKind.ImportKeyword ||
    (ts.isIdentifier(value.expression) &&
      value.expression.text === "require" &&
      lookupChildBinding(scope, "require") === undefined)
  );
}
