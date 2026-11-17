// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/**
 * The completion tally: actual tokens and dollar cost next to the estimate
 * (CodySwannGT/lisa#4956).
 *
 * The actual is the work item's `## Lisa Usage` rollup, the existing ledger
 * every agent already records its spend into; there is no second ledger. A
 * rollup whose total is unknown (`unavailable` telemetry, a measured subset)
 * is shown as unknown, never as zero and never as a guess. The tally is
 * written into the `## Lisa Estimate` section as an `Actual` row plus one
 * `<!-- lisa:estimate-actual ... -->` token, and the done gate checks that the
 * recorded tally still matches the ledger.
 * @module scripts/lib/work-item-estimate-tally
 */
import { parseLisaUsageSection } from "./usage-ledger.mjs";
import { EstimateConfigError } from "./work-item-estimate-config.mjs";
import {
  formatTokens,
  parseEstimateSection,
  renderEstimateSection,
  upsertEstimateSection,
} from "./work-item-estimate.mjs";

const ACTUAL_PATTERN = /<!-- lisa:estimate-actual ((?:[a-z_]+=\S*\s+)+)-->/;
const NO_LEDGER =
  "No Lisa Usage entry is recorded on this item. It cannot reach done without one: record each run through lisa-usage-accounting (source unavailable is the honest value when the runtime gives no telemetry), then run lisa-estimate tally.";

/**
 * @typedef {object} Actual
 * @property {number | null} tokens - Complete token total, or null when unknown.
 * @property {number | null} cost - Total cost, or null when unknown.
 * @property {string | null} currency - Cost currency.
 * @property {string[]} sources - Distinct usage `source` values behind the total.
 * @property {number} entries - Usage entries the total covers.
 */

/**
 * The actual spend from the first readable usage ledger with entries.
 * @param {string[]} documents - Item body, then its comments.
 * @returns {Actual | null} The actual, or null when no ledger has an entry.
 */
export function ledgerActual(documents) {
  for (const document of documents) {
    if (typeof document !== "string" || !document.includes("## Lisa Usage"))
      continue;
    let parsed;
    try {
      parsed = parseLisaUsageSection(document);
    } catch {
      continue;
    }
    const { entries, rollup } = parsed;
    if (entries.length === 0 || !rollup) continue;
    return {
      tokens: rollup.childTokensIncomplete ? null : rollup.totalTokens,
      cost: rollup.totalCost,
      currency: rollup.currency,
      sources: [...new Set(entries.map(entry => entry.source))].sort(),
      entries: rollup.directEntryIds.length + rollup.childEntryIds.length,
    };
  }
  return null;
}

/**
 * Render the actual row, note and token.
 * @param {Actual} actual - Actual spend.
 * @param {object | null} estimate - Parsed estimate, if any.
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
 * Rewrite the estimate section with the actual from the usage ledger.
 * @param {string} body - Item body.
 * @param {string[]} [documents] - Where the ledger may live: the body, then comments.
 * @returns {string} Updated body.
 */
export function tallyEstimate(body, documents = [body]) {
  const actual = ledgerActual(documents);
  if (!actual) throw new EstimateConfigError(NO_LEDGER);
  const { count, estimate } = parseEstimateSection(body);
  if (count > 1)
    throw new EstimateConfigError(
      "The body has more than one Lisa Estimate section; remove the extra copies first."
    );
  return upsertEstimateSection(
    body,
    renderEstimateSection(estimate, renderActual(actual, estimate))
  );
}

/**
 * The actual tally recorded in a section.
 * @param {string | null} section - Estimate section text.
 * @returns {{tokens: string, cost: string, currency: string} | null} Raw recorded fields.
 */
function recordedActual(section) {
  const match = section ? ACTUAL_PATTERN.exec(section) : null;
  if (!match) return null;
  const fields = Object.fromEntries(
    match[1]
      .trim()
      .split(/\s+/)
      .map(pair => [
        pair.slice(0, pair.indexOf("=")),
        pair.slice(pair.indexOf("=") + 1),
      ])
  );
  return {
    tokens: fields.tokens,
    cost: fields.cost,
    currency: decodeURIComponent(fields.currency ?? "null"),
  };
}

/**
 * Why an item may not reach done yet, from the estimate's point of view.
 * @param {string} body - Item body.
 * @param {string[]} [documents] - Where the ledger may live: the body, then comments.
 * @returns {string[]} Problems; empty when done may proceed.
 */
export function doneProblems(body, documents = [body]) {
  const actual = ledgerActual(documents);
  if (!actual) return [NO_LEDGER];
  const { count, section } = parseEstimateSection(body);
  if (count > 1)
    return [`The body has ${count} Lisa Estimate sections; keep exactly one.`];
  const recorded = recordedActual(section);
  if (!recorded)
    return [
      "The estimate does not yet show the actual tokens and cost. Run lisa-estimate tally and write the body back.",
    ];
  const current = {
    tokens: String(actual.tokens ?? "null"),
    cost: String(actual.cost ?? "null"),
    currency: actual.currency ?? "null",
  };
  return recorded.tokens === current.tokens &&
    recorded.cost === current.cost &&
    recorded.currency === current.currency
    ? []
    : [
        `The actual tally is stale: it records ${recorded.tokens} tokens and ${recorded.cost} ${recorded.currency}, but the usage ledger now totals ${current.tokens} tokens and ${current.cost} ${current.currency}. Run lisa-estimate tally again.`,
      ];
}
