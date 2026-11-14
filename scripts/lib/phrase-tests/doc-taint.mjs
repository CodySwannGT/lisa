/**
 * Which expressions in a test file hold Markdown document text
 * (CodySwannGT/lisa#4867).
 *
 * A file that reads a skill document often also runs a script and asserts on
 * its output; only the first kind of assertion pins document wording. This is
 * a small taint analysis over one file, iterated to a fixed point:
 *
 *  - a PATH expression names a repository document: it carries both a
 *    Markdown extension (`.md` / `.mdc`) and a document root (`plugins`,
 *    `skills`, `rules`, `.claude`, `wiki`, `README.md` ...), spelled as
 *    literals or held by bindings (including a loop variable or callback
 *    parameter fed by a path list, as in `for (const file of SKILLS)` or
 *    `it.each(SKILLS)`). Requiring the root keeps out Markdown a script under
 *    test writes, such as a `summary.md` in a temporary directory;
 *  - a DOC expression is a file read (`readFileSync` / `readFile`) of a PATH,
 *    a call to a local function that does such a read, or names a binding
 *    that holds a DOC (so `const section = sliceSection(doc, "x")` is DOC).
 *    Taint does NOT flow through a call that runs code: a spawn or exec, a
 *    function imported from a module other than a Node built-in or the test
 *    runner, or a local function whose body makes such a call. Running a
 *    document's shell block and asserting on its stdout tests behaviour, not
 *    wording, so `result = runBlock(docBlock)` is not DOC.
 *
 * Bindings are tracked by their TypeScript symbol, not their name, so a
 * `summary` holding script output in one test and a `summary` holding a
 * document in another stay apart.
 *
 * It is a heuristic and errs toward "markdown": a subject that mentions
 * document text in any way counts. A subject rooted in a call to an imported
 * helper with no Markdown path in sight is "unknown", never "other", because
 * the helper may read a document this analysis cannot see.
 * @module scripts/lib/phrase-tests/doc-taint
 */
import path from "node:path";

import ts from "typescript";

import { walk } from "./ast.mjs";

/** A literal carrying a Markdown extension. */
export const MARKDOWN_PATH = /\.mdc?\b/u;

/** Path segments naming a directory where Lisa keeps its documents. */
const DOCUMENT_DIRECTORIES = new Set([
  "plugins",
  "skills",
  "rules",
  "agents",
  "commands",
  "reference",
  ".claude",
  ".agents",
  ".cursor",
  ".codex",
  ".github",
  "wiki",
  "docs",
  "all",
  "typescript",
  "expo",
  "nestjs",
  "cdk",
  "rails",
  "npm-package",
  "base",
]);

/** File names that are documents wherever they live. */
const DOCUMENT_FILE = /^(?:SKILL|README|AGENTS|CLAUDE|GEMINI)\.md$/u;

/**
 * A literal naming a directory or file where Lisa keeps its documents. It has
 * the `test` shape of a RegExp so it can stand where one does.
 */
export const DOCUMENT_ROOT = Object.freeze({
  /**
   * @param {string} text - A literal.
   * @returns {boolean} True when a segment is a document directory or file.
   */
  test: text =>
    text
      .split("/")
      .some(
        segment =>
          DOCUMENT_DIRECTORIES.has(segment) || DOCUMENT_FILE.test(segment)
      ),
});

/** Calls that read a file's text. */
const READ_CALL_NAMES = new Set(["readFileSync", "readFile"]);

/** Calls that run a process. */
const RUN_CALL_NAMES = new Set([
  "spawn",
  "spawnSync",
  "exec",
  "execSync",
  "execFile",
  "execFileSync",
  "boundedSpawnSync",
  "execa",
]);

/**
 * Calls whose result is still a path (or a list of paths) built from their
 * arguments. A path part does not survive any other call: the result of
 * `readJob(".github/workflows/x.yml")` is file text, not a path.
 */
const PATH_CALL_NAMES = new Set([
  "join",
  "resolve",
  "normalize",
  "relative",
  "dirname",
  "basename",
  "filter",
  "map",
  "flatMap",
  "concat",
  "slice",
  "from",
  "of",
  "readdirSync",
  "globSync",
  "sync",
  "replace",
  "each",
]);

