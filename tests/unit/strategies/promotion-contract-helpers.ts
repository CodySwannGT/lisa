/**
 * Shared helpers for the promotion-contract (LLG-7, #1736) and gardener
 * (LLG-6, #1735) prose-contract suites.
 *
 * The promotion-contract rule pair carries a delimited AC-template snippet
 * that the gardener embeds verbatim into EXECUTABLE-CONTROL promotion
 * tickets. Both suites need to extract that snippet byte-for-byte, so the
 * extraction lives here rather than in either test file (importing a test
 * module from another test would re-register its suites).
 * @module tests/unit/strategies/promotion-contract-helpers
 */

/** Opening delimiter of the AC-template snippet in the reference rule. */
export const AC_TEMPLATE_START =
  "<!-- promotion-contract-ac-template:start -->";

/** Closing delimiter of the AC-template snippet in the reference rule. */
export const AC_TEMPLATE_END = "<!-- promotion-contract-ac-template:end -->";

/**
 * Extracts the delimited AC-template snippet from a promotion-contract rule
 * body so the gardener's verbatim embedding can be asserted byte-for-byte.
 * @param body Full markdown body of a promotion-contract reference rule.
 * @returns The template text between the start/end markers, inclusive.
 */
export function extractAcTemplate(body: string): string {
  const start = body.indexOf(AC_TEMPLATE_START);
  const end = body.indexOf(AC_TEMPLATE_END);
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("promotion-contract AC template markers not found");
  }
  const result = body.slice(start, end + AC_TEMPLATE_END.length);
  return result;
}
