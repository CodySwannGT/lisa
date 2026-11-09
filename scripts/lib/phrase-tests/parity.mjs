/**
 * The verdict of the manifest parity check (CodySwannGT/lisa#4609), kept
 * separate from the CLI so every way it can fail is unit-tested.
 *
 * The check must never pass vacuously. It fails when:
 * - the range deletes no test file at all (a range that is not the fold
 *   proves nothing);
 * - a deleted test file was not phrase-only, or was phrase-only but not
 *   fully translatable (it should have been kept);
 * - the deleted phrase-only files are not exactly the test files the
 *   manifest's `source` entries name;
 * - any assertion of a deleted file is missing from the manifest;
 * - with `exact`, the manifest holds an entry no deleted file asserted.
 * @module scripts/lib/phrase-tests/parity
 */
import { entryKey, manifestEntries, sourceTestFile } from "./manifest.mjs";

/**
 * Elements of `left` that are not in `right`.
 * @param {Iterable<string>} left - Candidates.
 * @param {Set<string>} right - Reference.
 * @returns {string[]} The difference, sorted.
 */
function minus(left, right) {
  return [...left].filter(item => !right.has(item)).sort();
}

/**
 * The test files a range deletes: present at its base, gone at its head.
 *
 * The range is the fold's own commit, not "base to today", so a test file
 * deleted later on main (by unrelated work) is never counted against the fold.
 * @param {readonly string[]} atBase - Test files at the range's base.
 * @param {readonly string[]} atHead - Test files at the range's head.
 * @returns {string[]} The deleted test files, sorted.
 */
export function deletedTestFiles(atBase, atHead) {
  return minus(atBase, new Set(atHead));
}

/**
 * Every way the fold fails to match the manifest.
 * @param {object} input - What to compare.
 * @param {readonly string[]} input.deleted - Test files at the base but not at the head.
 * @param {import("./fold.mjs").Fold} input.fold - Their classification and recording.
 * @param {import("./manifest.mjs").Manifest} input.manifest - The manifest.
 * @param {boolean} input.exact - Also fail on manifest entries no deleted file asserted.
 * @returns {string[]} Failure messages; empty when parity holds.
 */
export function parityFailures({ deleted, fold, manifest, exact }) {
  const manifestKeys = new Set(manifestEntries(manifest).map(entryKey));
  const sources = new Set(
    Object.values(manifest.files).flatMap(entry =>
      entry.source.map(sourceTestFile)
    )
  );
  const recorded = new Set(fold.recordings.map(recording => recording.file));
  return [
    ...(deleted.length === 0
      ? [
          `no test file is deleted between the base and the head, so nothing is proved; use the commit before the fold as --base and the fold as --head (the manifest came from ${[...sources].sort().slice(0, 3).join(", ")}${sources.size > 3 ? ", ..." : ""})`,
        ]
      : []),
    ...minus(deleted, recorded).map(
      file => `deleted but not phrase-only: ${file}`
    ),
    ...fold.untranslatable.map(
      ({ file, reasons }) =>
        `deleted but not translatable: ${file}\n    ${reasons.slice(0, 3).join("\n    ")}`
    ),
    ...minus(sources, recorded).map(
      file =>
        `the manifest names ${file} as a source, but it is not a deleted phrase-only file`
    ),
    ...minus(recorded, sources).map(
      file => `deleted phrase-only ${file} is not a source of the manifest`
    ),
    ...minus(fold.keys, manifestKeys).map(
      key => `missing from the manifest: ${key}`
    ),
    ...(exact
      ? minus(manifestKeys, fold.keys).map(
          key => `in the manifest but asserted by no deleted file: ${key}`
        )
      : []),
  ];
}
