/**
 * Repository facts the Markdown-assertion classifier needs, built once per
 * run (CodySwannGT/lisa#4867).
 * @module scripts/lib/markdown-assertions/context
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { classifyCheck, knownNames } from "./classify.mjs";
import { buildCorpus } from "./corpus.mjs";

/** Document extensions whose assertions are in scope. */
const MARKDOWN = /\.(?:md|mdc|mdx)$/u;

/**
 * Whether a file is a Markdown document (the scope of the cull).
 * @param {string} file - Repository-relative path.
 * @returns {boolean} True for Markdown.
 */
export function isMarkdown(file) {
  return MARKDOWN.test(file);
}

/**
 * A classifier bound to one checkout. Checks against a non-Markdown file
 * (a hook script, a workflow) pin executable text and are out of the cull's
 * scope; they classify as MACHINE-TOKEN with the file itself as the parser.
 * @param {string} root - Repository root.
 * @returns {(check: import("./classify.mjs").Check) => import("./classify.mjs").Verdict} The classifier.
 */
export function createClassifier(root) {
  const context = {
    root,
    names: knownNames(root),
    corpus: buildCorpus(root),
    /** @param {string} file - Repository-relative path. */
    readText: file => {
      try {
        return readFileSync(path.join(root, file), "utf8");
      } catch {
        return undefined;
      }
    },
  };
  return check =>
    isMarkdown(check.file)
      ? classifyCheck(check, context)
      : {
          class: "MACHINE-TOKEN",
          why: "target is executable code, not Markdown",
          parser: check.file,
        };
}
