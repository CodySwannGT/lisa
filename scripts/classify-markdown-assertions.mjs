#!/usr/bin/env node
/**
 * Classify every Markdown assertion as STRUCTURAL, MACHINE-TOKEN or WORDING
 * and cull the WORDING ones (CodySwannGT/lisa#4867). The rules live in
 * `lib/markdown-assertions/classify.mjs`.
 *
 * Usage:
 *   node scripts/classify-markdown-assertions.mjs manifest           # counts per class
 *   node scripts/classify-markdown-assertions.mjs manifest --check   # exit 1 if any WORDING remains
 *   node scripts/classify-markdown-assertions.mjs manifest --apply   # write the evidence file, drop WORDING
 *
 * `--apply` writes the classification of the manifest as it stood to
 * `tests/phrase-manifest/classification/manifest.json` (the committed
 * evidence) and rewrites `tests/phrase-manifest/required-phrases.json` with
 * only the STRUCTURAL and MACHINE-TOKEN entries.
 * @module scripts/classify-markdown-assertions
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { createClassifier } from "./lib/markdown-assertions/context.mjs";
import { cullManifest } from "./lib/markdown-assertions/manifest-cull.mjs";
import {
  candidateTestFiles,
  recordAssertions,
} from "./lib/markdown-assertions/record.mjs";
import {
  classifySites,
  evidenceSites,
  siteCounts,
} from "./lib/markdown-assertions/sites.mjs";
import { cullTestFiles } from "./lib/markdown-assertions/test-cull.mjs";
import { REPO_ROOT } from "./lib/phrase-tests/repo.mjs";
import { MANIFEST_PATH } from "./lib/phrase-tests/manifest.mjs";

/** Where the committed classification evidence lives. */
const EVIDENCE_DIR = "tests/phrase-manifest/classification";

const [command, ...rest] = process.argv.slice(2);
const flags = new Set(rest);

/**
 * Write a JSON file with a trailing newline.
 * @param {string} file - Repository-relative path.
 * @param {unknown} value - The value.
 */
function writeJson(file, value) {
  const absolute = path.join(REPO_ROOT, file);
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, `${JSON.stringify(value, null, 2)}\n`);
}

/**
 * Write evidence JSON with one classified entry per line, so the file stays
 * small and diffs line by line.
 * @param {string} file - Repository-relative path.
 * @param {unknown} value - The evidence.
 */
function writeEvidence(file, value) {
  const absolute = path.join(REPO_ROOT, file);
  mkdirSync(path.dirname(absolute), { recursive: true });
  const text = JSON.stringify(
    value,
    (_key, item) =>
      item && typeof item === "object" && ("polarity" in item || "site" in item)
        ? `\u0000${JSON.stringify(item)}`
        : item,
    1
  ).replaceAll(/"\\u0000((?:[^"\\]|\\.)*)"/gu, (_match, inner) =>
    JSON.parse(`"${inner}"`)
  );
  writeFileSync(absolute, `${text}\n`);
}

if (command === "manifest") {
  const manifestFile = path.join(REPO_ROOT, MANIFEST_PATH);
  const manifest = JSON.parse(readFileSync(manifestFile, "utf8"));
  const { evidence, culled, counts } = cullManifest(
    manifest,
    createClassifier(REPO_ROOT)
  );
  console.log(JSON.stringify(counts, null, 2));
  if (flags.has("--apply")) {
    writeEvidence(`${EVIDENCE_DIR}/manifest.json`, evidence);
    writeJson(MANIFEST_PATH, culled);
  } else if (flags.has("--check") && counts.WORDING > 0) {
    console.error(
      `${counts.WORDING} WORDING entries remain in ${MANIFEST_PATH}`
    );
    process.exit(1);
  }
} else if (command === "record") {
  const out = rest[0];
  if (!out) usage();
  const files = candidateTestFiles(REPO_ROOT);
  console.log(`recording ${files.length} test files`);
  const { rows, status } = recordAssertions(REPO_ROOT, files);
  writeFileSync(path.resolve(out), JSON.stringify({ files, status, rows }));
  console.log(`${rows.length} assertion runs recorded (vitest exit ${status})`);
} else if (command === "tests") {
  const rowsAt = rest.indexOf("--rows");
  const rowsFile = rowsAt === -1 ? undefined : rest[rowsAt + 1];
  if (!rowsFile) usage();
  const recording = JSON.parse(readFileSync(path.resolve(rowsFile), "utf8"));
  const sites = classifySites(
    recording.rows,
    REPO_ROOT,
    createClassifier(REPO_ROOT)
  );
  const result = flags.has("--apply")
    ? cullTestFiles(REPO_ROOT, sites)
    : undefined;
  const counts = siteCounts(sites, recording.files.length, result);
  console.log(JSON.stringify(counts, null, 2));
  if (result) {
    writeEvidence(`${EVIDENCE_DIR}/test-assertions.json`, {
      $comment: [
        "Classification of every recorded toContain/toMatch site in the unit test files that read Markdown, before the CodySwannGT/lisa#4867 cull.",
        "Produced by `node scripts/classify-markdown-assertions.mjs record <rows.json>` then `tests --rows <rows.json> --apply`; rules in scripts/lib/markdown-assertions/sites.mjs.",
        "A site is deleted only when every run of it checked a Markdown document and classified WORDING; `edits` lists what each test file lost.",
      ],
      counts,
      edits: result.edits,
      sites: evidenceSites(sites),
    });
  }
} else {
  usage();
}

/** Print usage and exit. */
function usage() {
  console.error(
    [
      "usage: classify-markdown-assertions.mjs manifest [--check | --apply]",
      "       classify-markdown-assertions.mjs record <rows.json>",
      "       classify-markdown-assertions.mjs tests --rows <rows.json> [--apply]",
    ].join("\n")
  );
  process.exit(2);
}
