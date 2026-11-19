// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/**
 * The actual-spend lines of the `## Lisa Estimate` section
 * (CodySwannGT/lisa#4956): the `Actual` row, its note and the
 * `<!-- lisa:estimate-actual ... -->` token, rendered and read back.
 *
 * Reading the token back lets the section tell exactly which of its lines
 * Lisa wrote: re-rendering the recorded actual reproduces them, so anything
 * else is a person's text, kept on rewrite and counted in the specification.
 * @module scripts/lib/work-item-estimate-actual
 */

const ACTUAL_PATTERN = /<!-- lisa:estimate-actual ((?:[a-z_]+=\S*\s+)+)-->/;

/**
 * @typedef {object} Actual
 * @property {number | null} tokens - Complete token total, or null when unknown.
 * @property {number | null} cost - Total cost, or null when unknown.
 * @property {string | null} currency - Cost currency.
 * @property {string[]} sources - Distinct usage `source` values behind the total.
 * @property {number} entries - Usage entries the total covers.
 */

/**
 * Human-readable token count: 2000000 -> "2M", 1500 -> "1.5k".
 * @param {number} tokens - Token count.
 * @returns {string} Short form.
 */
export function formatTokens(tokens) {
  const short = (value, unit) =>
    `${Number(value.toFixed(2)).toString()}${unit}`;
  if (tokens >= 1_000_000) return short(tokens / 1_000_000, "M");
  if (tokens >= 1_000) return short(tokens / 1_000, "k");
  return String(tokens);
}

/**
 * Render the actual row, note and token.
 * @param {Actual} actual - Actual spend.
 * @param {{tokensLow: number, tokensHigh: number} | null} estimate - Parsed estimate, if any.
 * @returns {{row: string, note: string, token: string}} Rendered parts.
 */
export function renderActual(actual, estimate) {
  const midpoint = estimate
    ? (estimate.tokensLow + estimate.tokensHigh) / 2
    : null;
  const ratio =
    actual.tokens !== null && midpoint
      ? Number((actual.tokens / midpoint).toFixed(2))
      : null;
  const tokens =
    actual.tokens === null ? "unknown" : formatTokens(actual.tokens);
  const cost =
    actual.cost === null
      ? "unknown"
      : `$${actual.cost.toFixed(2)} ${actual.currency ?? ""}`.trim();
  const fields = [
    `tokens=${actual.tokens ?? "null"}`,
    `cost=${actual.cost ?? "null"}`,
    `currency=${actual.currency === null ? "null" : encodeURIComponent(actual.currency)}`,
    `sources=${encodeURIComponent(actual.sources.join(","))}`,
    `entries=${actual.entries}`,
    `ratio=${ratio ?? "null"}`,
  ];
  const comparison =
    ratio === null ? "" : `; ${ratio}x the estimate's midpoint`;
  return {
    row: `| Actual | ${tokens} | ${cost} | — |`,
    note: `Actual: the Lisa Usage ledger total over ${actual.entries} usage entr${actual.entries === 1 ? "y" : "ies"} (source: ${actual.sources.join(", ")})${comparison}.`,
    token: `<!-- lisa:estimate-actual ${fields.join(" ")} -->`,
  };
}

/**
 * The raw fields of the actual token recorded in a section.
 * @param {string | null} section - Estimate section text.
 * @returns {Record<string, string> | null} Fields as written, or null when there is no token.
 */
export function actualTokenFields(section) {
  const match = section ? ACTUAL_PATTERN.exec(section) : null;
  if (!match) return null;
  return Object.fromEntries(
    match[1]
      .trim()
      .split(/\s+/)
      .map(pair => [
        pair.slice(0, pair.indexOf("=")),
        pair.slice(pair.indexOf("=") + 1),
      ])
  );
}

/**
 * The actual recorded in a section, read back from its token.
 * @param {string | null} section - Estimate section text.
 * @returns {Actual | null} The recorded actual, or null when none parses.
 */
export function parseActualToken(section) {
  const fields = actualTokenFields(section);
  if (!fields) return null;
  const number = value =>
    value === undefined || value === "null" ? null : Number(value);
  const tokens = number(fields.tokens);
  const cost = number(fields.cost);
  const entries = Number(fields.entries);
  if (
    [tokens, cost].some(value => value !== null && !Number.isFinite(value)) ||
    !Number.isSafeInteger(entries)
  )
    return null;
  try {
    return {
      tokens,
      cost,
      currency:
        fields.currency === undefined || fields.currency === "null"
          ? null
          : decodeURIComponent(fields.currency),
      sources: decodeURIComponent(fields.sources ?? "")
        .split(",")
        .filter(Boolean),
      entries,
    };
  } catch (error) {
    // A malformed percent escape makes the token unparseable, not the caller.
    if (error instanceof URIError) return null;
    throw error;
  }
}
