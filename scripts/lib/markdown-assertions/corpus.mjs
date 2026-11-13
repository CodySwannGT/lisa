/**
 * The shipped-code corpus a machine token must appear in
 * (CodySwannGT/lisa#4867).
 *
 * A pinned Markdown phrase is a MACHINE-TOKEN only when code that Lisa ships
 * or runs reads it. "Code" here is every tracked script, source module, hook,
 * workflow and config file, minus tests, generated plugin copies (they mirror
 * `plugins/src`), and prose trees. For JavaScript and TypeScript only string,
 * template and regular-expression literals count — a phrase quoted in a
 * comment is not read by anything. For shell, Python and YAML, `#` comment
 * lines are dropped.
 * @module scripts/lib/markdown-assertions/corpus
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

import ts from "typescript";

/** Extensions parsed as JavaScript or TypeScript. */
const SCRIPT_EXTENSIONS = new Set([
  ".ts",
  ".mts",
  ".cts",
  ".js",
  ".mjs",
  ".cjs",
]);

/** Extensions read as text with `#` comments removed. */
const HASH_COMMENT_EXTENSIONS = new Set([
  ".sh",
  ".bash",
  ".py",
  ".yml",
  ".yaml",
]);

/** Extensions read as plain text. */
const PLAIN_EXTENSIONS = new Set([".json", ".jsonc"]);

/** Tracked paths that are not code a shipped parser lives in. */
const EXCLUDED = Object.freeze([
  /^tests\//u,
  /(^|\/)__tests__\//u,
  /\.test\.[cm]?[jt]s$/u,
  /\.spec\.[cm]?[jt]s$/u,
  /^plugins\/lisa[^/]*\//u,
  /^\.claude-pr\//u,
  /^(wiki|docs|evidence|research|transcripts|dist|\.lisa)\//u,
  /^scripts\/lib\/(phrase-tests|markdown-assertions)\//u,
  /^scripts\/(classify-phrase-tests|generate-phrase-manifest|check-phrase-manifest-parity|classify-markdown-assertions)\.mjs$/u,
  /(^|\/)(package-lock|bun\.lock|CHANGELOG)/u,
  /(^|\/)node_modules\//u,
]);

/**
 * Whether a tracked path belongs in the code corpus.
 * @param {string} file - Repository-relative path.
 * @returns {boolean} True for shipped code.
 */
export function isCodePath(file) {
  const extension = path.posix.extname(file);
  const known =
    SCRIPT_EXTENSIONS.has(extension) ||
    HASH_COMMENT_EXTENSIONS.has(extension) ||
    PLAIN_EXTENSIONS.has(extension);
  return known && !EXCLUDED.some(pattern => pattern.test(file));
}

/**
 * The literal text of a JavaScript or TypeScript file: its string, template
 * and regular-expression literals, one per line. Regular expressions are
 * unescaped so `\[lisa-human-gate\]` reads as `[lisa-human-gate]`.
 * @param {string} file - File name, for the parser.
 * @param {string} text - Source text.
 * @returns {string} Literal text.
 */
export function scriptLiterals(file, text) {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, false);
  /** @type {string[]} */
  const literals = [];
  /** @param {ts.Node} node */
  const visit = node => {
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    ) {
      literals.push(node.text);
    } else if (ts.isRegularExpressionLiteral(node)) {
      const body = node.text.slice(1, node.text.lastIndexOf("/"));
      literals.push(body.replaceAll(/\\([^\w])/gu, "$1"));
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return literals.join("\n");
}

/**
 * The names a JavaScript or TypeScript file declares: functions, classes,
 * variables, parameters' object keys, properties and interface members.
 * A document that tells an agent to call `parseLearningsFile` or set
 * `mergeDriver` names one of these.
 * @param {string} file - File name, for the parser.
 * @param {string} text - Source text.
 * @returns {Set<string>} Declared names.
 */
export function declaredNames(file, text) {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, false);
  /** @type {Set<string>} */
  const names = new Set();
  /** @param {ts.Node} node */
  const visit = node => {
    const named =
      ts.isFunctionDeclaration(node) ||
      ts.isClassDeclaration(node) ||
      ts.isVariableDeclaration(node) ||
      ts.isMethodDeclaration(node) ||
      ts.isPropertyDeclaration(node) ||
      ts.isPropertySignature(node) ||
      ts.isPropertyAssignment(node) ||
      ts.isShorthandPropertyAssignment(node) ||
      ts.isInterfaceDeclaration(node) ||
      ts.isTypeAliasDeclaration(node) ||
      ts.isExportSpecifier(node);
    const name = named
      ? /** @type {{ name?: ts.Node }} */ (node).name
      : undefined;
    if (name && (ts.isIdentifier(name) || ts.isStringLiteral(name))) {
      names.add(name.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return names;
}

/**
 * The text of one code file that a token search should see.
 * @param {string} file - Repository-relative path.
 * @param {string} text - File contents.
 * @returns {string} Searchable text.
 */
export function searchableText(file, text) {
  const extension = path.posix.extname(file);
  if (SCRIPT_EXTENSIONS.has(extension)) return scriptLiterals(file, text);
  if (HASH_COMMENT_EXTENSIONS.has(extension)) {
    return text
      .split("\n")
      .filter(line => !/^\s*#/u.test(line))
      .join("\n");
  }
  return text;
}

/**
 * @typedef {object} Corpus
 * @property {(needle: string) => string | undefined} find - The first code
 *   file whose searchable text contains `needle`, or undefined.
 * @property {(needle: string) => number} count - How many code files contain it.
 * @property {(name: string) => string | undefined} declares - The first code
 *   file that declares `name` (see declaredNames), or undefined.
 * @property {number} files - Files in the corpus.
 */

/**
 * Build the code corpus for a repository checkout.
 * @param {string} root - Repository root.
 * @returns {Corpus} The corpus.
 */
export function buildCorpus(root) {
  const tracked = execFileSync("git", ["ls-files", "-z"], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  })
    .split("\0")
    .filter(Boolean)
    .filter(isCodePath)
    .sort();
  /** @type {Map<string, string>} */
  const declarations = new Map();
  const entries = tracked.flatMap(file => {
    try {
      const text = readFileSync(path.join(root, file), "utf8");
      if (SCRIPT_EXTENSIONS.has(path.posix.extname(file))) {
        for (const name of declaredNames(file, text)) {
          if (!declarations.has(name)) declarations.set(name, file);
        }
      }
      return [{ file, text: searchableText(file, text) }];
    } catch {
      return [];
    }
  });
  /** @type {Map<string, string[]>} */
  const hits = new Map();
  /**
   * @param {string} needle - Text to find.
   * @returns {string[]} Files containing it.
   */
  const filesWith = needle => {
    const cached = hits.get(needle);
    if (cached) return cached;
    const found = entries
      .filter(entry => entry.text.includes(needle))
      .map(entry => entry.file);
    hits.set(needle, found);
    return found;
  };
  return {
    find: needle => filesWith(needle)[0],
    count: needle => filesWith(needle).length,
    declares: name => declarations.get(name),
    files: entries.length,
  };
}
