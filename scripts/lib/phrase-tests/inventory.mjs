/**
 * Classify every Markdown phrase assertion (CodySwannGT/lisa#4867): each
 * required-phrases manifest entry, and each `toContain` / `toMatch` site in a
 * unit test that reads a Markdown document. The class of each phrase comes
 * from `marker-classes.mjs`; this module only finds the phrases.
 * @module scripts/lib/phrase-tests/inventory
 */
import ts from "typescript";

import {
  booleanLiteral,
  expectChains,
  isPhraseChain,
  parseSource,
  walk,
} from "./ast.mjs";
import {
  MANIFEST_COMMENT,
  manifestEntries,
  SOURCE_GUARDS_COMMENT,
} from "./manifest.mjs";
import {
  analyseDocTaint,
  mentionsDocumentPath,
  subjectSource,
} from "./doc-taint.mjs";
import { classifyPhrase } from "./marker-classes.mjs";

/**
 * @typedef {{ cls: string, rule: string, parser: readonly string[] }} PhraseVerdict
 * @typedef {object} AssertionVerdict
 * @property {string} file - The test file.
 * @property {number} line - 1-based line of the assertion.
 * @property {string} matcher - `toContain`, `not.toMatch`, `includes` ...
 * @property {string} subject - Source text of the `expect(...)` argument.
 * @property {"markdown" | "other" | "unknown"} source - Where that text comes from.
 * @property {"string" | "pattern" | "expression"} kind - What the phrase is.
 * @property {string | { source: string, flags: string }} value - The phrase,
 *   or the argument's source text when it is not a literal.
 * @property {string} cls - Its class.
 * @property {string} rule - The rule that decided the class.
 * @property {readonly string[]} parser - The parser behind a MACHINE-TOKEN.
 */

/** Phrases pinned in a file that is not a Markdown document. */
const NOT_MARKDOWN = "NOT-MARKDOWN";

/** Classes a report counts, in display order. */
export const REPORT_CLASSES = Object.freeze([
  "MACHINE-TOKEN",
  "STRUCTURAL",
  "WORDING",
  "UNRESOLVED",
  NOT_MARKDOWN,
]);

/** A Markdown document: the only kind of file whose wording this culls. */
const MARKDOWN_FILE = /\.mdc?$/u;

/**
 * Count verdicts by class, every class present even when zero.
 * @param {readonly { cls: string }[]} verdicts - Classified phrases.
 * @returns {Record<string, number>} Counts keyed by class.
 */
export function countByClass(verdicts) {
  /** @type {Record<string, number>} */
  const counts = Object.fromEntries(REPORT_CLASSES.map(cls => [cls, 0]));
  for (const { cls } of verdicts) counts[cls] = (counts[cls] ?? 0) + 1;
  return counts;
}

/**
 * Count assertion sites by where their subject text comes from.
 * @param {readonly { source: string }[]} sites - Classified sites.
 * @returns {Record<string, number>} Counts for markdown, other and unknown.
 */
export function countBySource(sites) {
  /** @type {Record<string, number>} */
  const counts = { markdown: 0, other: 0, unknown: 0 };
  for (const { source } of sites) counts[source] = (counts[source] ?? 0) + 1;
  return counts;
}

/**
 * Classify one manifest check. A check on a file that is not a Markdown
 * document — a workflow, a hook, a script — is NOT-MARKDOWN: it pins source
 * text, not guidance prose, and is outside what CodySwannGT/lisa#4867 culls.
 * @param {import("./manifest.mjs").PhraseCheck} check - The check.
 * @returns {{ cls: string, rule: string, parser: readonly string[] }} Its class.
 */
export function classifyCheck(check) {
  if (!MARKDOWN_FILE.test(check.file)) {
    return { cls: NOT_MARKDOWN, rule: "not-a-markdown-document", parser: [] };
  }
  return check.kind === "string"
    ? classifyPhrase(/** @type {string} */ (check.value))
    : classifyPhrase(
        /** @type {import("./manifest.mjs").Pattern} */ (check.value).source,
        { isPattern: true }
      );
}

/**
 * Classify every entry of the required-phrases manifest.
 * @param {import("./manifest.mjs").Manifest} manifest - The manifest.
 * @returns {{ files: number, entries: number, counts: Record<string, number>, verdicts: (import("./manifest.mjs").PhraseCheck & PhraseVerdict)[] }} The report.
 */
export function classifyManifest(manifest) {
  const verdicts = manifestEntries(manifest).map(check => ({
    ...check,
    ...classifyCheck(check),
  }));
  return {
    files: Object.keys(manifest.files).length,
    entries: verdicts.length,
    counts: countByClass(verdicts),
    verdicts,
  };
}

/** Classes that may stay in the required-phrases manifest. */
export const LOAD_BEARING = Object.freeze(["MACHINE-TOKEN", "STRUCTURAL"]);

