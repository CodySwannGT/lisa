// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/**
 * The comparison key that matches a line a tracker stored against the line
 * Lisa's writer rendered (CodySwannGT/lisa#4690, #4956).
 *
 * Linear escapes Markdown punctuation one layer deep (`\_`, `\.`),
 * re-serializes `_…_` as `*…*`, and rewrites any table alignment row as
 * `| -- | … |`, dropping its colons. Only the comparison key changes, and the
 * writer's rows pass through the same fold, so a line counts as Lisa's solely
 * when its key equals a known rendered row; any other prose or row still
 * reaches the spec digest.
 *
 * Accepted limitation: every alignment row with the same number of cells
 * folds to one key, so an extra alignment row inserted next to a managed one
 * is indistinguishable from it. Such a row carries only dashes and colons, so
 * no specification words can hide that way.
 * @module scripts/lib/tracker-row-fold
 */

const ALIGNMENT_ROW = /^\|(?::?-+:?\|)+$/;
const LEADING_STAR_ITALIC = /^(\|?)\*([^*\r\n]+)\*(?=\||$)/;
const ESCAPED_PUNCTUATION = /\\([!-/:-@[-`{-~])/g;

/**
 * Trim a line and every table cell in it.
 * @param {string} line - Stored or rendered line.
 * @returns {string} The line with cell padding removed.
 */
const normalizedRow = line =>
  line
    .trim()
    .split("|")
    .map(part => part.trim())
    .join("|");

/**
 * The key two lines share when one is a tracker's rewrite of the other.
 * @param {string} line - Stored or rendered line.
 * @returns {string} The comparison key.
 */
export function trackerRowKey(line) {
  const row = normalizedRow(line.replace(ESCAPED_PUNCTUATION, "$1"));
  if (ALIGNMENT_ROW.test(row))
    return `|${"---|".repeat(row.split("|").length - 2)}`;
  return row.replace(LEADING_STAR_ITALIC, "$1_$2_");
}
