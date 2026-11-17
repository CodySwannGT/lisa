// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/**
 * The `## Lisa Estimate` section a work item carries: a token range, the
 * matching dollar range, and a recommended model (CodySwannGT/lisa#4952,
 * #4954).
 *
 * One managed section per item, rewritten in place. The visible table is for
 * people; the single `<!-- lisa:estimate ... -->` token on its own line is what
 * machines read. Every agent renders and checks it through this module, so the
 * shape cannot drift between agents or trackers.
 * @module scripts/lib/work-item-estimate
 */
import {
  costCents,
  EstimateConfigError,
  priceFor,
} from "./work-item-estimate-config.mjs";

/**
 * @typedef {object} Estimate
 * @property {number} tokensLow - Low end of the token range.
 * @property {number} tokensHigh - High end of the token range.
 * @property {number | null} costLow - Low end of the dollar range, in cents.
 * @property {number | null} costHigh - High end of the dollar range, in cents.
 * @property {string | null} currency - ISO currency of the dollar range.
 * @property {string} pricingStatus - `estimated` or `missing`.
 * @property {string | null} pricingSource - Price table the range came from.
 * @property {string | null} model - Recommended model id or family.
 * @property {string | null} basis - How the estimate was reached.
 */

export const ESTIMATE_HEADING = "## Lisa Estimate";
const TOKEN_PATTERN = /<!-- lisa:estimate ((?:[a-z_]+=\S*\s+)+)-->/;
const MANAGED_NOTE =
  "_Managed by Lisa. Rewritten in place on each estimate or tally; do not edit by hand._";

const encode = value => (value === null ? "null" : encodeURIComponent(value));
const decode = value => (value === "null" ? null : decodeURIComponent(value));
const dollars = cents => (cents / 100).toFixed(2);

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
 * Parse a token count written as `2000000`, `2M`, `2.5m` or `500k`.
 * @param {string} text - Count as written.
 * @returns {number} Whole token count.
 */
export function parseTokenCount(text) {
  const match = /^(\d+(?:\.\d+)?)([kKmM]?)$/.exec(String(text).trim());
  if (!match)
    throw new EstimateConfigError(
      `${JSON.stringify(text)} is not a token count. Write it as 2000000, 2M or 500k.`
    );
  const scale = { "": 1, k: 1_000, m: 1_000_000 }[match[2].toLowerCase()];
  const tokens = Math.round(Number(match[1]) * scale);
  if (tokens < 1)
    throw new EstimateConfigError("A token estimate must be at least 1.");
  return tokens;
}

/**
 * Build an estimate from a token range and model, pricing it from config.
 * @param {{tokensLow: number, tokensHigh: number, model: string, basis?: string}} input - Estimate inputs.
 * @param {object} settings - Result of `resolveEstimateConfig`.
 * @returns {Estimate} The estimate record.
 */
export function buildEstimate(input, settings) {
  const { tokensLow, tokensHigh, model } = input;
  if (tokensLow > tokensHigh)
    throw new EstimateConfigError(
      `The low end (${tokensLow}) is above the high end (${tokensHigh}).`
    );
  if (!settings.models.includes(model))
    throw new EstimateConfigError(
      `Recommended model ${JSON.stringify(model)} is not in workItem.estimate.models: ${settings.models.join(", ")}.`
    );
  const price = priceFor(settings, model);
  return {
    tokensLow,
    tokensHigh,
    costLow: price
      ? costCents(tokensLow, price.rates, settings.tokenMix)
      : null,
    costHigh: price
      ? costCents(tokensHigh, price.rates, settings.tokenMix)
      : null,
    currency: price?.currency ?? null,
    pricingStatus: price ? "estimated" : "missing",
    pricingSource: price?.source ?? null,
    model,
    basis: input.basis?.trim() || "no calibration history",
  };
}

/**
 * Render the managed section for an estimate.
 * @param {Estimate} estimate - Result of {@link buildEstimate}.
 * @returns {string} Markdown section, ending in a newline.
 */
export function renderEstimateSection(estimate) {
  const cost =
    estimate.costLow === null
      ? "unpriced"
      : `$${dollars(estimate.costLow)}–$${dollars(estimate.costHigh)} ${estimate.currency}`;
  const fields = [
    `tokens_low=${estimate.tokensLow}`,
    `tokens_high=${estimate.tokensHigh}`,
    `cost_low=${estimate.costLow === null ? "null" : dollars(estimate.costLow)}`,
    `cost_high=${estimate.costHigh === null ? "null" : dollars(estimate.costHigh)}`,
    `currency=${encode(estimate.currency)}`,
    `pricing_status=${estimate.pricingStatus}`,
    `pricing_source=${encode(estimate.pricingSource)}`,
    `model=${encode(estimate.model)}`,
    `basis=${encode(estimate.basis)}`,
  ];
  return [
    ESTIMATE_HEADING,
    "",
    MANAGED_NOTE,
    "",
    "| Row | Tokens | Cost | Model |",
    "|---|---:|---:|---|",
    `| Estimate | ${formatTokens(estimate.tokensLow)}–${formatTokens(estimate.tokensHigh)} | ${cost} | ${estimate.model} |`,
    "",
    `Basis: ${estimate.basis}`,
    "",
    `<!-- lisa:estimate ${fields.join(" ")} -->`,
    "",
  ].join("\n");
}

/**
 * Locate every `## Lisa Estimate` section in a body.
 * @param {string} body - Item body.
 * @returns {{start: number, end: number}[]} Line spans, end exclusive.
 */
function estimateSpans(body) {
  const lines = body.split("\n");
  return lines.flatMap((line, index) => {
    if (line.trimEnd() !== ESTIMATE_HEADING) return [];
    const next = lines.findIndex(
      (other, at) => at > index && other.startsWith("## ")
    );
    return [{ start: index, end: next === -1 ? lines.length : next }];
  });
}

/**
 * Read the estimate token out of a section.
 * @param {string} section - Section text.
 * @returns {Estimate | null} Parsed estimate, or null when no token parses.
 */
function parseToken(section) {
  const match = TOKEN_PATTERN.exec(section);
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
  const cents = value =>
    value === "null" || value === undefined
      ? null
      : Math.round(Number(value) * 100);
  return {
    tokensLow: Number(fields.tokens_low),
    tokensHigh: Number(fields.tokens_high),
    costLow: cents(fields.cost_low),
    costHigh: cents(fields.cost_high),
    currency: decode(fields.currency ?? "null"),
    pricingStatus: fields.pricing_status,
    pricingSource: decode(fields.pricing_source ?? "null"),
    model: decode(fields.model ?? "null"),
    basis: decode(fields.basis ?? "null"),
  };
}

/**
 * Parse the item's estimate section.
 * @param {string} body - Item body.
 * @returns {{count: number, estimate: Estimate | null}} Section count and its parsed token.
 */
export function parseEstimateSection(body) {
  const spans = estimateSpans(body);
  if (spans.length !== 1) return { count: spans.length, estimate: null };
  const lines = body.split("\n").slice(spans[0].start, spans[0].end);
  return { count: 1, estimate: parseToken(lines.join("\n")) };
}

/**
 * Put the estimate section into a body, replacing an existing one in place.
 * @param {string} body - Item body.
 * @param {string} section - Rendered section.
 * @returns {string} Updated body.
 */
export function upsertEstimateSection(body, section) {
  const spans = estimateSpans(body);
  if (spans.length > 1)
    throw new EstimateConfigError(
      "The body has more than one Lisa Estimate section; remove the extra copies first."
    );
  const lines = body.split("\n");
  if (spans.length === 0) return `${body.trimEnd()}\n\n${section}`;
  const replaced = [
    ...lines.slice(0, spans[0].start),
    ...section.trimEnd().split("\n"),
    ...(spans[0].end < lines.length
      ? ["", ...lines.slice(spans[0].end)]
      : [""]),
  ];
  return replaced.join("\n");
}
