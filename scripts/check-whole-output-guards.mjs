#!/usr/bin/env node
/**
 * check-whole-output-guards — refuse a multi-step text transform whose only
 * correctness check compares its finished output to its input
 * (CodySwannGT/lisa#3081).
 *
 * ## The defect
 *
 * A transform with N anchored rewrites, guarded by comparing the finished
 * result to the starting value, passes as soon as **any one** step lands:
 *
 *   const out = source.replace(A, A2).replace(B, B2);
 *   if (out === source) throw new Error("the rewrite no longer applies");
 *
 * The guard asks "did something change". It cannot answer "did everything I
 * asked for happen". The other N−1 steps can silently stop matching and it
 * stays green — and it degrades in the direction nobody watches, because it is
 * written when N is 1, where the check is sound, and becomes unsound the moment
 * someone adds a second step without noticing that the guard's question changed
 * underneath them.
 *
 * It has already bitten this repository. CodySwannGT/lisa#2980 deleted the
 * import line the FIRST rewrite of a test fixture anchored on; the second still
 * matched, so `out !== source`, so the guard passed, and the fixture built a
 * module referencing `fileURLToPath` without importing it. Every case
 * downstream failed inside a module-resolution error, in a test about
 * repository layout. The partially-applied output was not merely incomplete, it
 * was INVALID, and it surfaced far from the guard that let it through. That one
 * instance was found by luck — the file happened to carry a separate positive
 * control — which is a property of that file, not of the idiom.
 *
 * ## What counts as a finding
 *
 * A scope is reported when ALL of these hold:
 *
 *  1. It performs TWO OR MORE anchored replacement steps. An anchor is a
 *     literal string, a template literal, a non-global regular expression, or —
 *     inside a loop or an array-method callback — a dynamic expression, which
 *     is by construction more than one step.
 *  2. Something in the scope throws on a WHOLE-OUTPUT comparison: an `if` whose
 *     test is `===`/`!==` between two plain expressions, at least one of which
 *     is the transform's own input or output variable, and whose branch throws
 *     or exits; or an `if` on a bare `changed`-style flag that throws.
 *  3. At least one step is UNACCOUNTED FOR — its anchor is not asserted present
 *     anywhere in the scope (no `includes`/`indexOf`/`test`/`match` guard that
 *     throws on that same anchor expression), and it does not come from
 *     `replaceOrThrow` / `replaceOptional` / `applyRewrites`.
 *
 * Accountability is matched by ANCHOR EXPRESSION TEXT, not by counting
 * assertions, which is what lets one assertion inside a `reduce` body cover
 * every iteration of it while two chained `.replace` calls still need two.
 *
 * ## Declared blind spots
 *
 * Stated rather than hidden, in the manner of the sibling sweeps:
 *
 *  - A GLOBAL regular expression (`/…/g`) is not an anchored step. Matching
 *    zero times is a routine, correct outcome for a `/g` rewrite over a
 *    document, so counting them would turn the commonest correct idiom into a
 *    wall of findings and the sweep would be turned off.
 *  - A single-step transform is inspected and passed. The whole-output
 *    comparison is SOUND at N=1; this is about steps, not about style.
 *  - A scope whose only comparison is a `return`/short-circuit rather than a
 *    throw is inspected and passed — a write-if-changed idempotence check is
 *    not a correctness claim. `src/core/instruction-files-migration.ts`'s
 *    `reconcileManagedBlocks` is the worked example: three steps, a whole-output
 *    comparison, and no defect, because it neither throws nor claims every step
 *    fired — it compares each step's output SEPARATELY to report what changed.
 *
 * ## Why it fails at zero inspected
 *
 * An empty inspection and a clean tree print the same tick. This repository has
 * shipped guards that reported success while inert often enough to have a rule
 * about it, so the count of transforms actually parsed is part of the report,
 * and a count of zero is exit 2 rather than exit 0. A glob that matches
 * nothing, a root that does not exist, and a parser that silently stopped all
 * reach that branch.
 *
 * Determinism: Node built-ins plus the `typescript` parser, no network, no
 * clock, no `Math.random`. The scanned root is a parameter so the suite can
 * point it at a fixture tree holding a known offender.
 *
 * CLI:
 *   node scripts/check-whole-output-guards.mjs [--json] [root]
 *
 * Exit codes (mirroring the sibling check-* scripts):
 *   0 — transforms were inspected and none is guarded only whole-output.
 *   1 — >=1 finding.
 *   2 — operational error: unknown flag, unreadable root, or ZERO transforms
 *       inspected.
 *
 * @module scripts/check-whole-output-guards
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import ts from "typescript";
import { invokedAsScript } from "./lib/invoked-as-script.mjs";

/** Directories holding source this repository authors and runs. */
export const SCANNED_ROOTS = Object.freeze([
  "all",
  "cdk",
  "expo",
  "harper-fabric",
  "nestjs",
  "npm-package",
  "phaser",
  "plugins/src",
  "rails",
  "scripts",
  "src",
  "tests",
  "typescript",
]);

