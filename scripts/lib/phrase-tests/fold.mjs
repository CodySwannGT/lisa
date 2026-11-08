/**
 * Classify and record a set of test files in one pass (CodySwannGT/lisa#4609).
 * Shared by the one-time generator (working tree) and the parity check (a
 * base commit), so both translate exactly the same way.
 * @module scripts/lib/phrase-tests/fold
 */
import { classifyTestSource } from "./classify.mjs";
import { entryKey } from "./manifest.mjs";
import { recordTestFile } from "./record.mjs";

/**
 * @typedef {import("./record.mjs").Recording} Recording
 * @typedef {object} Fold
 * @property {number} testFiles - Test files considered.
 * @property {Recording[]} recordings - One per phrase-only file, in path order.
 * @property {Recording[]} translated - Recordings with no reasons.
 * @property {Recording[]} untranslatable - Recordings with reasons.
 * @property {number} raw - Runtime phrase assertions in translated files.
 * @property {Set<string>} keys - Deduped (file, polarity, kind, value) keys of translated files.
 */

/**
 * Classify `files` and record every phrase-only one.
 * @param {readonly string[]} files - Repository-relative test files.
 * @param {object} options - Where to read.
 * @param {string} options.root - Repository root whose text files the tests read.
 * @param {(file: string) => string | undefined} options.readSource - Reads test and helper sources.
 * @returns {Promise<Fold>} The fold.
 */
export async function foldPhraseTests(files, { root, readSource }) {
  const phraseOnly = files.filter(
    file =>
      classifyTestSource(file, readSource(file) ?? "", readSource).phraseOnly
  );
  /** @type {Recording[]} */
  const recordings = [];
  for (const file of phraseOnly) {
    recordings.push(await recordTestFile(file, { root, readSource }));
  }
  const translated = recordings.filter(
    recording => recording.reasons.length === 0
  );
  return {
    testFiles: files.length,
    recordings,
    translated,
    untranslatable: recordings.filter(
      recording => recording.reasons.length > 0
    ),
    raw: translated.reduce((sum, recording) => sum + recording.raw, 0),
    keys: new Set(
      translated.flatMap(recording => recording.entries.map(entryKey))
    ),
  };
}