/** Modules whose imports are plumbing, not code under test. */
const PLUMBING_MODULE =
  /^(?:node:.*|fs|fs-extra|fs\/promises|path|url|os|vitest|yaml|js-yaml)$/u;

/** Fixed-point iteration cap; real files settle in two or three passes. */
const MAX_PASSES = 12;

/**
 * The text of a string literal or template fragment, else undefined.
 * @param {ts.Node} node - Any node.
 * @returns {string | undefined} The literal text.
 */
function literalText(node) {
  const literal =
    ts.isStringLiteralLike(node) ||
    ts.isTemplateHead(node) ||
    ts.isTemplateMiddle(node) ||
    ts.isTemplateTail(node);
  return literal ? node.text : undefined;
}

/**
 * The name a call invokes: `f(...)` → f, `fs.readFileSync(...)` → readFileSync.
 * @param {ts.CallExpression} call - A call.
 * @returns {string | undefined} The callee's final name.
 */
function calleeName(call) {
  const callee = call.expression;
  if (ts.isIdentifier(callee)) return callee.text;
  if (ts.isPropertyAccessExpression(callee)) return callee.name.text;
  return undefined;
}

/**
 * Every identifier a binding name introduces (destructuring included).
 * @param {ts.BindingName} name - A binding name.
 * @returns {ts.Identifier[]} The bound identifiers.
 */
function boundNames(name) {
  if (ts.isIdentifier(name)) return [name];
  return name.elements.flatMap(element =>
    ts.isOmittedExpression(element) ? [] : boundNames(element.name)
  );
}

/**
 * @typedef {object} Taint
 * @property {(identifier: ts.Identifier) => unknown} key - The binding an
 *   identifier refers to: its symbol, or its text when it has none.
 * @property {Set<unknown>} md - Bindings holding a Markdown extension.
 * @property {Set<unknown>} roots - Bindings holding a document root.
 * @property {Set<unknown>} docs - Bindings holding Markdown text.
 * @property {Set<string>} readers - Local functions that read a file.
 * @property {Set<string>} imported - Names imported from other modules.
 * @property {Set<string>} codeImports - Names imported from modules that are
 *   not Node built-ins, the test runner or a YAML parser.
 * @property {Set<string>} executors - Local functions that run code.
 * @property {Set<string>} pathFns - `<name>:md` / `<name>:root` for local
 *   functions that return a path carrying that part.
 * @property {Set<unknown>} exclude - Bindings ignored while summarising a
 *   function: its own parameters.
 * @property {Map<string, readonly ts.ParameterDeclaration[]>} functions -
 *   Local named functions and their parameters.
 */

/**
 * Whether any node under `root` satisfies `test`.
 * @param {ts.Node} root - Where to look.
 * @param {(node: ts.Node) => boolean} test - The predicate.
 * @returns {boolean} True on the first match.
 */
function some(root, test) {
  let found = false;
  walk(root, node => {
    if (!found && test(node)) found = true;
  });
  return found;
}

/**
 * Whether an expression spells or names a literal matching `pattern`, or a
 * binding in `names`.
 * @param {ts.Node} node - An expression.
 * @param {RegExp} pattern - The literal test.
 * @param {Set<unknown>} names - Tainted bindings.
 * @param {Taint} taint - Supplies the binding key.
 * @returns {boolean} True on a match.
 */
function carries(node, pattern, names, taint) {
  if (ts.isIdentifier(node)) return held(names, node, taint);
  const text = literalText(node);
  if (text !== undefined) return pattern.test(text);
  if (ts.isCallExpression(node)) {
    const name = calleeName(node) ?? "";
    const kind = names === taint.md ? "md" : "root";
    if (taint.pathFns.has(`${name}:${kind}`)) return true;
    if (!PATH_CALL_NAMES.has(name)) return false;
  }
  return (
    ts.forEachChild(
      node,
      child => carries(child, pattern, names, taint) || undefined
    ) === true
  );
}

