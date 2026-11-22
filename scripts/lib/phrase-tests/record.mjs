/**
 * Translate a phrase-only test file into manifest entries by running it
 * (CodySwannGT/lisa#4609).
 *
 * Phrase tests compute what they read and what they assert at runtime —
 * `describe.each` tables, path joins, helper calls — so the values cannot be
 * read off the source. Instead the file is transpiled with the TypeScript
 * compiler API and executed under a stub runner (see `runner.mjs`) in which
 * every file read is recorded and `expect` records instead of asserting.
 *
 * One runtime phrase assertion translates to `{ file, polarity, kind, value }`
 * only when its subject is EXACTLY (===) the full text of a file the test
 * read. A subject that is a section, a slice or a normalised copy of a file
 * has no faithful manifest form, so one such assertion makes the WHOLE test
 * file untranslatable: it is kept unchanged and listed with the reason.
 *
 * Two different files can hold identical text (generated plugin copies are
 * byte-for-byte copies of their source). When a subject matches more than one
 * file read, the file is run a second time with every file's text made unique
 * by an appended marker; the second run attributes each assertion exactly, and
 * is accepted only when it makes the same assertions in the same order.
 * @module scripts/lib/phrase-tests/record
 */
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { callbackify } from "node:util";
import vm from "node:vm";

import ts from "typescript";

import { isExpectCall, isIncludesCall } from "./ast.mjs";
import { resolveTestImport } from "./classify.mjs";
import { SOURCE_SEPARATOR } from "./manifest.mjs";
import { createRunner } from "./runner.mjs";

/** Tag on the value `__phraseIncludes` hands to `expect`. */
const INCLUDES_TAG = Symbol("phrase-includes");

/** Parameters every transpiled module body is compiled with. */
const MODULE_PARAMETERS = Object.freeze([
  "require",
  "module",
  "exports",
  "__filename",
  "__dirname",
  "__phraseImportMeta",
  "__phraseIncludes",
]);

/**
 * @typedef {object} Entry
 * @property {string} file - Repository-relative path of the file read.
 * @property {"required" | "forbidden"} polarity - Must the phrase be present?
 * @property {"string" | "pattern"} kind - Substring or regular expression.
 * @property {string | { source: string, flags: string }} value - The phrase.
 * @property {string} source - Where it came from: `<test file> › <test title path>`.
 */

/**
 * @typedef {object} Recording
 * @property {string} file - The test file.
 * @property {number} raw - Runtime phrase assertions executed.
 * @property {Entry[]} entries - Translated assertions, in execution order.
 * @property {string[]} reasons - Why the file is untranslatable; empty when
 *   every assertion translated and the file ran cleanly.
 */

/**
 * Source transformer: `import.meta` becomes an injected identifier (a
 * CommonJS body cannot contain it), and `expect(x.includes(y))` becomes
 * `expect(__phraseIncludes(x, y))` so the recorder still sees the subject.
 * @param {ts.TransformationContext} context - Compiler context.
 * @returns {(sourceFile: ts.SourceFile) => ts.SourceFile} The transform.
 */
function phraseTransformer(context) {
  const { factory } = context;
  /** @type {(node: ts.Node) => ts.Node} */
  const visit = node => {
    if (
      ts.isMetaProperty(node) &&
      node.keywordToken === ts.SyntaxKind.ImportKeyword
    ) {
      return factory.createIdentifier("__phraseImportMeta");
    }
    if (isExpectCall(node) && isIncludesCall(node.arguments[0])) {
      const call = /** @type {ts.CallExpression} */ (node);
      const includes = /** @type {ts.CallExpression} */ (call.arguments[0]);
      const owner = /** @type {ts.PropertyAccessExpression} */ (
        includes.expression
      );
      const tagged = factory.createCallExpression(
        factory.createIdentifier("__phraseIncludes"),
        undefined,
        [
          /** @type {ts.Expression} */ (ts.visitNode(owner.expression, visit)),
          /** @type {ts.Expression} */ (
            ts.visitNode(includes.arguments[0], visit)
          ),
        ]
      );
      return factory.updateCallExpression(
        call,
        call.expression,
        call.typeArguments,
        [
          tagged,
          ...call.arguments
            .slice(1)
            .map(
              arg => /** @type {ts.Expression} */ (ts.visitNode(arg, visit))
            ),
        ]
      );
    }
    return ts.visitEachChild(node, visit, context);
  };
  return sourceFile =>
    /** @type {ts.SourceFile} */ (ts.visitNode(sourceFile, visit));
}

/**
 * Transpile TypeScript to a CommonJS module body.
 * @param {string} fileName - For diagnostics.
 * @param {string} text - TypeScript source.
 * @returns {string} JavaScript.
 */
function transpile(fileName, text) {
  return ts.transpileModule(text, {
    fileName,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
    transformers: { before: [phraseTransformer] },
  }).outputText;
}

