#!/usr/bin/env node
/**
 * Prove the required-phrases manifest carries every phrase assertion of the
 * test files it replaced (CodySwannGT/lisa#4609).
 *
 * For every test file present at `--base` but gone from `HEAD`, the file and
 * its helpers are read from the base commit (`git show`), classified, and the
 * phrase-only ones are re-run under the recording runner against this working
 * tree's text files. Their deduped (file, polarity, kind, value) assertions
 * must all be in `tests/phrase-manifest/required-phrases.json`.
 *
 * Fails when a deleted phrase-only file was not fully translatable (it should
 * have been kept), or when any of its assertions is missing from the manifest.
 * With `--exact` it also fails when the manifest holds entries no deleted file
 * asserted, which is what "identical protection" means for the fold itself.
 *
 * Usage:
 *   node scripts/check-phrase-manifest-parity.mjs --base <ref> [--exact]
 * @module scripts/check-phrase-manifest-parity
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { foldPhraseTests } from "./lib/phrase-tests/fold.mjs";
import {
  entryKey,
  MANIFEST_PATH,
  manifestEntries,
} from "./lib/phrase-tests/manifest.mjs";
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
const manifestKeys = new Set(manifestEntries(manifest).map(entryKey));
const missing = [...fold.keys].filter(key => !manifestKeys.has(key));
const extra = [...manifestKeys].filter(key => !fold.keys.has(key));

console.log(`base ${base}: ${deleted.length} test file(s) deleted on HEAD`);
console.log(`  phrase-only:              ${fold.recordings.length}`);
console.log(
  `  not phrase-only (ignored): ${deleted.length - fold.recordings.length}`
);
console.log(
  `before: ${fold.raw} runtime phrase assertions, ${fold.keys.size} distinct (file, polarity, kind, value)`
);
console.log(`after:  ${manifestKeys.size} manifest entries`);

const failures = [
  ...fold.untranslatable.map(
    ({ file, reasons }) =>
      `deleted but not translatable: ${file}\n    ${reasons.slice(0, 3).join("\n    ")}`
  ),
  ...missing.map(key => `missing from the manifest: ${key}`),
  ...(argv.includes("--exact")
    ? extra.map(
        key => `in the manifest but asserted by no deleted file: ${key}`
      )
    : []),
];
if (!argv.includes("--exact") && extra.length > 0) {
  console.log(
    `note: ${extra.length} manifest entries are asserted by no deleted file (pass --exact to fail on them)`
  );
}
for (const failure of failures) console.error(`FAIL ${failure}`);
console.log(
  failures.length === 0 ? "parity: OK" : `parity: ${failures.length} failure(s)`
);
process.exit(failures.length === 0 ? 0 : 1);
