/**
 * Delete WORDING assertion sites from test files (CodySwannGT/lisa#4867).
 *
 * Works on the TypeScript AST, never on text patterns:
 *
 *  1. Each WORDING site (a recorded `file:line:column`) is mapped to the
 *     `expect(...)` chain whose matcher call contains that position. Its
 *     statement is deleted when it is a plain expression statement in a
 *     block, or when it is the whole body of a `forEach` callback (the
 *     `forEach` statement goes). Any other shape is left alone and counted
 *     as kept-uneditable.
 *  2. Emptied containers go too, to a fixed point: a loop or `if` whose body
 *     lost every statement; a test (`it` / `test`, any modifier or `.each`)
 *     that had assertions and lost all of them; a `describe` that had tests
 *     and lost all of them.
 *  3. Declarations and imports nothing references any more are removed,
 *     again to a fixed point.
 *  4. A file with no test left is deleted.
 * @module scripts/lib/markdown-assertions/test-cull
 */
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import ts from "typescript";

import {
  isExpectCall,
  parseSource,
  readExpectChain,
  walk,
} from "../phrase-tests/ast.mjs";

/** Runner calls that declare a test. */
const TEST_NAMES = new Set(["it", "test"]);

/** Runner calls that declare a suite. */
const SUITE_NAMES = new Set(["describe", "suite"]);

/**
 * The runner name a call starts from: `it`, `it.each(...)`, `describe.skip`.
 * @param {ts.Node} node - A node.
 * @returns {string | undefined} The root identifier of a call's callee.
 */
function runnerName(node) {
  if (!ts.isCallExpression(node)) return undefined;
  /** @type {ts.Expression} */
  let callee = node.expression;
  while (ts.isCallExpression(callee) || ts.isPropertyAccessExpression(callee)) {
    callee = callee.expression;
  }
  return ts.isIdentifier(callee) ? callee.text : undefined;
}

/**
 * An expression with any `await` and parentheses taken off.
 * @param {ts.Expression} node - An expression.
 * @returns {ts.Expression} The inner expression.
 */
function unwrapAwait(node) {
  let inner = node;
  while (ts.isAwaitExpression(inner) || ts.isParenthesizedExpression(inner)) {
    inner = inner.expression;
  }
  return inner;
}

/**
 * The statement a node sits in directly, if its parent is a block-like list.
 * @param {ts.Node} node - An expression.
 * @returns {ts.Statement | undefined} The expression statement.
 */
function ownStatement(node) {
  /** @type {ts.Node} */
  let current = node;
  while (
    ts.isAwaitExpression(current.parent) ||
    ts.isParenthesizedExpression(current.parent)
  ) {
    current = current.parent;
  }
  const statement = current.parent;
  return statement && ts.isExpressionStatement(statement)
    ? statement
    : undefined;
}

/**
 * The statement to delete for one assertion site, or undefined when its
 * shape is not one the cull edits.
 * @param {ts.Node} site - The matcher call that ends the expect chain.
 * @returns {ts.Statement | undefined} The statement.
 */
function deletableStatement(site) {
  const statement = ownStatement(site);
  if (statement && isStatementList(statement.parent)) return statement;
  const arrow = site.parent;
  if (arrow && ts.isArrowFunction(arrow) && arrow.body === site) {
    const call = arrow.parent;
    if (
      call &&
      ts.isCallExpression(call) &&
      ts.isPropertyAccessExpression(call.expression) &&
      call.expression.name.text === "forEach"
    ) {
      const loop = ownStatement(call);
      if (loop && isStatementList(loop.parent)) return loop;
    }
  }
  return undefined;
}

/**
 * Whether a node holds a list of statements.
 * @param {ts.Node | undefined} node - A node.
 * @returns {boolean} True for blocks, files and case clauses.
 */
function isStatementList(node) {
  return (
    node !== undefined &&
    (ts.isBlock(node) ||
      ts.isSourceFile(node) ||
      ts.isCaseClause(node) ||
      ts.isDefaultClause(node))
  );
}

/**
 * Whether every statement of a body is deleted (and it had one).
 * @param {ts.Node | undefined} body - A statement or block.
 * @param {Set<ts.Node>} deleted - Deleted nodes.
 * @returns {boolean} True when the body is emptied.
 */
