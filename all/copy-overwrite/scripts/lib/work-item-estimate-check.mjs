// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/**
 * The work-item estimate gate (CodySwannGT/lisa#4954): validator gate S21.
 *
 * It runs at ready time. An estimate is not required when an item is created
 * or made ready, because deterministic sources (Sentry, New Relic, monitors)
 * cannot produce one; the claim step writes it before work begins. What this
 * gate refuses is an estimate that is present but wrong: unparseable, an
 * inverted range, a model the project does not allow, a dollar range that is
 * not a sound range of its own, or one that disagrees with the price table it
 * names. When `workItem.estimate.required`
 * is false the gate is `N/A` and blocks nothing.
 * @module scripts/lib/work-item-estimate-check
 */
import { costCents, priceFor } from "./work-item-estimate-config.mjs";
import { parseEstimateSection } from "./work-item-estimate.mjs";

const PHASES = new Set(["ready"]);

/**
 * Problems with a parsed estimate's own fields.
 * @param {object} estimate - Parsed estimate.
 * @param {object} settings - Effective estimate settings.
 * @returns {string[]} Problems, empty when the fields are sound.
 */
function fieldProblems(estimate, settings) {
  const { tokensLow, tokensHigh, model } = estimate;
  const whole = value => Number.isSafeInteger(value) && value >= 1;
  return [
    ...(whole(tokensLow) && whole(tokensHigh)
      ? []
      : ["The token range must be two whole numbers of at least 1."]),
    ...(tokensLow > tokensHigh
      ? [`The low end (${tokensLow}) is above the high end (${tokensHigh}).`]
      : []),
    ...(settings.models.includes(model)
      ? []
      : [
          `Recommended model ${JSON.stringify(model)} is not in workItem.estimate.models: ${settings.models.join(", ")}.`,
        ]),
  ];
}

/**
 * Problems a priced dollar range has on its own, whichever price table it
 * names: each end a finite amount of at least zero, the low end not above the
 * high end, and an ISO 4217 currency code.
 * @param {object} estimate - Parsed estimate carrying both ends and a currency.
 * @returns {string[]} Problems, empty when the range is sound.
 */
function rangeProblems(estimate) {
  const { costLow, costHigh, currency } = estimate;
  const amount = cents => Number.isFinite(cents) && cents >= 0;
  if (!amount(costLow) || !amount(costHigh))
    return ["The dollar range must be two finite amounts of at least 0."];
  return [
    ...(costLow > costHigh
      ? [
          `The low cost (${(costLow / 100).toFixed(2)}) is above the high cost (${(costHigh / 100).toFixed(2)}).`,
        ]
      : []),
    ...(/^[A-Z]{3}$/.test(currency)
      ? []
      : [
          `The currency ${JSON.stringify(currency)} is not a three-letter ISO 4217 code such as USD.`,
        ]),
  ];
}

/**
 * Problems with a parsed estimate's dollar range.
 * @param {object} estimate - Parsed estimate.
 * @param {object} settings - Effective estimate settings.
 * @returns {string[]} Problems, empty when the dollar range is sound.
 */
function pricingProblems(estimate, settings) {
  if (estimate.pricingStatus === "missing")
    return estimate.costLow === null && estimate.costHigh === null
      ? []
      : [
          "An unpriced estimate (pricing_status=missing) must not carry a dollar range.",
        ];
  if (estimate.pricingStatus !== "estimated")
    return [
      `pricing_status must be estimated or missing, not ${JSON.stringify(estimate.pricingStatus)}.`,
    ];
  if (
    estimate.costLow === null ||
    estimate.costHigh === null ||
    !estimate.currency
  )
    return ["A priced estimate needs a dollar range and a currency."];
  const ownProblems = rangeProblems(estimate);
  if (ownProblems.length) return ownProblems;
  const price = priceFor(settings, estimate.model);
  // A price table that has moved on since the estimate was written is not a
  // defect in the item; only a range that disagrees with its own table is.
  if (!price || price.source !== estimate.pricingSource) return [];
  const low = costCents(estimate.tokensLow, price.rates, settings.tokenMix);
  const high = costCents(estimate.tokensHigh, price.rates, settings.tokenMix);
  return low === estimate.costLow &&
    high === estimate.costHigh &&
    estimate.currency === price.currency
    ? []
    : [
        `The dollar range does not match ${price.source}: expected ${(low / 100).toFixed(2)}–${(high / 100).toFixed(2)} ${price.currency}. Re-render it with lisa-estimate render.`,
      ];
}

/**
 * Run the estimate gate on an item body.
 * @param {string} body - Item body as stored.
 * @param {object} settings - Result of `resolveEstimateConfig`.
 * @param {string} [phase] - Lifecycle moment; only `ready` exists so far.
 * @returns {{verdict: "PASS" | "FAIL" | "N/A", lines: string[]}} Gate result.
 */
export function checkEstimate(body, settings, phase = "ready") {
  if (!PHASES.has(phase))
    throw new RangeError(
      `Unknown phase ${JSON.stringify(phase)}; expected ready.`
    );
  const warnings = settings.warnings ?? [];
  if (!settings.required)
    return {
      verdict: "N/A",
      lines: ["workItem.estimate.required is false; no estimate is required."],
    };
  const { count, estimate } = parseEstimateSection(body);
  if (count > 1)
    return {
      verdict: "FAIL",
      lines: [
        ...warnings,
        `The body has ${count} Lisa Estimate sections; keep exactly one.`,
      ],
    };
  if (count === 0)
    return {
      verdict: "PASS",
      lines: [
        ...warnings,
        "No estimate yet. That is allowed until the item is claimed: the claiming agent estimates it and writes it before any work begins.",
      ],
    };
  if (!estimate)
    return {
      verdict: "FAIL",
      lines: [
        ...warnings,
        "The Lisa Estimate section has no parseable <!-- lisa:estimate ... --> token. Re-render it with lisa-estimate render.",
      ],
    };
  const problems = [
    ...fieldProblems(estimate, settings),
    ...pricingProblems(estimate, settings),
  ];
  return problems.length
    ? { verdict: "FAIL", lines: [...warnings, ...problems] }
    : { verdict: "PASS", lines: [...warnings, "The estimate is well formed."] };
}
