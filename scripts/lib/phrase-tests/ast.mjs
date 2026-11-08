/**
 * Shared TypeScript-AST helpers for the phrase-test tooling
 * (CodySwannGT/lisa#4609).
 *
 * The classifier, the manifest generator and the parity check all have to
 * agree on what "an assertion site" is, so the one definition lives here:
 * a site is the matcher call that terminates an `expect(...)` chain. Parsing
 * goes through the TypeScript compiler API rather than regular expressions
 * because a regex cannot tell a string literal from a comment. (Values such
 * as `it.each` tables and path joins are not resolved here at all: the
 * recorder obtains them by running the file, see `record.mjs`.)
 * @module scripts/lib/phrase-tests/ast
 */
import ts from "typescript";

/** Matchers that test a phrase against text, per the issue's rule 3. */
export const PHRASE_MATCHERS = Object.freeze(["toContain", "toMatch"]);

/**
 * Parse a test file's text into a TypeScript source file.
 * @param {string} fileName - Repository-relative name, used for diagnostics.
 * @param {string} text - The file's contents.
 * @returns {ts.SourceFile} The parsed source file, with parent pointers set.
 */
export function parseSource(fileName, text) {
  return ts.createSourceFile(
    fileName,
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );
}

/**
 * Visit every node beneath `root`, depth first.
 * @param {ts.Node} root - Where to start.
 * @param {(node: ts.Node) => void} visit - Called once per node.
 */
export function walk(root, visit) {
  visit(root);
  ts.forEachChild(root, child => walk(child, visit));
}

/**
 * Whether a node is an `expect(...)` call (not `expect.soft`, not a matcher).
 * @param {ts.Node} node - Any node.
 * @returns {node is ts.CallExpression} True for a bare `expect(...)` call.
 */
export function isExpectCall(node) {
  return (
    ts.isCallExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === "expect"
  );
}

/**
 * Climb from an `expect(...)` call to the matcher call that ends its chain.
 * @param {ts.CallExpression} expectCall - The `expect(...)` call.
 * @returns {{ site: ts.Node, subject: ts.Expression | undefined, negated: boolean, matcher: string | undefined, args: readonly ts.Expression[] }} The chain.
 */
export function readExpectChain(expectCall) {
  /** @type {string[]} */
  const names = [];
  /** @type {ts.Expression} */
  let current = expectCall;
  while (
    ts.isPropertyAccessExpression(current.parent) &&
    current.parent.expression === current
  ) {
    names.push(current.parent.name.text);
    current = current.parent;
  }
  const call =
    ts.isCallExpression(current.parent) &&
    current.parent.expression === current &&
    names.length > 0
      ? current.parent
      : undefined;
  const negated = names.length === 2 && names[0] === "not";
  const plain = names.length === 1;
  return {
    site: call ?? current,
    subject: expectCall.arguments[0],
    negated,
    matcher: call && (plain || negated) ? names.at(-1) : undefined,
    args: call ? call.arguments : [],
  };
}

/**
 * Whether an expression is the literal `true` or `false`.
 * @param {ts.Expression | undefined} node - The `toBe` argument.
 * @returns {boolean | undefined} The literal's value, or undefined.
 */
export function booleanLiteral(node) {
  if (node?.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node?.kind === ts.SyntaxKind.FalseKeyword) return false;
  return undefined;
}

/**
 * Whether an expression is a `<x>.includes(<y>)` call.
 * @param {ts.Expression | undefined} node - The `expect` subject.
 * @returns {node is ts.CallExpression & { expression: ts.PropertyAccessExpression }} True for an `.includes(...)` call with one argument.
 */
export function isIncludesCall(node) {
  return (
    node !== undefined &&
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    node.expression.name.text === "includes" &&
    node.arguments.length === 1
  );
}

/**
 * Whether one expect chain is a phrase assertion under the issue's rule 3:
 * `toContain` / `toMatch` (optionally negated) with one argument, or
 * `<text>.includes(x)` checked with `toBe(true)` / `toBe(false)`.
 * @param {ReturnType<typeof readExpectChain>} chain - The parsed chain.
 * @returns {boolean} True when the chain is a phrase assertion.
 */
export function isPhraseChain(chain) {
  if (chain.args.length !== 1 || chain.subject === undefined) return false;
  if (PHRASE_MATCHERS.includes(chain.matcher ?? "")) return true;
  return (
    chain.matcher === "toBe" &&
    booleanLiteral(chain.args[0]) !== undefined &&
    isIncludesCall(chain.subject)
  );
}

/**
 * Every `expect(...)` chain in a file, in source order.
 * @param {ts.SourceFile} sourceFile - The parsed test file.
 * @returns {ReturnType<typeof readExpectChain>[]} One entry per expect call.
 */
export function expectChains(sourceFile) {
  /** @type {ReturnType<typeof readExpectChain>[]} */
  const chains = [];
  walk(sourceFile, node => {
    if (isExpectCall(node)) chains.push(readExpectChain(node));
  });
  return chains;
}