/**
 * @typedef {{ text: string, polarity: "required" | "forbidden", kind: "string" | "pattern", value: string | RegExp }} Shaped
 * @typedef {{ reason: string }} Unshaped
 * @typedef {(Shaped | Unshaped) & { test: string | undefined, holds: boolean }} Recorded
 */

/**
 * One run's mutable state.
 * @typedef {object} RunState
 * @property {string} root - Absolute repository root.
 * @property {boolean} perturb - Whether reads are served with unique markers.
 * @property {{ file: string, served: string }[]} reads - Every read, in order.
 * @property {Map<string, number>} markers - Path to its marker index.
 * @property {Recorded[]} assertions - Recorded assertions.
 * @property {string | undefined} test - Title of the running test.
 */

/**
 * Serve one file read: record it and, when perturbing, make its text unique.
 * @param {RunState} state - The run.
 * @param {unknown} target - The path argument the test passed.
 * @param {string | Buffer} data - What the real read returned.
 * @returns {string | Buffer} What the test receives.
 */
function serve(state, target, data) {
  const absolute = path.resolve(
    state.root,
    target instanceof URL ? fileURLToPath(target) : String(target)
  );
  const file = path.relative(state.root, absolute).split(path.sep).join("/");
  if (typeof data !== "string") {
    state.reads.push({ file, served: data.toString("utf8") });
    return data;
  }
  if (!state.markers.has(file)) state.markers.set(file, state.markers.size);
  const served = state.perturb
    ? `${data}\n\u0000phrase-recorder:${state.markers.get(file)}`
    : data;
  state.reads.push({ file, served });
  return served;
}

/**
 * Resolve a read target against the repository root rather than the cwd.
 * @param {RunState} state - The run.
 * @param {unknown} target - Path argument.
 * @returns {unknown} The resolved path (non-strings pass through).
 */
function resolveTarget(state, target) {
  return typeof target === "string" ? path.resolve(state.root, target) : target;
}

/**
 * File-system modules whose read calls are recorded.
 * @param {RunState} state - The run.
 * @returns {Record<string, object>} Module id to stub.
 */
function fileSystemModules(state) {
  /** @type {(target: unknown, options?: unknown) => string | Buffer} */
  const readFileSync = (target, options) =>
    serve(
      state,
      target,
      fs.readFileSync(
        /** @type {fs.PathOrFileDescriptor} */ (resolveTarget(state, target)),
        /** @type {BufferEncoding} */ (options)
      )
    );
  /** @type {(target: unknown, options: unknown) => Promise<string | Buffer>} */
  const readFilePromise = async (target, options) =>
    serve(
      state,
      target,
      await fsPromises.readFile(
        /** @type {fs.PathLike} */ (resolveTarget(state, target)),
        /** @type {BufferEncoding} */ (options)
      )
    );
  const readFileCallback = callbackify(readFilePromise);
  /** @type {(target: unknown, ...rest: unknown[]) => unknown} */
  const readFile = (target, ...rest) => {
    const callback = rest.at(-1);
    if (typeof callback !== "function") return readFilePromise(target, rest[0]);
    const options = rest.length > 1 ? rest[0] : undefined;
    return readFileCallback(
      target,
      options,
      /** @type {(error: NodeJS.ErrnoException | null, data: string | Buffer) => void} */ (
        callback
      )
    );
  };
  // Only the read members exist: a phrase-only file never needs more, and a
  // write reached through some path the classifier missed must fail loudly
  // rather than touch the repository.
  const promises = { readFile: readFilePromise };
  const nodeFs = { readFileSync, readFile, promises };
  return {
    "node:fs": nodeFs,
    fs: nodeFs,
    "node:fs/promises": promises,
    "fs/promises": promises,
    "fs-extra": nodeFs,
  };
}

/**
 * The value handed to `expect` for `expect(x.includes(y))`.
 * @param {unknown} subject - `x`.
 * @param {unknown} needle - `y`.
 * @returns {object} A tagged record of both.
 */
function phraseIncludes(subject, needle) {
  return { [INCLUDES_TAG]: true, subject, needle };
}

/**
 * Normalise one matcher call into (text, polarity, kind, value), or a reason.
 * @param {string} matcher - Matcher name.
 * @param {unknown} subject - `expect` argument.
 * @param {unknown} expected - Matcher argument.
 * @param {boolean} negated - Whether `.not` was used.
 * @returns {{ text: string, polarity: "required" | "forbidden", kind: "string" | "pattern", value: string | RegExp } | { reason: string }} The shape.
 */