function emptied(body, deleted) {
  if (body === undefined) return true;
  if (deleted.has(body)) return true;
  if (!ts.isBlock(body)) return false;
  return (
    body.statements.length > 0 &&
    body.statements.every(statement => deleted.has(statement))
  );
}

/**
 * Whether a node lies inside a deleted node.
 * @param {ts.Node} node - A node.
 * @param {Set<ts.Node>} deleted - Deleted nodes.
 * @returns {boolean} True when an ancestor (or itself) is deleted.
 */
function isGone(node, deleted) {
  for (let current = node; current; current = current.parent) {
    if (deleted.has(current)) return true;
  }
  return false;
}

/**
 * Grow the deleted set with emptied loops, ifs, tests and suites, to a fixed point.
 * @param {ts.SourceFile} source - The file.
 * @param {Set<ts.Node>} deleted - Deleted statements; grows.
 */
function deleteEmptied(source, deleted) {
  const assertions = assertionIndex(source);
  let changed = true;
  while (changed) {
    changed = false;
    walk(source, node => {
      if (!ts.isStatement(node) || isGone(node, deleted)) return;
      if (!isStatementList(node.parent)) return;
      if (containerEmptied(node, deleted, assertions)) {
        deleted.add(node);
        changed = true;
      }
    });
  }
}

/**
 * @typedef {object} AssertionIndex
 * @property {Map<string, ts.Node>} helpers - Local functions that assert, by name, to their body.
 * @property {ts.Node[]} bearing - Every `expect(...)` call and every call to a helper.
 */

/**
 * The file's assertion-bearing calls: `expect(...)`, and calls to local
 * helper functions whose bodies (transitively) assert.
 * @param {ts.SourceFile} source - The file.
 * @returns {AssertionIndex} The index.
 */
function assertionIndex(source) {
  /** @type {Map<string, ts.Node>} */
  const functions = new Map();
  walk(source, node => {
    if (ts.isFunctionDeclaration(node) && node.name && node.body) {
      functions.set(node.name.text, node.body);
    } else if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      (ts.isArrowFunction(node.initializer) ||
        ts.isFunctionExpression(node.initializer))
    ) {
      functions.set(node.name.text, node.initializer.body);
    }
  });
  /** @type {Map<string, ts.Node>} */
  const helpers = new Map();
  let grew = true;
  while (grew) {
    grew = false;
    for (const [name, body] of functions) {
      if (helpers.has(name)) continue;
      let asserts = false;
      walk(body, node => {
        if (isExpectCall(node) || helperCallee(node, helpers)) asserts = true;
      });
      if (asserts) {
        helpers.set(name, body);
        grew = true;
      }
    }
  }
  /** @type {ts.Node[]} */
  const bearing = [];
  walk(source, node => {
    if (isExpectCall(node) || helperCallee(node, helpers)) bearing.push(node);
  });
  return { helpers, bearing };
}

/**
 * The helper a call invokes, if it is a call to one.
 * @param {ts.Node} node - A node.
 * @param {Map<string, ts.Node>} helpers - Known helpers.
 * @returns {string | undefined} The helper's name.
 */
function helperCallee(node, helpers) {
  return ts.isCallExpression(node) &&
    ts.isIdentifier(node.expression) &&
    helpers.has(node.expression.text)
    ? node.expression.text
    : undefined;
}

/**
 * Whether an assertion-bearing call no longer asserts: it was deleted, or it
 * calls a helper whose every assertion is gone.
 * @param {ts.Node} node - An expect call or helper call.
 * @param {Set<ts.Node>} deleted - Deleted nodes.
 * @param {AssertionIndex} assertions - The index.
 * @param {Set<string>} [visiting] - Helpers on the current path (cycles).
 * @returns {boolean} True when it asserts nothing any more.
 */
function bearingGone(node, deleted, assertions, visiting = new Set()) {
  if (isGone(node, deleted)) return true;
  const name = helperCallee(node, assertions.helpers);
  if (name === undefined || visiting.has(name)) return false;
  const body = assertions.helpers.get(name);
  const inside = assertions.bearing.filter(
    other => body !== undefined && contains(body, other)
  );
  const path = new Set([...visiting, name]);
  return (
    inside.length > 0 &&
    inside.every(other => bearingGone(other, deleted, assertions, path))
  );
}

