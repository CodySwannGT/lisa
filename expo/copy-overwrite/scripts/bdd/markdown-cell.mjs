// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/**
 * Markdown table-cell escaping, shared by the BDD burndown renderer and the
 * Maestro failure classifier.
 *
 * Waiver reasons, scenario titles, discovered test names and Maestro failure
 * messages are repo data that lands inside a generated Markdown table. A single
 * `|` ends the cell early and shifts every column after it, so the columns to
 * its right silently misreport — in a generated file nobody re-reads. A line
 * ending is worse: it ends the ROW, so one record becomes two and every column
 * after the break is read against the wrong header.
 *
 * This module exists because the escaper was module-private and DUPLICATED —
 * `cell` inside `scripts/bdd/render.mjs` and `escapeCell` inside
 * `scripts/classify-maestro-failures.mjs`. Neither copy could be reached by a
 * unit test, so both could only be exercised indirectly through a whole
 * rendered document, and the two had already drifted: one stripped `\r\n` and
 * `\n`, the other only `\n`. Both leaked live column separators.
 *
 * The contract predicates below are exported alongside it deliberately, so
 * "table safe" has one definition rather than one per test. That is worth
 * having and it is NOT sufficient: the first fix on this defect shipped with
 * `hasUnescapedPipe` already asserting the right answer for `\\|` while `cell`
 * was never fed that input, so the escaper leaked at every even backslash run
 * with the yardstick sitting right there, correct and unused. A shared
 * predicate only helps once something SWEEPS the subject with it. Enumerate the
 * property; the named instances are documentation.
 *
 * @module scripts/bdd/markdown-cell
 */

/**
 * Escape one pipe together with the WHOLE backslash run in front of it.
 *
 * The rule is the same one {@link hasUnescapedPipe} measures, stated once:
 * a pipe is a live column separator exactly when an EVEN number of backslashes
 * (zero included) precedes it. So an even run needs one more backslash; an odd
 * run is already an escape and must be left alone, or the escaper would grow
 * the run on every pass and stop being idempotent.
 *
 * Two nearby spellings are wrong and both look right:
 *
 *  - `/\\?\|/` — consumes at most ONE preceding backslash, so `\\|` (escaped
 *    backslash, live pipe) is seen as an escape that is already present and is
 *    passed through untouched. It leaks at every even run: measured live at
 *    runs 2, 4, 6 and 8. That was this defect's first fix and was itself a bug —
 *    the report named two INSTANCES, and fixing those is not fixing the
 *    property.
 *  - `/((?:\\\\)*)\|/` with a `"$1\\|"` replacement — an even-run pattern with
 *    no left anchor. The engine simply slides one character right and matches
 *    an even run INSIDE an odd one, so `\|` becomes `\\\|`. Measured: 60 leaks
 *    over the same sweep. A `(?<!\\)` lookbehind fixes it, but the arithmetic
 *    below says the same thing without needing that argument.
 *
 * @param {string} _match - The whole match; unused.
 * @param {string} backslashes - The backslash run preceding the pipe.
 * @returns {string} The run, escaped, plus the pipe.
 */
const escapePipeRun = (_match, backslashes) =>
  `${backslashes}${backslashes.length % 2 === 0 ? "\\" : ""}|`;

/**
 * Make author-supplied text safe inside a Markdown table cell.
 *
 * Both steps exist because the obvious spelling of each was wrong, and both
 * failures are invisible in review:
 *
 *  - Pipes are escaped by RUN, not one at a time — see {@link escapePipeRun}.
 *  - `/\r\n?|\n/` and not `/\r?\n/`. The latter only matches a CR that is
 *    FOLLOWED by an LF, so a lone `\r` survives — and CommonMark treats a lone
 *    CR as a line ending, which ends the row rather than the cell.
 *
 * The `?? ""` guard is load-bearing and must stay: without it a nullish waiver
 * field prints the literal text "null" or "undefined" into the ledger, which
 * reads as data.
 *
 * SCOPE — this is SAFETY, not FIDELITY, and the difference is deliberate. The
 * only promise made is that no live column separator and no line ending reach
 * the table; it is NOT promised that a reader can recover the input byte for
 * byte. Lone backslashes are left exactly as they arrive, so Markdown consumes
 * them pairwise and a cell holding N backslashes DISPLAYS `floor(N / 2)` of
 * them. A round-trip-safe escaper is one step longer —
 * `.replace(/\\/g, "\\\\").replace(/\|/g, "\\|")` — and was not chosen: it
 * rewrites every backslash in every waiver reason and scenario title in the
 * repo, which churns the generated ledger for a fidelity nobody consumes, and
 * it is not what {@link hasUnescapedPipe} measures. If a caller ever needs the
 * input back out of the table, it needs that escaper and a matching
 * unescaper — not a patch to this one.
 * @param {unknown} text - Arbitrary cell content.
 * @returns {string} Text safe to interpolate into a table row.
 */
export const cell = text =>
  String(text ?? "")
    .replace(/(\\*)\|/g, escapePipeRun)
    .replace(/\r\n?|\n/g, " ");

/**
 * Whether `text` still carries a line ending. A cell containing one splits the
 * table row it sits in, so this is the second half of the safety contract.
 * @param {string} text - Text already passed through {@link cell}.
 * @returns {boolean} True when a CR or an LF survives.
 */
export const hasLineEnding = text => /[\r\n]/.test(String(text));

/**
 * Whether `text` still carries a pipe that Markdown will read as a column
 * separator.
 *
 * A pipe is escaped only when an ODD number of backslashes precedes it: `\|` is
 * a literal pipe, but `\\|` is an escaped backslash followed by a LIVE pipe.
 * That distinction is the whole reason this predicate is not a regex.
 * @param {string} text - Text already passed through {@link cell}.
 * @returns {boolean} True when a column-separating pipe survives.
 */
export const hasUnescapedPipe = text => {
  let backslashes = 0;
  for (const character of String(text)) {
    if (character === "\\") {
      backslashes += 1;
      continue;
    }
    if (character === "|" && backslashes % 2 === 0) return true;
    backslashes = 0;
  }
  return false;
};
