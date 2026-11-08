#!/usr/bin/env node
/**
 * One-time fold of the phrase-only test files into the required-phrases
 * manifest (CodySwannGT/lisa#4609).
 *
 * Classifies every test file, runs each phrase-only one under the recording
 * runner, and writes `tests/phrase-manifest/required-phrases.json` from the
 * files whose every runtime phrase assertion translated. With `--delete` it
 * also removes those test files. Files with any untranslatable assertion are
 * listed with the reason and left untouched.
 *
 * This is a ONE-TIME generator: once the translated files are deleted it can
 * no longer re-derive their phrases, and the manifest becomes the
 * hand-maintained source of truth. It therefore refuses to overwrite an
 * existing manifest unless `--force` is given. Use
 * `scripts/check-phrase-manifest-parity.mjs` to re-prove the fold later.
 *
 * Usage:
 *   node scripts/generate-phrase-manifest.mjs [--dry-run] [--delete] [--force] [--json]
 * @module scripts/generate-phrase-manifest
 */
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { foldPhraseTests } from "./lib/phrase-tests/fold.mjs";
import {
  buildManifest,
  MANIFEST_PATH,
  manifestEntries,
} from "./lib/phrase-tests/manifest.mjs";
import {
  REPO_ROOT,
  workingTreeReader,
  workingTreeTestFiles,
} from "./lib/phrase-tests/repo.mjs";

const args = new Set(process.argv.slice(2));
const manifestFile = path.join(REPO_ROOT, MANIFEST_PATH);

// Phrase tests resolve relative paths against the cwd, as vitest runs them.
process.chdir(REPO_ROOT);

if (
  existsSync(manifestFile) &&
  !args.has("--force") &&
  !args.has("--dry-run")
) {
  console.error(
    `${MANIFEST_PATH} already exists and is hand-maintained; pass --force to overwrite it.`
  );
  process.exit(1);
}

const fold = await foldPhraseTests(workingTreeTestFiles(REPO_ROOT), {
  root: REPO_ROOT,
  readSource: workingTreeReader(REPO_ROOT),
});
const manifest = buildManifest(fold.translated);
const summary = {
  testFiles: fold.testFiles,
  phraseOnly: fold.recordings.length,
  translated: fold.translated.map(recording => recording.file),
  untranslatable: fold.untranslatable.map(({ file, raw, reasons }) => ({
    file,
    raw,
    reasons,
  })),
  rawAssertions: fold.raw,
  dedupedAssertions: fold.keys.size,
  manifestFiles: Object.keys(manifest.files).length,
  manifestEntries: manifestEntries(manifest).length,
};

if (args.has("--json")) {
  console.log(JSON.stringify(summary, null, 2));
} else {
  console.log(`test files:            ${summary.testFiles}`);
  console.log(`phrase-only:           ${summary.phraseOnly}`);
  console.log(`translated:            ${summary.translated.length}`);
  console.log(`untranslatable (kept): ${summary.untranslatable.length}`);
  for (const { file, reasons } of summary.untranslatable) {
    console.log(`  ${file}\n    ${reasons.slice(0, 3).join("\n    ")}`);
  }
  console.log(
    `runtime assertions:    ${summary.rawAssertions} (deduped ${summary.dedupedAssertions})`
  );
  console.log(
    `manifest entries:      ${summary.manifestEntries} across ${summary.manifestFiles} files`
  );
}

if (!args.has("--dry-run")) {
  mkdirSync(path.dirname(manifestFile), { recursive: true });
  writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
  if (args.has("--delete")) {
    for (const file of summary.translated) rmSync(path.join(REPO_ROOT, file));
  }
}