/**
 * Whether one statement became an empty container.
 * @param {ts.Statement} node - A statement.
 * @param {Set<ts.Node>} deleted - Deleted nodes.
 * @param {AssertionIndex} assertions - The file's assertion-bearing calls.
 * @returns {boolean} True when it should be deleted.
 */
function containerEmptied(node, deleted, assertions) {
  if (
    ts.isForStatement(node) ||
    ts.isForOfStatement(node) ||
    ts.isForInStatement(node) ||
    ts.isWhileStatement(node)
  ) {
    return emptied(node.statement, deleted);
  }
  if (ts.isIfStatement(node)) {
    return (
      emptied(node.thenStatement, deleted) &&
      (node.elseStatement === undefined || emptied(node.elseStatement, deleted))
    );
  }
  if (!ts.isExpressionStatement(node)) return false;
  const call = unwrapAwait(node.expression);
  if (
    helperCallee(call, assertions.helpers) &&
    bearingGone(call, deleted, assertions)
  ) {
    return true;
  }
  const name = runnerName(call);
  if (name && TEST_NAMES.has(name)) {
    const inside = assertions.bearing.filter(other => contains(node, other));
    return (
      inside.length > 0 &&
      inside.every(other => bearingGone(other, deleted, assertions))
    );
  }
  if (name && SUITE_NAMES.has(name)) {
    const tests = [];
    walk(node, child => {
      if (
        child !== node &&
        ts.isExpressionStatement(child) &&
        TEST_NAMES.has(runnerName(child.expression) ?? "")
      ) {
        tests.push(child);
      }
    });
    return tests.length > 0 && tests.every(test => isGone(test, deleted));
  }
  if (
    ts.isCallExpression(call) &&
    ts.isPropertyAccessExpression(call.expression) &&
    call.expression.name.text === "forEach"
  ) {
    const callback = call.arguments[0];
    return (
      callback !== undefined &&
      (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback)) &&
      emptied(callback.body, deleted)
    );
  }
  return false;
}

/**
 * Whether `outer` contains `inner`.
 * @param {ts.Node} outer - Container.
 * @param {ts.Node} inner - Candidate.
 * @returns {boolean} True when inner is within outer.
 */
function contains(outer, inner) {
  return (
    inner.getStart() >= outer.getStart() && inner.getEnd() <= outer.getEnd()
  );
}

/**
 * Remove nodes from text, outermost only, with their leading trivia.
 * @param {ts.SourceFile} source - The file.
 * @param {Set<ts.Node>} deleted - Nodes to remove.
 * @returns {string} The new text.
 */
function removeNodes(source, deleted) {
  const ranges = [...deleted]
    .filter(node => !isGone(node.parent, deleted))
    .map(node => [node.getFullStart(), node.getEnd()])
    .sort((a, b) => (b[0] ?? 0) - (a[0] ?? 0));
  let text = source.text;
  for (const [start = 0, end = 0] of ranges) {
    text = text.slice(0, start) + text.slice(end);
  }
  return text;
}

/**
 * Names a declaration binds.
 * @param {ts.BindingName} name - A binding name.
 * @returns {string[]} Identifiers.
 */
function boundNames(name) {
  if (ts.isIdentifier(name)) return [name.text];
  return name.elements.flatMap(element =>
    ts.isOmittedExpression(element) ? [] : boundNames(element.name)
  );
}

/**
 * Whether an identifier sits where a name is declared, not referenced.
 * @param {ts.Identifier} node - An identifier.
 * @returns {boolean} True for declaration and member-name positions.
 */
