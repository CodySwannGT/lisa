/** Shadowing-aware scope index for child_process provenance analysis. */
import ts from "typescript";

import { buildChildProcessScopes } from "./test-run-child-process-bindings.js";
import { createChildProcessResolver } from "./test-run-child-process-resolver.js";
import type { ChildProcessScopeIndex } from "./test-run-child-process-model.js";

/**
 * Build a shadowing-aware scope index and memoized resolver.
 * @param source - Parsed source whose declarations are indexed
 * @returns Scope lookup and memoized expression resolver
 */
export function indexChildProcessScopes(
  source: ts.SourceFile
): ChildProcessScopeIndex {
  const { root, scopes } = buildChildProcessScopes(source);
  return {
    source,
    scopeOf: node => scopes.get(node) ?? root,
    resolve: createChildProcessResolver(source, root, scopes),
  };
}
