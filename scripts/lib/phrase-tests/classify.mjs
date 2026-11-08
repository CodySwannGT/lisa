/**
 * Decide whether a test file is "phrase-only" (CodySwannGT/lisa#4609).
 *
 * The issue's three rules, applied conservatively — a file this rejects stays
 * exactly as it is, so every doubt resolves to "not phrase-only":
 *
 *  1. Its only I/O is reading text files. Imports are limited to the test
 *     runner, `path`, `url` and the file-system modules, and the only
 *     file-system members it may touch are the read calls.
 *  2. It spawns no process and imports no module under test. A relative
 *     import is allowed only when it resolves to a helper inside `tests/`
 *     that itself passes rules 1 and 2 (checked transitively), so a helper
 *     that reaches into `src/`, `scripts/`, `all/` or `plugins/` rejects the
 *     file. `process` may only be used for `process.cwd()`. `require`,
 *     dynamic `import()` and `vi` are refused.
 *  3. Every `expect(...)` is a phrase assertion (see `isPhraseChain`), and
 *     the test file has at least one. A helper's own `expect` calls must be
 *     phrase assertions too.
 * @module scripts/lib/phrase-tests/classify
 */
import path from "node:path";

import ts from "typescript";

import { expectChains, isPhraseChain, parseSource, walk } from "./ast.mjs";

/** Package modules a phrase-only file may import. */
export const ALLOWED_MODULES = Object.freeze([
  "vitest",
  "node:fs",
  "fs",
  "node:fs/promises",
  "fs/promises",
  "fs-extra",
  "node:path",
  "path",
  "node:url",
  "url",
]);

/** Modules whose members are file-system calls, checked against READ_CALLS. */
const FS_MODULES = Object.freeze([
  "node:fs",
  "fs",
  "node:fs/promises",
  "fs/promises",
  "fs-extra",
]);

/** The only file-system members a phrase-only file may use. */
export const READ_CALLS = Object.freeze(["readFileSync", "readFile"]);

/** Runner exports that would make a file more than a phrase check. */
const REFUSED_RUNNER_EXPORTS = Object.freeze(["vi", "vitest", "assert"]);

/** Directory a helper must live in to be importable by a phrase-only file. */
const TESTS_DIR = "tests/";

/** Script-module extensions a TypeScript import may spell for a `.ts` file. */
const JS_EXTENSIONS = Object.freeze([".js", ".mjs", ".cjs"]);

/**
 * Resolve a relative import from a test file to a repository-relative helper
 * path inside `tests/`, the way TypeScript's bundler resolution would:
 * `./x.js` names `./x.ts`, and a bare `./x` tries `.ts` then `/index.ts`.
 * @param {string} fromFile - Repository-relative importing file.
 * @param {string} specifier - The relative module specifier.
 * @param {(file: string) => boolean} exists - Whether a repo-relative file exists.
 * @returns {string | undefined} The helper path, or undefined when it does not
 *   resolve to an existing file under `tests/`.
 */
export function resolveTestImport(fromFile, specifier, exists) {
  const target = path.posix.normalize(
    path.posix.join(path.posix.dirname(fromFile), specifier)
  );
  if (!target.startsWith(TESTS_DIR)) return undefined;
  const extension = path.posix.extname(target);
  const stem = JS_EXTENSIONS.includes(extension)
    ? target.slice(0, -extension.length)
    : target;
  const candidates = [`${stem}.ts`, `${stem}.mts`, target, `${stem}/index.ts`];
  return candidates.find(candidate => exists(candidate));
}

/**
 * The module specifier of an import or re-export, or undefined.
 * @param {ts.Statement} statement - A top-level statement.
 * @returns {string | undefined} The specifier text.
 */
function moduleSpecifierOf(statement) {
  const specifier =
    ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)
      ? statement.moduleSpecifier
      : undefined;
  return specifier && ts.isStringLiteral(specifier)
    ? specifier.text
    : undefined;
}

