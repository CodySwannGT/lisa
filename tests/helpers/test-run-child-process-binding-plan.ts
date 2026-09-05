/** Immutable scope and binding-event planning for child_process analysis. */
import ts from "typescript";

import {
  CHILD_PROCESS_APIS,
  isChildProcessModule,
  type ChildProcessBinding,
} from "./test-run-child-process-model.js";

/** Binding information collected before cyclic scope objects are assembled. */
export interface PlannedBinding {
  readonly expression?: ts.Expression;
  readonly expressionScopeId?: number;
  readonly factory?: boolean;
  readonly property?: string;
  readonly seeded?: ChildProcessBinding["seeded"];
}

/** One source-ordered declaration or assignment. */
export interface BindingEvent {
  readonly kind: "assign" | "bind";
  readonly name: string;
  readonly scopeId: number;
  readonly value: PlannedBinding;
}

/** Immutable result of the scope-planning traversal. */
export interface ChildProcessScopePlan {
  readonly events: readonly BindingEvent[];
  readonly nextScopeId: number;
  readonly nodeScopes: readonly (readonly [ts.Node, number])[];
  readonly parents: readonly (number | undefined)[];
}

/**
 * Return the single direct value returned by a function-like declaration.
 * @param node - Function whose returned alias is requested
 * @returns Sole direct return expression or undefined
 */
export function returnedChildExpression(
  node: ts.FunctionLikeDeclaration
): ts.Expression | undefined {
  if (ts.isArrowFunction(node) && !ts.isBlock(node.body)) return node.body;
  if (node.body === undefined || !ts.isBlock(node.body)) return undefined;
  const returns = node.body.statements.filter(ts.isReturnStatement);
  return returns.length === 1 ? returns[0]?.expression : undefined;
}

/**
 * Convert a named import into a binding event.
 * @param element - Named import element
 * @param scopeId - Owning lexical scope identifier
 * @returns Binding event for the import
 */
function namedImportEvent(
  element: ts.ImportSpecifier,
  scopeId: number
): BindingEvent {
  const imported = element.propertyName?.text ?? element.name.text;
  const seeded =
    imported === "default"
      ? { kind: "namespace" as const }
      : CHILD_PROCESS_APIS.has(imported)
        ? { kind: "api" as const, api: imported }
        : {
            kind: "tainted" as const,
            reason: `unsupported child_process export ${imported}`,
          };
  return { kind: "bind", name: element.name.text, scopeId, value: { seeded } };
}

/**
 * Seed named imports from the bounded-spawn latency helper.
 * @param bindings - Named imports to inspect
 * @param scopeId - Owning lexical scope identifier
 * @returns Recognized bounded-spawn binding events
 */
function latencyImportEvents(
  bindings: ts.NamedImports,
  scopeId: number
): readonly BindingEvent[] {
  return bindings.elements.flatMap(element => {
    const imported = element.propertyName?.text ?? element.name.text;
    return imported === "boundedSpawnSync"
      ? [
          {
            kind: "bind" as const,
            name: element.name.text,
            scopeId,
            value: { seeded: { kind: "api" as const, api: "spawnSync" } },
          },
        ]
      : [];
  });
}

/**
 * Seed child_process imports into their lexical scope.
 * @param node - Static ESM import declaration
 * @param scopeId - Lexical scope receiving imported names
 * @returns Source-ordered import binding events
 */
function importEvents(
  node: ts.ImportDeclaration,
  scopeId: number
): readonly BindingEvent[] {
  if (!ts.isStringLiteral(node.moduleSpecifier)) return [];
  const specifier = node.moduleSpecifier.text;
  const clause = node.importClause;
  const bindings = clause?.namedBindings;
  if (!isChildProcessModule(specifier)) {
    return /(?:^|\/)io-latency-budget(?:\.js)?$/u.test(specifier) &&
      bindings !== undefined &&
      ts.isNamedImports(bindings)
      ? latencyImportEvents(bindings, scopeId)
      : [];
  }
  const defaultEvent =
    clause?.name === undefined
      ? []
      : [
          {
            kind: "bind" as const,
            name: clause.name.text,
            scopeId,
            value: { seeded: { kind: "namespace" as const } },
          },
        ];
  const namedEvents =
    bindings === undefined
      ? []
      : ts.isNamespaceImport(bindings)
        ? [
            {
              kind: "bind" as const,
              name: bindings.name.text,
              scopeId,
              value: { seeded: { kind: "namespace" as const } },
            },
          ]
        : bindings.elements.map(element => namedImportEvent(element, scopeId));
  return [...defaultEvent, ...namedEvents];
}

/**
 * Seed a TypeScript import-equals child_process namespace.
 * @param node - TypeScript import-equals declaration
 * @param scopeId - Lexical scope receiving the imported name
 * @returns Namespace binding event when the module is child_process
 */
function importEqualsEvents(
  node: ts.ImportEqualsDeclaration,
  scopeId: number
): readonly BindingEvent[] {
  const reference = node.moduleReference;
  return ts.isExternalModuleReference(reference) &&
    reference.expression !== undefined &&
    ts.isStringLiteral(reference.expression) &&
    isChildProcessModule(reference.expression.text)
    ? [
        {
          kind: "bind",
          name: node.name.text,
          scopeId,
          value: { seeded: { kind: "namespace" } },
        },
      ]
    : [];
}

/**
 * Seed identifier, object, and array declarations.
 * @param node - Variable declaration to bind
 * @param scopeId - Owning lexical scope identifier
 * @returns Binding events for every declared identifier
 */