/**
 * Directory names never descended into: nothing under them is authored here,
 * so a finding inside one names somebody else's code — or, for `dist`, names
 * this repository's own source a second time from its build output.
 */
const SKIPPED_DIRECTORIES = Object.freeze(["node_modules", "dist", ".git"]);

/** Array methods whose callback body runs once per element. */
const ITERATION_METHODS = Object.freeze([
  "reduce",
  "reduceRight",
  "map",
  "flatMap",
  "forEach",
  "filter",
]);

/** Calls that make a step individually accountable by construction. */
export const ACCOUNTABLE_CALLS = Object.freeze([
  "replaceOrThrow",
  "replaceOptional",
  "applyRewrites",
]);

/** Methods whose throwing `if` asserts that an anchor is present. */
const PRESENCE_METHODS = Object.freeze([
  "includes",
  "indexOf",
  "test",
  "match",
  "search",
]);

/**
 * Identifier names read as a "did anything change" flag.
 *
 * Narrow on purpose. A broader pattern would catch `isValid`, `ok` and every
 * other boolean in the tree, and a sweep whose findings are mostly noise is a
 * sweep nobody reads.
 */
const CHANGE_FLAG =
  /^(changed|modified|applied|dirty|touched|rewritten|replaced)$/i;

/** Source extensions parsed. `.d.ts` files declare types and transform nothing. */
const SOURCE_EXTENSIONS = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;

/** Collapse whitespace so an anchor spanning lines still matches its assertion. */
const normalize = text => text.replace(/\s+/g, " ").trim();

/**
 * Whether a function node is an array-method callback.
 * @param {object} fn - A function-like AST node.
 * @returns {boolean} True when it is the callback of an iteration method.
 */
export function isIterationCallback(fn) {
  const parent = fn.parent;
  return Boolean(
    parent &&
    ts.isCallExpression(parent) &&
    ts.isPropertyAccessExpression(parent.expression) &&
    ITERATION_METHODS.includes(parent.expression.name.text)
  );
}

/**
 * Whether a node sits inside something that runs more than once.
 *
 * Stops at a real function boundary: a helper CALLED from a loop is not itself
 * a loop, and treating it as one would report every string utility in the tree.
 * @param {object} node - Any AST node.
 * @returns {boolean} True when the node runs once per element/iteration.
 */
export function insideIteration(node) {
  for (let current = node.parent; current; current = current.parent) {
    if (
      ts.isForStatement(current) ||
      ts.isForOfStatement(current) ||
      ts.isForInStatement(current) ||
      ts.isWhileStatement(current) ||
      ts.isDoStatement(current)
    ) {
      return true;
    }
    const isFunction =
      ts.isFunctionDeclaration(current) ||
      ts.isFunctionExpression(current) ||
      ts.isArrowFunction(current) ||
      ts.isMethodDeclaration(current);
    if (isFunction) return isIterationCallback(current);
  }
  return false;
}

/**
 * The scope a node's evidence belongs to.
 *
 * An iteration CALLBACK is deliberately merged into the function that contains
 * it. The steps of a `reduce`-driven transform live in the callback while the
 * guard that is supposed to cover them lives outside it, and a scope model that
 * separated the two would look at the exact shape this sweep exists for and see
 * a transform with no guard next to a guard with no transform.
 * @param {object} node - Any AST node.
 * @param {object} sourceFile - The file's root node, used as the module scope.
 * @returns {object} The owning scope node.
 */
export function scopeOf(node, sourceFile) {
  for (let current = node.parent; current; current = current.parent) {
    if (ts.isSourceFile(current)) return current;
    const isFunction =
      ts.isFunctionDeclaration(current) ||
      ts.isFunctionExpression(current) ||
      ts.isArrowFunction(current) ||
      ts.isMethodDeclaration(current);
    if (isFunction && !isIterationCallback(current)) return current;
  }
  return sourceFile;
}