/**
 * Whether an import or re-export is erased at runtime.
 * @param {ts.Statement} statement - An import or export declaration.
 * @returns {boolean} True for `import type` / `export type`.
 */
function isTypeOnly(statement) {
  if (ts.isExportDeclaration(statement)) return statement.isTypeOnly;
  return (
    ts.isImportDeclaration(statement) &&
    statement.importClause?.isTypeOnly === true
  );
}

/**
 * Reasons a package import breaks rules 1 or 2.
 * @param {ts.Statement} statement - One import or re-export.
 * @param {string} specifier - Its (non-relative) module specifier.
 * @param {Set<string>} fsNamespaces - Collects namespace/default fs bindings.
 * @returns {string[]} Zero or more reasons.
 */
function packageImportReasons(statement, specifier, fsNamespaces) {
  if (!ALLOWED_MODULES.includes(specifier)) return [`imports ${specifier}`];
  if (!ts.isImportDeclaration(statement)) return [];
  const clause = statement.importClause;
  const isFs = FS_MODULES.includes(specifier);
  if (isFs && clause?.name) fsNamespaces.add(clause.name.text);
  const bindings = clause?.namedBindings;
  if (bindings && ts.isNamespaceImport(bindings)) {
    if (isFs) fsNamespaces.add(bindings.name.text);
    return [];
  }
  const named =
    bindings && ts.isNamedImports(bindings) ? bindings.elements : [];
  return named.flatMap(element => {
    const imported = (element.propertyName ?? element.name).text;
    if (isFs && !READ_CALLS.includes(imported)) return [`uses fs.${imported}`];
    if (specifier === "vitest" && REFUSED_RUNNER_EXPORTS.includes(imported))
      return [`imports ${imported} from vitest`];
    return [];
  });
}

/**
 * Reasons a single node breaks rule 1 or 2 outside the import list.
 * @param {ts.Node} node - Any node.
 * @param {Set<string>} fsNamespaces - Namespace/default fs bindings.
 * @returns {string | undefined} A reason, or undefined when the node is fine.
 */
function nodeReason(node, fsNamespaces) {
  if (node.kind === ts.SyntaxKind.ImportKeyword) return "dynamic import()";
  if (ts.isIdentifier(node)) {
    if (node.text === "require") return "require()";
    return fsNamespaces.has(node.text) ? fsNamespaceReason(node) : undefined;
  }
  if (!ts.isPropertyAccessExpression(node)) return undefined;
  const owner = node.expression;
  if (!ts.isIdentifier(owner)) return undefined;
  const member = node.name.text;
  if (owner.text === "process" && member !== "cwd") return `process.${member}`;
  if (owner.text === "expect") return `expect.${member}`;
  return undefined;
}

/**
 * A namespace or default `fs` binding may only be used as `fs.readFileSync`,
 * `fs.readFile` or `fs.promises.readFile`. Any other use — destructuring,
 * element access, passing the module along — could reach a write, so it
 * rejects the file.
 * @param {ts.Identifier} identifier - A reference to an fs binding.
 * @returns {string | undefined} A reason, or undefined for a read.
 */
function fsNamespaceReason(identifier) {
  const parent = identifier.parent;
  if (ts.isImportClause(parent) || ts.isNamespaceImport(parent)) {
    return undefined;
  }
  if (ts.isPropertyAccessExpression(parent) && parent.name === identifier) {
    return undefined;
  }
  if (!ts.isPropertyAccessExpression(parent)) {
    return `uses the ${identifier.text} module other than to read`;
  }
  const member = parent.name.text;
  if (READ_CALLS.includes(member)) return undefined;
  return member === "promises" ? promisesReason(parent) : `uses fs.${member}`;
}

/**
 * `fs.promises.readFile` is a read; any other `fs.promises.*` is not.
 * @param {ts.PropertyAccessExpression} node - The `fs.promises` access.
 * @returns {string | undefined} A reason, or undefined for a read.
 */