function declarationEvents(
  node: ts.VariableDeclaration,
  scopeId: number
): readonly BindingEvent[] {
  if (ts.isIdentifier(node.name)) {
    const value =
      node.initializer === undefined
        ? { seeded: { kind: "local" as const } }
        : { expression: node.initializer };
    return [{ kind: "bind", name: node.name.text, scopeId, value }];
  }
  return node.name.elements.flatMap((element, index) => {
    if (!ts.isBindingElement(element) || !ts.isIdentifier(element.name))
      return [];
    const property = ts.isArrayBindingPattern(node.name)
      ? String(index)
      : (element.propertyName?.getText() ?? element.name.text);
    const value =
      node.initializer === undefined
        ? { seeded: { kind: "local" as const } }
        : { expression: node.initializer, property };
    return [{ kind: "bind" as const, name: element.name.text, scopeId, value }];
  });
}

/**
 * Bind one named function declaration in its surrounding scope.
 * @param node - Candidate function declaration
 * @param incomingId - Surrounding scope identifier
 * @param currentId - Function scope identifier
 * @returns Function binding event when the declaration is named
 */
function functionBindingEvents(
  node: ts.Node,
  incomingId: number,
  currentId: number
): readonly BindingEvent[] {
  const returned = ts.isFunctionDeclaration(node)
    ? returnedChildExpression(node)
    : undefined;
  return ts.isFunctionDeclaration(node) && node.name !== undefined
    ? [
        {
          kind: "bind",
          name: node.name.text,
          scopeId: incomingId,
          value:
            returned === undefined
              ? { seeded: { kind: "local" } }
              : {
                  expression: returned,
                  expressionScopeId: currentId,
                  factory: true,
                },
        },
      ]
    : [];
}

/**
 * Bind identifiers declared as function parameters.
 * @param node - Candidate function-like declaration
 * @param scopeId - Function scope identifier
 * @returns Parameter binding events
 */
function parameterEvents(
  node: ts.Node,
  scopeId: number
): readonly BindingEvent[] {
  return ts.isFunctionLike(node)
    ? node.parameters.flatMap(parameter =>
        ts.isIdentifier(parameter.name)
          ? [
              {
                kind: "bind" as const,
                name: parameter.name.text,
                scopeId,
                value: { seeded: { kind: "local" as const } },
              },
            ]
          : []
      )
    : [];
}

/**
 * Return the binding events owned directly by one node.
 * @param node - Candidate declaration or assignment
 * @param incomingId - Scope outside a possible function boundary
 * @param currentId - Scope containing the node's descendants
 * @returns Source-ordered binding events
 */
function nodeBindingEvents(
  node: ts.Node,
  incomingId: number,
  currentId: number
): readonly BindingEvent[] {
  const assignments =
    ts.isBinaryExpression(node) &&
    node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
    ts.isIdentifier(node.left)
      ? [
          {
            kind: "assign" as const,
            name: node.left.text,
            scopeId: currentId,
            value: { expression: node.right, expressionScopeId: currentId },
          },
        ]
      : [];
  return [
    ...functionBindingEvents(node, incomingId, currentId),
    ...(ts.isImportDeclaration(node) ? importEvents(node, currentId) : []),
    ...(ts.isImportEqualsDeclaration(node)
      ? importEqualsEvents(node, currentId)
      : []),
    ...(ts.isVariableDeclaration(node)
      ? declarationEvents(node, currentId)
      : []),
    ...assignments,
    ...parameterEvents(node, currentId),
  ];
}

/**
 * Return semantic children while flattening syntax-list wrappers.
 * @param node - Parent syntax node
 * @returns Direct traversable children
 */
function traversableChildren(node: ts.Node): readonly ts.Node[] {
  return node
    .getChildren()
    .flatMap(child =>
      child.kind === ts.SyntaxKind.SyntaxList
        ? traversableChildren(child)
        : [child]
    );
}

/**
 * Plan lexical scopes and bindings without mutating partial objects.
 * @param node - Current syntax node
 * @param incomingId - Parent lexical scope identifier
 * @param source - Root source file
 * @param plan - Immutable traversal state
 * @returns Completed traversal state below the node
 */
function planScopes(
  node: ts.Node,
  incomingId: number,
  source: ts.SourceFile,
  plan: ChildProcessScopePlan
): ChildProcessScopePlan {
  const nested =
    node !== source &&
    (ts.isBlock(node) || ts.isFunctionLike(node) || ts.isCatchClause(node));
  const currentId = nested ? plan.nextScopeId : incomingId;
  const opened = nested
    ? {
        ...plan,
        nextScopeId: plan.nextScopeId + 1,
        parents: [...plan.parents, incomingId],
      }
    : plan;
  const current = {
    ...opened,
    events: [
      ...opened.events,
      ...nodeBindingEvents(node, incomingId, currentId),
    ],
    nodeScopes: [...opened.nodeScopes, [node, currentId] as const],
  };
  return traversableChildren(node).reduce(
    (state, child) => planScopes(child, currentId, source, state),
    current
  );
}

/**
 * Build an immutable scope plan for one parsed source.
 * @param source - Parsed source to plan
 * @returns Complete scope identifiers and binding events
 */
export function createChildProcessScopePlan(
  source: ts.SourceFile
): ChildProcessScopePlan {
  return planScopes(source, 0, source, {
    events: [],
    nextScopeId: 1,
    nodeScopes: [],
    parents: [undefined],
  });
}
