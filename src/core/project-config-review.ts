/** Provider-neutral persisted review policy; adapter validation stays at execution. */
import type { JsonValue } from "../sync/json-path.js";

/** Providers are open strings at the storage boundary; the adapter registry resolves them. */
export interface ReviewConfig {
  readonly providers?: readonly string[];
  readonly requiredProviders?: readonly string[];
  readonly minimumCount?: number;
  readonly minimumHumanApprovals?: number;
  readonly adapters?: Readonly<Record<string, JsonValue>>;
  readonly holdLabels?: readonly string[];
}

/**
 * Validate persisted shape without claiming an uninstalled adapter exists.
 * @param value Persisted review policy.
 * @returns Validated JSON configuration.
 */
export function validateReviewConfig(value: unknown): JsonValue {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("review must be an object");
  }
  const review = value as Record<string, JsonValue>;
  for (const key of ["providers", "requiredProviders", "holdLabels"]) {
    validateList(review[key], key);
  }
  for (const key of ["minimumCount", "minimumHumanApprovals"]) {
    const count = review[key];
    if (
      count !== undefined &&
      (!Number.isSafeInteger(count) ||
        Number(count) < (key === "minimumCount" ? 1 : 0))
    ) {
      throw new Error(`review.${key} has an invalid count`);
    }
  }
  if (
    review.adapters !== undefined &&
    (review.adapters === null ||
      typeof review.adapters !== "object" ||
      Array.isArray(review.adapters))
  ) {
    throw new Error("review.adapters must be an object");
  }
  return review;
}

/**
 * Validate a distinct persisted string-list field.
 * @param items Field value.
 * @param key Field name.
 */
function validateList(items: JsonValue | undefined, key: string): void {
  if (items === undefined) return;
  if (
    !Array.isArray(items) ||
    items.some(item => typeof item !== "string" || !item.trim()) ||
    new Set(items).size !== items.length ||
    (key === "providers" && items.length === 0)
  ) {
    throw new Error(`review.${key} must be distinct nonempty strings`);
  }
}