function isDeclaringPosition(node) {
  const parent = node.parent;
  return (
    (ts.isVariableDeclaration(parent) && parent.name === node) ||
    (ts.isBindingElement(parent) && parent.name === node) ||
    (ts.isParameter(parent) && parent.name === node) ||
    (ts.isFunctionDeclaration(parent) && parent.name === node) ||
    ts.isImportSpecifier(parent) ||
    ts.isImportClause(parent) ||
    ts.isNamespaceImport(parent) ||
    (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
    (ts.isPropertyAssignment(parent) && parent.name === node) ||
    (ts.isPropertySignature(parent) && parent.name === node) ||
    (ts.isTypeAliasDeclaration(parent) && parent.name === node) ||
    (ts.isInterfaceDeclaration(parent) && parent.name === node)
  );
}

/**
 * Whether a name is referenced anywhere inside a scope.
 * @param {string} name - The name.
 * @param {ts.Node} scope - Where to look.
 * @returns {boolean} True when some identifier refers to it.
 */
function referencedIn(name, scope) {
  let found = false;
  walk(scope, node => {
    if (!found && ts.isIdentifier(node) && node.text === name) {
      found = !isDeclaringPosition(node);
    }
  });
  return found;
}

/**
 * Parameter renames that mark a callback's now-unused parameters with `_`.
 * @param {ts.SourceFile} source - The file.
 * @returns {{ start: number, end: number, text: string }[]} Rewrites.
 */
function unusedParameterRenames(source) {
  /** @type {{ start: number, end: number, text: string }[]} */
  const rewrites = [];
  walk(source, node => {
    if (!ts.isParameter(node) || !ts.isIdentifier(node.name)) return;
    const owner = node.parent;
    const name = node.name.text;
    if (name.startsWith("_") || name === "this") return;
    if (!(ts.isArrowFunction(owner) || ts.isFunctionExpression(owner))) return;
    if (owner.body && !referencedIn(name, owner.body)) {
      rewrites.push({
        start: node.name.getStart(),
        end: node.name.getEnd(),
        text: `_${name}`,
      });
    }
  });
  return rewrites;
}

/**
 * Whether a statement is exported.
 * @param {ts.Statement} node - A statement.
 * @returns {boolean} True when it carries `export`.
 */
function isExported(node) {
  return (ts.canHaveModifiers(node) ? (ts.getModifiers(node) ?? []) : []).some(
    modifier => modifier.kind === ts.SyntaxKind.ExportKeyword
  );
}

/**
 * One pass of unused-declaration removal.
 * @param {string} fileName - File name.
 * @param {string} text - File text.
 * @returns {string} New text (unchanged when nothing is unused).
 */
function removeUnusedOnce(fileName, text) {
  const source = parseSource(fileName, text);
  const fileUnused = (/** @type {string} */ name) =>
    !referencedIn(name, source);
  /** @type {Set<ts.Node>} */
  const deleted = new Set();
  /** @type {{ start: number, end: number, text: string }[]} */
  const rewrites = [];
  walk(source, node => {
    const scope = node.parent;
    const local = isStatementList(scope);
    if (ts.isVariableStatement(node) && !isExported(node) && local) {
      const names = node.declarationList.declarations.flatMap(d =>
        boundNames(d.name)
      );
      if (names.length > 0 && names.every(name => !referencedIn(name, scope)))
        deleted.add(node);
    } else if (
      ts.isFunctionDeclaration(node) &&
      node.name &&
      !isExported(node) &&
      local
    ) {
      if (!referencedIn(node.name.text, scope)) deleted.add(node);
    } else if (
      (ts.isTypeAliasDeclaration(node) || ts.isInterfaceDeclaration(node)) &&
      !isExported(node)
    ) {
      if (fileUnused(node.name.text)) deleted.add(node);
    } else if (ts.isImportDeclaration(node) && node.importClause) {
      const rewrite = importRewrite(node, fileUnused, source);
      if (rewrite === null) deleted.add(node);
      else if (rewrite) rewrites.push(rewrite);
    }
  });
  const outermost = [...deleted].filter(node => !isGone(node.parent, deleted));
  const renames =
    outermost.length === 0 && rewrites.length === 0
      ? unusedParameterRenames(source)
      : [];
  if (outermost.length === 0 && rewrites.length === 0 && renames.length === 0)
    return text;
  let next = text;
  const edits = [
    ...outermost.map(node => ({
      start: node.getFullStart(),
      end: node.getEnd(),
      text: "",
    })),
    ...rewrites,
    ...renames,
  ].sort((a, b) => b.start - a.start);
  for (const edit of edits)
    next = next.slice(0, edit.start) + edit.text + next.slice(edit.end);
  return next;
}

/**
 * How to rewrite an import whose bindings are partly or wholly unused.
 * @param {ts.ImportDeclaration} node - The import.
 * @param {(name: string) => boolean} unused - Whether a name is unreferenced.
 * @param {ts.SourceFile} source - The file.
 * @returns {{ start: number, end: number, text: string } | null | undefined}
 *   A rewrite, null to delete the import, undefined to leave it.
 */
function importRewrite(node, unused, source) {
  const clause = /** @type {ts.ImportClause} */ (node.importClause);
  const defaultUnused = clause.name ? unused(clause.name.text) : true;
  const bindings = clause.namedBindings;
  if (bindings && ts.isNamespaceImport(bindings)) {
    return defaultUnused && unused(bindings.name.text) ? null : undefined;
  }
  const elements =
    bindings && ts.isNamedImports(bindings) ? bindings.elements : [];
  const kept = elements.filter(element => !unused(element.name.text));
  if (defaultUnused && kept.length === 0) return null;
  if (
    kept.length === elements.length &&
    (clause.name === undefined || !defaultUnused)
  )
    return undefined;
  if (!bindings || !ts.isNamedImports(bindings)) return undefined;
  if (kept.length === 0) {
    const name = clause.name?.getText(source) ?? "";
    return { start: clause.getStart(), end: clause.getEnd(), text: name };
  }
  return {
    start: bindings.getStart(),
    end: bindings.getEnd(),
    text: `{ ${kept.map(element => element.getText(source)).join(", ")} }`,
  };
}

/**
 * Whether a file still declares a test.
 * @param {string} fileName - File name.
 * @param {string} text - File text.
 * @returns {boolean} True when a test remains.
 */
function hasTests(fileName, text) {
  let found = false;
  walk(parseSource(fileName, text), node => {
    if (
      ts.isExpressionStatement(node) &&
      TEST_NAMES.has(runnerName(node.expression) ?? "")
    )
      found = true;
  });
  return found;
}

/**
 * The expect chains of a file whose matcher call contains a position.
 * @param {ts.SourceFile} source - The file.
 * @param {{ line: number, column: number }} site - 1-based position.
 * @returns {ts.Node | undefined} The innermost matching site node.
 */
function siteNode(source, site) {
  const lineStarts = source.getLineStarts();
  const lineStart = lineStarts[site.line - 1];
  if (lineStart === undefined) return undefined;
  const position = lineStart + site.column - 1;
  /** @type {ts.Node | undefined} */
  let best;
  walk(source, node => {
    if (!isExpectCall(node)) return;
    const chain = readExpectChain(node);
    const start = chain.site.getStart();
    if (start <= position && position <= chain.site.getEnd()) {
      if (!best || chain.site.getStart() >= best.getStart()) best = chain.site;
    }
  });
  return best;
}

/**
 * A runner statement's identity that survives edits: its callee text and
 * title argument.
 * @param {ts.ExpressionStatement} node - A runner statement.
 * @param {ts.SourceFile} source - Its file.
 * @returns {string} The key.
 */
function runnerKey(node, source) {
  const call = /** @type {ts.CallExpression} */ (node.expression);
  return `${call.expression.getText(source)}(${call.arguments[0]?.getText(source) ?? ""})`;
}

/**
 * Whether a runner call (test or suite) has an empty callback body.
 * @param {ts.ExpressionStatement} node - A runner statement.
 * @returns {boolean} True when its last function argument has no statements.
 */
function hasEmptyCallback(node) {
  const call = /** @type {ts.CallExpression} */ (node.expression);
  const callback = [...call.arguments]
    .reverse()
    .find(arg => ts.isArrowFunction(arg) || ts.isFunctionExpression(arg));
  if (!callback) return false;
  const body = /** @type {ts.ArrowFunction | ts.FunctionExpression} */ (
    callback
  ).body;
  return ts.isBlock(body) && body.statements.length === 0;
}

/**
 * Runner statements of a file, with their kind.
 * @param {ts.SourceFile} source - The file.
 * @returns {{ node: ts.ExpressionStatement, kind: "test" | "suite" }[]} Runners.
 */
function runners(source) {
  /** @type {{ node: ts.ExpressionStatement, kind: "test" | "suite" }[]} */
  const found = [];
  walk(source, node => {
    if (
      !ts.isExpressionStatement(node) ||
      !ts.isCallExpression(node.expression)
    )
      return;
    const name = runnerName(node.expression) ?? "";
    if (TEST_NAMES.has(name)) found.push({ node, kind: "test" });
    else if (SUITE_NAMES.has(name)) found.push({ node, kind: "suite" });
  });
  return found;
}

/**
 * Keys of runner statements that were already empty before the cull, so a
 * deliberate empty one is never taken for an emptied one.
 * @param {ts.SourceFile} source - The original file.
 * @returns {Set<string>} Runner keys.
 */
function emptyRunnerBodies(source) {
  return new Set(
    runners(source)
      .filter(({ node }) => hasEmptyCallback(node))
      .map(({ node }) => runnerKey(node, source))
  );
}

/**
 * Remove tests left with an empty body and suites left without tests.
 * @param {string} fileName - File name.
 * @param {string} text - File text.
 * @param {Set<string>} keep - Runners that were empty to begin with.
 * @returns {string} New text.
 */
function pruneEmptyRunners(fileName, text, keep) {
  const source = parseSource(fileName, text);
  /** @type {Set<ts.Node>} */
  const deleted = new Set();
  for (const { node, kind } of runners(source)) {
    if (!isStatementList(node.parent) || keep.has(runnerKey(node, source)))
      continue;
    if (kind === "test" && hasEmptyCallback(node)) deleted.add(node);
    if (kind === "suite") {
      const inner = runners(parseSource(fileName, node.getText(source))).filter(
        runner => runner.kind === "test"
      );
      if (inner.length === 0) deleted.add(node);
    }
  }
  return deleted.size === 0 ? text : removeNodes(source, deleted);
}

/**
 * Cull one test file.
 * @param {string} root - Repository root.
 * @param {string} file - Repository-relative test file.
 * @param {{ line: number, column: number }[]} sites - Its WORDING sites.
 * @returns {{ file: string, deleted: boolean, removedSites: number, keptUneditable: number, testsBefore: number, testsAfter: number }} What changed.
 */
function cullFile(root, file, sites) {
  const absolute = path.join(root, file);
  const original = readFileSync(absolute, "utf8");
  const source = parseSource(file, original);
  /** @type {Set<ts.Node>} */
  const deleted = new Set();
  let removedSites = 0;
  let keptUneditable = 0;
  for (const site of sites) {
    const node = siteNode(source, site);
    const statement = node && deletableStatement(node);
    if (statement) {
      deleted.add(statement);
      removedSites++;
    } else {
      keptUneditable++;
    }
  }
  deleteEmptied(source, deleted);
  const keep = emptyRunnerBodies(source);
  let text = removeNodes(source, deleted);
  for (let pass = 0; pass < 40; pass++) {
    const unused = removeUnusedOnce(file, text);
    const next = unused === text ? pruneEmptyRunners(file, text, keep) : unused;
    if (next === text) break;
    text = next;
  }
  const testsBefore = countTests(file, original);
  const remains = hasTests(file, text);
  if (!remains) rmSync(absolute);
  else if (text !== original) writeFileSync(absolute, text);
  return {
    file,
    deleted: !remains,
    removedSites,
    keptUneditable,
    testsBefore,
    testsAfter: remains ? countTests(file, text) : 0,
  };
}

/**
 * Declared tests in a file (static; `.each` counts once).
 * @param {string} fileName - File name.
 * @param {string} text - File text.
 * @returns {number} Test declarations.
 */
function countTests(fileName, text) {
  let count = 0;
  walk(parseSource(fileName, text), node => {
    if (
      ts.isExpressionStatement(node) &&
      TEST_NAMES.has(runnerName(node.expression) ?? "")
    )
      count++;
  });
  return count;
}

/**
 * Delete every WORDING site from its test file.
 * @param {string} root - Repository root.
 * @param {import("./sites.mjs").SiteVerdict[]} sites - Classified sites.
 * @returns {{ edits: ReturnType<typeof cullFile>[], removedSites: number, keptUneditable: number }} The cull.
 */
export function cullTestFiles(root, sites) {
  /** @type {Map<string, { line: number, column: number }[]>} */
  const byFile = new Map();
  for (const site of sites) {
    if (site.class !== "WORDING") continue;
    byFile.set(site.file, [...(byFile.get(site.file) ?? []), site]);
  }
  const edits = [...byFile.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([file, fileSites]) => cullFile(root, file, fileSites));
  return {
    edits,
    removedSites: edits.reduce((sum, edit) => sum + edit.removedSites, 0),
    keptUneditable: edits.reduce((sum, edit) => sum + edit.keptUneditable, 0),
  };
}
