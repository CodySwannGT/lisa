/** Supervision-protocol and child-route analysis composed from focused passes. */
import ts from "typescript";

import { analyzeChildProcessCalls } from "./test-run-child-process-analysis.js";
import { CHILD_PROCESS_APIS } from "./test-run-child-process-model.js";
import { normalizedChildNode } from "./test-run-child-process-source.js";

const RUNNER_PATH = 1;
const PROFILE = 2;
const ADAPTER = 4;
const SEPARATOR = 8;

/** Bit proving the source runner path participates in one command. */
export const LISA_TEST_RUNNER_PATH_BIT = RUNNER_PATH;

/** Linear declaration-resolution metrics and bare Vitest calls. */
export interface VitestSpawnAnalysis {
  readonly bypasses: readonly string[];
  readonly findings: readonly string[];
  readonly vitestCallCount: number;
  readonly declarationCount: number;
  readonly dependencyCount: number;
  readonly declarationVisits: number;
  readonly dependencyVisits: number;
}

/** One normalized child launch with inherited supervision bits. */
export interface TestRunChildLaunch {
  readonly callee: string;
  readonly arguments: readonly string[];
  readonly bits: number;
}

/** Child launches and fail-closed provenance findings. */
export interface TestRunChildAnalysis {
  readonly launches: readonly TestRunChildLaunch[];
  readonly findings: readonly string[];
}

/** One indexed declaration used by the protocol-bit graph. */
interface ProtocolBinding {
  readonly text: string;
  readonly dependencies: readonly string[];
}

/** Memoized protocol-bit resolution and structural visit counts. */
interface ProtocolResolution {
  readonly bits: ReadonlyMap<string, number>;
  readonly declarationCount: number;
  readonly dependencyCount: number;
  readonly declarationVisits: number;
  readonly dependencyVisits: number;
}

/**
 * Return exact protocol components present in normalized source.
 * @param text - Normalized declaration or call source
 * @returns Bitmask of required supervision components
 */