function shape(matcher, subject, expected, negated) {
  const tagged =
    subject !== null && typeof subject === "object" && INCLUDES_TAG in subject;
  if (matcher === "toBe") {
    if (!tagged || typeof expected !== "boolean")
      return { reason: "toBe on something other than <text>.includes(...)" };
    const { subject: text, needle } =
      /** @type {{ subject: unknown, needle: unknown }} */ (
        /** @type {unknown} */ (subject)
      );
    if (typeof text !== "string" || typeof needle !== "string")
      return { reason: "includes(...) on a non-string" };
    const present = expected !== negated;
    return {
      text,
      polarity: present ? "required" : "forbidden",
      kind: "string",
      value: needle,
    };
  }
  if (tagged) return { reason: `${matcher} on <text>.includes(...)` };
  if (typeof subject !== "string")
    return { reason: `${matcher} on a non-string subject` };
  const polarity = negated ? "forbidden" : "required";
  if (typeof expected === "string")
    return { text: subject, polarity, kind: "string", value: expected };
  if (matcher === "toMatch" && expected instanceof RegExp)
    return { text: subject, polarity, kind: "pattern", value: expected };
  return { reason: `${matcher} with a non-string, non-RegExp argument` };
}

/**
 * Whether the phrase is present, with vitest's semantics (`toMatch` with a
 * string is a substring test; with a RegExp it is `String#match`).
 * @param {string} text - Subject text.
 * @param {"string" | "pattern"} kind - Phrase kind.
 * @param {string | RegExp} value - Phrase.
 * @returns {boolean} True when present.
 */
function present(text, kind, value) {
  return kind === "string"
    ? text.includes(/** @type {string} */ (value))
    : text.match(/** @type {RegExp} */ (value)) !== null;
}

/**
 * A recording `expect`: each matcher records, then throws like vitest when
 * the assertion does not hold, so control flow matches a real run.
 * @param {RunState} state - The run.
 * @returns {(subject: unknown) => object} The `expect` function.
 */
function recordingExpect(state) {
  /**
   * The matchers for one subject.
   * @param {unknown} subject - The `expect` argument.
   * @param {boolean} negated - Whether these are the `.not` matchers.
   * @returns {Record<string, (expected: unknown) => void>} Matchers.
   */
  const matchers = (subject, negated) => {
    /** @type {(matcher: string) => (expected: unknown) => void} */
    const call = matcher => expected => {
      const result = shape(matcher, subject, expected, negated);
      const holds =
        "reason" in result
          ? true
          : present(result.text, result.kind, result.value) ===
            (result.polarity === "required");
      state.assertions.push({ ...result, test: state.test, holds });
      if (!holds) {
        throw new Error(
          `phrase assertion fails on the current tree: ${"value" in result ? String(result.value) : ""}`
        );
      }
    };
    return {
      toContain: call("toContain"),
      toMatch: call("toMatch"),
      toBe: call("toBe"),
    };
  };
  return subject => ({
    ...matchers(subject, false),
    not: matchers(subject, true),
  });
}

/**
 * Load one module of the test's graph: a package stub, or a transpiled
 * test/helper file executed with this run's `require`.
 * @param {string} file - Repository-relative path.
 * @param {object} context - Run context.
 * @param {RunState} context.state - The run.
 * @param {(file: string) => string | undefined} context.readSource - Reads sources.
 * @param {Record<string, object>} context.packages - Package id to stub.
 * @param {Map<string, object>} context.cache - Loaded modules.
 * @returns {object} The module's exports.
 */
function loadModule(file, context) {
  const cached = context.cache.get(file);
  if (cached) return cached;
  const text = context.readSource(file);
  if (text === undefined) throw new Error(`cannot read ${file}`);
  const absolute = path.join(context.state.root, file);
  const module = { exports: {} };
  context.cache.set(file, module.exports);
  /** @type {(specifier: string) => object} */
  const require = specifier => {
    if (!specifier.startsWith(".")) {
      const stub = context.packages[specifier];
      if (stub === undefined) throw new Error(`unexpected import ${specifier}`);
      return stub;
    }
    const helper = resolveTestImport(
      file,
      specifier,
      candidate => context.readSource(candidate) !== undefined
    );
    if (helper === undefined) throw new Error(`unexpected import ${specifier}`);
    return loadModule(helper, context);
  };
  // The module runs in an inner arrow so a file that declares its own
  // `const __dirname` shadows the injected one instead of colliding with it
  // (vitest provides both names, like CommonJS).
  const body = vm.compileFunction(
    ["return (() => {", transpile(file, text), "})();"].join("\n"),
    [...MODULE_PARAMETERS],
    { filename: absolute }
  );
  body(
    require,
    module,
    module.exports,
    absolute,
    path.dirname(absolute),
    {
      url: pathToFileURL(absolute).href,
      filename: absolute,
      dirname: path.dirname(absolute),
    },
    phraseIncludes
  );
  context.cache.set(file, module.exports);
  return module.exports;
}

