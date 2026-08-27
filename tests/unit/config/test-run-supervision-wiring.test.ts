/** Structural guard that managed test entrypoints cannot bypass lisa-test-run. */
import * as fs from "node:fs";
import * as path from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");
const CHILD_LAUNCHERS = new Set(
  "boundedSpawnSync execFile execFileSync spawn spawnSync".split(" ")
);
const RUNNER_PATH_BIT = 1;
const PROFILE_ARGUMENT_BIT = 2;
const ADAPTER_ARGUMENT_BIT = 4;
const PAYLOAD_SEPARATOR_BIT = 8;

/**
 * Record the supervision protocol fragments present in source text.
 * @param text - Source fragment
 * @returns Protocol bit set
 */
const protocolBits = (text: string): number =>
  (/lisa-test-run(?:\.ts)?/u.test(text) ? RUNNER_PATH_BIT : 0) |
  (/['"`]--profile['"`]/u.test(text) ? PROFILE_ARGUMENT_BIT : 0) |
  (/['"`]--adapter['"`]/u.test(text) ? ADAPTER_ARGUMENT_BIT : 0) |
  (/['"`]--['"`]/u.test(text) ? PAYLOAD_SEPARATOR_BIT : 0);

/**
 * Collect variable declarations from one source file.
 * @param sourceFile - Parsed source
 * @returns Local variable declarations
 */
function variableDeclarations(
  sourceFile: ts.SourceFile
): readonly ts.VariableDeclaration[] {
  const declarations: ts.VariableDeclaration[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node)) declarations.push(node);
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return declarations;
}

/**
 * Collect identifier names from one syntax subtree exactly once.
 * @param node - Syntax subtree
 * @returns Unique identifiers
 */
function identifierNames(node: ts.Node): readonly string[] {
  const names = new Set<string>();
  const visit = (child: ts.Node): void => {
    if (ts.isIdentifier(child)) names.add(child.text);
    ts.forEachChild(child, visit);
  };
  visit(node);
  return [...names];
}

/** One indexed declaration in the local alias graph. */
interface BindingInput {
  readonly directBits: number;
  readonly dependencies: readonly string[];
}

/** Memoized alias resolution plus deterministic complexity counters. */
interface BindingResolution {
  readonly bindings: ReadonlyMap<string, number>;
  readonly declarationCount: number;
  readonly dependencyCount: number;
  readonly declarationVisits: number;
  readonly dependencyVisits: number;
}

/** Structural spawn verdict plus one complexity certificate. */
interface VitestSpawnAnalysis extends BindingResolution {
  readonly bypasses: readonly string[];
}

/**
 * Index the local declaration dependency graph once.
 * Ambiguous duplicate bindings deliberately resolve to no authority.
 * @param sourceFile - Parsed source
 * @returns Binding dependency index
 */
function bindingIndex(
  sourceFile: ts.SourceFile
): ReadonlyMap<string, BindingInput> {
  const declarations = variableDeclarations(sourceFile).filter(
    (
      declaration
    ): declaration is ts.VariableDeclaration & {
      readonly name: ts.Identifier;
      readonly initializer: ts.Expression;
    } =>
      ts.isIdentifier(declaration.name) && declaration.initializer !== undefined
  );
  const names = new Set(declarations.map(declaration => declaration.name.text));
  const counts = new Map<string, number>();
  for (const declaration of declarations) {
    counts.set(
      declaration.name.text,
      (counts.get(declaration.name.text) ?? 0) + 1
    );
  }
  return new Map(
    declarations.map(declaration => {
      const name = declaration.name.text;
      const ambiguous = counts.get(name) !== 1;
      return [
        name,
        {
          directBits: ambiguous
            ? 0
            : protocolBits(declaration.initializer.getText(sourceFile)),
          dependencies: ambiguous
            ? []
            : identifierNames(declaration.initializer).filter(identifier =>
                names.has(identifier)
              ),
        },
      ];
    })
  );
}

/**
 * Resolve the indexed graph with cycle-safe memoization.
 * @param sourceFile - Parsed source
 * @returns Runner bits and O(V+E) visit evidence
 */
function resolvedRunnerBindings(sourceFile: ts.SourceFile): BindingResolution {
  const index = bindingIndex(sourceFile);
  const cache = new Map<string, number>();
  const active = new Set<string>();
  let declarationVisits = 0;
  let dependencyVisits = 0;
  const resolve = (name: string): number => {
    const cached = cache.get(name);
    if (cached !== undefined) return cached;
    const input = index.get(name);
    if (input === undefined) return 0;
    if (active.has(name)) {
      for (const cycleName of active) cache.set(cycleName, 0);
      return 0;
    }
    let bits = input.directBits;
    active.add(name);
    declarationVisits += 1;
    for (const dependency of input.dependencies) {
      dependencyVisits += 1;
      bits |= resolve(dependency);
      if (cache.has(name)) break;
    }
    active.delete(name);
    if (!cache.has(name)) cache.set(name, bits);
    return cache.get(name) ?? 0;
  };
  for (const name of index.keys()) resolve(name);
  return {
    bindings: cache,
    declarationCount: index.size,
    dependencyCount: [...index.values()].reduce(
      (count, input) => count + input.dependencies.length,
      0
    ),
    declarationVisits,
    dependencyVisits,
  };
}

/**
 * Return supervision bits inherited from a referenced runner binding.
 * @param node - Source fragment
 * @param bindings - Known runner bindings
 * @returns Combined protocol bits
 */
const referencedRunnerBits = (
  node: ts.Node,
  bindings: ReadonlyMap<string, number>
): number =>
  identifierNames(node).reduce(
    (bits, name) => bits | (bindings.get(name) ?? 0),
    0
  );

/**
 * Whether a child-launch call has one complete supervised protocol.
 * @param node - Child-launch call
 * @param bindings - Known runner bindings
 * @returns Whether the complete protocol is present
 */
function isSupervisedChildCall(
  node: ts.CallExpression,
  bindings: ReadonlyMap<string, number>
): boolean {
  const bits =
    protocolBits(node.getText()) | referencedRunnerBits(node, bindings);
  return (bits & RUNNER_PATH_BIT) !== 0 && (bits & 14) === 14;
}

/**
 * Whether a call is a governed direct Vitest launch.
 * @param node - Candidate call
 * @param sourceFile - Parsed source
 * @returns Whether the call starts Vitest directly
 */
function isDirectVitestCall(
  node: ts.CallExpression,
  sourceFile: ts.SourceFile
): boolean {
  const callee = node.expression.getText(sourceFile).split(".").at(-1);
  const text = node.getText(sourceFile);
  return (
    callee !== undefined &&
    CHILD_LAUNCHERS.has(callee) &&
    /['"`]vitest(?:\.mjs)?['"`]|node_modules[^]{0,80}vitest/iu.test(text)
  );
}

/**
 * Find every direct Vitest child invocation that does not route through the
 * supervised source entrypoint.
 * @param source - TypeScript source to inspect
 * @returns Bare direct Vitest spawn call texts
 */
function analyzeVitestSpawns(source: string): VitestSpawnAnalysis {
  const sourceFile = ts.createSourceFile(
    "spawn-control.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );
  const resolution = resolvedRunnerBindings(sourceFile);
  const bypasses: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      isDirectVitestCall(node, sourceFile) &&
      !isSupervisedChildCall(node, resolution.bindings)
    ) {
      bypasses.push(node.getText(sourceFile));
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return { ...resolution, bypasses };
}

/**
 * Enumerate every TypeScript test source so a new child launch cannot escape
 * the supervision guard merely by living outside a hard-coded file list.
 * @param directory - Absolute directory to walk
 * @returns Absolute TypeScript source paths
 */
const testSources = (directory: string): readonly string[] =>
  fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return testSources(target);
    return entry.isFile() && entry.name.endsWith(".ts") ? [target] : [];
  });

describe("managed test supervision wiring", () => {
  it("detects every bare Vitest child, including a second call", () => {
    const source = `
      const RUNNER = "lisa-test-run.ts";
      const PROFILE = ["--profile", "lisa"];
      const ADAPTER = ["--adapter", "vitest"];
      const PAYLOAD = ["--", "vitest"];
      const TEST_RUNNER_ARGS = [...PROFILE, ...ADAPTER, ...PAYLOAD];
      spawnSync("node", [RUNNER, ...TEST_RUNNER_ARGS]);
      spawnSync("vitest", ["run"]);
      execFileSync("node_modules/.bin/vitest", ["run"]);
      const CYCLE_A = [CYCLE_B, "--profile", "lisa"];
      const CYCLE_B = [CYCLE_A, "--adapter", "vitest", "--"];
      spawnSync("vitest", CYCLE_A);
      spawnSync("vitest", UNKNOWN_ARGS);
    `;

    expect(analyzeVitestSpawns(source).bypasses).toHaveLength(4);
  });

  it("routes every internal Vitest child launch through source supervision", () => {
    const analyses = testSources(path.join(REPO_ROOT, "tests")).map(file => ({
      analysis: analyzeVitestSpawns(fs.readFileSync(file, "utf8")),
      file: path.relative(REPO_ROOT, file),
    }));
    for (const { analysis } of analyses) {
      expect(analysis.declarationVisits).toBeLessThanOrEqual(
        analysis.declarationCount
      );
      expect(analysis.dependencyVisits).toBeLessThanOrEqual(
        analysis.dependencyCount
      );
    }
    const bypasses = analyses.flatMap(({ analysis, file }) =>
      analysis.bypasses.map(call => ({ call, file }))
    );

    expect(bypasses).toEqual([]);
  });
});
