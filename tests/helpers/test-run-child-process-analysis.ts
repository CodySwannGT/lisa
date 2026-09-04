/** Fail-closed launch-call analysis over scope-aware child_process provenance. */
import ts from "typescript";

import { indexChildProcessScopes } from "./test-run-child-process-scope.js";
import { scanChildProcessSource } from "./test-run-child-process-visitors.js";

/** One normalized child-process call found in source. */
export interface ChildProcessCall {
  readonly callee: string;
  readonly arguments: readonly string[];
  readonly identifiers: readonly string[];
  readonly text: string;
}

/** Calls and unsupported tainted acquisitions found by one scan. */
export interface ChildProcessCallAnalysis {
  readonly calls: readonly ChildProcessCall[];
  readonly findings: readonly string[];
  readonly inertCalls: readonly string[];
}

/**
 * Stable parser diagnostics that make an incomplete AST fail closed.
 * @param source - Parsed source containing recoverable diagnostics
 * @returns Stable diagnostic findings
 */
function parserFindings(source: ts.SourceFile): readonly string[] {
  const diagnostics =
    (
      source as ts.SourceFile & {
        readonly parseDiagnostics?: readonly ts.Diagnostic[];
      }
    ).parseDiagnostics ?? [];
  return diagnostics.map(
    diagnostic =>
      `source parse diagnostic: ${ts.flattenDiagnosticMessageText(
        diagnostic.messageText,
        " "
      )}`
  );
}

/**
 * Analyze every launch and fail-closed child-process acquisition.
 * @param sourceText - TypeScript source to inspect
 * @returns Normalized launches and unsupported-provenance findings
 */
export function analyzeChildProcessCalls(
  sourceText: string
): ChildProcessCallAnalysis {
  const source = ts.createSourceFile(
    "child-routes.ts",
    sourceText,
    ts.ScriptTarget.Latest,
    true
  );
  const scanned = scanChildProcessSource(
    source,
    indexChildProcessScopes(source)
  );
  return {
    calls: scanned.calls,
    findings: [
      ...new Set([...parserFindings(source), ...scanned.findings]),
    ].toSorted((left, right) => left.localeCompare(right)),
    inertCalls: scanned.inertCalls,
  };
}
