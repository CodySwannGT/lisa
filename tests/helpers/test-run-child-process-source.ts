/** Source-normalization helpers for child-process provenance analysis. */
import ts from "typescript";

import type { ChildProcessProvenance } from "./test-run-child-process-model.js";

/**
 * Normalize one AST node for exact whitespace-stable assertions.
 * @param node - Node whose source text is required
 * @param source - Parsed source owning the node
 * @returns Normalized source text
 */
export function normalizedChildNode(
  node: ts.Node,
  source: ts.SourceFile
): string {
  return node.getText(source).replace(/\s+/gu, " ").trim();
}

/**
 * Collect identifier dependencies below one call expression.
 * @param node - Call whose lexical identifier edges are required
 * @returns Unique identifier names
 */
export function childCallIdentifiers(node: ts.Node): readonly string[] {
  const own = ts.isIdentifier(node) ? [node.text] : [];
  const nested = node.getChildren().flatMap(childCallIdentifiers);
  return [...new Set([...own, ...nested])];
}

/**
 * Whether provenance carries any child-process capability.
 * @param value - Resolved lexical provenance
 * @returns Whether the value can expose a process API
 */
export function isProcessBearing(value: ChildProcessProvenance): boolean {
  if (value.kind === "container") {
    return [...value.values.values()].some(isProcessBearing);
  }
  if (value.kind === "factory") return isProcessBearing(value.result);
  return !["local", "unknown"].includes(value.kind);
}

/**
 * Convert unsupported provenance into a stable finding.
 * @param provenance - Resolved lexical provenance
 * @param text - Normalized source tied to the finding
 * @returns Stable finding or undefined for supported provenance
 */
export function childProvenanceFinding(
  provenance: ChildProcessProvenance,
  text: string
): string | undefined {
  if (provenance.kind === "tainted") {
    return `unsupported child_process provenance: ${text} (${provenance.reason})`;
  }
  if (provenance.kind === "namespace") {
    return `unsupported child_process namespace invocation: ${text}`;
  }
  return undefined;
}
