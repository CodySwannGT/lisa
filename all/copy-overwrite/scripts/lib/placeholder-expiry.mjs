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

/** Condition keys are plain slugs, so a marker cannot smuggle a regex. */
const KEY = /PLACEHOLDER-UNTIL:\s*([a-z0-9][a-z0-9-]{0,63})/g;

/**
 * The condition keys one source file declares.
 * @param {string} source The file's contents.
 * @returns {string[]} The keys, in order of appearance, deduplicated.
 */
export function placeholderKeys(source) {
  return [
    ...new Set(
      [...String(source).matchAll(KEY)].flatMap(hit =>
        hit[1] === undefined ? [] : [hit[1]]
      )
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
 * @param {Record<string, () => boolean>} options.conditions Predicate per key, true when the condition has arrived.
 * @returns {{expired: Array<{file: string, key: string}>, unchecked: Array<{file: string, key: string}>}} What must be corrected.
 */
export function expiredPlaceholders({ files, conditions }) {
  const expired = [];
  const unchecked = [];
  for (const { file, source } of files) {
    for (const key of placeholderKeys(source)) {
      const predicate = conditions[key];
      if (typeof predicate !== "function") {
        unchecked.push({ file, key });
        continue;
      }
      if (predicate()) expired.push({ file, key });
    }
  }
  return { expired, unchecked };
}