function protocolBits(text: string): number {
  return (
    (/lisa-test-run(?:\.ts)?/u.test(text) ? RUNNER_PATH : 0) |
    (/['"`]--profile['"`]/u.test(text) ? PROFILE : 0) |
    (/['"`]--adapter['"`]/u.test(text) ? ADAPTER : 0) |
    (/['"`]--['"`]/u.test(text) ? SEPARATOR : 0)
  );
}

/**
 * Collect every identifier referenced below one AST node.
 * @param node - Declaration or call containing identifier edges
 * @returns Unique identifier names
 */
function identifierNames(node: ts.Node): readonly string[] {
  const own = ts.isIdentifier(node) ? [node.text] : [];
  const nested = node.getChildren().flatMap(identifierNames);
  return [...new Set([...own, ...nested])];
}

/**
 * Index declaration texts and their identifier dependency edges.
 * @param source - Parsed source to index
 * @returns Declaration graph keyed by identifier
 */
function protocolBindings(
  source: ts.SourceFile
): ReadonlyMap<string, ProtocolBinding> {
  const entries = source
    .getChildren()
    .flatMap(function visit(node): readonly (readonly [
      string,
      ProtocolBinding,
    ])[] {
      const own: readonly (readonly [string, ProtocolBinding])[] =
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.initializer !== undefined
          ? [
              [
                node.name.text,
                {
                  text: normalizedChildNode(node.initializer, source),
                  dependencies: identifierNames(node.initializer),
                },
              ],
            ]
          : [];
      return [...own, ...node.getChildren().flatMap(visit)];
    });
  return new Map(entries);
}

/** Immutable state threaded through memoized protocol resolution. */
interface ProtocolResolutionState {
  readonly active: ReadonlySet<string>;
  readonly bits: ReadonlyMap<string, number>;
  readonly declarationVisits: number;
  readonly dependencyVisits: number;
}

/** One resolved protocol value and the cache state produced while resolving it. */
interface ResolvedProtocolBinding {
  readonly state: ProtocolResolutionState;
  readonly value: number;
}

/**
 * Resolve one declaration and its dependencies with an immutable memo cache.
 * @param name - Declaration name to resolve
 * @param bindings - Complete declaration graph
 * @param state - Resolution cache and active path
 * @returns Resolved bits and updated cache state
 */
function resolveProtocolBinding(
  name: string,
  bindings: ReadonlyMap<string, ProtocolBinding>,
  state: ProtocolResolutionState
): ResolvedProtocolBinding {
  const cached = state.bits.get(name);
  if (cached !== undefined) return { state, value: cached };
  if (state.active.has(name)) return { state, value: 0 };
  const binding = bindings.get(name);
  if (binding === undefined) return { state, value: 0 };
  const entered = {
    ...state,
    active: new Set([...state.active, name]),
    declarationVisits: state.declarationVisits + 1,
  };
  const dependencies = binding.dependencies.reduce(
    (current, dependency) => {
      const resolved = resolveProtocolBinding(dependency, bindings, {
        ...current.state,
        dependencyVisits: current.state.dependencyVisits + 1,
      });
      return { state: resolved.state, value: current.value | resolved.value };
    },
    { state: entered, value: protocolBits(binding.text) }
  );
  const completed = {
    ...dependencies.state,
    active: new Set(
      [...dependencies.state.active].filter(value => value !== name)
    ),
    bits: new Map([...dependencies.state.bits, [name, dependencies.value]]),
  };
  return { state: completed, value: dependencies.value };
}

/**
 * Resolve each declaration once and each dependency edge at most once.
 * @param source - Parsed source containing the declaration graph
 * @returns Bit resolution plus exact structural visit counters
 */
function resolveProtocolBits(source: ts.SourceFile): ProtocolResolution {
  const bindings = protocolBindings(source);
  const initial: ProtocolResolutionState = {
    active: new Set(),
    bits: new Map(),
    declarationVisits: 0,
    dependencyVisits: 0,
  };
  const state = [...bindings.keys()].reduce(
    (current, name) => resolveProtocolBinding(name, bindings, current).state,
    initial
  );
  return {
    bits: state.bits,
    declarationCount: bindings.size,
    dependencyCount: [...bindings.values()].reduce(
      (total, value) => total + value.dependencies.length,
      0
    ),
    declarationVisits: state.declarationVisits,
    dependencyVisits: state.dependencyVisits,
  };
}

/**
 * Calculate direct and identifier-inherited protocol bits for a call.
 * @param text - Normalized call source
 * @param identifiers - Call identifier dependencies
 * @param resolution - Memoized declaration-bit resolution
 * @returns Combined supervision bitmask
 */
function callBits(
  text: string,
  identifiers: readonly string[],
  resolution: ProtocolResolution
): number {
  return identifiers.reduce(
    (value, name) => value | (resolution.bits.get(name) ?? 0),
    protocolBits(text)
  );
}

/**
 * Analyze exact child launches and preserve fail-closed provenance findings.
 * @param sourceText - TypeScript source to inspect
 * @returns Normalized launches and findings
 */
export function analyzeTestRunChildLaunches(
  sourceText: string
): TestRunChildAnalysis {
  const source = ts.createSourceFile(
    "routes.ts",
    sourceText,
    ts.ScriptTarget.Latest,
    true
  );
  const resolution = resolveProtocolBits(source);
  const analysis = analyzeChildProcessCalls(sourceText);
  return {
    launches: analysis.calls.map(call => ({
      callee: call.callee,
      arguments: call.arguments,
      bits: callBits(call.text, call.identifiers, resolution),
    })),
    findings: analysis.findings,
  };
}

/**
 * Find every Vitest child call that lacks the exact supervision protocol.
 * @param sourceText - TypeScript source to inspect
 * @returns Bypasses and O(V+E) declaration-resolution counters
 */
export function analyzeVitestSpawns(sourceText: string): VitestSpawnAnalysis {
  const source = ts.createSourceFile(
    "vitest.ts",
    sourceText,
    ts.ScriptTarget.Latest,
    true
  );
  const resolution = resolveProtocolBits(source);
  const analysis = analyzeChildProcessCalls(sourceText);
  const calls = new Map(analysis.calls.map(call => [call.text, call]));
  const inert = new Set(analysis.inertCalls);
  const candidates = source
    .getChildren()
    .flatMap(function visit(node): readonly ts.CallExpression[] {
      const own = ts.isCallExpression(node) ? [node] : [];
      return [...own, ...node.getChildren().flatMap(visit)];
    });
  const inspected = candidates.flatMap(node => {
    const text = normalizedChildNode(node, source);
    if (!/['"`]vitest(?:\.mjs)?['"`]|node_modules[^]{0,80}vitest/iu.test(text))
      return [];
    const call = calls.get(text);
    const directName = node.expression.getText(source).split(".").at(-1);
    const unresolved =
      call === undefined &&
      !inert.has(text) &&
      directName !== undefined &&
      CHILD_PROCESS_APIS.has(directName);
    const bits =
      call === undefined
        ? 0
        : callBits(call.text, call.identifiers, resolution);
    const bypass =
      unresolved ||
      (call !== undefined &&
        !((bits & RUNNER_PATH) !== 0 && (bits & 14) === 14))
        ? call === undefined
          ? `unresolved child launch: ${text}`
          : text
        : undefined;
    return [{ bypass, counted: call !== undefined || unresolved }];
  });
  return {
    ...resolution,
    bypasses: [
      ...new Set(
        inspected.flatMap(value =>
          value.bypass === undefined ? [] : [value.bypass]
        )
      ),
    ],
    findings: analysis.findings,
    vitestCallCount: inspected.filter(value => value.counted).length,
  };
}