/**
 * Whether a binding is in a taint set, ignoring the parameters of the
 * function being summarised (a summary must not depend on one caller).
 * @param {Set<unknown>} names - The taint set.
 * @param {ts.Identifier} identifier - A reference.
 * @param {Taint} taint - Supplies the key and the exclusions.
 * @returns {boolean} True when the binding is tainted.
 */
function held(names, identifier, taint) {
  const key = taint.key(identifier);
  return names.has(key) && !taint.exclude.has(key);
}

/**
 * Whether an expression carries a Markdown extension.
 * @param {ts.Node} node - An expression.
 * @param {Taint} taint - What is known so far.
 * @returns {boolean} True when it does.
 */
function hasMarkdown(node, taint) {
  return carries(node, MARKDOWN_PATH, taint.md, taint);
}

/**
 * Whether an expression carries a document root.
 * @param {ts.Node} node - An expression.
 * @param {Taint} taint - What is known so far.
 * @returns {boolean} True when it does.
 */
function hasRoot(node, taint) {
  return carries(node, DOCUMENT_ROOT, taint.roots, taint);
}

/**
 * Whether a file spells a Markdown extension and a document root anywhere in
 * its string and template literals.
 * @param {ts.SourceFile} sourceFile - The parsed test file.
 * @returns {boolean} True when it may name a repository document.
 */
export function mentionsDocumentPath(sourceFile) {
  const spells = (/** @type {RegExp} */ pattern) =>
    some(sourceFile, node => {
      const text = literalText(node);
      return text !== undefined && pattern.test(text);
    });
  return spells(MARKDOWN_PATH) && spells(DOCUMENT_ROOT);
}

/**
 * Whether an expression names a repository Markdown document.
 * @param {ts.Node} node - An expression.
 * @param {Taint} taint - What is known so far.
 * @returns {boolean} True for a PATH expression.
 */
export function isPathy(node, taint) {
  return hasMarkdown(node, taint) && hasRoot(node, taint);
}

/**
 * Whether an expression holds Markdown text.
 * @param {ts.Node} node - An expression.
 * @param {Taint} taint - What is known so far.
 * @returns {boolean} True for a DOC expression.
 */
export function isDocy(node, taint) {
  if (ts.isIdentifier(node)) return held(taint.docs, node, taint);
  if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) return false;
  if (ts.isCallExpression(node)) {
    const name = calleeName(node) ?? "";
    if (READ_CALL_NAMES.has(name)) return argumentsNameDocument(node, taint);
    if (runsCode(name, taint)) return false;
    if (taint.readers.has(`${name}:doc`)) return true;
    if (taint.readers.has(name) && readsDocument(name, node, taint))
      return true;
  }
  return (
    ts.forEachChild(node, child => isDocy(child, taint) || undefined) === true
  );
}

/**
 * Whether a call to reader `name` reads a document: the reader's body and the
 * call's arguments between them supply both a Markdown extension and a
 * document root, as in `readSkill(root, "x")` with the body adding
 * `SKILL.md` and the argument the `plugins/...` root.
 * @param {string} name - The reader.
 * @param {ts.CallExpression} call - The call.
 * @param {Taint} taint - What is known so far.
 * @returns {boolean} True when the call reads a document.
 */
function readsDocument(name, call, taint) {
  return (
    (taint.readers.has(`${name}:md`) ||
      call.arguments.some(argument => hasMarkdown(argument, taint))) &&
    (taint.readers.has(`${name}:root`) ||
      call.arguments.some(argument => hasRoot(argument, taint)))
  );
}

/**
 * Whether a file-read call's arguments name a repository document.
 * @param {ts.CallExpression} call - A `readFileSync` / `readFile` call.
 * @param {Taint} taint - What is known so far.
 * @returns {boolean} True when it reads a document.
 */
function argumentsNameDocument(call, taint) {
  return (
    call.arguments.some(argument => hasMarkdown(argument, taint)) &&
    call.arguments.some(argument => hasRoot(argument, taint))
  );
}