/**
 * The entries of a manifest whose class passes `keep`, dropping every file
 * left with none.
 * @param {import("./manifest.mjs").Manifest} manifest - The manifest.
 * @param {(cls: string) => boolean} keep - Which classes to keep.
 * @param {readonly string[]} comment - The `$comment` of the result.
 * @returns {import("./manifest.mjs").Manifest} The selected manifest.
 */
export function selectEntries(manifest, keep, comment) {
  const kept =
    (
      /** @type {string} */ file,
      /** @type {"required" | "forbidden"} */ polarity,
      /** @type {"string" | "pattern"} */ kind
    ) =>
    (/** @type {any} */ value) =>
      keep(classifyCheck({ file, polarity, kind, value }).cls);
  const files = Object.entries(manifest.files).flatMap(([file, entry]) => {
    const selected = {
      required: entry.required.filter(kept(file, "required", "string")),
      forbidden: entry.forbidden.filter(kept(file, "forbidden", "string")),
      requiredPatterns: entry.requiredPatterns.filter(
        kept(file, "required", "pattern")
      ),
      forbiddenPatterns: entry.forbiddenPatterns.filter(
        kept(file, "forbidden", "pattern")
      ),
      source: entry.source,
    };
    const empty =
      selected.required.length +
        selected.forbidden.length +
        selected.requiredPatterns.length +
        selected.forbiddenPatterns.length ===
      0;
    return empty ? [] : [[file, selected]];
  });
  return { $comment: comment, files: Object.fromEntries(files) };
}

/**
 * Split a manifest: its MACHINE-TOKEN and STRUCTURAL entries stay as the
 * required-phrases manifest, its NOT-MARKDOWN entries move to the
 * source-text guards, and its WORDING entries are dropped.
 *
 * The guards already on disk are merged, never replaced: after the first
 * run the manifest holds no NOT-MARKDOWN entries, so a second run would
 * otherwise write an empty guards file. Running it again is a no-op.
 * @param {import("./manifest.mjs").Manifest} manifest - The manifest.
 * @param {import("./manifest.mjs").Manifest} [existingGuards] - The
 *   source-text guards file as it stands, if there is one.
 * @returns {{ manifest: import("./manifest.mjs").Manifest, sourceGuards: import("./manifest.mjs").Manifest }} The two files.
 */
export function pruneManifest(manifest, existingGuards) {
  const found = selectEntries(
    manifest,
    cls => cls === NOT_MARKDOWN,
    SOURCE_GUARDS_COMMENT
  );
  return {
    manifest: selectEntries(
      manifest,
      cls => LOAD_BEARING.includes(cls),
      MANIFEST_COMMENT
    ),
    sourceGuards: existingGuards
      ? mergeManifests(existingGuards, found, SOURCE_GUARDS_COMMENT)
      : found,
  };
}

/** The arrays of a manifest file entry. */
const ENTRY_KEYS = /** @type {const} */ ([
  "required",
  "forbidden",
  "requiredPatterns",
  "forbiddenPatterns",
  "source",
]);

/**
 * Append the values of `more` that `base` lacks, keeping `base` in order.
 * @param {readonly unknown[]} base - Existing values.
 * @param {readonly unknown[]} more - Values to add.
 * @returns {unknown[]} The union.
 */
function union(base, more) {
  const seen = new Set(base.map(value => JSON.stringify(value)));
  return [...base, ...more.filter(value => !seen.has(JSON.stringify(value)))];
}

/**
 * Merge two manifests. Every value in `base` stays where it is and new
 * values are appended, so merging nothing new returns `base` unchanged.
 * @param {import("./manifest.mjs").Manifest} base - The manifest kept.
 * @param {import("./manifest.mjs").Manifest} more - Entries to add.
 * @param {readonly string[]} comment - The `$comment` of the result.
 * @returns {import("./manifest.mjs").Manifest} The merged manifest.
 */
export function mergeManifests(base, more, comment) {
  const files = { ...base.files };
  for (const [file, entry] of Object.entries(more.files)) {
    const current = files[file];
    files[file] = current
      ? /** @type {import("./manifest.mjs").FileEntry} */ (
          Object.fromEntries(
            ENTRY_KEYS.map(key => [key, union(current[key], entry[key])])
          )
        )
      : entry;
  }
  const sorted = Object.keys(files)
    .sort()
    .map(file => [file, files[file]]);
  return { $comment: comment, files: Object.fromEntries(sorted) };
}

/** Calls that read a file's text. */
const READ_CALLS = /\b(?:readFileSync|readFile)\b/u;

/**
 * Whether a test file reads a Markdown document: it spells a `.md` / `.mdc`
 * extension and a document root in its literals and calls a file read.
 * @param {ts.SourceFile} sourceFile - The parsed test file.
 * @returns {boolean} True when the file reads Markdown.
 */
