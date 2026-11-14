#!/usr/bin/env node
/**
 * Prove the required-phrases manifest carries every phrase assertion of the
 * test files it replaced (CodySwannGT/lisa#4609).
 *
 * For every test file present at `--base` but gone at `--head` (default
 * `HEAD`), the file and
 * its helpers are read from the base commit (`git show`), classified, and the
 * phrase-only ones are re-run under the recording runner. Their deduped
 * (file, polarity, kind, value) assertions must all be in
 * `tests/phrase-manifest/required-phrases.json`, and the deleted phrase-only
 * files must be exactly the test files the manifest's `source` entries name.
 * The full list of failure conditions is in `lib/phrase-tests/parity.mjs`;
 * in particular a range that deletes nothing FAILS rather than passing empty.
 *
 * The range must be the fold's own commit. Comparing the base with today's
 * HEAD would count every test file main deletes later, for unrelated reasons,
 * as a fold deletion that is "not phrase-only".
 *
 * It replays the base's tests against the CURRENT tree's text files, so it is
 * a merge-time proof of the fold. After later wording edits (which change the
 * manifest by hand), the old assertions no longer hold and surface as "fails
 * on the current tree" — that is expected, not a regression of the manifest.
 *
 * Usage:
 *   node scripts/check-phrase-manifest-parity.mjs --base <ref> [--head <ref>] [--exact]
 * The fold's own range was `--base 02b59a6297 --head 5207036771 --exact`. It
 * is no longer a package script: CodySwannGT/lisa#4867 pruned the manifest to
 * its load-bearing entries, so the fold's wording pins are gone from it by
 * design, and the check is a record of how the fold was proven, not a gate.
 * @module scripts/check-phrase-manifest-parity
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { foldPhraseTests } from "./lib/phrase-tests/fold.mjs";
import {
  MANIFEST_PATH,
  manifestEntries,
} from "./lib/phrase-tests/manifest.mjs";
import {
  deletedTestFiles,
  parityFailures,
} from "./lib/phrase-tests/parity.mjs";
import {
  commitReader,
  REPO_ROOT,
  testFilesAt,
} from "./lib/phrase-tests/repo.mjs";

const argv = process.argv.slice(2);

/**
 * The value of the last occurrence of a flag, so a flag given later on the
 * command line overrides an earlier one.
 * @param {string} name - Flag name, e.g. `--base`.
 * @returns {string | undefined} Its value, or undefined when absent.
 */
function flag(name) {
  const index = argv.lastIndexOf(name);
  return index === -1 ? undefined : argv[index + 1];
}

const base = flag("--base");
const head = flag("--head") ?? "HEAD";
if (base === undefined || base.startsWith("--") || head.startsWith("--")) {
  console.error(
    "usage: check-phrase-manifest-parity.mjs --base <ref> [--head <ref>] [--exact]"
  );
  process.exit(2);
}

// Phrase tests resolve relative paths against the cwd, as vitest runs them.
process.chdir(REPO_ROOT);

const deleted = deletedTestFiles(
  testFilesAt(REPO_ROOT, base),
  testFilesAt(REPO_ROOT, head)
);
const fold = await foldPhraseTests(deleted, {
  root: REPO_ROOT,
  readSource: commitReader(REPO_ROOT, base),
});
const manifest = JSON.parse(
  readFileSync(path.join(REPO_ROOT, MANIFEST_PATH), "utf8")
);

console.log(
  `${base}..${head}: ${deleted.length} test file(s) deleted by the range`
);
console.log(`  phrase-only:     ${fold.recordings.length}`);
console.log(`  not phrase-only: ${deleted.length - fold.recordings.length}`);
console.log(
  `before: ${fold.raw} runtime phrase assertions, ${fold.keys.size} distinct (file, polarity, kind, value)`
);
console.log(`after:  ${manifestEntries(manifest).length} manifest entries`);

const failures = parityFailures({
  deleted,
  fold,
  manifest,
  exact: argv.includes("--exact"),
});
for (const failure of failures) console.error(`FAIL ${failure}`);
console.log(
  failures.length === 0 ? "parity: OK" : `parity: ${failures.length} failure(s)`
);
process.exit(failures.length === 0 ? 0 : 1);