/**
 * Whether a statement transfers control on failure.
 * @param {object | undefined} statement - The branch taken when a test holds.
 * @returns {boolean} True when it throws or exits.
 */
function branchFails(statement) {
  if (!statement) return false;
  const text = statement.getText();
  return /\bthrow\b/.test(text) || /process\.exit\s*\(/.test(text);
}

/**
 * The root identifier of an expression, for relating a guard to a transform.
 * @param {object} node - An expression node.
 * @returns {string} The base identifier's text, or `""`.
 */
export function rootIdentifier(node) {
  let current = node;
  while (current && ts.isPropertyAccessExpression(current)) {
    current = current.expression;
  }
  return current && ts.isIdentifier(current) ? current.text : "";
}

/**
 * The variable a transform's result is bound to, walking out of any callback.
 * @param {object} node - The replacement call.
 * @param {object} scope - The owning scope node.
 * @returns {string} The bound name, or `""` when the result is not bound.
 */
export function boundName(node, scope) {
  for (
    let current = node.parent;
    current && current !== scope.parent;
    current = current.parent
  ) {
    if (ts.isVariableDeclaration(current) && ts.isIdentifier(current.name)) {
      return current.name.text;
    }
    if (
      ts.isBinaryExpression(current) &&
      current.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isIdentifier(current.left)
    ) {
      return current.left.text;
    }
  }
  return "";
}

/**
 * Classify a replacement call's anchor.
 * @param {object} node - A `.replace`/`.replaceAll` call expression.
 * @returns {{ anchored: boolean, iterated: boolean }} How it counts.
 */
export function classifyAnchor(node) {
  const anchor = node.arguments[0];
  const iterated = insideIteration(node);
  if (!anchor) return { anchored: false, iterated };
  if (ts.isRegularExpressionLiteral(anchor)) {
    // A `/g` rewrite over a document matching nothing is routine and correct.
    const global = /\/[a-z]*g[a-z]*$/.test(anchor.text);
    return { anchored: !global, iterated };
  }
  const literal =
    ts.isStringLiteral(anchor) ||
    ts.isNoSubstitutionTemplateLiteral(anchor) ||
    ts.isTemplateExpression(anchor);
  return { anchored: literal || iterated, iterated };
}

/**
 * Collect every scope's transform evidence from one parsed file.
 * @param {object} sourceFile - The parsed source file.
 * @returns {Map<object, object>} Scope node to its collected evidence.
 */
export function collectScopes(sourceFile) {
  const scopes = new Map();
  const evidenceFor = node => {
    const scope = scopeOf(node, sourceFile);
    if (!scopes.has(scope)) {
      scopes.set(scope, {
        steps: [],
        guards: [],
        assertedAnchors: new Set(),
        accountableCalls: 0,
        variables: new Set(),
        name:
          scope === sourceFile
            ? "<module>"
            : (scope.name?.getText() ?? "<anonymous>"),
      });
    }
    return scopes.get(scope);
  };
  const lineOf = node =>
    sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;

  const visitCall = node => {
    const callee = ts.isPropertyAccessExpression(node.expression)
      ? node.expression.name.text
      : ts.isIdentifier(node.expression)
        ? node.expression.text
        : "";
    if (ACCOUNTABLE_CALLS.includes(callee)) {
      evidenceFor(node).accountableCalls += 1;
      return;
    }
    if (
      (callee === "replace" || callee === "replaceAll") &&
      node.arguments.length >= 1
    ) {
      const { anchored, iterated } = classifyAnchor(node);
      if (!anchored) return;
      const evidence = evidenceFor(node);
      const scope = scopeOf(node, sourceFile);
      const receiver = ts.isPropertyAccessExpression(node.expression)
        ? rootIdentifier(node.expression.expression)
        : "";
      const bound = boundName(node, scope);
      if (receiver) evidence.variables.add(receiver);
      if (bound) evidence.variables.add(bound);
      evidence.steps.push({
        anchor: normalize(node.arguments[0].getText()),
        iterated,
        line: lineOf(node.arguments[0]),
        // A chained `a.replace(A, …).replace(B, …)` is visited outermost-first,
        // so B is seen before A. Recording the anchor's offset lets the report
        // be re-sorted into SOURCE order; a finding listed back-to-front reads
        // as though the sweep found a different transform than the one on screen.
        position: node.arguments[0].getStart(),
      });
      return;
    }
    if (!PRESENCE_METHODS.includes(callee)) return;
    // An anchor-presence check only counts when something acts on it.
    let enclosing = node.parent;
    while (enclosing && !ts.isIfStatement(enclosing)) {
      if (ts.isSourceFile(enclosing)) return;
      enclosing = enclosing.parent;
    }
    if (!enclosing || !branchFails(enclosing.thenStatement)) return;
    const evidence = evidenceFor(node);
    // `anchor.test(text)` names the anchor on the RECEIVER; the others name it
    // in the first argument. Recording both spellings costs nothing and stops
    // an assertion written the other way round from reading as absent.
    if (node.arguments[0]) {
      evidence.assertedAnchors.add(normalize(node.arguments[0].getText()));
    }
    if (ts.isPropertyAccessExpression(node.expression)) {
      evidence.assertedAnchors.add(
        normalize(node.expression.expression.getText())
      );
    }
  };

  const visitIf = node => {
    // TypeScript 6 renamed `IfStatement.condition` to `.expression`; reading
    // both keeps the sweep working either side of that rename instead of
    // silently inspecting zero guards, which is the failure mode this whole
    // family of scripts exists to refuse.
    const test = node.expression ?? node.condition;
    if (!test || !branchFails(node.thenStatement)) return;
    const flagged =
      (ts.isPrefixUnaryExpression(test) &&
        ts.isIdentifier(test.operand) &&
        CHANGE_FLAG.test(test.operand.text)) ||
      (ts.isIdentifier(test) && CHANGE_FLAG.test(test.text));
    if (flagged) {
      evidenceFor(node).guards.push({
        line: lineOf(node),
        test: normalize(test.getText()),
        operands: [],
      });
      return;
    }
    const comparison =
      ts.isBinaryExpression(test) &&
      (test.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken ||
        test.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsEqualsToken);
    if (!comparison) return;
    const plain = side =>
      ts.isIdentifier(side) || ts.isPropertyAccessExpression(side);
    if (!plain(test.left) || !plain(test.right)) return;
    evidenceFor(node).guards.push({
      line: lineOf(node),
      test: normalize(test.getText()),
      operands: [rootIdentifier(test.left), rootIdentifier(test.right)],
    });
  };

  const walk = node => {
    if (ts.isCallExpression(node)) visitCall(node);
    if (ts.isIfStatement(node)) visitIf(node);
    ts.forEachChild(node, walk);
  };
  walk(sourceFile);
  return scopes;
}

/**
 * Order two steps by where their anchors sit in the file.
 * @param {{ position?: number }} left - One step.
 * @param {{ position?: number }} right - The other step.
 * @returns {number} Negative when `left` comes first.
 */
export function byPosition(left, right) {
  return (left.position ?? 0) - (right.position ?? 0);
}

/**
 * Turn one scope's evidence into a finding, or `null`.
 * @param {object} evidence - Collected evidence for the scope.
 * @param {string} file - Repository-relative path, for reporting.
 * @returns {object | null} A finding, or `null` when the scope is sound.
 */
export function judgeScope(evidence, file) {
  const stepCount = evidence.steps.reduce(
    (total, step) => total + (step.iterated ? 2 : 1),
    0
  );
  if (stepCount < 2) return null;
  const guards = evidence.guards.filter(
    guard =>
      guard.operands.length === 0 ||
      guard.operands.some(name => evidence.variables.has(name))
  );
  if (guards.length === 0) return null;
  if (evidence.accountableCalls >= evidence.steps.length) return null;
  const unaccounted = evidence.steps
    .filter(step => !evidence.assertedAnchors.has(step.anchor))
    // Named comparator, never a bare `.sort()`: the default sorts by string
    // coercion, which orders offsets 2, 10, 9 as "10", "2", "9".
    .sort(byPosition);
  if (unaccounted.length === 0) return null;
  return {
    file,
    scope: evidence.name,
    steps: stepCount,
    guards,
    unaccounted: unaccounted.map(step => ({
      line: step.line,
      anchor:
        step.anchor.length > 70 ? `${step.anchor.slice(0, 70)}…` : step.anchor,
    })),
  };
}

/**
 * Walk a directory tree, yielding source files the sweep can parse.
 * @param {string} root - Absolute directory to walk.
 * @param {string} repoRoot - Absolute repository root, for relative paths.
 * @returns {{ absolute: string, relative: string }[]} Files, in a stable order.
 */
export function collectFiles(root, repoRoot) {
  const found = [];
  const walk = directory => {
    const entries = readdirSync(directory, { withFileTypes: true });
    for (const entry of [...entries].sort((a, b) =>
      a.name < b.name ? -1 : 1
    )) {
      if (SKIPPED_DIRECTORIES.includes(entry.name)) continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(absolute);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!SOURCE_EXTENSIONS.test(entry.name)) continue;
      if (/\.d\.(ts|mts|cts)$/.test(entry.name)) continue;
      found.push({ absolute, relative: path.relative(repoRoot, absolute) });
    }
  };
  walk(root);
  return found;
}