/**
 * Whether calling `name` runs code rather than transforming text.
 * @param {string} name - A callee name.
 * @param {Taint} taint - What is known so far.
 * @returns {boolean} True for a spawn, an imported function or an executor.
 */
function runsCode(name, taint) {
  return (
    RUN_CALL_NAMES.has(name) ||
    taint.codeImports.has(name) ||
    taint.executors.has(name)
  );
}

/**
 * Record what one binding holds; returns whether anything new was learned.
 * @param {ts.Identifier[]} names - The bound identifiers.
 * @param {ts.Node} source - What they are bound to.
 * @param {Taint} taint - Updated in place.
 * @returns {boolean} True when the taint grew.
 */
function bind(names, source, taint) {
  /** @type {Set<unknown>[]} */
  const targets = isDocy(source, taint)
    ? [taint.docs]
    : [
        ...(hasMarkdown(source, taint) ? [taint.md] : []),
        ...(hasRoot(source, taint) ? [taint.roots] : []),
      ];
  let grew = false;
  for (const target of targets) {
    for (const key of names.map(taint.key).filter(key => !target.has(key))) {
      target.add(key);
      grew = true;
    }
  }
  return grew;
}

/**
 * The function value a declaration binds, for reader detection.
 * @param {ts.Node} node - Any node.
 * @returns {{ name: string, body: ts.Node } | undefined} The named function.
 */
function namedFunction(node) {
  if (ts.isFunctionDeclaration(node) && node.name && node.body) {
    return {
      name: node.name.text,
      body: node.body,
      parameters: node.parameters,
    };
  }
  if (
    ts.isVariableDeclaration(node) &&
    ts.isIdentifier(node.name) &&
    node.initializer &&
    (ts.isArrowFunction(node.initializer) ||
      ts.isFunctionExpression(node.initializer))
  ) {
    return {
      name: node.name.text,
      body: node.initializer.body,
      parameters: node.initializer.parameters,
    };
  }
  return undefined;
}

/**
 * Parameters of a local function fed by one call to it, so an assertion
 * helper such as `expectGate(section)` sees what its callers pass.
 * @param {ts.Node} node - Any node.
 * @param {Taint} taint - Supplies the local functions.
 * @returns {{ names: ts.Identifier[], source: ts.Node }[]} One binding per
 *   argument.
 */
function argumentBindings(node, taint) {
  if (!ts.isCallExpression(node) || !ts.isIdentifier(node.expression)) {
    return [];
  }
  const parameters = taint.functions.get(node.expression.text) ?? [];
  return node.arguments.flatMap((argument, index) => {
    const parameter = parameters[index];
    return parameter
      ? [{ names: boundNames(parameter.name), source: argument }]
      : [];
  });
}

/**
 * Callback parameters fed by the call they are passed to: `it.each(X)(t, fn)`
 * and `X.forEach(fn)` / `X.map(fn)` bind fn's parameters to X's elements.
 * @param {ts.Node} node - Any node.
 * @returns {{ names: ts.Identifier[], source: ts.Node } | undefined} The binding.
 */
function callbackBinding(node) {
  if (!(ts.isArrowFunction(node) || ts.isFunctionExpression(node))) {
    return undefined;
  }
  const call = node.parent;
  if (!ts.isCallExpression(call) || !call.arguments.includes(node)) {
    return undefined;
  }
  const source = ts.isPropertyAccessExpression(call.expression)
    ? call.expression.expression
    : call.expression;
  return {
    names: node.parameters.flatMap(parameter => boundNames(parameter.name)),
    source,
  };
}

/**
 * Add `key` to `set` when `condition` holds and it is new.
 * @param {Set<string>} set - The set.
 * @param {string} key - The key.
 * @param {() => boolean} condition - Evaluated only when the key is new.
 * @returns {boolean} True when the set grew.
 */
function learn(set, key, condition) {
  if (set.has(key) || !condition()) return false;
  set.add(key);
  return true;
}

/**
 * The file-read and reader calls inside a function body.
 * @param {ts.Node} body - The body.
 * @param {Taint} taint - Supplies the known readers.
 * @returns {ts.CallExpression[]} The calls.
 */