function promisesReason(node) {
  const parent = node.parent;
  return ts.isPropertyAccessExpression(parent) &&
    READ_CALLS.includes(parent.name.text)
    ? undefined
    : "uses fs.promises";
}

/**
 * @typedef {object} Analysis
 * @property {string[]} reasons - Rule breaches in this file or its helpers.
 * @property {number} assertions - `expect(...)` sites in this file itself.
 * @property {string[]} helpers - Helper files reached, transitively.
 */

/**
 * Reasons one relative import breaks rule 2, following it into the helper.
 * @param {string} fileName - The importing file.
 * @param {string} specifier - The relative specifier.
 * @param {(file: string) => string | undefined} readSource - Reads a repo file.
 * @param {Set<string>} seen - Files already analysed.
 * @param {string[]} helpers - Collects every helper reached.
 * @returns {string[]} Zero or more reasons.
 */
function helperReasons(fileName, specifier, readSource, seen, helpers) {
  const helper = resolveTestImport(
    fileName,
    specifier,
    file => readSource(file) !== undefined
  );
  if (helper === undefined) {
    return [`imports ${specifier} (not a readable helper under tests/)`];
  }
  if (seen.has(helper)) return [];
  helpers.push(helper);
  const inner = analyse(helper, readSource(helper) ?? "", readSource, seen);
  helpers.push(...inner.helpers);
  return inner.reasons.map(reason => `helper ${helper}: ${reason}`);
}

/**
 * Analyse one file (test or helper) and, through its relative imports, every
 * helper it reaches.
 * @param {string} fileName - Repository-relative path.
 * @param {string} text - Its contents.
 * @param {(file: string) => string | undefined} readSource - Reads a repo file.
 * @param {Set<string>} seen - Files already analysed, to stop import cycles.
 * @returns {Analysis} What the file and its helpers break.
 */
function analyse(fileName, text, readSource, seen) {
  seen.add(fileName);
  const sourceFile = parseSource(fileName, text);
  /** @type {Set<string>} */
  const fsNamespaces = new Set();
  /** @type {string[]} */
  const helpers = [];
  const reasons = sourceFile.statements.flatMap(statement => {
    const specifier = moduleSpecifierOf(statement);
    if (specifier === undefined || isTypeOnly(statement)) return [];
    return specifier.startsWith(".")
      ? helperReasons(fileName, specifier, readSource, seen, helpers)
      : packageImportReasons(statement, specifier, fsNamespaces);
  });
  walk(sourceFile, node => {
    const reason = nodeReason(node, fsNamespaces);
    if (reason) reasons.push(reason);
  });
  const chains = expectChains(sourceFile);
  const nonPhrase = chains.filter(chain => !isPhraseChain(chain)).length;
  if (nonPhrase > 0) reasons.push(`${nonPhrase} non-phrase assertion(s)`);
  return { reasons, assertions: chains.length, helpers };
}

/**
 * Classify one test file.
 * @param {string} fileName - Repository-relative path of the test file.
 * @param {string} text - Its contents.
 * @param {(file: string) => string | undefined} [readSource] - Reads a
 *   repository-relative file, for following relative helper imports. Without
 *   it, every relative import rejects the file.
 * @returns {{ file: string, phraseOnly: boolean, assertions: number, reasons: string[], helpers: string[] }} The verdict.
 */
export function classifyTestSource(
  fileName,
  text,
  readSource = () => undefined
) {
  const { reasons, assertions, helpers } = analyse(
    fileName,
    text,
    readSource,
    new Set()
  );
  if (assertions === 0) reasons.push("no assertions");
  return {
    file: fileName,
    phraseOnly: reasons.length === 0,
    assertions,
    reasons: [...new Set(reasons)],
    helpers: [...new Set(helpers)],
  };
}
