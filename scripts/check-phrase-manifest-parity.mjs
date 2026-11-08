#!/usr/bin/env node
/**
 * Prove the required-phrases manifest carries every phrase assertion of the
 * test files it replaced (CodySwannGT/lisa#4609).
 *
 * For every test file present at `--base` but gone from `HEAD`, the file and
 * its helpers are read from the base commit (`git show`), classified, and the
 * phrase-only ones are re-run under the recording runner. Their deduped
 * (file, polarity, kind, value) assertions must all be in
 * `tests/phrase-manifest/required-phrases.json`, and the deleted phrase-only
 * files must be exactly the test files the manifest's `source` entries name.
 * The full list of failure conditions is in `lib/phrase-tests/parity.mjs`;
 * in particular a base that deletes nothing FAILS rather than passing empty.
 *
 * It replays the base's tests against the CURRENT tree's text files, so it is
 * a merge-time proof of the fold. After later wording edits (which change the
 * manifest by hand), the old assertions no longer hold and surface as "fails
 * on the current tree" — that is expected, not a regression of the manifest.
 *
 * Usage:
 *   node scripts/check-phrase-manifest-parity.mjs --base <ref> [--exact]
 * `bun run check:phrase-manifest-parity` uses the commit before the fold.
 * @module scripts/check-phrase-manifest-parity
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { foldPhraseTests } from "./lib/phrase-tests/fold.mjs";
import {
  MANIFEST_PATH,
  manifestEntries,
} from "./lib/phrase-tests/manifest.mjs";
import { parityFailures } from "./lib/phrase-tests/parity.mjs";
import {
  commitReader,
  REPO_ROOT,
  testFilesAt,
} from "./lib/phrase-tests/repo.mjs";

const argv = process.argv.slice(2);
// The last --base wins, so `bun run check:phrase-manifest-parity --base <ref>`
// overrides the package script's default.
const baseIndex = argv.lastIndexOf("--base");
const base = baseIndex === -1 ? undefined : argv[baseIndex + 1];
if (base === undefined || base.startsWith("--")) {
  console.error(
    "usage: check-phrase-manifest-parity.mjs --base <ref> [--exact]"
  );
  process.exit(2);
}

// Phrase tests resolve relative paths against the cwd, as vitest runs them.
process.chdir(REPO_ROOT);

const onHead = new Set(testFilesAt(REPO_ROOT, "HEAD"));
const deleted = testFilesAt(REPO_ROOT, base).filter(file => !onHead.has(file));
const fold = await foldPhraseTests(deleted, {
  root: REPO_ROOT,
  readSource: commitReader(REPO_ROOT, base),
});
const manifest = JSON.parse(
  readFileSync(path.join(REPO_ROOT, MANIFEST_PATH), "utf8")
);

console.log(`base ${base}: ${deleted.length} test file(s) deleted on HEAD`);
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