export function readsMarkdown(sourceFile) {
  return READ_CALLS.test(sourceFile.text) && mentionsDocumentPath(sourceFile);
}

/**
 * `const NAME = <string or regex literal>` bindings in a file, so an
 * assertion that names a constant still resolves to its phrase.
 * @param {ts.SourceFile} sourceFile - The parsed test file.
 * @returns {Map<string, ts.Expression>} Initialisers keyed by name.
 */
function constantLiterals(sourceFile) {
  /** @type {Map<string, ts.Expression>} */
  const constants = new Map();
  /** @type {Set<string>} */
  const shadowed = new Set();
  walk(sourceFile, node => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      ts.isVarConst(node)
    ) {
      const name = node.name.text;
      if (constants.has(name) || shadowed.has(name)) {
        constants.delete(name);
        shadowed.add(name);
      } else {
        constants.set(name, node.initializer);
      }
    }
  });
  return constants;
}

/**
 * The phrase an assertion argument spells, if it is a literal.
 * @param {ts.Expression | undefined} node - The argument.
 * @param {Map<string, ts.Expression>} constants - File constants.
 * @returns {{ kind: "string", value: string } | { kind: "pattern", value: { source: string, flags: string } } | undefined} The phrase.
 */
export function literalPhrase(node, constants) {
  if (node === undefined) return undefined;
  if (ts.isStringLiteralLike(node)) return { kind: "string", value: node.text };
  if (node.kind === ts.SyntaxKind.RegularExpressionLiteral) {
    const text = node.getText();
    const end = text.lastIndexOf("/");
    return {
      kind: "pattern",
      value: { source: text.slice(1, end), flags: text.slice(end + 1) },
    };
  }
  if (ts.isIdentifier(node) && constants.has(node.text)) {
    const initializer = constants.get(node.text);
    return initializer === node
      ? undefined
      : literalPhrase(initializer, new Map());
  }
  return undefined;
}

/**
 * The argument and polarity of one phrase chain: `toContain(x)` /
 * `toMatch(x)`, or `<text>.includes(x)` checked with `toBe(true|false)`.
 * @param {ReturnType<typeof import("./ast.mjs").readExpectChain>} chain - A phrase chain.
 * @returns {{ argument: ts.Expression | undefined, negated: boolean, matcher: string }} The parts.
 */
export function phraseParts(chain) {
  if (chain.matcher !== "toBe") {
    return {
      argument: chain.args[0],
      negated: chain.negated,
      matcher: chain.matcher ?? "",
    };
  }
  const includes = /** @type {ts.CallExpression} */ (chain.subject);
  const expected = booleanLiteral(chain.args[0]);
  return {
    // Not a boolean literal: the polarity is unknown, so leave the
    // argument unset and let the site report UNRESOLVED.
    argument: expected === undefined ? undefined : includes.arguments[0],
    negated: expected === chain.negated,
    matcher: "includes",
  };
}

/**
 * Classify every phrase assertion in a test file that reads Markdown.
 * @param {string} fileName - Repository-relative test path.
 * @param {string} text - Its contents.
 * @returns {AssertionVerdict[]} One verdict per phrase assertion site; empty when the
 *   file reads no Markdown. `source` says whether the asserted text is a
 *   Markdown document ("markdown"), something else such as script output
 *   ("other"), or could not be traced ("unknown"); only "markdown" sites are
 *   Markdown wording assertions.
 */
export function classifyAssertions(fileName, text) {
  const sourceFile = parseSource(fileName, text);
  if (!readsMarkdown(sourceFile)) return [];
  const constants = constantLiterals(sourceFile);
  const taint = analyseDocTaint(sourceFile);
  return expectChains(sourceFile)
    .filter(isPhraseChain)
    .map(chain => {
      const { argument, negated, matcher } = phraseParts(chain);
      const phrase = literalPhrase(argument, constants);
      const line =
        sourceFile.getLineAndCharacterOfPosition(chain.site.getStart()).line +
        1;
      const base = {
        file: fileName,
        line,
        matcher: negated ? `not.${matcher}` : matcher,
        subject: chain.subject?.getText(sourceFile) ?? "",
        source: subjectSource(chain.subject, taint),
      };
      if (phrase === undefined) {
        return {
          ...base,
          kind: "expression",
          value: argument?.getText(sourceFile) ?? "",
          cls: "UNRESOLVED",
          rule: "argument-not-literal",
          parser: [],
        };
      }
      const verdict =
        phrase.kind === "string"
          ? classifyPhrase(phrase.value)
          : classifyPhrase(phrase.value.source, { isPattern: true });
      return { ...base, ...phrase, ...verdict };
    });
}
