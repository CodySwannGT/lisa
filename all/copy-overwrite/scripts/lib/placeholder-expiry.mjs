// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/**
 * A recorded value documented as provisional must not outlive its condition.
 *
 * THE DEFECT THIS EXISTS FOR. The gate inventory carried a field marked
 * "PLACEHOLDER, AND KNOWN TO BE WRONG", above a comment naming its own expiry:
 * recording the accurate value was "blocked on the registry gaining
 * `post-tool`". That moment landed in a later pull request, which satisfied
 * the stated condition and falsified the placeholder's "nothing depends on the
 * distinction" premise in the same commit — and nothing noticed, because the
 * only thing watching the condition was prose. The shipped CLI then reported a
 * moment the scripts do not fire at, and said a declarable moment was
 * undeclarable, for as long as it took a review to spot it by eye.
 *
 * A comment that names its own expiry condition is only as good as something
 * that checks the condition. This is that something.
 *
 * THE CONTRACT. A provisional value carries a marker naming a condition KEY:
 *
 *   // PLACEHOLDER-UNTIL: <condition-key>
 *
 * Every key must have an executable predicate. A marker with no predicate is a
 * failure — otherwise a placeholder could be declared provisional on a
 * condition nobody can evaluate, which is the prose situation with extra
 * ceremony. A predicate that answers true is a failure too: the condition has
 * arrived and the value has to be corrected.
 *
 * @module all/copy-overwrite/scripts/lib/placeholder-expiry
 */

/** The marker a provisional value carries, followed by its condition key. */
export const PLACEHOLDER_MARKER = "PLACEHOLDER-UNTIL:";

/**
 * The marker, plus whatever token was written after it on the SAME line.
 *
 * Deliberately not "the marker followed by a WELL-FORMED key". Matching only
 * well-formed keys meant a marker whose key was misspelled matched NOTHING, so
 * a key one capital letter away from correct was neither expired nor
 * unchecked — it passed the gate in silence, which is the precise fail-open
 * shape this module's header says it exists to close. The marker is the
 * commitment; the key's form is judged afterwards, so a misspelling becomes a
 * finding instead of an exemption.
 *
 * The token class is identifier-shaped rather than "any non-space", and that is
 * what separates a COMMITMENT from PROSE. A malformed key is still an attempt
 * at an identifier. A marker followed by punctuation is this file specifying
 * the marker, a regex containing it, or documentation quoting it — none of
 * which is a promise anybody made. Without that distinction the module defining
 * the marker reports itself, and a gate that fires on its own specification is
 * one that gets deleted rather than heeded.
 *
 * The empty alternative catches a marker written with nothing after it on its
 * line, which is a commitment naming no condition at all — reported, not
 * skipped.
 *
 * Horizontal whitespace only. `\s*` crossed a newline, so a bare marker adopted
 * the first token of the NEXT line as its key.
 *
 * The token runs to the next whitespace once it has STARTED as an identifier,
 * and that boundary is what keeps a malformed key malformed. Stopping the
 * capture at the first character outside the slug class read a marker written
 * with the token `ready!` as the well-formed key `ready`: a predicate named
 * `ready` then answered for a marker nobody wrote, and a marker whose predicate
 * answered `false` produced neither `expired` nor `unchecked`. That is the
 * fail-open shape this module exists to close, reintroduced one character at a
 * time. Captured whole, `ready!` fails {@link isWellFormedKey} and is reported
 * as unchecked, which is the honest answer for a commitment nothing evaluates.
 *
 * Note that this comment cannot SHOW the failing line: writing the marker with
 * an identifier after it is a commitment as far as the scanner is concerned,
 * and the sweep over the shipped tree reported this file the moment a draft of
 * it did. That is the guard working, so the example is named rather than
 * quoted.
 *
 * The capture is bounded rather than greedy: it is echoed into a report, and an
 * unbounded match on a minified line would put the rest of that line there. The
 * bound is 65 rather than 64 — one MORE than the longest well-formed key — so
 * an over-long token is captured at a length `WELL_FORMED_KEY` rejects. Cutting
 * at 64 would have turned a 200-character token into a valid-looking key.
 */
const MARKER_AND_TOKEN =
  /PLACEHOLDER-UNTIL:[^\S\n]*([A-Za-z0-9_-][^\s]{0,64}|(?=\r?\n)|$)/g;

/** A condition key is a plain slug, so a marker cannot smuggle a regex. */
const WELL_FORMED_KEY = /^[a-z0-9][a-z0-9-]{0,63}$/;

/**
 * Whether a token read after a marker is a usable condition key.
 * @param {string} key The token written after the marker.
 * @returns {boolean} True when it is a plain slug.
 */
export function isWellFormedKey(key) {
  return WELL_FORMED_KEY.test(key);
}

/**
 * The condition keys one source file declares.
 *
 * Malformed tokens are RETURNED, not filtered. They carry no predicate, so the
 * caller reports them as unchecked — which is the honest answer for a
 * commitment nothing can evaluate, and the one that keeps a typo from reading
 * as an absence.
 * @param {string} source The file's contents.
 * @returns {string[]} The keys, in order of appearance, deduplicated.
 */
export function placeholderKeys(source) {
  return [
    ...new Set(
      [...String(source).matchAll(MARKER_AND_TOKEN)].map(hit => hit[1] ?? "")
    ),
  ];
}

/**
 * Which placeholders have outlived their stated condition.
 *
 * Two failure modes, deliberately not collapsed: an EXPIRED placeholder is a
 * value that is now wrong, and an UNCHECKED one is a claim nothing can
 * evaluate. Reporting them the same way would let the second hide inside the
 * first's noise.
 * @param {object} options Inputs.
 * @param {Array<{file: string, source: string}>} options.files The sources to scan.
 * @param {Record<string, () => boolean>} options.conditions Own-property predicate per key, true when the condition has arrived.
 * @returns {{expired: Array<{file: string, key: string}>, unchecked: Array<{file: string, key: string}>}} What must be corrected.
 */
export function expiredPlaceholders({ files, conditions }) {
  const expired = [];
  const unchecked = [];
  for (const { file, source } of files) {
    for (const key of placeholderKeys(source)) {
      // `Object.hasOwn`, not a plain read. `constructor` is a legal slug under
      // the key pattern, so `conditions[key]` found `Object.prototype.constructor`
      // on the prototype chain, passed the `typeof` check, was CALLED, returned
      // a truthy object, and reported the placeholder expired. Same for
      // `valueOf` and `toString`. A predicate nobody declared is not a
      // predicate. A malformed key lands here too and has no own entry, so it
      // becomes `unchecked` rather than silently passing.
      const predicate = Object.hasOwn(conditions, key)
        ? conditions[key]
        : undefined;
      if (typeof predicate !== "function") {
        unchecked.push({ file, key });
        continue;
      }
      if (predicate()) expired.push({ file, key });
    }
  }
  return { expired, unchecked };
}
