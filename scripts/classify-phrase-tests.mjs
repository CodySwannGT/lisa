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
 * @module scripts/classify-phrase-tests
 */
import { classifyTestSource } from "./lib/phrase-tests/classify.mjs";
import {
  REPO_ROOT,
  workingTreeReader,
  workingTreeTestFiles,
} from "./lib/phrase-tests/repo.mjs";

const args = new Set(process.argv.slice(2));
const readSource = workingTreeReader(REPO_ROOT);
const verdicts = workingTreeTestFiles(REPO_ROOT).map(file =>
  classifyTestSource(file, readSource(file) ?? "", readSource)
);
const phraseOnly = verdicts.filter(verdict => verdict.phraseOnly);
const shown = args.has("--all") ? verdicts : phraseOnly;

if (args.has("--json")) {
  console.log(
    JSON.stringify(
      {
        testFiles: verdicts.length,
        phraseOnly: phraseOnly.length,
        assertionSites: phraseOnly.reduce((sum, v) => sum + v.assertions, 0),
        files: shown,
      },
      null,
      2
    )
  );
} else {
  for (const verdict of shown) {
    const tail = verdict.phraseOnly
      ? ""
      : `  REJECTED: ${verdict.reasons.join("; ")}`;
    console.log(
      `${String(verdict.assertions).padStart(5)}  ${verdict.file}${tail}`
    );
  }
  console.log(
    `${phraseOnly.length} phrase-only of ${verdicts.length} test files; ` +
      `${phraseOnly.reduce((sum, v) => sum + v.assertions, 0)} assertion sites`
  );
}