function readCallsIn(body, taint) {
  /** @type {ts.CallExpression[]} */
  const calls = [];
  walk(body, node => {
    if (!ts.isCallExpression(node)) return;
    const name = calleeName(node) ?? "";
    if (READ_CALL_NAMES.has(name) || taint.readers.has(name)) calls.push(node);
  });
  return calls;
}

/**
 * What one local function is: a reader (reads a file, directly or through
 * another reader), an executor (runs code), and whether calling it yields a
 * document's text (it reads a document path, or returns a slice of a DOC).
 * @param {{ name: string, body: ts.Node }} fn - The function.
 * @param {Taint} taint - Updated in place.
 * @returns {boolean} True when the taint grew.
 */
function learnFunction(fn, taint) {
  taint.exclude = new Set(
    fn.parameters.flatMap(parameter =>
      boundNames(parameter.name).map(taint.key)
    )
  );
  try {
    return summarise(fn, taint);
  } finally {
    taint.exclude = new Set();
  }
}

/**
 * The body of `learnFunction`, run with the function's parameters excluded.
 * @param {{ name: string, body: ts.Node, parameters: readonly ts.ParameterDeclaration[] }} fn - The function.
 * @param {Taint} taint - Updated in place.
 * @returns {boolean} True when the taint grew.
 */
function summarise(fn, taint) {
  const callsAny = (/** @type {(name: string) => boolean} */ test) =>
    some(
      fn.body,
      child => ts.isCallExpression(child) && test(calleeName(child) ?? "")
    );
  const reader = learn(taint.readers, fn.name, () =>
    callsAny(name => READ_CALL_NAMES.has(name) || taint.readers.has(name))
  );
  const executor = learn(taint.executors, fn.name, () =>
    callsAny(name => runsCode(name, taint))
  );
  const reads = () => readCallsIn(fn.body, taint);
  const md = learn(taint.readers, `${fn.name}:md`, () =>
    reads().some(call => call.arguments.some(arg => hasMarkdown(arg, taint)))
  );
  const root = learn(taint.readers, `${fn.name}:root`, () =>
    reads().some(call => call.arguments.some(arg => hasRoot(arg, taint)))
  );
  const doc = learn(
    taint.readers,
    `${fn.name}:doc`,
    () => !taint.executors.has(fn.name) && isDocy(fn.body, taint)
  );
  const pathMd = learn(
    taint.pathFns,
    `${fn.name}:md`,
    () => !taint.readers.has(fn.name) && hasMarkdown(fn.body, taint)
  );
  const pathRoot = learn(
    taint.pathFns,
    `${fn.name}:root`,
    () => !taint.readers.has(fn.name) && hasRoot(fn.body, taint)
  );
  return reader || executor || md || root || doc || pathMd || pathRoot;
}

/**
 * The bindings a loop header introduces, with what they iterate.
 * @param {ts.Node} node - Any node.
 * @returns {{ names: ts.Identifier[], source: ts.Node } | undefined} The binding.
 */
function loopBinding(node) {
  if (!(ts.isForOfStatement(node) || ts.isForInStatement(node))) {
    return undefined;
  }
  if (!ts.isVariableDeclarationList(node.initializer)) return undefined;
  return {
    names: node.initializer.declarations.flatMap(declaration =>
      boundNames(declaration.name)
    ),
    source: node.expression,
  };
}

/**
 * One pass over the file; returns whether the taint grew.
 * @param {ts.SourceFile} sourceFile - The parsed test file.
 * @param {Taint} taint - Updated in place.
 * @returns {boolean} True when anything new was learned.
 */
function pass(sourceFile, taint) {
  let grew = false;
  walk(sourceFile, node => {
    const fn = namedFunction(node);
    if (fn) grew = learnFunction(fn, taint) || grew;
    const binding =
      ts.isVariableDeclaration(node) && node.initializer
        ? { names: boundNames(node.name), source: node.initializer }
        : (loopBinding(node) ?? callbackBinding(node));
    if (binding) grew = bind(binding.names, binding.source, taint) || grew;
    for (const argument of argumentBindings(node, taint)) {
      grew = bind(argument.names, argument.source, taint) || grew;
    }
  });
  return grew;
}

