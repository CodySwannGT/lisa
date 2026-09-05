/** Fail-closed AST visitors for scope-aware child-process analysis. */
import ts from "typescript";

import { lookupChildBinding } from "./test-run-child-process-bindings.js";
import {
  CHILD_PROCESS_APIS,
  type ChildProcessProvenance,
  type ChildProcessScope,
  type ChildProcessScopeIndex,
} from "./test-run-child-process-model.js";
import {
  childCallIdentifiers,
  childProvenanceFinding,
  isProcessBearing,
  normalizedChildNode,
} from "./test-run-child-process-source.js";
import type { ChildProcessCall } from "./test-run-child-process-analysis.js";

/** Mutable scan accumulators confined to one source traversal. */
interface ChildProcessScanState {
  readonly source: ts.SourceFile;
  readonly index: ChildProcessScopeIndex;
  readonly calls: readonly ChildProcessCall[];
  readonly findings: ReadonlySet<string>;
  readonly inertCalls: ReadonlySet<string>;
}

/** Complete normalized output of one source traversal. */
export interface ChildProcessSourceScan {
  readonly calls: readonly ChildProcessCall[];
  readonly findings: readonly string[];
  readonly inertCalls: readonly string[];
}

/**
 * Whether a call is an unshadowed require or dynamic-import acquisition.
 * @param node - Candidate acquisition call
 * @param scope - Lexical scope used to reject shadowed require
 * @returns Whether the call is an unshadowed module acquisition
 */
function isModuleAcquisition(
  node: ts.CallExpression,
  scope: ChildProcessScope
): boolean {
  return (
    node.expression.kind === ts.SyntaxKind.ImportKeyword ||
    (ts.isIdentifier(node.expression) &&
      node.expression.text === "require" &&
      lookupChildBinding(scope, "require") === undefined)
  );
}

/**
 * Whether a declaration is exported across the current module boundary.
 * @param node - Candidate declaration
 * @returns Whether the declaration crosses the module boundary
 */
function isExportedDeclaration(node: ts.Node): boolean {
  const owner = ts.isVariableDeclaration(node) ? node.parent.parent : node;
  return (
    ts.canHaveModifiers(owner) &&
    ts
      .getModifiers(owner)
      ?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword) === true
  );
}

/**
 * Whether a node is a concrete runtime function-like declaration.
 * @param node - Candidate syntax node
 * @returns Whether the node is a runtime function declaration
 */
function isConcreteFunction(node: ts.Node): node is ts.FunctionLikeDeclaration {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node) ||
    ts.isConstructorDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node)
  );
}

/**
 * Collect returns owned by one function while excluding nested functions.
 * @param node - Function whose direct returns are required
 * @returns Return expressions owned by the function
 */
function functionReturns(
  node: ts.FunctionLikeDeclaration
): readonly ts.Expression[] {
  const visit = (child: ts.Node): readonly ts.Expression[] => {
    if (child !== node && ts.isFunctionLike(child)) return [];
    if (ts.isReturnStatement(child) && child.expression !== undefined) {
      return [child.expression];
    }
    return child.getChildren().flatMap(visit);
  };
  return node.body === undefined ? [] : visit(node.body);
}

/**
 * Append one stable finding to immutable scan state.
 * @param state - Current scan state
 * @param finding - Finding to append
 * @returns Updated scan state
 */
function appendFinding(
  state: ChildProcessScanState,
  finding: string
): ChildProcessScanState {
  return { ...state, findings: new Set([...state.findings, finding]) };
}

/**
 * Add one stable finding only for unsupported provenance.
 * @param state - Current scan state
 * @param provenance - Provenance to convert into a finding
 * @param node - Syntax node tied to the finding
 * @returns Updated scan state
 */
function addFinding(
  state: ChildProcessScanState,
  provenance: ChildProcessProvenance,
  node: ts.Node
): ChildProcessScanState {
  const finding = childProvenanceFinding(
    provenance,
    normalizedChildNode(node, state.source)
  );
  return finding === undefined ? state : appendFinding(state, finding);
}

