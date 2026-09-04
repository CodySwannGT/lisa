/** Fail-closed executable-module closure for the detached reaper proof. */
import * as path from "node:path";

import ts from "typescript";

import {
  buildChildProcessScopes,
  lookupChildBinding,
} from "./test-run-child-process-bindings.js";

/** Executable source extensions admitted to the closure. */
export const EXECUTABLE_MODULE_EXTENSIONS = [
  ".ts",
  ".mts",
  ".cts",
  ".js",
  ".mjs",
  ".cjs",
] as const;

/** One unresolved relative dependency that invalidates the proof. */
export interface UnresolvedModuleEdge {
  readonly importer: string;
  readonly specifier: string;
}

/** One source-level closure gap tied to its executable module. */
export interface ExecutableModuleFinding {
  readonly file: string;
  readonly message: string;
}

/** Complete graph plus every unresolved relative edge. */
export interface ExecutableModuleGraph {
  readonly graph: ReadonlyMap<string, ReadonlySet<string>>;
  readonly findings: readonly ExecutableModuleFinding[];
  readonly unresolved: readonly UnresolvedModuleEdge[];
}

/**
 * Whether a repository path is executable source included by the proof.
 * @param name - Repository-relative path or basename
 * @returns Whether the supported executable extension is present
 */
export function isExecutableModule(name: string): boolean {
  return EXECUTABLE_MODULE_EXTENSIONS.some(extension =>
    name.endsWith(extension)
  );
}

/** Parsed dependency specifiers and fatal source-shape findings. */
interface ModuleSpecifiers {
  readonly findings: readonly string[];
  readonly specifiers: readonly string[];
}

/**
 * Return one node and all of its descendants in source order.
 * @param node - Root syntax node
 * @returns Flattened syntax subtree
 */
function syntaxTree(node: ts.Node): readonly ts.Node[] {
  return [node, ...node.getChildren().flatMap(syntaxTree)];
}

/** Parsed dependency contribution from one syntax node. */
interface ModuleSpecifierContribution {
  readonly findings: readonly string[];
  readonly specifiers: readonly string[];
}

/**
 * Extract a dependency contribution from one syntax node.
 * @param node - Candidate import-like node
 * @param parsed - Parsed source owning the node
 * @param scopes - Lexical scopes used to reject shadowed require calls
 * @returns Literal dependency or fatal acquisition finding
 */
