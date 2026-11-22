// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/** Per-million-token rates for one model. */
export interface EstimateRates {
  readonly inputPer1M?: number;
  readonly cachedInputPer1M?: number;
  readonly outputPer1M?: number;
}
/** Shares of an estimate billed at each rate; they add up to 1. */
export interface EstimateTokenMix {
  readonly input: number;
  readonly cachedInput: number;
  readonly output: number;
}
/** The effective `workItem.estimate` settings for a project. */
export interface EstimateSettings {
  readonly required: boolean;
  readonly warnings: readonly string[];
  readonly models: readonly string[];
  readonly tokenMix: EstimateTokenMix;
  readonly usagePricing: unknown;
}
/** Recommended-model values a project gets when it does not list its own. */
export declare const DEFAULT_ESTIMATE_MODELS: readonly string[];
/** The `workItem.estimate` value `lisa sync` writes into a host config. */
export declare const DEFAULT_WORK_ITEM_ESTIMATE: Readonly<{
  required: true;
  models: readonly string[];
}>;
/** Default token mix: mostly cached input. */
export declare const DEFAULT_TOKEN_MIX: EstimateTokenMix;
/** Shipped default price table (Anthropic API list prices). */
export declare const DEFAULT_ESTIMATE_PRICING: Readonly<{
  currency: string;
  source: string;
  snapshot: string;
  models: Readonly<Record<string, EstimateRates>>;
}>;
/** A configuration value that cannot be used. */
export declare class EstimateConfigError extends Error {}
/** Validate a `workItem.estimate` value; throws when it cannot be used. */
export declare function validateEstimateConfig(value: unknown): object;
/** The effective estimate settings for a merged Lisa config. */
export declare function resolveEstimateConfig(
  config: unknown
): EstimateSettings;
/** The price that covers a model, or null when unpriced. */
export declare function priceFor(
  settings: EstimateSettings,
  model: string
): { rates: EstimateRates; currency: string; source: string } | null;
/** Dollar cost of a token count, in whole cents. */
export declare function costCents(
  tokens: number,
  rates: EstimateRates,
  mix: EstimateTokenMix
): number;