/**
 * Run the sweep over a tree.
 * @param {string} repoRoot - Absolute path of the tree to inspect.
 * @param {readonly string[]} [roots] - Sub-directories to scan.
 * @returns {{ inspected: number, files: number, findings: object[] }} Report.
 */
export function sweep(repoRoot, roots = SCANNED_ROOTS) {
  const report = { inspected: 0, files: 0, findings: [] };
  for (const root of roots) {
    const absolute = path.join(repoRoot, root);
    try {
      if (!statSync(absolute).isDirectory()) continue;
    } catch {
      continue;
    }
    for (const file of collectFiles(absolute, repoRoot)) {
      report.files += 1;
      const text = readFileSync(file.absolute, "utf8");
      if (!/\.replace(All)?\s*\(/.test(text)) continue;
      const sourceFile = ts.createSourceFile(
        file.absolute,
        text,
        ts.ScriptTarget.Latest,
        true,
        /\.tsx?$/.test(file.absolute) ? ts.ScriptKind.TS : ts.ScriptKind.JS
      );
      for (const evidence of collectScopes(sourceFile).values()) {
        if (evidence.steps.length === 0) continue;
        report.inspected += 1;
        const finding = judgeScope(evidence, file.relative);
        if (finding) report.findings.push(finding);
      }
    }
  }
  return report;
}

/**
 * Render the human-readable report.
 * @param {{ inspected: number, files: number, findings: object[] }} report - Result.
 * @returns {string} The report text.
 */
export function formatReport(report) {
  const lines = [
    `check:whole-output-guards — inspected ${report.inspected} anchored transform(s) across ${report.files} file(s).`,
  ];
  if (report.inspected === 0) {
    lines.push(
      "  ✖ ZERO transforms inspected. A sweep that parsed nothing cannot report a clean tree; treating this as a failure, not an all-clear."
    );
    return lines.join("\n");
  }
  for (const finding of report.findings) {
    lines.push(
      `  ✖ ${finding.file} — ${finding.scope}() applies ${finding.steps} anchored rewrites`
    );
    for (const guard of finding.guards) {
      lines.push(
        `      line ${guard.line}: \`${guard.test}\` throws only when NOTHING changed`
      );
    }
    for (const step of finding.unaccounted) {
      lines.push(
        `      line ${step.line}: ${step.anchor} — never asserted present`
      );
    }
  }
  if (report.findings.length === 0) {
    lines.push(
      "  ✔ Every multi-step anchored transform holds each of its steps to account."
    );
    return lines.join("\n");
  }
  lines.push(
    "",
    "Fix: assert each anchor BEFORE replacing, and name the missing one —",
    '  import { applyRewrites } from "…/core/anchored-rewrite.js";',
    "  const out = applyRewrites(source, [",
    '    { anchor: A, replacement: A2, label: "the import" },',
    '    { anchor: B, replacement: B2, label: "the default root" },',
    "  ], PROVER_SOURCE);",
    "A step that may legitimately find nothing declares `optional: true` (or calls `replaceOptional`) rather than being left unguarded."
  );
  return lines.join("\n");
}

/**
 * CLI entry point.
 * @returns {void}
 */
export function main() {
  const args = process.argv.slice(2);
  const unknown = args.find(arg => arg.startsWith("--") && arg !== "--json");
  if (unknown) {
    console.error(`check:whole-output-guards: unknown flag ${unknown}`);
    process.exitCode = 2;
    return;
  }
  const json = args.includes("--json");
  const repoRoot = path.resolve(args.find(arg => !arg.startsWith("--")) ?? ".");
  const report = sweep(repoRoot);
  console.log(json ? JSON.stringify(report, null, 2) : formatReport(report));
  if (report.inspected === 0) process.exitCode = 2;
  else if (report.findings.length > 0) process.exitCode = 1;
}

if (invokedAsScript(import.meta.url)) {
  main();
}
