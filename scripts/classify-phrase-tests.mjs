#!/usr/bin/env node
/**
 * List the phrase-only test files (CodySwannGT/lisa#4609): files whose only
 * I/O is reading text and whose every assertion checks a phrase is present
 * or absent in that text. The rules live in `lib/phrase-tests/classify.mjs`.
 *
 * Usage:
 *   node scripts/classify-phrase-tests.mjs           # one line per file
 *   node scripts/classify-phrase-tests.mjs --json    # machine-readable
 *   node scripts/classify-phrase-tests.mjs --all     # also rejected files, with reasons
 *
 * Phrase classes (CodySwannGT/lisa#4867; rules in `lib/phrase-tests/token-classes.mjs`):
 *   node scripts/classify-phrase-tests.mjs --classify-manifest     # every manifest entry, JSON
 *   node scripts/classify-phrase-tests.mjs --classify-assertions   # every Markdown phrase assertion in tests, JSON
 *   node scripts/classify-phrase-tests.mjs --prune-manifest        # drop WORDING; move NOT-MARKDOWN entries to the source-text guards
 * Each entry is MACHINE-TOKEN (with the parser that reads it), STRUCTURAL or
 * WORDING; an assertion whose argument is not a literal is UNRESOLVED.
 * `counts` covers only assertions on Markdown text; `bySource` also counts
 * those on other text (script output) and on text it could not trace.
 * @module scripts/classify-phrase-tests
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { classifyTestSource } from "./lib/phrase-tests/classify.mjs";
import {
  classifyAssertions,
  classifyManifest,
  countByClass,
  countBySource,
  pruneManifest,
} from "./lib/phrase-tests/inventory.mjs";
import {
  MANIFEST_PATH,
  SOURCE_GUARDS_PATH,
} from "./lib/phrase-tests/manifest.mjs";
import { redactDeep, redactText } from "./lib/phrase-tests/redact.mjs";
import {
  REPO_ROOT,
  workingTreeReader,
  workingTreeTestFiles,
} from "./lib/phrase-tests/repo.mjs";

const args = new Set(process.argv.slice(2));
const readSource = workingTreeReader(REPO_ROOT);
const manifestFile = path.join(REPO_ROOT, MANIFEST_PATH);

/**
 * Print a report as JSON, with every credential-shaped string redacted: the
 * reports copy assertion arguments verbatim, and some are fixture secrets.
 * Never follow this with `process.exit`: stdout to a pipe is asynchronous,
 * and exiting early truncates the report at 64 KiB.
 * @param {unknown} report - The report.
 */
function printJson(report) {
  process.stdout.write(`${JSON.stringify(redactDeep(report), null, 2)}\n`);
}

/**
 * The required-phrases manifest on disk.
 * @returns {import("./lib/phrase-tests/manifest.mjs").Manifest} The manifest.
 */
function readManifest() {
  return JSON.parse(readFileSync(manifestFile, "utf8"));
}

/** `--classify-assertions`: every Markdown phrase assertion in the tests. */
function reportAssertions() {
  const sites = workingTreeTestFiles(REPO_ROOT).flatMap(file =>
    classifyAssertions(file, readSource(file) ?? "")
  );
  const markdown = sites.filter(site => site.source === "markdown");
  const files = [...new Set(sites.map(site => site.file))].map(file => {
    const own = sites.filter(site => site.file === file);
    return {
      file,
      sites: own.length,
      counts: countByClass(own.filter(site => site.source === "markdown")),
      bySource: countBySource(own),
    };
  });
  printJson({
    testFiles: files.length,
    sites: sites.length,
    markdownSites: markdown.length,
    counts: countByClass(markdown),
    bySource: countBySource(sites),
    files,
    verdicts: sites,
  });
}

/** The original mode: which test files are phrase-only (#4609). */
function reportPhraseOnlyFiles() {
  const verdicts = workingTreeTestFiles(REPO_ROOT).map(file =>
    classifyTestSource(file, readSource(file) ?? "", readSource)
  );
  const phraseOnly = verdicts.filter(verdict => verdict.phraseOnly);
  const shown = args.has("--all") ? verdicts : phraseOnly;
  const sites = phraseOnly.reduce((sum, v) => sum + v.assertions, 0);
  if (args.has("--json")) {
    printJson({
      testFiles: verdicts.length,
      phraseOnly: phraseOnly.length,
      assertionSites: sites,
      files: shown,
    });
    return;
  }
  for (const verdict of shown) {
    const tail = verdict.phraseOnly
      ? ""
      : `  REJECTED: ${verdict.reasons.join("; ")}`;
    console.log(
      redactText(
        `${String(verdict.assertions).padStart(5)}  ${verdict.file}${tail}`
      )
    );
  }
  console.log(
    `${phraseOnly.length} phrase-only of ${verdicts.length} test files; ` +
      `${sites} assertion sites`
  );
}

if (args.has("--classify-manifest")) {
  printJson(classifyManifest(readManifest()));
} else if (args.has("--prune-manifest")) {
  const guardsFile = path.join(REPO_ROOT, SOURCE_GUARDS_PATH);
  const existingGuards = existsSync(guardsFile)
    ? JSON.parse(readFileSync(guardsFile, "utf8"))
    : undefined;
  const { manifest, sourceGuards } = pruneManifest(
    readManifest(),
    existingGuards
  );
  writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(guardsFile, `${JSON.stringify(sourceGuards, null, 2)}\n`);
} else if (args.has("--classify-assertions")) {
  reportAssertions();
} else {
  reportPhraseOnlyFiles();
}
