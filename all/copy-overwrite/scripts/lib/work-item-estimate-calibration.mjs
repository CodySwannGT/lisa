// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/**
 * Calibrate a new token estimate against finished work (CodySwannGT/lisa#4955).
 *
 * For each comparable finished item that carries both an estimate and a
 * complete actual, the ratio is the actual token total over the estimate's
 * midpoint. The actual is the item's recorded done tally, which counted every
 * usage ledger it carried, comments included; an item finished before tallies
 * were recorded falls back to its body's `## Lisa Usage` ledger. The median ratio scales the new range. Items whose
 * actual is unknown or partial (no ledger, or any run with `unavailable`
 * telemetry or a measured subset) are skipped, never counted as zero or as the
 * sum of only the known runs. With no usable history the range is
 * returned unchanged and the basis says so.
 * @module scripts/lib/work-item-estimate-calibration
 */
import { EstimateConfigError } from "./work-item-estimate-config.mjs";
import { parseActualToken } from "./work-item-estimate-actual.mjs";
import { parseEstimateSection } from "./work-item-estimate.mjs";
import { ledgerActual } from "./work-item-estimate-tally.mjs";

/**
 * Whether a parsed token count is a usable positive number (NaN is not).
 * @param {number} value - Parsed count.
 * @returns {boolean} True for a finite count above zero.
 */
const isPositive = value => Number.isFinite(value) && value > 0;

/**
 * The actual-to-estimate ratio one finished item shows, if it shows one.
 * @param {string} body - Finished item body.
 * @returns {number | null} Ratio, or null when the item cannot calibrate.
 */
export function itemRatio(body) {
  const { estimate, section } = parseEstimateSection(body);
  if (
    !estimate ||
    !isPositive(estimate.tokensLow) ||
    !isPositive(estimate.tokensHigh)
  )
    return null;
  // The done tally already counted every ledger the item carried, comments
  // included, which a history fetch of bodies never sees. Trust its recorded
  // actual (an unknown one stays unknown); read the body's ledger only for an
  // item finished before tallies were recorded.
  const recorded = parseActualToken(section);
  const actual = recorded
    ? recorded.tokens
    : (ledgerActual([body])?.tokens ?? null);
  if (actual === null || !isPositive(actual)) return null;
  return actual / ((estimate.tokensLow + estimate.tokensHigh) / 2);
}

/**
 * Median of a non-empty list of numbers.
 * @param {number[]} values - Values.
 * @returns {number} Median.
 */
function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * Calibrate a proposed range against comparable finished items.
 * @param {{tokensLow: number, tokensHigh: number}} proposed - The agent's first estimate.
 * @param {string[]} bodies - Bodies of comparable finished items.
 * @returns {{comparable: number, ratio: number | null, tokensLow: number, tokensHigh: number, basis: string}} Calibrated range.
 */
export function calibrateEstimate(proposed, bodies) {
  if (proposed.tokensLow > proposed.tokensHigh)
    throw new EstimateConfigError(
      `The low end (${proposed.tokensLow}) is above the high end (${proposed.tokensHigh}).`
    );
  const ratios = bodies.map(itemRatio).filter(ratio => ratio !== null);
  if (ratios.length === 0)
    return {
      comparable: 0,
      ratio: null,
      tokensLow: proposed.tokensLow,
      tokensHigh: proposed.tokensHigh,
      basis: `no calibration history (${bodies.length} item(s) read, none with both an estimate and a complete actual)`,
    };
  const ratio = median(ratios);
  const rounded = Number(ratio.toFixed(2));
  return {
    comparable: ratios.length,
    ratio: rounded,
    tokensLow: Math.max(1, Math.round(proposed.tokensLow * ratio)),
    tokensHigh: Math.max(1, Math.round(proposed.tokensHigh * ratio)),
    basis: `calibrated x${rounded} (median actual/estimate) from ${ratios.length} comparable finished item(s)`,
  };
}

/**
 * Item bodies from a history file: a JSON array of strings, or of objects with
 * a `body` (the shape `gh issue list --json body` prints).
 * @param {unknown} history - Parsed JSON.
 * @returns {string[]} Bodies.
 */
export function historyBodies(history) {
  if (!Array.isArray(history))
    throw new SyntaxError(
      "The history file must hold a JSON array of item bodies or of objects with a body."
    );
  return history.flatMap(item => {
    if (typeof item === "string") return [item];
    return typeof item?.body === "string" ? [item.body] : [];
  });
}