/**
 * Execute a test file once under the recording runner.
 * @param {string} testFile - Repository-relative test path.
 * @param {{ root: string, readSource: (file: string) => string | undefined }} options - Where and how to read.
 * @param {boolean} perturb - Serve every file's text with a unique marker.
 * @returns {Promise<{ state: RunState, errors: string[] }>} The run.
 */
async function runOnce(testFile, { root, readSource }, perturb) {
  /** @type {RunState} */
  const state = {
    root,
    perturb,
    reads: [],
    markers: new Map(),
    assertions: [],
    test: undefined,
  };
  const runner = createRunner({ onTest: name => (state.test = name) });
  const vitest = { ...runner.api, expect: recordingExpect(state) };
  const packages = {
    ...fileSystemModules(state),
    vitest,
    "node:path": path,
    path,
    "node:url": { fileURLToPath, pathToFileURL, URL },
    url: { fileURLToPath, pathToFileURL, URL },
  };
  try {
    loadModule(testFile, { state, readSource, packages, cache: new Map() });
  } catch (error) {
    return { state, errors: [`loading: ${errorText(error)}`] };
  }
  return { state, errors: await runner.run() };
}

/**
 * An error's message.
 * @param {unknown} error - Anything thrown.
 * @returns {string} Its message.
 */
function errorText(error) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The files whose served text is exactly `text`.
 * @param {RunState} state - The run.
 * @param {string} text - An assertion subject.
 * @returns {string[]} Distinct repository-relative paths.
 */
function filesServing(state, text) {
  return [
    ...new Set(
      state.reads.filter(read => read.served === text).map(read => read.file)
    ),
  ];
}

/**
 * The comparable identity of an assertion, ignoring which file it hit.
 * @param {Recorded | undefined} assertion - A recorded assertion.
 * @returns {string} A key.
 */
function signature(assertion) {
  if (assertion === undefined) return "";
  if ("reason" in assertion)
    return JSON.stringify([assertion.test, assertion.reason]);
  return JSON.stringify([
    assertion.test,
    assertion.polarity,
    assertion.kind,
    String(assertion.value),
  ]);
}

/**
 * Convert a phrase value to its manifest form.
 * @param {string | RegExp} value - String or RegExp.
 * @returns {string | { source: string, flags: string }} JSON-safe value.
 */
function manifestValue(value) {
  return value instanceof RegExp
    ? { source: value.source, flags: value.flags }
    : value;
}

/**
 * Record one phrase-only test file.
 * @param {string} testFile - Repository-relative path of the test.
 * @param {{ root: string, readSource: (file: string) => string | undefined }} options -
 *   `root` is the repository whose text files the test reads; `readSource`
 *   returns the source of the test file and its helpers (the working tree, or
 *   a base commit via `git show` for the parity check).
 * @returns {Promise<Recording>} The translation, or why there is none.
 */
export async function recordTestFile(testFile, options) {
  const first = await runOnce(testFile, options, false);
  const reasons = [...first.errors];
  const attributions = first.state.assertions.map(assertion =>
    "reason" in assertion ? [] : filesServing(first.state, assertion.text)
  );
  if (attributions.some(files => files.length > 1)) {
    const second = await runOnce(testFile, options, true);
    const same =
      second.state.assertions.length === first.state.assertions.length &&
      second.state.assertions.every(
        (assertion, index) =>
          signature(assertion) === signature(first.state.assertions[index])
      );
    if (same) {
      second.state.assertions.forEach((assertion, index) => {
        if (!("reason" in assertion))
          attributions[index] = filesServing(second.state, assertion.text);
      });
    } else {
      reasons.push(
        "identical text read from several files, and a run with the files made distinct behaved differently"
      );
    }
  }
  /** @type {Entry[]} */
  const entries = [];
  first.state.assertions.forEach((assertion, index) => {
    const where = assertion.test ?? "(outside any test)";
    if ("reason" in assertion) {
      reasons.push(`${where}: ${assertion.reason}`);
      return;
    }
    const files = attributions[index] ?? [];
    const [file] = files;
    if (file === undefined) {
      reasons.push(`${where}: subject is not the full text of a file it read`);
      return;
    }
    if (files.length > 1 || file.startsWith("..")) {
      reasons.push(
        `${where}: cannot attribute the subject to one repository file`
      );
      return;
    }
    if (!assertion.holds)
      reasons.push(`${where}: assertion fails on the current tree`);
    entries.push({
      file,
      polarity: assertion.polarity,
      kind: assertion.kind,
      value: manifestValue(assertion.value),
      source: `${testFile}${SOURCE_SEPARATOR}${where}`,
    });
  });
  if (first.state.assertions.length === 0)
    reasons.push("no runtime phrase assertions");
  return {
    file: testFile,
    raw: first.state.assertions.length,
    entries,
    reasons: [...new Set(reasons)],
  };
}