/**
 * Inspect a variable declaration for tainted or exported provenance.
 * @param node - Candidate variable declaration
 * @param state - Current scan state
 * @returns Updated scan state
 */
function inspectDeclarationEscape(
  node: ts.Node,
  state: ChildProcessScanState
): ChildProcessScanState {
  if (!ts.isVariableDeclaration(node) || node.initializer === undefined)
    return state;
  const value = state.index.resolve(
    node.initializer,
    state.index.scopeOf(node)
  );
  const tainted =
    value.kind === "tainted"
      ? addFinding(state, value, node.initializer)
      : state;
  return isExportedDeclaration(node) && isProcessBearing(value)
    ? appendFinding(
        tainted,
        `unsupported child_process exported declaration: ${normalizedChildNode(node, state.source)}`
      )
    : tainted;
}

/**
 * Inspect declaration, assignment, and default-export capability escapes.
 * @param node - Candidate escape node
 * @param state - Current scan state
 * @returns Updated scan state
 */
function inspectChildProcessEscape(
  node: ts.Node,
  state: ChildProcessScanState
): ChildProcessScanState {
  const { index, source } = state;
  const declaration = inspectDeclarationEscape(node, state);
  if (
    ts.isBinaryExpression(node) &&
    node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
    !ts.isIdentifier(node.left) &&
    isProcessBearing(index.resolve(node.right, index.scopeOf(node)))
  ) {
    return appendFinding(
      declaration,
      `unsupported child_process assignment escape: ${normalizedChildNode(node, source)}`
    );
  }
  if (
    ts.isExportAssignment(node) &&
    isProcessBearing(index.resolve(node.expression, index.scopeOf(node)))
  ) {
    return appendFinding(
      declaration,
      `unsupported child_process export escape: ${normalizedChildNode(node, source)}`
    );
  }
  return declaration;
}

/**
 * Inspect named exports and exported function return values.
 * @param node - Candidate export node
 * @param state - Current scan state
 * @returns Updated scan state
 */
function inspectChildProcessExport(
  node: ts.Node,
  state: ChildProcessScanState
): ChildProcessScanState {
  const { index, source } = state;
  const named =
    ts.isExportDeclaration(node) && node.exportClause !== undefined
      ? node.exportClause.elements.reduce((current, element) => {
          const value = index.resolve(
            element.propertyName ?? element.name,
            index.scopeOf(node)
          );
          return isProcessBearing(value)
            ? appendFinding(
                current,
                `unsupported child_process named export: ${element.getText(source)}`
              )
            : current;
        }, state)
      : state;
  if (!isConcreteFunction(node) || !isExportedDeclaration(node)) return named;
  const name =
    "name" in node && node.name !== undefined
      ? node.name.getText(source)
      : "default";
  return functionReturns(node).reduce(
    (current, expression) =>
      isProcessBearing(index.resolve(expression, index.scopeOf(expression)))
        ? appendFinding(
            current,
            `unsupported child_process exported return: ${name}`
          )
        : current,
    named
  );
}

/**
 * Inspect process-bearing arguments and Reflect targets for one call.
 * @param node - Call expression to inspect
 * @param callee - Resolved call target
 * @param state - Current scan state
 * @returns Updated scan state
 */
