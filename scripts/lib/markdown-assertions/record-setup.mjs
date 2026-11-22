/**
 * Vitest setup file that records every phrase assertion and whether its
 * subject is Markdown a test read (CodySwannGT/lisa#4867).
 *
 * Loaded only by `record.vitest.config.mjs`, never by the project's own
 * config. It changes no behaviour: file reads return what they returned, and
 * `toContain` / `toMatch` still assert. Alongside, it notes
 *
 *  - every tracked Markdown file read from a test or a test helper (reads by
 *    the code under test do not count — a subject derived from them is the
 *    code's output, not the document);
 *  - for each `toContain` / `toMatch` call: its source location in the test
 *    file, the matcher, the negation, the expected value, and the Markdown
 *    file the subject came from — the whole text, a slice of it (compared
 *    whitespace- and case-insensitively), or a concatenation containing it.
 *
 * Rows go to `$LISA_MD_ASSERT_RECORD_DIR/<pid>-<n>.jsonl`, one per call.
 * @module scripts/lib/markdown-assertions/record-setup
 */
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, chai } from "vitest";

const STATE_KEY = Symbol.for("lisa.markdown-assertions.record");
const OUT_DIR = process.env["LISA_MD_ASSERT_RECORD_DIR"] ?? "";
const ROOT = process.env["LISA_MD_ASSERT_ROOT"] ?? process.cwd();
const TESTS_DIR = `${path.join(ROOT, "tests")}${path.sep}`;
const THIS_FILE = fileURLToPath(import.meta.url);

/** Shortest normalised subject that counts as a slice of a document. */
const MIN_SLICE = 20;

/** Shortest document that counts when a subject concatenates several. */
const MIN_CONCAT_DOC = 200;

/**
 * @typedef {{ tracked: Set<string>, reads: Map<string, { text: string, norm: string }>, rows: object[], files: number }} State
 */

/**
 * Collapse whitespace and case, so a re-wrapped or lower-cased slice still
 * matches its document.
 * @param {string} text - Text.
 * @returns {string} Normalised text.
 */
function normalise(text) {
  return text.replaceAll(/\s+/gu, " ").toLowerCase();
}

/**
 * The process-wide recorder state (builtins and the runner outlive a single
 * test file's module graph, so the patches are installed once).
 * @returns {State} The state.
 */
function state() {
  const holder = /** @type {Record<symbol, State>} */ (
    /** @type {unknown} */ (globalThis)
  );
  holder[STATE_KEY] ??= {
    tracked: new Set(
      JSON.parse(
        fs.readFileSync(process.env["LISA_MD_ASSERT_TRACKED"] ?? "", "utf8")
      )
    ),
    reads: new Map(),
    rows: [],
    files: 0,
  };
  return holder[STATE_KEY];
}

/**
 * Stack frames as absolute file paths with line and column.
 * @returns {{ file: string, line: number, column: number }[]} Frames.
 */