/**
 * Every local named function and its parameters.
 * @param {ts.SourceFile} sourceFile - The parsed test file.
 * @returns {Map<string, readonly ts.ParameterDeclaration[]>} By name.
 */
function localFunctions(sourceFile) {
  /** @type {Map<string, readonly ts.ParameterDeclaration[]>} */
  const functions = new Map();
  walk(sourceFile, node => {
    const fn = namedFunction(node);
    if (fn) functions.set(fn.name, fn.parameters);
  });
  return functions;
}

/**
 * Whether an import is plumbing rather than code under test: a Node built-in,
 * the test runner, a YAML parser, or a helper that lives under `tests/`.
 * @param {string} fileName - Repository-relative importing file.
 * @param {string} specifier - The module specifier.
 * @returns {boolean} True for plumbing.
 */
function isPlumbing(fileName, specifier) {
  if (PLUMBING_MODULE.test(specifier)) return true;
  if (!specifier.startsWith(".")) return false;
  return path.posix
    .normalize(path.posix.join(path.posix.dirname(fileName), specifier))
    .startsWith("tests/");
}

/**
 * Names imported into the file.
 * @param {ts.SourceFile} sourceFile - The parsed test file.
 * @param {boolean} codeOnly - Only names from modules that are not plumbing.
 * @returns {Set<string>} Imported local names.
 */
function importedNames(sourceFile, codeOnly) {
  /** @type {Set<string>} */
  const names = new Set();
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const specifier = ts.isStringLiteral(statement.moduleSpecifier)
      ? statement.moduleSpecifier.text
      : "";
    if (codeOnly && isPlumbing(sourceFile.fileName, specifier)) continue;
    const clause = statement.importClause;
    if (clause?.name) names.add(clause.name.text);
    const bindings = clause?.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) {
      for (const element of bindings.elements) names.add(element.name.text);
    }
  }
  return names;
}

/**
 * A type checker over this one file alone (no lib, no imports resolved), used
 * only to map identifiers to the declarations they refer to.
 * @param {ts.SourceFile} sourceFile - The parsed test file.
 * @returns {ts.TypeChecker} The checker.
 */
function bindingChecker(sourceFile) {
  const options = { noLib: true, noResolve: true, allowJs: true };
  const host = ts.createCompilerHost(options);
  host.getSourceFile = name =>
    name === sourceFile.fileName ? sourceFile : undefined;
  return ts
    .createProgram({ rootNames: [sourceFile.fileName], options, host })
    .getTypeChecker();
}

/**
 * Analyse a file once; the result answers `subjectSource` for any subject.
 * @param {ts.SourceFile} sourceFile - The parsed test file.
 * @returns {Taint} What holds Markdown paths and text.
 */
export function analyseDocTaint(sourceFile) {
  const checker = bindingChecker(sourceFile);
  /** @type {Taint} */
  const taint = {
    key: identifier =>
      checker.getSymbolAtLocation(identifier) ?? identifier.text,
    md: new Set(),
    roots: new Set(),
    docs: new Set(),
    readers: new Set(),
    imported: importedNames(sourceFile, false),
    codeImports: importedNames(sourceFile, true),
    executors: new Set(),
    pathFns: new Set(),
    exclude: new Set(),
    functions: localFunctions(sourceFile),
  };
  for (let index = 0; index < MAX_PASSES && pass(sourceFile, taint); index++);
  return taint;
}

/**
 * Where an assertion subject's text comes from.
 * @param {ts.Expression | undefined} subject - The `expect(...)` argument.
 * @param {Taint} taint - The file's analysis.
 * @returns {"markdown" | "other" | "unknown"} The subject's source.
 */
export function subjectSource(subject, taint) {
  if (subject === undefined) return "other";
  if (isDocy(subject, taint)) return "markdown";
  const viaImport = some(
    subject,
    node =>
      ts.isCallExpression(node) && taint.imported.has(calleeName(node) ?? "")
  );
  return viaImport ? "unknown" : "other";
}
