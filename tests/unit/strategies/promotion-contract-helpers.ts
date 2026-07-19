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

/** Opening delimiter of the gardener's CONFIRM/RETIRE batch-ticket template. */
export const BATCH_TEMPLATE_START =
  "<!-- gardener-batch-ticket-template:start -->";

/** Closing delimiter of the gardener's CONFIRM/RETIRE batch-ticket template. */
export const BATCH_TEMPLATE_END = "<!-- gardener-batch-ticket-template:end -->";

/**
 * Extracts a delimited snippet (markers inclusive) from a markdown body so
 * verbatim embedding can be asserted byte-for-byte.
 * @param body Full markdown body carrying the delimited snippet.
 * @param startMarker Opening delimiter.
 * @param endMarker Closing delimiter.
 * @returns The snippet between the markers, inclusive.
 */
function extractDelimited(
  body: string,
  startMarker: string,
  endMarker: string
): string {
  const start = body.indexOf(startMarker);
  const end = body.indexOf(endMarker);
  if (start === -1 || end === -1 || end <= start) {
    throw new Error(`delimited template not found: ${startMarker}`);
  }
  const result = body.slice(start, end + endMarker.length);
  return result;
}

/**
 * Extracts the delimited AC-template snippet from a promotion-contract rule
 * body so the gardener's verbatim embedding can be asserted byte-for-byte.
 * @param body Full markdown body of a promotion-contract reference rule.
 * @returns The template text between the start/end markers, inclusive.
 */
export function extractAcTemplate(body: string): string {
  const result = extractDelimited(body, AC_TEMPLATE_START, AC_TEMPLATE_END);
  return result;
}

/**
 * Extracts the gardener's delimited CONFIRM/RETIRE batch-ticket execution
 * contract so its cross-fan-out byte-identity can be asserted.
 * @param body Full markdown body of a lisa-learnings-audit SKILL.md.
 * @returns The template text between the start/end markers, inclusive.
 */
export function extractBatchTemplate(body: string): string {
  const result = extractDelimited(
    body,
    BATCH_TEMPLATE_START,
    BATCH_TEMPLATE_END
  );
  return result;
}