function frames() {
  const stack = new Error("frames").stack ?? "";
  return [
    ...stack.matchAll(/(?:\(|at )(?:file:\/\/)?(\/[^():\s]+):(\d+):(\d+)/gu),
  ]
    .map(match => ({
      file: match[1] ?? "",
      line: Number(match[2]),
      column: Number(match[3]),
    }))
    .filter(frame => frame.file !== THIS_FILE);
}

/**
 * Note a file read when a test (not the code under test) made it.
 * @param {unknown} target - The path argument.
 * @param {unknown} result - What the read returned.
 */
function noteRead(target, result) {
  if (busy) return;
  busy = true;
  try {
    noteReadOnce(target, result);
  } finally {
    busy = false;
  }
}

/** Set while a read is being noted, so reads it causes are not. */
let busy = false;

/**
 * Note one read (see noteRead).
 * @param {unknown} target - The path argument.
 * @param {unknown} result - What the read returned.
 */
function noteReadOnce(target, result) {
  const recorder = state();
  const raw =
    target instanceof URL
      ? fileURLToPath(target)
      : typeof target === "string"
        ? target
        : undefined;
  if (raw === undefined) return;
  const relative = path
    .relative(ROOT, path.resolve(raw))
    .split(path.sep)
    .join("/");
  if (!recorder.tracked.has(relative)) return;
  const caller = frames().find(frame => !frame.file.includes("/node_modules/"));
  if (!caller?.file.startsWith(TESTS_DIR)) return;
  const text = typeof result === "string" ? result : String(result);
  recorder.reads.set(relative, { text, norm: normalise(text) });
}

/**
 * The tracked Markdown file a subject came from, or undefined.
 * @param {unknown} subject - The `expect` subject.
 * @returns {string | undefined} Repository-relative path.
 */
function provenance(subject) {
  if (typeof subject !== "string") return undefined;
  const reads = [...state().reads.entries()];
  const exact = reads.find(([, read]) => read.text === subject);
  if (exact) return exact[0];
  const norm = normalise(subject);
  const slice = reads.find(
    ([, read]) => norm.trim().length >= MIN_SLICE && read.norm.includes(norm)
  );
  if (slice) return slice[0];
  const concat = reads.find(
    ([, read]) => read.text.length >= MIN_CONCAT_DOC && norm.includes(read.norm)
  );
  return concat?.[0];
}

/**
 * Serialise an expected value.
 * @param {unknown} value - The matcher argument.
 * @returns {unknown} JSON-safe value.
 */
function serialise(value) {
  if (value instanceof RegExp)
    return { source: value.source, flags: value.flags };
  return typeof value === "string" ? value : { unsupported: typeof value };
}

/** Install the read and matcher hooks once per process. */
function install() {
  const holder = /** @type {Record<symbol, boolean>} */ (
    /** @type {unknown} */ (globalThis)
  );
  const installed = Symbol.for("lisa.markdown-assertions.installed");
  if (holder[installed]) return;
  holder[installed] = true;
  const readFileSync = fs.readFileSync;
  fs.readFileSync = /** @type {typeof fs.readFileSync} */ (
    function patchedReadFileSync(/** @type {unknown[]} */ ...args) {
      const result = Reflect.apply(readFileSync, fs, args);
      noteRead(args[0], result);
      return result;
    }
  );
  const readFile = fsPromises.readFile;
  const patchedReadFile = /** @type {typeof fsPromises.readFile} */ (
    async function patchedReadFile(/** @type {unknown[]} */ ...args) {
      const result = await Reflect.apply(readFile, fsPromises, args);
      noteRead(args[0], result);
      return result;
    }
  );
  fsPromises.readFile = patchedReadFile;
  fs.promises.readFile = patchedReadFile;
  syncBuiltinESMExports();
  chai.use((api, utils) => {
    for (const name of ["toContain", "toMatch"]) {
      utils.overwriteMethod(api.Assertion.prototype, name, original =>
        recordingMatcher(name, original, utils)
      );
    }
  });
}

/**
 * A matcher that records its call, then asserts exactly as `original` does.
 * @param {string} name - The matcher name.
 * @param {Function} original - The runner's matcher.
 * @param {{ flag: (assertion: object, key: string) => unknown }} utils - Chai utilities.
 * @returns {Function} The recording matcher.
 */
function recordingMatcher(name, original, utils) {
  return function recorded(/** @type {unknown[]} */ ...args) {
    const subject = utils.flag(this, "object");
    state().rows.push({
      site: siteOf(frames()),
      matcher: name,
      negated: Boolean(utils.flag(this, "negate")),
      value: serialise(args[0]),
      markdown: provenance(subject) ?? null,
      markdownExact: isWholeDocument(subject),
      valueMarkdown: provenance(args[0]) ?? null,
    });
    return Reflect.apply(original, this, args);
  };
}

/**
 * The first test-tree frame as `<file>:<line>:<column>`, or null.
 * @param {{ file: string, line: number, column: number }[]} stack - Frames.
 * @returns {string | null} The site.
 */
function siteOf(stack) {
  const site = stack.find(frame => frame.file.startsWith(TESTS_DIR));
  return site
    ? `${path.relative(ROOT, site.file)}:${site.line}:${site.column}`
    : null;
}

/**
 * Whether a subject is the whole text of a document a test read.
 * @param {unknown} subject - The `expect` subject.
 * @returns {boolean} True for an exact document.
 */
function isWholeDocument(subject) {
  return (
    typeof subject === "string" &&
    [...state().reads.values()].some(read => read.text === subject)
  );
}

state().reads.clear();
install();
afterAll(() => {
  const recorder = state();
  if (OUT_DIR && recorder.rows.length > 0) {
    recorder.files++;
    fs.mkdirSync(OUT_DIR, { recursive: true });
    fs.writeFileSync(
      path.join(OUT_DIR, `${process.pid}-${recorder.files}.jsonl`),
      `${recorder.rows.map(row => JSON.stringify(row)).join("\n")}\n`
    );
  }
  recorder.rows = [];
  recorder.reads.clear();
});