function inspectChildProcessCallEscapes(
  node: ts.CallExpression,
  callee: ChildProcessProvenance,
  state: ChildProcessScanState
): ChildProcessScanState {
  const { index, source } = state;
  const scope = index.scopeOf(node);
  const argumentsChecked =
    callee.kind !== "api" && callee.kind !== "reflect"
      ? node.arguments.reduce(
          (current, argument) =>
            isProcessBearing(index.resolve(argument, scope))
              ? appendFinding(
                  current,
                  `unsupported child_process argument escape: ${normalizedChildNode(node, source)}`
                )
              : current,
          state
        )
      : state;
  if (callee.kind !== "reflect") return argumentsChecked;
  const target = node.arguments[0];
  if (target === undefined) return argumentsChecked;
  const provenance = index.resolve(target, scope);
  return provenance.kind === "api" || provenance.kind === "namespace"
    ? appendFinding(
        argumentsChecked,
        `unsupported child_process Reflect.${callee.operation}: ${normalizedChildNode(node, source)}`
      )
    : addFinding(argumentsChecked, provenance, target);
}

/**
 * Inspect one normalized call and any process-bearing escape.
 * @param node - Call expression to inspect
 * @param state - Current scan state
 * @returns Updated scan state
 */
function inspectChildProcessCall(
  node: ts.CallExpression,
  state: ChildProcessScanState
): ChildProcessScanState {
  const { index, source } = state;
  const scope = index.scopeOf(node);
  const callee = index.resolve(node.expression, scope);
  const acquisitionChecked =
    isModuleAcquisition(node, scope) &&
    (node.arguments.length !== 1 || !ts.isStringLiteral(node.arguments[0]!))
      ? appendFinding(
          state,
          `unsupported nonliteral module acquisition: ${normalizedChildNode(node, source)}`
        )
      : state;
  if (callee.kind === "api")
    return inspectChildProcessCallEscapes(node, callee, {
      ...acquisitionChecked,
      calls: [
        ...acquisitionChecked.calls,
        {
          callee: callee.api,
          arguments: node.arguments.map(value =>
            normalizedChildNode(value, source)
          ),
          identifiers: childCallIdentifiers(node),
          text: normalizedChildNode(node, source),
        },
      ],
    });
  const inertChecked =
    callee.kind === "local" || callee.kind === "factory"
      ? {
          ...acquisitionChecked,
          inertCalls: new Set([
            ...acquisitionChecked.inertCalls,
            normalizedChildNode(node, source),
          ]),
        }
      : acquisitionChecked;
  const provenanceChecked = addFinding(inertChecked, callee, node.expression);
  const unknownChecked =
    callee.kind === "unknown" &&
    ts.isIdentifier(node.expression) &&
    CHILD_PROCESS_APIS.has(node.expression.text)
      ? appendFinding(
          provenanceChecked,
          `unsupported child_process provenance: ${normalizedChildNode(node.expression, source)}`
        )
      : provenanceChecked;
  return inspectChildProcessCallEscapes(node, callee, unknownChecked);
}

/**
 * Scan every node without following runtime control flow.
 * @param source - Parsed source under analysis
 * @param index - Scope-aware child-process provenance index
 * @returns Sorted calls, findings, and inert calls
 */
export function scanChildProcessSource(
  source: ts.SourceFile,
  index: ChildProcessScopeIndex
): ChildProcessSourceScan {
  const initial: ChildProcessScanState = {
    source,
    index,
    calls: [],
    findings: new Set(),
    inertCalls: new Set(),
  };
  const visit = (
    state: ChildProcessScanState,
    node: ts.Node
  ): ChildProcessScanState => {
    const escaped = inspectChildProcessEscape(node, state);
    const exported = inspectChildProcessExport(node, escaped);
    const accessed =
      ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)
        ? (() => {
            const value = index.resolve(node, index.scopeOf(node));
            return value.kind === "tainted"
              ? addFinding(exported, value, node)
              : exported;
          })()
        : exported;
    const called = ts.isCallExpression(node)
      ? inspectChildProcessCall(node, accessed)
      : accessed;
    return node.getChildren().reduce(visit, called);
  };
  const state = visit(initial, source);
  return {
    calls: state.calls,
    findings: [...state.findings].toSorted((left, right) =>
      left.localeCompare(right)
    ),
    inertCalls: [...state.inertCalls].toSorted((left, right) =>
      left.localeCompare(right)
    ),
  };
}
