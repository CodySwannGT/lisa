/**
 * Run test files under the recording setup and collect their phrase
 * assertions (CodySwannGT/lisa#4867). See `record-setup.mjs`.
 * @module scripts/lib/markdown-assertions/record
 */
import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  expectChains,
  isPhraseChain,
  parseSource,
} from "../phrase-tests/ast.mjs";

/** A test file worth recording: it makes phrase assertions and names documents. */
const DOCUMENT_HINT =
  /\.mdc?\b|SKILL|AGENTS|CLAUDE|rules\/|skills|commands\/|agents\//u;

/**
 * @typedef {object} Row
 * @property {string | null} site - `<test file>:<line>:<column>` of the matcher call.
 * @property {"toContain" | "toMatch"} matcher - The matcher.
 * @property {boolean} negated - Whether `.not` preceded it.
 * @property {string | { source: string, flags: string } | { unsupported: string }} value - The expected value.
 * @property {string | null} markdown - The Markdown file the subject came from.
 * @property {boolean} markdownExact - Whether the subject is a document's whole text.
 * @property {string | null} valueMarkdown - The Markdown file the expected value came from.
 */

/**
 * Unit test files that make at least one phrase assertion and mention a
 * document, in path order.
 * @param {string} root - Repository root.
 * @returns {string[]} Repository-relative test files.
 */
export function candidateTestFiles(root) {
  return execFileSync("git", ["ls-files", "tests/**/*.test.ts"], {
    cwd: root,
    encoding: "utf8",
  })
    .split("\n")
    .filter(Boolean)
    .filter(
      file => !file.includes("/integration/") && !file.includes(".integration.")
    )
    .filter(file => {
      const text = readFileSync(path.join(root, file), "utf8");
      return (
        DOCUMENT_HINT.test(text) &&
        expectChains(parseSource(file, text)).some(isPhraseChain)
      );
    });
}

/**
 * Run the given test files under the recorder and return every row.
 * @param {string} root - Repository root.
 * @param {string[]} files - Test files.
 * @returns {{ rows: Row[], status: number | null }} The rows and vitest's exit status.
 */
export function recordAssertions(root, files) {
  const scratch = mkdtempSync(path.join(tmpdir(), "lisa-md-assert-"));
  const outDir = path.join(scratch, "rows");
  const trackedFile = path.join(scratch, "tracked.json");
  const tracked = execFileSync("git", ["ls-files", "*.md", "*.mdc", "*.mdx"], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  })
    .split("\n")
    .filter(Boolean);
  writeFileSync(trackedFile, JSON.stringify(tracked));
  const result = spawnSync(
    "node_modules/.bin/vitest",
    [
      "run",
      "--config",
      "scripts/lib/markdown-assertions/record.vitest.config.mjs",
      ...files,
    ],
    {
      cwd: root,
      stdio: ["ignore", "inherit", "inherit"],
      env: {
        ...process.env,
        LISA_MD_ASSERT_RECORD_DIR: outDir,
        LISA_MD_ASSERT_ROOT: root,
        LISA_MD_ASSERT_TRACKED: trackedFile,
      },
    }
  );
  /** @type {string[]} */
  let names = [];
  try {
    names = readdirSync(outDir);
  } catch {
    names = [];
  }
  const rows = names.flatMap(name =>
    readFileSync(path.join(outDir, name), "utf8")
      .split("\n")
      .filter(Boolean)
      .map(line => /** @type {Row} */ (JSON.parse(line)))
  );
  rmSync(scratch, { recursive: true, force: true });
  return { rows, status: result.status };
}