function moduleSpecifierContribution(
  node: ts.Node,
  parsed: ts.SourceFile,
  scopes: ReturnType<typeof buildChildProcessScopes>
): ModuleSpecifierContribution {
  if (
    (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
    node.moduleSpecifier !== undefined &&
    ts.isStringLiteral(node.moduleSpecifier)
  ) {
    return { findings: [], specifiers: [node.moduleSpecifier.text] };
  }
  if (
    ts.isImportEqualsDeclaration(node) &&
    ts.isExternalModuleReference(node.moduleReference) &&
    node.moduleReference.expression !== undefined &&
    ts.isStringLiteral(node.moduleReference.expression)
  ) {
    return { findings: [], specifiers: [node.moduleReference.expression.text] };
  }
  if (!ts.isCallExpression(node)) return { findings: [], specifiers: [] };
  const dynamic = node.expression.kind === ts.SyntaxKind.ImportKeyword;
  const commonJs =
    ts.isIdentifier(node.expression) &&
    node.expression.text === "require" &&
    lookupChildBinding(scopes.scopes.get(node) ?? scopes.root, "require") ===
      undefined;
  if (!dynamic && !commonJs) return { findings: [], specifiers: [] };
  const argument = node.arguments[0];
  return node.arguments.length === 1 &&
    argument !== undefined &&
    ts.isStringLiteral(argument)
    ? { findings: [], specifiers: [argument.text] }
    : {
        findings: [
          `unsupported nonliteral module acquisition: ${node.getText(parsed)}`,
        ],
        specifiers: [],
      };
}

/**
 * Extract static, dynamic, and CommonJS string-literal dependencies.
 * @param name - Repository-relative executable source path
 * @param source - Source bytes to inspect
 * @returns Literal specifiers and fatal parse/acquisition findings
 */
function moduleSpecifiers(name: string, source: string): ModuleSpecifiers {
  const parsed = ts.createSourceFile(
    name,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
  const scopes = buildChildProcessScopes(parsed);
  const diagnostics =
    (
      parsed as ts.SourceFile & {
        readonly parseDiagnostics?: readonly ts.Diagnostic[];
      }
    ).parseDiagnostics ?? [];
  const parserFindings = diagnostics.map(
    diagnostic =>
      `source parse diagnostic: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, " ")}`
  );
  const contributions = syntaxTree(parsed).map(node =>
    moduleSpecifierContribution(node, parsed, scopes)
  );
  return {
    findings: [
      ...parserFindings,
      ...contributions.flatMap(value => value.findings),
    ],
    specifiers: contributions.flatMap(value => value.specifiers),
  };
}

/**
 * Candidate files for exact, cross-extension, and extensionless imports.
 * @param importer - Repository-relative importing module
 * @param specifier - Literal relative module specifier
 * @returns Ordered candidate executable paths
 */
function resolutionCandidates(
  importer: string,
  specifier: string
): readonly string[] {
  const base = path.posix.normalize(
    path.posix.join(path.posix.dirname(importer), specifier)
  );
  const extension = path.posix.extname(base);
  const stem = extension === "" ? base : base.slice(0, -extension.length);
  return [
    base,
    ...EXECUTABLE_MODULE_EXTENSIONS.map(value => `${stem}${value}`),
    ...EXECUTABLE_MODULE_EXTENSIONS.map(value =>
      path.posix.join(base, `index${value}`)
    ),
  ];
}

/**
 * Resolve one relative edge or return undefined for a missing target.
 * @param importer - Repository-relative importing module
 * @param specifier - Literal relative module specifier
 * @param known - Complete executable source inventory
 * @returns Resolved path or undefined
 */
function resolveRelative(
  importer: string,
  specifier: string,
  known: ReadonlySet<string>
): string | undefined {
  if (!specifier.startsWith(".")) return undefined;
  return resolutionCandidates(importer, specifier).find(candidate =>
    known.has(candidate)
  );
}

/**
 * Build an executable import graph without dropping unresolved relative edges.
 * @param sources - Every executable repository module and its source
 * @returns Resolved graph and fatal unresolved edges
 */
export function executableModuleGraph(
  sources: ReadonlyMap<string, string>
): ExecutableModuleGraph {
  const known = new Set(sources.keys());
  const rows = [...sources].map(([importer, source]) => {
    const dependencies = moduleSpecifiers(importer, source);
    const relative = dependencies.specifiers.filter(value =>
      value.startsWith(".")
    );
    const resolved = relative.map(specifier => ({
      specifier,
      target: resolveRelative(importer, specifier, known),
    }));
    return {
      findings: dependencies.findings.map(message => ({
        file: importer,
        message,
      })),
      graphEntry: [
        importer,
        new Set(
          resolved.flatMap(value =>
            value.target === undefined ? [] : [value.target]
          )
        ),
      ] as const,
      unresolved: resolved.flatMap(value =>
        value.target === undefined
          ? [{ importer, specifier: value.specifier }]
          : []
      ),
    };
  });
  return {
    findings: rows
      .flatMap(value => value.findings)
      .toSorted((left, right) =>
        `${left.file}:${left.message}`.localeCompare(
          `${right.file}:${right.message}`
        )
      ),
    graph: new Map(rows.map(value => value.graphEntry)),
    unresolved: rows
      .flatMap(value => value.unresolved)
      .toSorted((left, right) =>
        `${left.importer}:${left.specifier}`.localeCompare(
          `${right.importer}:${right.specifier}`
        )
      ),
  };
}
