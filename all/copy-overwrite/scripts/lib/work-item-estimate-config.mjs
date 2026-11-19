// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/**
 * Configuration and pricing for work-item token estimates
 * (CodySwannGT/lisa#4952, #4954).
 *
 * `workItem.estimate` in `.lisa.config.json` decides whether every work item
 * must carry a token estimate and which recommended-model values are allowed.
 * It is required by default: an absent key means `required: true`, and a value
 * that is present but not a boolean fails safe to `true`, the stricter option.
 *
 * Dollar figures come from `usage.pricing` (the existing pricing key the
 * usage-accounting contract reads) when it prices the model, and otherwise from
 * {@link DEFAULT_ESTIMATE_PRICING}: Anthropic's published first-party API list
 * prices. A model neither table prices gets no dollar figure, never a guess.
 * @module scripts/lib/work-item-estimate-config
 */

/** Recommended-model values a project gets when it does not list its own. */
export const DEFAULT_ESTIMATE_MODELS = Object.freeze([
  "claude-fable-5-2",
  "claude-opus-5-5",
  "claude-sonnet-5-5",
  "claude-haiku-5-5",
  "fable",
  "opus",
  "sonnet",
  "haiku",
]);

/** The `workItem.estimate` value `lisa sync` writes into a host config. */
export const DEFAULT_WORK_ITEM_ESTIMATE = Object.freeze({
  required: true,
  models: DEFAULT_ESTIMATE_MODELS,
});

/**
 * Share of an estimate's tokens billed at each rate. Agent work rereads its
 * context far more than it writes, so most tokens are cached input. This is an
 * assumption, not a measurement: a project overrides it with
 * `workItem.estimate.tokenMix`, and calibration against actual cost corrects
 * it over time.
 */
export const DEFAULT_TOKEN_MIX = Object.freeze({
  input: 0.1,
  cachedInput: 0.85,
  output: 0.05,
});

const rates = (inputPer1M, cachedInputPer1M, outputPer1M) =>
  Object.freeze({ inputPer1M, cachedInputPer1M, outputPer1M });
const FABLE = rates(8, 0.2, 40);
const OPUS = rates(4, 0.2, 20);
const SONNET = rates(2, 0.1, 10);
// Haiku's cache-read price is not listed with the others; 0.1x the input
// price is the standard cache-read multiplier.
const HAIKU = rates(0.1, 0.01, 0.5);

/**
 * Shipped default price table, in USD per million tokens. Source: Anthropic's
 * first-party API list prices as published in the Claude API reference on
 * 2026-11-03 (Bedrock and Vertex AI bill separately). A family name is priced
 * as the current model of that family.
 */
export const DEFAULT_ESTIMATE_PRICING = Object.freeze({
  currency: "USD",
  source: "anthropic-api-list-prices",
  snapshot: "2026-11-03",
  models: Object.freeze({
    "anthropic/claude-fable-5-2": FABLE,
    "anthropic/claude-opus-5-5": OPUS,
    "anthropic/claude-sonnet-5-5": SONNET,
    "anthropic/claude-haiku-5-5": HAIKU,
    "anthropic/fable": FABLE,
    "anthropic/opus": OPUS,
    "anthropic/sonnet": SONNET,
    "anthropic/haiku": HAIKU,
  }),
});

/** A configuration value that cannot be used. */
export class EstimateConfigError extends Error {}

const isPlainObject = value =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/**
 * Validate the allowed recommended-model list.
 * @param {unknown} models - Configured list.
 * @returns {readonly string[]} The list, unchanged.
 */
function validModels(models) {
  const valid =
    Array.isArray(models) &&
    models.length > 0 &&
    models.every(model => typeof model === "string" && /^\S+$/.test(model));
  if (!valid)
    throw new EstimateConfigError(
      "workItem.estimate.models must be a non-empty list of model ids or family names without spaces."
    );
  return models;
}

/**
 * Validate the token mix: three shares that add up to 1.
 * @param {unknown} mix - Configured mix.
 * @returns {{input: number, cachedInput: number, output: number}} The mix.
 */
function validMix(mix) {
  const keys = ["input", "cachedInput", "output"];
  const valid =
    isPlainObject(mix) &&
    keys.every(key => Number.isFinite(mix[key]) && mix[key] >= 0) &&
    Math.abs(keys.reduce((sum, key) => sum + mix[key], 0) - 1) < 0.001;
  if (!valid)
    throw new EstimateConfigError(
      "workItem.estimate.tokenMix must give input, cachedInput and output shares that add up to 1."
    );
  return mix;
}

/**
 * Validate a `workItem.estimate` value, as `lisa sync` does before keeping it.
 * @param {unknown} value - Configured value.
 * @returns {object} The value, unchanged.
 */
export function validateEstimateConfig(value) {
  if (!isPlainObject(value))
    throw new EstimateConfigError("workItem.estimate must be an object.");
  if (value.required !== undefined && typeof value.required !== "boolean")
    throw new EstimateConfigError(
      "workItem.estimate.required must be true or false."
    );
  if (value.models !== undefined) validModels(value.models);
  if (value.tokenMix !== undefined) validMix(value.tokenMix);
  return value;
}

/**
 * The effective estimate settings for a project.
 * @param {object} config - Merged Lisa config.
 * @returns {{required: boolean, warnings: string[], models: readonly string[], tokenMix: object, usagePricing: unknown}} Settings.
 */
export function resolveEstimateConfig(config) {
  const raw = config?.workItem?.estimate;
  const estimate = isPlainObject(raw) ? raw : {};
  const invalidRequired =
    estimate.required !== undefined && typeof estimate.required !== "boolean";
  return {
    required: invalidRequired ? true : estimate.required !== false,
    warnings: invalidRequired
      ? [
          `workItem.estimate.required is ${JSON.stringify(estimate.required)}, not true or false; treating it as true, the stricter option.`,
        ]
      : [],
    models: validModels(estimate.models ?? DEFAULT_ESTIMATE_MODELS),
    tokenMix: validMix(estimate.tokenMix ?? DEFAULT_TOKEN_MIX),
    usagePricing: config?.usage?.pricing,
  };
}

/**
 * The estimate gate's settings, tolerating settings the gate never reads: a
 * project that turned the gate off (`required: false`) gets the disabled gate
 * even when its `models` or `tokenMix` would not validate, so a disabled gate
 * can never refuse anything. With the gate on, unusable settings still throw.
 * @param {unknown} config - Project config (`.lisa.config.json` content).
 * @returns {{required: boolean, warnings: string[]}} Settings for `checkEstimate`.
 */
export function resolveEstimateGate(config) {
  try {
    return resolveEstimateConfig(config);
  } catch (error) {
    if (
      error instanceof EstimateConfigError &&
      config?.workItem?.estimate?.required === false
    )
      return { required: false, warnings: [] };
    throw error;
  }
}

/**
 * Find a model's rates in one price table. Keys are `<provider>/<model>`, as
 * in the usage-accounting pricing schema; a bare `<model>` key also matches.
 * @param {unknown} table - A pricing object with `models`.
 * @param {string} model - Model id or family.
 * @returns {object | undefined} Rates, when the table prices the model.
 */
function ratesIn(table, model) {
  if (!isPlainObject(table?.models)) return undefined;
  const key = Object.keys(table.models).find(
    name => name === model || name.split("/").slice(1).join("/") === model
  );
  return key === undefined ? undefined : table.models[key];
}

/**
 * The price source that covers a model: configured pricing first, then the
 * shipped default.
 * @param {object} settings - Result of {@link resolveEstimateConfig}.
 * @param {string} model - Model id or family.
 * @returns {{rates: object, currency: string, source: string} | null} Price, or null when unpriced.
 */
export function priceFor(settings, model) {
  const tables = [settings.usagePricing, DEFAULT_ESTIMATE_PRICING];
  const table = tables.find(candidate => ratesIn(candidate, model));
  if (!table) return null;
  const snapshot = table.snapshot ? `@${table.snapshot}` : "";
  return {
    rates: ratesIn(table, model),
    currency: table.currency ?? "USD",
    source: `${table.source ?? "usage.pricing"}${snapshot}`,
  };
}

/**
 * Dollar cost of a token count, in whole cents, under a price and mix.
 * @param {number} tokens - Token count.
 * @param {object} rates - Per-million rates.
 * @param {object} mix - Token mix.
 * @returns {number} Cost in cents.
 */
export function costCents(tokens, rates, mix) {
  const blendedPer1M =
    mix.input * (rates.inputPer1M ?? 0) +
    mix.cachedInput * (rates.cachedInputPer1M ?? rates.inputPer1M ?? 0) +
    mix.output * (rates.outputPer1M ?? 0);
  return Math.round(((tokens * blendedPer1M) / 1_000_000) * 100);
}
